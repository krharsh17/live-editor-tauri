
import DefraDBClient from '../utils/DefraDBClient';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// DefraDB Client Configuration
const DEFRA_DB_ENDPOINT = 'http://localhost:9181/api/v0/graphql';

// Initialize DefraDB client
const defraClient = new DefraDBClient(DEFRA_DB_ENDPOINT);

// Custom hook for DefraDB integration
export default function useDefraDB() {
  const [note, setNote] = useState(null);
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [syncStatus, setSyncStatus] = useState('synced');
  
  // Peer connection state
  const [peerInfo, setPeerInfo] = useState(null);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const [isPeerLoading, setIsPeerLoading] = useState(true);

  // Track if user is actively editing to prevent polling overwrites
  const [isUserEditing, setIsUserEditing] = useState(false);
  
  // Track peer connections
  const [hasPeerConnections, setHasPeerConnections] = useState(false);

  // Check DefraDB connection on first load (client-side only)
  useEffect(() => {
    const initializeDefraDB = async () => {
      try {
        await defraClient.checkConnection();
        console.log('DefraDB connection verified');
        await loadNotes(); // Load notes after verifying connection
      } catch (error) {
        console.error('DefraDB initialization failed:', error);
        setIsOffline(true);
        setSyncStatus('error');
      }
    };

    // Only initialize on client-side
    if (typeof window !== 'undefined') {
      initializeDefraDB();
    }
  }, []);

  // Peer connection management
  useEffect(() => {
    let unlisten;
    let logUnlisten;

    const setupPeerListener = async () => {
      try {
        // First, check if peer info is already available
        try {
          const existingPeerInfo = await invoke('get_peer_info');
          if (existingPeerInfo) {
            console.log('Found existing peer info:', existingPeerInfo);
            const parsed = JSON.parse(existingPeerInfo);
            setPeerInfo(parsed);
            setIsPeerConnected(true);
            setIsPeerLoading(false);
          }
        } catch (error) {
          console.log('No existing peer info found:', error);
        }

        // Listen for peer info events from the Tauri backend
        unlisten = await listen('defradb-peer-info', (event) => {
          console.log('Received peer info event:', event.payload);
          try {
            // The payload is already parsed JSON from the Rust backend
            const peerData = event.payload;
            setPeerInfo(peerData);
            setIsPeerConnected(true);
            setIsPeerLoading(false);
          } catch (error) {
            console.error('Failed to process peer info:', error);
            setIsPeerLoading(false);
          }
        });

        console.log('Peer info listener set up successfully');

      } catch (error) {
        console.error('Failed to set up peer info listener:', error);
        setIsPeerLoading(false);
      }
    };

    setupPeerListener();

    // Cleanup on unmount
    return () => {
      if (unlisten) {
        unlisten();
      }
      if (logUnlisten) {
        logUnlisten();
      }
    };
  }, []);

  // Add timeout for peer loading to prevent infinite loading
  useEffect(() => {
    if (isPeerLoading) {
      const timeout = setTimeout(() => {
        console.log('Peer loading timeout - assuming connection failed');
        setIsOffline(true);
        setSyncStatus('offline');
      }, 5000); // 5 second timeout (reduced from 10)

      return () => clearTimeout(timeout);
    }
  }, [isPeerLoading]);

  

  useEffect(() => {
    let isSubscribed = true;
    let subscription = null;

    const subscribeToNote = async () => {
      if (note?._docID) {
        try {
          subscription = await defraClient.subscribeToNote(
            note._docID,
            (data) => {
              if (isSubscribed && data.data && data.data.Note && data.data.Note.length > 0) {
                setNote(data.data.Note[0]);
              }
            },
            (error) => {
              console.error('Note subscription error:', error);
            }
          );
        } catch (error) {
          console.error('Failed to subscribe to note:', error);
        }
      }
    };

    //Subscribe if selectedNoteID is set
    subscribeToNote();

    // Cleanup: unsubscribe on noteID change or unmount
    return () => {
      isSubscribed = false;
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
    };
  }, [note?._docID]);

  // Load all notes
  const loadNotes = async () => {
    try {
      const result = await defraClient.getNotes();
      setNotes(result.Note || []);
    } catch (error) {
      console.error('Failed to load notes:', error);
      setIsOffline(true);
    }
  };

  // Load specific note
  const loadNote = async (id) => {
    if (!id) return;
    
    try {
      setIsLoading(true);
      const noteData = await defraClient.getNote(id);
      setNote(noteData);
      console.log('noteData', noteData);
    } catch (error) {
      console.error('Failed to load note:', error);
      setIsOffline(true);
    } finally {
      console.log("Note loaded")
      setIsLoading(false);
    }
  };

  // Create new note
  const createNote = async (noteData) => {
    try {
      setSyncStatus('syncing');
      const result = await defraClient.createNote({
        ...noteData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      
      const newNote = result.create_Note[0];
      console.log('Created new note:', newNote);
      
      // Add to local state immediately
      setNotes(prev => {
        // Check if note already exists to avoid duplicates
        const exists = prev.some(note => note._docID === newNote._docID);
        if (exists) {
          return prev;
        }
        return [...prev, newNote];
      });
      
      setSyncStatus('synced');
      return newNote;
    } catch (error) {
      console.error('Failed to create note:', error);
      setSyncStatus('error');
      setIsOffline(true);
      throw error;
    }
  };

  // Update note
  const updateNote = async (docID, updates) => {
    if (!docID) return;
    
    try {
      // Convert content string to paragraph array if content is being updated
      const processedUpdates = { ...updates };
      if (updates.content && typeof updates.content === 'string') {
        // Split by double newlines to get paragraphs, then split each paragraph by single newlines
        const paragraphs = updates.content.split('\n\n').map(paragraph => 
          paragraph.split('\n')
        ).flat();
        processedUpdates.content = paragraphs;
      }
      
      const result = await defraClient.updateNote(docID, {
        ...processedUpdates,
        updatedAt: new Date().toISOString(),
      });
      
      const updatedNote = result.update_Note[0];
      setNote(updatedNote);
      setNotes(prev => prev.map(n => n._docID === docID ? updatedNote : n));
      
      return updatedNote;
    } catch (error) {
      console.error('Failed to update note:', error);
      throw error;
    }
  };

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setSyncStatus('synced');
      loadNotes(); // Refresh data when coming back online
    };
    
    const handleOffline = () => {
      setIsOffline(true);
      setSyncStatus('offline');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Schema creation function
  const createSchema = async () => {
    try {
      const result = await invoke('create_schema');
      console.log('Schema creation result:', result);
      return result;
    } catch (error) {
      console.error('Failed to create schema:', error);
      return false;
    }
  };

  // Peer connection function
  const connectToPeer = async (peerId) => {
    try {
      const result = await invoke('connect_to_peer', { peerId });
      console.log('Peer connection result:', result);
      return { success: true, message: result };
    } catch (error) {
      console.error('Failed to connect to peer:', error);
      return { success: false, message: error };
    }
  };

  // Check if any peers are connected
  const checkPeerConnections = async () => {
    try {
      const hasConnections = await invoke('check_peer_connections');
      console.log('Peer connections status:', hasConnections);
      setHasPeerConnections(hasConnections);
      return hasConnections;
    } catch (error) {
      console.error('Failed to check peer connections:', error);
      setHasPeerConnections(false);
      return false;
    }
  };

  // Periodically check peer connections
  useEffect(() => {
    const checkConnections = async () => {
      await checkPeerConnections();
    };

    // Check immediately
    checkConnections();

    // Check every 10 seconds
    const interval = setInterval(checkConnections, 10000);

    return () => clearInterval(interval);
  }, []);

  // Simple user input handler - send content directly to database
  const handleUserInput = (docID, updates) => {
    console.log('handleLocalUserInput called with:', updates);
    
    setIsUserEditing(true);
    
    // Save immediately to database - no debouncing here since QuillEditor already debounced
    (async () => {
      try {
        console.log('Sending content to DefraDB:', updates);
        await updateNote(docID, updates);
        
        // Reset editing state after successful save
        setTimeout(() => {
          setIsUserEditing(false);
        }, 1000);
      } catch (error) {
        console.error('Failed to save user input:', error);
        setIsUserEditing(false);
      }
    })();
  };

  return {
    note,
    notes,
    isLoading,
    isOffline,
    syncStatus,
    isPeerConnected,
    isPeerLoading,
    peerInfo,
    hasPeerConnections,
    createNote,
    updateNote,
    handleUserInput,
    loadNotes,
    loadNote,
    createSchema,
    connectToPeer,
    checkPeerConnections,
    isUserEditing,
  };
}