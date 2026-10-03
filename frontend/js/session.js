/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Portal Session Guard
 *
 * Replaces the old firebase-init.js pattern of reading Firestore
 * directly from the browser (window.db.collection(...)).
 *
 * Now: the browser only ever talks to Firebase Auth (sign-in, ID
 * tokens) and to the Cloudflare Worker API (everything else).
 * The Worker is the only thing with Firestore access.
 */

import {
  watchAuthState,
  getIdToken,
  logout as firebaseLogout,
} from "./firebase-auth.js";

import { api } from "./api-client.js";

const SESSION_TIMEFRAME_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_TIMESTAMP_KEY = "fahmid_login_time";

/**
 * Record the moment the user logged in, so we can enforce the
 * 8-hour re-authentication window.
 */
export function recordLoginTimestamp() {
  localStorage.setItem(SESSION_TIMESTAMP_KEY, String(Date.now()));
}

export function clearLoginTimestamp() {
  localStorage.removeItem(SESSION_TIMESTAMP_KEY);
}

export function isSessionWithinTimeframe() {
  const stored = localStorage.getItem(SESSION_TIMESTAMP_KEY);
  if (!stored) return false;
  const elapsed = Date.now() - parseInt(stored, 10);
  return elapsed >= 0 && elapsed < SESSION_TIMEFRAME_MS;
}

/**
 * Show a message to the user. Falls back to alert() if the
 * marketing-site toast script (script.js) isn't loaded on this page.
 */
function notify(message, type = "info", duration = 4000) {
  if (typeof window.showToast === "function") {
    window.showToast(message, type, duration);
  } else {
    alert(message);
  }
}

/**
 * Wait for Firebase Auth to report the signed-in user (or null),
 * then confirm with the backend that the session is still valid
 * and fetch the user's role. This is the module every portal page
 * (admin.html, teacher.html, pupil.html) should call on load.
 *
 * Usage:
 *   const session = await requireRole('admin');
 *   // session = { uid, email, role }
 */
export function requireRole(requiredRole) {
  return new Promise((resolve, reject) => {
    const unsubscribe = watchAuthState(async (user) => {
      unsubscribe();

      if (!user) {
        notify("Please log in to continue", "warning");
        redirectToLogin();
        reject(new Error("Not authenticated"));
        return;
      }

      if (!isSessionWithinTimeframe()) {
        clearLoginTimestamp();
        await firebaseLogout().catch(() => {});
        notify("Your session has expired. Please log in again.", "info", 5000);
        redirectToLogin();
        reject(new Error("Session expired"));
        return;
      }

      try {
        const { user: profile } = await api.get("/api/auth/me");

        if (!profile || profile.role !== requiredRole) {
          notify("Access denied. Insufficient permissions.", "danger");
          await firebaseLogout().catch(() => {});
          redirectToLogin();
          reject(new Error("Insufficient permissions"));
          return;
        }

        startSessionWatch();

        resolve({
          uid: profile.uid,
          email: profile.email,
          role: profile.role,
          profile: profile.profile,
        });
      } catch (error) {
        handleApiError(error, "Error verifying permissions");
        reject(error);
      }
    });
  });
}

let sessionCheckIntervalId = null;

function startSessionWatch() {
  if (sessionCheckIntervalId) clearInterval(sessionCheckIntervalId);
  sessionCheckIntervalId = setInterval(() => {
    if (!isSessionWithinTimeframe()) {
      clearInterval(sessionCheckIntervalId);
      sessionCheckIntervalId = null;
      clearLoginTimestamp();
      firebaseLogout()
        .catch(() => {})
        .finally(() => {
          notify("Your session has expired. Please log in again.", "info", 5000);
          redirectToLogin();
        });
    }
  }, 60 * 1000);
}

function redirectToLogin() {
  setTimeout(() => {
    window.location.href = "/login";
  }, 1500);
}

/**
 * Fetch the school's current term/session settings from the backend.
 * (Was previously a direct Firestore read via SessionCache / firebase-init.js.)
 * The Worker applies its own short-lived cache, so pages can call
 * this freely.
 */
export async function getCurrentSettings() {
  try {
    const { settings } = await api.get("/api/school/settings");
    return settings;
  } catch (error) {
    handleApiError(error, "Could not load school settings");
    return {
      term: "First Term",
      session: "2025/2026",
      currentSession: null,
      resumptionDate: null,
      promotionPeriodActive: false,
    };
  }
}

/**
 * Shared error → toast translation for API errors returned by
 * api-client.js (error.code / error.status / error.message).
 */
export function handleApiError(error, fallbackMessage = "An error occurred") {
  const code = error?.code || "UNKNOWN";

  // These match the codes worker.js's global error handler actually
  // sends: UNAUTHORIZED (not logged in / bad token), FORBIDDEN (logged
  // in but not allowed), VALIDATION_ERROR (bad request body/params).
  const MESSAGES = {
    UNAUTHORIZED: "You must be logged in to perform this action.",
    FORBIDDEN: "You don't have permission to do that.",
    VALIDATION_ERROR: fallbackMessage,
    NOT_FOUND: "The requested resource was not found.",
    REQUEST_FAILED: fallbackMessage,
  };

  const userMessage = MESSAGES[code] || `${fallbackMessage}: ${error?.message || "Unknown error"}`;

  if (error?.status === 401) {
    notify("🔒 " + MESSAGES.UNAUTHORIZED, "danger", 3000);
    redirectToLogin();
    return userMessage;
  }

  notify(userMessage, "danger", 6000);
  return userMessage;
}

/**
 * Log in, then send the browser to the shared portal landing page
 * (portal.html reads the role and redirects onward).
 */
export async function login(email, password, signIn) {
  await signIn(email, password);
  recordLoginTimestamp();
  notify("Login successful!", "success");
  setTimeout(() => {
    window.location.href = "/portal.html";
  }, 800);
}

/**
 * Log out and return to the public login page.
 */
export async function logout() {
  clearLoginTimestamp();
  await firebaseLogout();
  notify("Logged out successfully", "success");
  setTimeout(() => {
    window.location.href = "/login";
  }, 800);
}

/**
 * Get a fresh Firebase ID token — re-exported so pages don't need
 * to import from two different files.
 */
export { getIdToken };
