/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Firebase Initialization & Shared Authentication
 * @version 3.3.0
 * @date 2026-07-02
 */
'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyD0A1zJ9bGCwk_UioAbgsNWrV2M9C51aDo",
  authDomain: "fahmid-school.firebaseapp.com",
  projectId: "fahmid-school",
  storageBucket: "fahmid-school.firebasestorage.app",
  messagingSenderId: "48604608508",
  appId: "1:48604608508:web:5b387a2de260b9851a6479",
  measurementId: "G-HEC84JXFY2"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

window.db = firebase.firestore();
window.auth = firebase.auth();
window.firebase = firebase;

// onAuthStateChanged's first callback is the SDK's guarantee that session
// rehydration from storage is complete. Pages should await this instead
// of polling auth.currentUser directly.
window.authReadyPromise = new Promise((resolve) => {
  let settled = false;

  const unsubscribe = window.auth.onAuthStateChanged((user) => {
    if (settled) return;
    settled = true;
    unsubscribe();
    resolve(user);
  });

  setTimeout(() => {
    if (settled) return;
    settled = true;
    try { unsubscribe(); } catch (e) {}
    resolve(window.auth.currentUser);
  }, 10000);
});

window.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch((error) => {});

try {
  window.db.enablePersistence({
    synchronizeTabs: true
  }).catch((err) => {});
} catch (error) {}

// If a user logged in on this device within SESSION_TIMEFRAME_MS, they are
// auto-logged-in silently. Once that window passes, they must re-enter
// credentials regardless of activity.
const SESSION_TIMEFRAME_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_TIMESTAMP_KEY = 'fahmid_login_time';

window.SESSION_TIMEFRAME_MS = SESSION_TIMEFRAME_MS;
window.SESSION_TIMESTAMP_KEY = SESSION_TIMESTAMP_KEY;

window.recordLoginTimestamp = function() {
  localStorage.setItem(SESSION_TIMESTAMP_KEY, String(Date.now()));
};

window.clearLoginTimestamp = function() {
  localStorage.removeItem(SESSION_TIMESTAMP_KEY);
};

window.isSessionWithinTimeframe = function() {
  const stored = localStorage.getItem(SESSION_TIMESTAMP_KEY);
  if (!stored) return false;
  const elapsed = Date.now() - parseInt(stored, 10);
  return elapsed >= 0 && elapsed < SESSION_TIMEFRAME_MS;
};

let sessionCheckIntervalId = null;

function enforceSessionTimeframe() {
  const user = window.auth.currentUser;
  if (!user) return;

  const stored = localStorage.getItem(SESSION_TIMESTAMP_KEY);

  if (!stored) {
    window.recordLoginTimestamp();
    return;
  }

  const elapsed = Date.now() - parseInt(stored, 10);
  if (elapsed >= SESSION_TIMEFRAME_MS) {
    window.clearLoginTimestamp();
    window.auth.signOut()
      .then(() => {
        window.showToast?.(
          'Your session has expired. Please log in again.',
          'info',
          5000
        );
        setTimeout(() => {
          window.location.href = 'login';
        }, 1500);
      })
      .catch(error => {});
  }
}

window.auth.onAuthStateChanged(user => {
  if (user) {
    if (sessionCheckIntervalId) clearInterval(sessionCheckIntervalId);
    enforceSessionTimeframe();
    sessionCheckIntervalId = setInterval(enforceSessionTimeframe, 60 * 1000);
  } else {
    if (sessionCheckIntervalId) {
      clearInterval(sessionCheckIntervalId);
      sessionCheckIntervalId = null;
    }
  }
});

window.ERROR_MESSAGES = {
  'auth/email-already-in-use': 'This email is already registered.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'Password should be at least 6 characters long.',
  'auth/user-not-found': 'No account found with this email address.',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/invalid-login-credentials': 'Invalid email or password. Please try again.',
  'auth/invalid-credential': 'Invalid email or password. Please try again.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled.',
  'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your internet connection.',
  'auth/popup-closed-by-user': 'Sign-in cancelled.',
  'auth/cancelled-popup-request': 'Sign-in cancelled.',
  'auth/missing-password': 'Please enter your password.',
  'auth/internal-error': 'An internal error occurred. Please try again.',
  'permission-denied': 'Permission denied. Check your access rights.',
  'not-found': 'Resource not found.',
  'unavailable': 'Service temporarily unavailable. Please try again.',
  'deadline-exceeded': 'Request timeout. Please check your connection.',
  'unauthenticated': 'You must be logged in to perform this action.',
  'auth/unauthenticated': 'You must be logged in to perform this action.',
  'unknown': 'An unexpected error occurred.'
};

window.handleError = function(error, fallbackMessage = 'An error occurred') {
  const errorCode = error.code || 'unknown';

  let userMessage = fallbackMessage;

  if (window.ERROR_MESSAGES[errorCode]) {
    userMessage = window.ERROR_MESSAGES[errorCode];
  } else if (error.message) {
    userMessage = `${fallbackMessage}: ${error.message}`;
  }

  if (errorCode === 'unauthenticated' || errorCode === 'auth/unauthenticated') {
    userMessage = '🔒 You must be logged in to perform this action.';
    if (window.showToast) {
      window.showToast(userMessage, 'danger', 3000);
    } else {
      alert(userMessage);
    }
    setTimeout(() => {
      window.location.href = 'login';
    }, 2000);
    return userMessage;
  }

  if (window.showToast) {
    window.showToast(userMessage, 'danger', 6000);
  } else {
    alert(userMessage);
  }

  return userMessage;
};

window.getCurrentSettings = async function() {
  const defaultSettings = {
    term: 'First Term',
    session: '2025/2026',
    currentSession: {
      name: '2025/2026',
      startYear: 2025,
      endYear: 2026,
      startDate: null,
      endDate: null
    },
    resumptionDate: null,
    promotionPeriodActive: false
  };

  try {
    const settingsDoc = await window.db.collection('settings').doc('current').get();

    if (!settingsDoc.exists) {
      return defaultSettings;
    }

    const data = settingsDoc.data();

    let sessionName = defaultSettings.session;
    let sessionData = defaultSettings.currentSession;

    if (data.currentSession && typeof data.currentSession === 'object') {
      sessionName = data.currentSession.name ||
                    `${data.currentSession.startYear}/${data.currentSession.endYear}` ||
                    defaultSettings.session;
      sessionData = {
        name: sessionName,
        startYear: data.currentSession.startYear || defaultSettings.currentSession.startYear,
        endYear: data.currentSession.endYear || defaultSettings.currentSession.endYear,
        startDate: data.currentSession.startDate || null,
        endDate: data.currentSession.endDate || null
      };
    } else if (data.session) {
      sessionName = data.session;
      const yearMatch = data.session.match(/(\d{4})\/(\d{4})/);
      if (yearMatch) {
        sessionData = {
          name: data.session,
          startYear: parseInt(yearMatch[1]),
          endYear: parseInt(yearMatch[2]),
          startDate: null,
          endDate: null
        };
      }
    }

    return {
      term: data.term || defaultSettings.term,
      session: sessionName,
      currentSession: sessionData,
      resumptionDate: data.resumptionDate || null,
      promotionPeriodActive: Boolean(data.promotionPeriodActive)
    };

  } catch (error) {
    return defaultSettings;
  }
};

window.getUserRole = async function(uid) {
  try {
    const doc = await window.db.collection('users').doc(uid).get();
    return doc.exists ? (doc.data().role || 'pupil') : null;
  } catch (error) {
    return null;
  }
};

window.checkRole = function(requiredRole) {
  return new Promise((resolve, reject) => {
    window.auth.onAuthStateChanged(async (user) => {
      if (!user) {
        window.showToast?.('Please log in to continue', 'warning');
        setTimeout(() => window.location.href = 'login', 1500);
        reject(new Error('Not authenticated'));
        return;
      }

      try {
        const userDoc = await window.db.collection('users').doc(user.uid).get();

        if (!userDoc.exists) {
          window.showToast?.('User profile not found', 'danger');
          await window.auth.signOut();
          setTimeout(() => window.location.href = 'login', 1500);
          reject(new Error('User profile not found'));
          return;
        }

        const userData = userDoc.data();

        if (userData.role !== requiredRole) {
          window.showToast?.('Access denied. Insufficient permissions.', 'danger');
          await window.auth.signOut();
          setTimeout(() => window.location.href = 'login', 2000);
          reject(new Error('Insufficient permissions'));
          return;
        }

        resolve({
          uid: user.uid,
          email: user.email,
          role: userData.role
        });
      } catch (error) {
        window.handleError(error, 'Error verifying permissions');
        reject(error);
      }
    });
  });
};

window.login = async function(email, password) {
  try {
    await window.auth.signInWithEmailAndPassword(email, password);
    window.recordLoginTimestamp();
    window.showToast?.('Login successful!', 'success');
    setTimeout(() => window.location.href = 'portal.html', 800);
  } catch (error) {
    window.handleError(error, 'Login failed');
    throw error;
  }
};

window.logout = async function() {
  try {
    window.clearLoginTimestamp();
    await window.auth.signOut();
    window.showToast?.('Logged out successfully', 'success');
    setTimeout(() => window.location.href = 'login', 800);
  } catch (error) {
    window.handleError(error, 'Logout failed');
  }
};

window.getAllTeachers = async function() {
  try {
    const snapshot = await window.db.collection('teachers').get();
    const teachers = [];
    snapshot.forEach(doc => {
      teachers.push({ uid: doc.id, ...doc.data() });
    });
    return teachers.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    return [];
  }
};

window.retryWithBackoff = async function(operation, maxRetries = 3, operationName = 'Operation') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                window.showToast?.(
                    `Retrying ${operationName}... (Attempt ${attempt}/${maxRetries})`,
                    'info',
                    2000
                );
            }

            const result = await operation();

            if (attempt > 1) {
                window.showToast?.(
                    `✓ ${operationName} succeeded after ${attempt} attempt(s)`,
                    'success',
                    3000
                );
            }

            return result;

        } catch (error) {
            lastError = error;

            const isRetryable =
                error?.code === 'unavailable' ||
                error?.code === 'deadline-exceeded' ||
                error?.code === 'cancelled' ||
                /network|timeout|unavailable/i.test(error?.message || '');

            if (!isRetryable) {
                throw error;
            }

            if (attempt === maxRetries) {
                window.showToast?.(
                    `${operationName} failed after ${maxRetries} attempts. Please check your connection.`,
                    'danger',
                    6000
                );
                throw lastError;
            }

            const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 8000);

            await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
    }

    throw lastError;
};

window.firestoreGet = async function(ref, operationName = 'Fetch document') {
    return window.retryWithBackoff(() => ref.get(), 3, operationName);
};

window.firestoreSet = async function(ref, data, options = null, operationName = 'Save document') {
    return window.retryWithBackoff(
        () => options ? ref.set(data, options) : ref.set(data),
        3,
        operationName
    );
};

window.firestoreUpdate = async function(ref, data, operationName = 'Update document') {
    return window.retryWithBackoff(() => ref.update(data), 3, operationName);
};

window.firestoreDelete = async function(ref, operationName = 'Delete document') {
    return window.retryWithBackoff(() => ref.delete(), 2, operationName);
};

window.encodeSession = function(session) {
  if (!session) return '';
  return session.replace(/\//g, '-');
};

window.decodeSession = function(encodedSession) {
  if (!encodedSession) return '';
  return encodedSession.replace(/-/g, '/');
};

window.generatePaymentDocId = function(pupilId, session, term) {
  const encodedSession = window.encodeSession(session);
  return `${pupilId}_${encodedSession}_${term}`;
};

window.generateFeeStructureDocId = function(classId, session, term) {
  const encodedSession = window.encodeSession(session);
  return `${classId}_${encodedSession}_${term}`;
};
