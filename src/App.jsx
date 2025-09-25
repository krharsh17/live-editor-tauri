"use client"
import { useState, useEffect } from 'react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import QuillEditor from './components/QuillEditor.jsx';
import useDefraDB from './hooks/useDefraDB.js';
import useCurrentUser from './hooks/useCurrentUser.js';


// Main App Component
export default function DefraNotesApp() {
  const [currentNoteId, setCurrentNoteId] = useState(null);
  const { user, isClient } = useCurrentUser();
  
  const {
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
    loadNote,
    handleUserInput,
    connectToPeer,
    isUserEditing
  } = useDefraDB();

  const handleNewNote = async () => {
    if (!isClient) return; // Wait for client-side hydration
    
    try {
      const newNote = await createNote({
        title: 'New Note',
        content: '', // Start with empty string for UI
        workspace: 'default',
        authorId: user.id,
      });
      console.log('New note created:', newNote);
      console.log('Setting current note ID to:', newNote._docID);
      setCurrentNoteId(newNote._docID);
    } catch (error) {
      console.error('Failed to create note:', error);
      alert('Failed to create note. Check DefraDB connection.');
    }
  };

  useEffect(() => {
    console.log('note', note);
  }, [note])

  const handleNoteSelect = (noteId) => {
    console.log('handleNoteSelect', noteId);
    setCurrentNoteId(noteId);
  };

  const handleUpdateNote = async (docID, updates) => {
    return updateNote(docID, updates);
  };

  // Auto-select first note if none selected
  useEffect(() => {
    if (!currentNoteId && notes.length > 0 && !isLoading && isClient) {
      setCurrentNoteId(notes[0]._docID);
    }
  }, []);

  useEffect(() => {
    loadNote(currentNoteId);
  }, [currentNoteId]);

  

  // Don't render user-dependent content until client-side hydration
  if (!isClient) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">Loading DefraDB Notes App...</div>
      </div>
    );
  }

  // Show peer connection status while loading (but not indefinitely)
  if (isPeerLoading && !isOffline) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="text-gray-500 mb-2">Connecting to DefraDB...</div>
          <div className="text-sm text-gray-400">Establishing peer connection</div>
          <div className="text-xs text-gray-300 mt-2">This may take a few moments</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
        <Header 
          note={note} 
          isOffline={isOffline} 
          syncStatus={syncStatus} 
          user={user}
          isPeerConnected={isPeerConnected}
          peerInfo={peerInfo}
          hasPeerConnections={hasPeerConnections}
          connectToPeer={connectToPeer}
        />
      
      <div className="flex-1 flex overflow-hidden">
        <Sidebar 
          notes={notes}
          currentNoteId={currentNoteId}
          onNoteSelect={handleNoteSelect}
          onNewNote={handleNewNote}
          isLoading={isLoading}
        />
        
        <QuillEditor 
          note={note}
          onUpdateNote={handleUpdateNote}
          onUserInput={handleUserInput}
          user={user}
          isLoading={isLoading}
          syncStatus={syncStatus}
          isUserEditing={isUserEditing}
        />
      </div>
      
    </div>
  );
}