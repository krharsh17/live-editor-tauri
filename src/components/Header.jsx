import { useState, useEffect } from 'react';
import PeerConnectionDialog from './PeerConnectionDialog';

export default function Header({ note, isOffline, syncStatus, user, isPeerConnected, peerInfo, hasPeerConnections, connectToPeer }) {
  const [showPeerDialog, setShowPeerDialog] = useState(false);
  const getSyncStatusColor = () => {
    if (hasPeerConnections) {
      return 'bg-green-100 text-green-800';
    }
    if (isPeerConnected) {
      return 'bg-blue-100 text-blue-800';
    }
    switch (syncStatus) {
      case 'syncing': return 'bg-yellow-100 text-yellow-800';
      case 'synced': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      case 'offline': return 'bg-gray-100 text-gray-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  const getSyncStatusText = () => {
    if (hasPeerConnections) {
      return 'Peers Connected';
    }
    if (isPeerConnected) {
      return 'DefraDB Connected';
    }
    switch (syncStatus) {
      case 'syncing': return 'Syncing...';
      case 'synced': return 'Synced';
      case 'error': return 'Sync Error';
      case 'offline': return 'Offline';
      default: return 'Connecting...';
    }
  };

  return (
    <div className="border-b border-gray-200 p-4 bg-white">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl text-gray-700 font-semibold">
            {note?.title || 'No note selected'}
          </h1>
          <div className="text-sm text-gray-500 mt-1">
            Workspace: {note?.workspace || 'default'} • DefraDB CRDT
          </div>
          {note?._version?.[0] && (
            <div className="text-xs text-gray-400 mt-1">
              Version: {note._version[0].height} • CID: {note._version[0].cid.slice(0, 12)}...
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
              {user.name.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-sm text-gray-600">{user.name}</span>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowPeerDialog(true)}
              className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600"
              title="Connect to Peer"
            >
              Connect
            </button>
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs ${getSyncStatusColor()}`}>
              <div className={`w-2 h-2 rounded-full ${
                hasPeerConnections ? 'bg-green-500' :
                isPeerConnected ? 'bg-blue-500' :
                syncStatus === 'syncing' ? 'animate-pulse bg-yellow-500' :
                syncStatus === 'synced' ? 'bg-green-500' :
                syncStatus === 'error' ? 'bg-red-500' : 'bg-gray-500'
              }`}></div>
              <span>{getSyncStatusText()}</span>
            </div>
          </div>
        </div>
      </div>
      
        <PeerConnectionDialog 
          isOpen={showPeerDialog} 
          onClose={() => setShowPeerDialog(false)}
          currentPeerInfo={peerInfo}
          connectToPeer={connectToPeer}
        />
    </div>
  );
}