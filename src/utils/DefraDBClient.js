import { fetch } from "@tauri-apps/plugin-http";

export default class DefraDBClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.subscriptions = new Map();
    this.pollingIntervals = new Map();
    this.subscriptionId = 0;
  }

  async query(query, variables = {}) {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.errors) {
        throw new Error(result.errors[0].message);
      }

      return result.data;
    } catch (error) {
      console.error('DefraDB query error:', error);
      throw error;
    }
  }
  
  async checkConnection() {
    // Simple query to verify DefraDB connection and schema
    try {
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `;
      
      const result = await this.query(query);
      const hasNoteType = result.__schema.types.some(type => type.name === 'Note');
      
      if (!hasNoteType) {
        throw new Error('Note schema not found. Please add schema via DefraDB CLI first.');
      }
      
      return true;
    } catch (error) {
      console.error('DefraDB connection/schema check failed:', error);
      throw error;
    }
  }

  async createNote(note) {
    const mutation = `
      mutation {
        create_Note(input: {title: "${note.title}", content: "${note.content || ''}", workspace: "${note.workspace}", createdAt: "${note.createdAt}", updatedAt: "${note.updatedAt}", authorId: "${note.authorId}"}) {
          _docID
          title
          content
          workspace
          createdAt
          updatedAt
          authorId
        }
      }
    `;

    return this.query(mutation, { input: [note] });
  }

  async updateNote(docID, updates) {
    const mutation = `
      mutation {
        update_Note(docID: "${docID}", input: {
          title: "${updates.title}",
          content: "${updates.content || ''}",
          workspace: "${updates.workspace || ''}",
          updatedAt: "${updates.updatedAt || new Date().toISOString()}"
        }) {
          _docID
          title
          content
          workspace
          createdAt
          updatedAt
          authorId
        }
      }
    `;

    return this.query(mutation, { docID, input: updates });
  }

  // Note: updateNoteLine removed - no longer needed with string content

  async getNotes() {
    const query = `                        
      query {
        Note {
          _docID
          title
          content
          workspace
          createdAt
          updatedAt
          authorId
        }
      }
    `;

    return this.query(query);
  }

  async getNote(docID) {
    const query = `
      query {
        Note(docID: "${docID}") {
          _docID
          title
          content
          workspace
          createdAt
          updatedAt
          authorId
        }
      }
    `;

    const result = await this.query(query, { docID });
    return result.Note?.[0];
  }

  // Get notes with only version info for efficient change detection
  async getNotesVersions(workspace = 'default') {
    const query = `
      query GetNotesVersions($workspace: String) {
        Note(filter: { workspace: { _eq: $workspace } }) {
          _docID
          updatedAt
          _version {
            cid
            height
          }
        }
      }
    `;

    return this.query(query, { workspace });
  }

  // Get only version info for a specific note
  async getNoteVersion(docID) {
    const query = `
      query GetNoteVersion($docID: ID!) {
        Note(docID: $docID) {
          _docID
          updatedAt
          _version {
            cid
            height
          }
        }
      }
    `;

    const result = await this.query(query, { docID });
    return result.Note?.[0];
  }

  async getCommits(docID) {
    const query = `
      query GetCommits($docID: String!) {
        latestCommits(docID: $docID) {
          cid
          height
          delta {
            payload
          }
          links {
            cid
            name
          }
        }
      }
    `;

    return this.query(query, { docID });
  }

  // Batch version check for multiple documents
  async checkDocumentVersions(docIDs) {
    if (!docIDs || docIDs.length === 0) return [];

    const query = `
      query CheckVersions($docIDs: [ID!]!) {
        Note(filter: { _docID: { _in: $docIDs } }) {
          _docID
          updatedAt
          _version {
            cid
            height
          }
        }
      }
    `;

    return this.query(query, { docIDs });
  }

  // Polling-based real-time updates
  async startPolling(query, variables, callback, errorCallback, interval = 2000) {
    const id = `poll_${++this.subscriptionId}`;
    
    const poll = async () => {
      try {
        const result = await this.query(query, variables);
        callback(result);
      } catch (error) {
        console.error('Polling error:', error);
        if (errorCallback) {
          errorCallback(error);
        }
      }
    };

    // Initial poll
    await poll();

    // Set up interval
    const intervalId = setInterval(poll, interval);
    this.pollingIntervals.set(id, intervalId);

    return {
      id,
      unsubscribe: () => {
        const intervalId = this.pollingIntervals.get(id);
        if (intervalId) {
          clearInterval(intervalId);
          this.pollingIntervals.delete(id);
        }
      }
    };
  }

  // Subscribe to note changes using polling
  async subscribeToNote(docID, callback, errorCallback) {
    const query = `
      query {
        Note(docID: "${docID}") {
          _docID
          title
          content
          workspace
          createdAt
          updatedAt
          authorId
        }
      }
    `;

    return this.startPolling(
      query,
      {},
      (result) => {
        if (result.Note && result.Note.length > 0) {
          callback({ data: { Note: result.Note } });
        }
      },
      errorCallback,
      1000 // Poll every 1 second for note updates
    );
  }

  // Subscribe to all notes changes using polling
  async subscribeToNotes(callback, errorCallback) {
    const query = `
      query {
        Note {
          _docID
          title
          content
          workspace
          createdAt
          updatedAt
          authorId
        }
      }
    `;

    return this.startPolling(
      query,
      {},
      (result) => {
        callback({ data: { Note: result.Note } });
      },
      errorCallback,
      2000 // Poll every 2 seconds for notes list updates
    );
  }

  // Cleanup all subscriptions
  disconnect() {
    this.pollingIntervals.forEach((intervalId) => {
      clearInterval(intervalId);
    });
    this.pollingIntervals.clear();
  }
}