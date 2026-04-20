import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        let role = 'admin';
        if (firebaseUser.email === 'owner@pos.com') role = 'owner';
        
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
             role = userDoc.data().role;
          } else {
             // Seed the user in Firestore if it doesn't exist
             await setDoc(userDocRef, {
                 email: firebaseUser.email,
                 role: role,
                 name: role === 'owner' ? 'Owner' : 'Admin'
             });
          }
        } catch (e) {
          console.warn("Firestore error, defaulting to email-based role.", e);
        }

        const userData = {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || (role === 'owner' ? 'Owner' : 'Admin'),
          username: firebaseUser.email.split('@')[0],
          role: role,
          email: firebaseUser.email
        };

        setUser(userData);
        setToken(await firebaseUser.getIdToken());
      } else {
        setUser(null);
        setToken(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = (tokenData, userData) => {
     // State is managed automatically by Firebase Auth observer
  };

  const logout = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export default AuthContext;

