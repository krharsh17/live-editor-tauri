import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Get current user (client-side only)
const useCurrentUser = () => {
  const [user, setUser] = useState({ id: 'anonymous', name: 'Anonymous' });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    let userId = localStorage.getItem('defraUserId');
    if (!userId) {
      userId = `user-${uuidv4()}`;
      localStorage.setItem('defraUserId', userId);
    }
    setUser({ id: userId, name: `User ${userId.slice(-8)}` });
  }, []);

  return { user, isClient };
};

export default useCurrentUser;