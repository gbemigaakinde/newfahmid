/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Firebase Authentication Client
 */

import {
  initializeApp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

import {
  firebaseConfig,
} from "./firebase-config.js";

/**
 * Initialize Firebase.
 */
const app =
  initializeApp(
    firebaseConfig,
  );

/**
 * Initialize Firebase Authentication.
 */
export const auth =
  getAuth(app);

/**
 * Keep users signed in across browser sessions.
 *
 * Firebase manages the refresh-token lifecycle.
 */
await setPersistence(
  auth,
  browserLocalPersistence,
);

/**
 * Sign in using email and password.
 */
export async function signIn(
  email,
  password,
) {
  const normalizedEmail =
    String(email || "")
      .trim()
      .toLowerCase();

  if (!normalizedEmail) {
    throw new Error(
      "Email address is required.",
    );
  }

  if (!password) {
    throw new Error(
      "Password is required.",
    );
  }

  const credential =
    await signInWithEmailAndPassword(
      auth,
      normalizedEmail,
      password,
    );

  return credential.user;
}

/**
 * Get a fresh Firebase ID token.
 *
 * This token is sent to the Cloudflare Worker.
 */
export async function getIdToken(
  forceRefresh = false,
) {
  const user =
    auth.currentUser;

  if (!user) {
    throw new Error(
      "You are not signed in.",
    );
  }

  return user.getIdToken(
    forceRefresh,
  );
}

/**
 * Get the currently authenticated Firebase user.
 */
export function getCurrentFirebaseUser() {
  return auth.currentUser;
}

/**
 * Listen for authentication state changes.
 */
export function watchAuthState(
  callback,
) {
  return onAuthStateChanged(
    auth,
    callback,
  );
}

/**
 * Sign out.
 */
export async function logout() {
  await signOut(auth);
}
