import { useState } from 'react';

export default function PeerConnectionDialog({ isOpen, onClose, currentPeerInfo, connectToPeer }) {
  const [peerId, setPeerId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');

  const handleConnect = async () => {
    if (!peerId.trim()) {
      setConnectionStatus('Please enter a peer ID');
      return;
    }

    setIsConnecting(true);
    setConnectionStatus('Connecting...');

    try {
      const result = await connectToPeer(peerId.trim());
      
      if (result.success) {
        setConnectionStatus('Connected successfully!');
      } else {
        setConnectionStatus('Connection failed: ' + result.message);
      }
    } catch (error) {
      console.error('Failed to connect to peer:', error);
      setConnectionStatus('Connection failed: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleClose = () => {
    setPeerId('');
    setConnectionStatus('');
    setIsConnecting(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Peer Connection</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Current Peer Info */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your Peer Info
            </label>
            <div className="p-3 bg-gray-100 rounded-md">
              <code className="text-sm text-gray-600 break-all">
                {JSON.stringify(currentPeerInfo) || 'Not connected'}
              </code>
            </div>
          </div>

          {/* Connect to Peer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Connect to Peer
            </label>
            <input
              type="text"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder="Enter peer info to connect to..."
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isConnecting}
            />
          </div>

          {/* Connection Status */}
          {connectionStatus && (
            <div className={`p-3 rounded-md text-sm ${
              connectionStatus.includes('successfully') 
                ? 'bg-green-100 text-green-800' 
                : connectionStatus.includes('failed') || connectionStatus.includes('Please enter')
                ? 'bg-red-100 text-red-800'
                : 'bg-blue-100 text-blue-800'
            }`}>
              {connectionStatus}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
              disabled={isConnecting}
            >
              Cancel
            </button>
            <button
              onClick={handleConnect}
              disabled={isConnecting || !peerId.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
