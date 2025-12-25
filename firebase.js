// Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 🔴 REPLACE WITH YOUR OWN CONFIG
 const firebaseConfig = {
    apiKey: "AIzaSyC4T0A0sbBMCm-byNKzCUG6XWw9WrjZYic",
    authDomain: "track-design-generator.firebaseapp.com",
    projectId: "track-design-generator",
    storageBucket: "track-design-generator.firebasestorage.app",
    messagingSenderId: "399045665604",
    appId: "1:399045665604:web:8bce1f749cf97be668ed11"
  };

// Init Firebase
const app = initializeApp(firebaseConfig);

// Firestore reference
window.db = getFirestore(app);
