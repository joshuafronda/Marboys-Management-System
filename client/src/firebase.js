import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyBhrD70_CVYRodyHGTYmhgoo6yIw3nZYv8",
  authDomain: "pos-marboys.firebaseapp.com",
  projectId: "pos-marboys",
  storageBucket: "pos-marboys.firebasestorage.app",
  messagingSenderId: "238742939377",
  appId: "1:238742939377:web:fce2ce1b67ff7b9abaab50",
  measurementId: "G-8Z33F6D6SP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
