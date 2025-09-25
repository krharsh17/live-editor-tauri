import React from 'react';
// Components
export default function Sidebar({ notes, currentNoteId, onNoteSelect, onNewNote, isLoading }) {
  return (
    <div className="w-64 bg-gray-50 border-r border-gray-200 p-4 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-800">Notes</h2>
        <button
          onClick={onNewNote}
          disabled={isLoading}
          className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
        >
          New Note
        </button>
      </div>
      
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="p-3 bg-gray-200 rounded animate-pulse h-16"></div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div
              key={note._docID}
              onClick={() => onNoteSelect(note._docID)}
              className={`p-3 rounded cursor-pointer transition-colors ${
                currentNoteId === note._docID 
                  ? 'bg-blue-100 border-l-4 border-blue-500' 
                  : 'hover:bg-gray-100'
              }`}
            >
              <div className="font-medium text-gray-700 font-semibold text-sm truncate">
                {note.title || 'Untitled Note'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : 'No date'}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                v{note._version?.[0]?.height || 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}