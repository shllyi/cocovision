// import { initializeApp, getApp, getApps } from 'firebase/app';
// import { 
//   initializeAuth, 
//   getReactNativePersistence, 
//   browserLocalPersistence, 
//   getAuth, 
//   Auth
// } from 'firebase/auth';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { Platform } from 'react-native';

import { Platform } from 'react-native';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyBSEk6-nlNqMA2MPxg7q-k3OjY6r2sXN-U",
  authDomain: "cocovision-bc7b9.firebaseapp.com",
  projectId: "cocovision-bc7b9",
  storageBucket: "cocovision-bc7b9.firebasestorage.app",
  messagingSenderId: "355795447724",
  appId: "1:355795447724:web:647c003778ce623ab41409",
  measurementId: "G-TE3JVG83FL"
};

// // 1. Initialize the App (Check if already initialized to avoid hot-reload errors)
// const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// // 2. Initialize Auth based on Platform
// let auth: Auth;

// try {
//   // Try to retrieve existing auth instance first
//   auth = getAuth(app);
// } catch (e) {
//   // If no instance exists, initialize it with the correct persistence
//   if (Platform.OS === 'web') {
//     auth = initializeAuth(app, {
//       persistence: browserLocalPersistence
//     });
//   } else {
//     auth = initializeAuth(app, {
//       persistence: getReactNativePersistence(AsyncStorage)
//     });
//   }
// }

// // 3. Export auth
// export { auth };

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createAuth() {
  if (Platform.OS === 'web') return getAuth(app);
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    // Fast refresh calls this twice. Reuse the existing instance.
    return getAuth(app);
  }
}

export const auth = createAuth();