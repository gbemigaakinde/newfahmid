/**
 * FAHMID NURSERY & PRIMARY SCHOOL
 * Admin Portal JavaScript
 * 
 * @version 8.0.0
 * @date 2026-01-27
 * 
 */

'use strict';

/**
 * Calculate adjusted fee (same logic as pupil portal)
 * Must be available before any admin financial functions run
 */
window.calculateAdjustedFee = function(pupilData, baseFee, currentTerm) {
  if (!pupilData || typeof baseFee !== 'number') {
    console.warn('Invalid pupilData or baseFee passed to calculateAdjustedFee');
    return baseFee || 0;
  }

  const termOrder = {
    'First Term':  1,
    'Second Term': 2,
    'Third Term':  3
  };

  const currentTermNum   = termOrder[currentTerm] || 1;
  const admissionTermNum = termOrder[pupilData.admissionTerm || 'First Term'] || 1;
  const exitTermNum      = termOrder[pupilData.exitTerm      || 'Third Term'] || 3;

  if (currentTermNum < admissionTermNum || currentTermNum > exitTermNum) {
    console.log(`Pupil ${pupilData.name} not enrolled for ${currentTerm}`);
    return 0;
  }

  const base = Math.round(Number(baseFee) || 0);

  const percentAdjustment = Number(pupilData.feeAdjustmentPercent) || 0;
  const amountAdjustment  = Number(pupilData.feeAdjustmentAmount)  || 0;

  const percentDiscount = Math.round(base * (percentAdjustment / 100));
  const adjustedFee     = Math.round(base + percentDiscount + amountAdjustment);

  if (percentAdjustment !== 0) {
    console.log(`Applied ${percentAdjustment}% adjustment: ₦${base.toLocaleString()} → discount ₦${percentDiscount.toLocaleString()}`);
  }
  if (amountAdjustment !== 0) {
    console.log(`Applied ₦${amountAdjustment.toLocaleString()} fixed adjustment`);
  }
  console.log(`Final adjusted fee: ₦${Math.max(0, adjustedFee).toLocaleString()}`);

  return Math.max(0, adjustedFee);
};

console.log('✅ calculateAdjustedFee() FIX 1 loaded');

/**
 * Calculate complete arrears WITHOUT double-counting
 * 
 */
window.calculateCompleteArrears = async function (pupilId, currentSession, currentTerm) {
  try {
    let totalArrears = 0;
    const encodedSession = currentSession.replace(/\//g, '-');

    const termOrder = {
      'First Term':  1,
      'Second Term': 2,
      'Third Term':  3
    };

    const currentTermNum = termOrder[currentTerm] || 1;

    console.log(`📊 Calculating arrears for pupil ${pupilId} — ${currentTerm}, ${currentSession}`);

    // ─── Helper: was this pupil enrolled in a given session + term?
    async function wasEnrolledIn(pupilData, checkSession, checkTerm) {
      const admissionSession = pupilData.admissionSession || null;
      const admissionTerm    = pupilData.admissionTerm    || 'First Term';
      const exitTerm         = pupilData.exitTerm         || 'Third Term';

      // Check exit term — pupil may have left before this term
      if ((termOrder[checkTerm] || 1) > (termOrder[exitTerm] || 3)) return false;

      if (!admissionSession) {
        // Legacy data: no session recorded. Use admissionTerm as a minimum guard.
        // We cannot compare sessions, so we trust termOrder within any session.
        return (termOrder[checkTerm] || 1) >= (termOrder[admissionTerm] || 1);
      }

      // Compare sessions by start year
      const sessionStartYear = (s) => {
        const m = (s || '').match(/(\d{4})\//);
        return m ? parseInt(m[1]) : 0;
      };

      const admissionYear = sessionStartYear(admissionSession);
      const checkYear     = sessionStartYear(checkSession);

      if (checkYear < admissionYear) return false;
      if (checkYear > admissionYear) return true;

      // Same session: compare terms
      if ((termOrder[admissionTerm] || 1) > (termOrder[checkTerm] || 1)) return false;

      return true;
    }

    // Fetch pupil data once
    let pupilDataCache = null;
    async function getPupilData() {
      if (pupilDataCache) return pupilDataCache;
      const doc = await db.collection('pupils').doc(pupilId).get();
      pupilDataCache = doc.exists ? doc.data() : null;
      return pupilDataCache;
    }

    if (currentTermNum === 1) {
      // First Term: carry previous session's consolidated balance.
      const previousSession = getPreviousSessionName(currentSession);

      if (previousSession) {
        console.log(`  Checking previous session Third Term: ${previousSession}`);

        const pupilData = await getPupilData();
        if (pupilData) {
          const enrolled = await wasEnrolledIn(pupilData, previousSession, 'Third Term');
          if (!enrolled) {
            console.log(`  ⏭️ Pupil was not enrolled in ${previousSession}. No arrears to carry forward.`);
            return 0;
          }
        }

        try {
          const sessionArrears = await calculateSessionBalanceSafe(pupilId, previousSession);
          totalArrears = sessionArrears;
        } catch (error) {
          console.error(`  ⚠️ Could not fetch previous session balance:`, error.message);
          totalArrears = 0;
        }

      } else {
        console.log(`  ℹ️ No previous session — first session on record`);
      }

    } else {
      // Second or Third Term: carry only the immediately preceding term's balance.
      const previousTermName = Object.keys(termOrder).find(
        key => termOrder[key] === currentTermNum - 1
      );

      if (previousTermName) {
        const pupilData = await getPupilData();
        if (pupilData) {
          const enrolled = await wasEnrolledIn(pupilData, currentSession, previousTermName);
          if (!enrolled) {
            console.log(`  ⏭️ Pupil was not enrolled in ${previousTermName} of ${currentSession}. No arrears.`);
            return 0;
          }
        }

        const prevTermDocId = `${pupilId}_${encodedSession}_${previousTermName}`;
        console.log(`  Checking previous term: ${previousTermName} (doc: ${prevTermDocId})`);

        try {
          const prevTermDoc = await db.collection('payments').doc(prevTermDocId).get();

          if (prevTermDoc.exists) {
            const rawBalance = prevTermDoc.data().balance;
            const parsed = Number(rawBalance);

            if (isNaN(parsed)) {
              console.warn(
                `  ⚠️ Previous term balance field is not a valid number (value: "${rawBalance}"). ` +
                `Recalculating from full outstanding...`
              );
              try {
                const outstanding = await window.calculateCurrentOutstanding(
                  pupilId, currentSession, previousTermName
                );
                totalArrears = outstanding.balance || 0;
              } catch (e) {
                totalArrears = 0;
              }
            } else {
              totalArrears = Math.max(0, Math.round(parsed));
              if (totalArrears > 0) {
                console.log(`  ✓ ${previousTermName} outstanding: ₦${totalArrears.toLocaleString()}`);
              } else {
                console.log(`  ✓ ${previousTermName} fully paid`);
              }
            }

          } else {
            console.warn(
              `  ⚠️ No payment record for ${previousTermName} in ${currentSession} for pupil ${pupilId}. ` +
              `Calculating full outstanding balance...`
            );

            try {
              const outstanding = await window.calculateCurrentOutstanding(
                pupilId, currentSession, previousTermName
              );
              totalArrears = outstanding.balance || 0;
            } catch (e) {
              console.error(`  ❌ calculateCurrentOutstanding fallback failed:`, e.message);
              totalArrears = await _recalculateTermBalance(
                pupilId, currentSession, previousTermName
              );
            }

            if (totalArrears > 0) {
              console.log(`  📊 Calculated ${previousTermName} balance: ₦${totalArrears.toLocaleString()}`);
            } else {
              console.log(`  ✓ ${previousTermName}: no fee configured or not enrolled`);
            }
          }

        } catch (readError) {
          console.error(`  ❌ Failed to read ${previousTermName}:`, readError.message);
          totalArrears = 0;
        }
      }
    }

    console.log(`✅ Arrears resolved: ₦${totalArrears.toLocaleString()}`);
    return totalArrears;

  } catch (error) {
    console.error('❌ calculateCompleteArrears error:', error);
    return 0;
  }
};

console.log('✅ calculateCompleteArrears() FIX 2+4 loaded');

/**
 * Helper: Safe session balance calculation
 */
async function calculateSessionBalanceSafe(pupilId, session) {
  try {
    const encodedSession = session.replace(/\//g, '-');
    const docId = `${pupilId}_${encodedSession}_Third Term`;

    let sessionBalance = 0;

    try {
      const doc = await db.collection('payments').doc(docId).get();

      if (doc.exists) {
        const data = doc.data();
        const balance = Number(data.balance);

        if (isNaN(balance)) {
          console.warn(
            `  ⚠️ Third Term balance field is not a valid number for ${session}. ` +
            `Recalculating from fee structure.`
          );
          // Recalculate from fee structure
          sessionBalance = await _recalculateTermBalance(pupilId, session, 'Third Term');
        } else {
          sessionBalance = Math.max(0, Math.round(balance));
          if (sessionBalance > 0) {
            console.log(`  ✓ ${session} Third Term arrears: ₦${sessionBalance.toLocaleString()}`);
          } else {
            console.log(`  ✓ ${session} Third Term: fully settled`);
          }
        }
      } else {
        // No Third Term doc — check if pupil was created after this session
        const pupilDocForCheck = await db.collection('pupils').doc(pupilId).get();
        const pupilCreatedAt =
          pupilDocForCheck.exists && pupilDocForCheck.data().createdAt
            ? pupilDocForCheck.data().createdAt.toDate()
            : null;

        const sessionMatch = session.match(/(\d{4})\/(\d{4})/);
        const sessionEndYear = sessionMatch ? parseInt(sessionMatch[2]) : null;
        // Sep 1 of session end year = start of next session
        const sessionEndCutoff = sessionEndYear ? new Date(sessionEndYear, 8, 1) : null;

        const isNewAfterSession =
          pupilCreatedAt && sessionEndCutoff && pupilCreatedAt >= sessionEndCutoff;

        if (isNewAfterSession) {
          console.log(
            `  ⏭️ Pupil created after session ${session} ended. No arrears from this session.`
          );
          sessionBalance = 0;
        } else {
          console.warn(
            `  ⚠️ No Third Term payment record found for pupil ${pupilId} in ${session}. ` +
            `Calculating from fee structure...`
          );
          sessionBalance = await _recalculateTermBalance(pupilId, session, 'Third Term');
        }
      }

    } catch (readError) {
      console.error(`  ❌ Failed to read Third Term for ${session}:`, readError.message);
      sessionBalance = 0;
    }

    return sessionBalance;

  } catch (error) {
    console.error('calculateSessionBalanceSafe error:', error);
    return 0;
  }
}

/**
 * NEW Helper: Calculate a pupil's actual outstanding balance for a specific term
 * by reading fee structure and total payments made, rather than relying on stored balance field.
 */
async function _recalculateTermBalance(pupilId, session, term) {
  try {
    const pupilDoc = await db.collection('pupils').doc(pupilId).get();
    if (!pupilDoc.exists) {
      console.warn(`  ⚠️ Pupil ${pupilId} not found for balance recalculation`);
      return 0;
    }

    const pupilData = pupilDoc.data();

    // Alumni / inactive pupils have no outstanding balance
    if (pupilData.status === 'alumni' || pupilData.isActive === false) {
      return 0;
    }

    const classId = pupilData.class?.id;
    if (!classId) {
      console.warn(`  ⚠️ Pupil ${pupilId} has no class assigned`);
      return 0;
    }

    // Get base fee from fee structure
    const feeDocId = `fee_${classId}`;
    const feeDoc = await db.collection('fee_structures').doc(feeDocId).get();
    if (!feeDoc.exists) {
      console.warn(`  ⚠️ No fee structure for class ${classId}`);
      return 0;
    }

    const baseFee = Math.round(Number(feeDoc.data().total) || 0);

    // Apply per-pupil adjustments
    const amountDue = window.calculateAdjustedFee
      ? window.calculateAdjustedFee(pupilData, baseFee, term)
      : baseFee;

    // Pupil not enrolled this term
    if (amountDue === 0) {
      return 0;
    }

    // How much have they actually paid for this term?
    const encodedSession = session.replace(/\//g, '-');
    const paymentDocId = `${pupilId}_${encodedSession}_${term}`;
    let totalPaid = 0;

    try {
      const paymentDoc = await db.collection('payments').doc(paymentDocId).get();
      if (paymentDoc.exists) {
        const raw = paymentDoc.data().totalPaid;
        totalPaid = Math.max(0, Math.round(Number(raw) || 0));
      }
      // If doc doesn't exist, totalPaid stays 0 — they owe the full amount
    } catch (e) {
      console.warn(`  ⚠️ Could not read payment doc for recalculation:`, e.message);
    }

    const balance = Math.max(0, amountDue - totalPaid);

    console.log(
      `  📊 Recalculated ${term} ${session} for ${pupilData.name}: ` +
      `due=₦${amountDue.toLocaleString()}, paid=₦${totalPaid.toLocaleString()}, balance=₦${balance.toLocaleString()}`
    );

    return balance;

  } catch (error) {
    console.error('_recalculateTermBalance error:', error);
    return 0;
  }
}

// Expose for use in other modules if needed
window._recalculateTermBalance = _recalculateTermBalance;

/**
 * Helper: Get previous session name
 */
function getPreviousSessionName(currentSession) {
  const match = currentSession.match(/(\d{4})\/(\d{4})/);
  if (!match) return null;
  
  const startYear = parseInt(match[1]);
  const endYear = parseInt(match[2]);
  
  return `${startYear - 1}/${endYear - 1}`;
}

console.log('✅ calculateCompleteArrears() loaded for admin portal');

/**
 *  Calculate current outstanding balance
 * This is the SINGLE SOURCE OF TRUTH for outstanding calculations
 */
window.calculateCurrentOutstanding = async function(pupilId, session, term) {
  try {
    const pupilDoc = await db.collection('pupils').doc(pupilId).get();

    if (!pupilDoc.exists) {
      throw new Error(`Pupil ${pupilId} not found`);
    }

    const pupilData = pupilDoc.data();

    if (pupilData.status === 'alumni' || pupilData.isActive === false) {
      return {
        amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
        balance: 0, credit: 0,
        reason: 'Alumni — not an active pupil'
      };
    }

    const classId = pupilData.class?.id;
    if (!classId) {
      return {
        amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
        balance: 0, credit: 0,
        reason: 'No class assigned'
      };
    }

    const feeDocId = `fee_${classId}`;
    const feeDoc   = await db.collection('fee_structures').doc(feeDocId).get();

    if (!feeDoc.exists) {
      return {
        amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
        balance: 0, credit: 0,
        reason: 'No fee structure configured for this class'
      };
    }

    const baseFee   = Math.round(Number(feeDoc.data().total) || 0);
    const amountDue = window.calculateAdjustedFee
      ? window.calculateAdjustedFee(pupilData, baseFee, term)
      : baseFee;

    if (amountDue === 0 && baseFee > 0) {
      return {
        amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
        balance: 0, credit: 0,
        reason: 'Not enrolled for this term'
      };
    }

    const arrears = await window.calculateCompleteArrears(pupilId, session, term);

    const encodedSession = session.replace(/\//g, '-');
    const paymentDocId   = `${pupilId}_${encodedSession}_${term}`;

    let totalPaid = 0;
    try {
      const paymentDoc = await db.collection('payments').doc(paymentDocId).get();
      if (paymentDoc.exists) {
        const raw = paymentDoc.data().totalPaid;
        totalPaid = Math.round(Math.max(0, Number(raw) || 0));
      }
    } catch (readError) {
      console.warn(`Could not read payment doc for ${pupilId}:`, readError.message);
    }

    const totalDue  = amountDue + arrears;

    // Preserve the raw signed balance so overpayments surface.
    const rawBalance = totalDue - totalPaid;
    const balance    = Math.max(0, rawBalance);
    const credit     = rawBalance < 0 ? Math.abs(rawBalance) : 0;

    // Status now includes 'overpaid'.
    let status;
    if (rawBalance < 0) {
      status = 'overpaid';
    } else if (balance === 0) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partial';
    } else {
      status = 'owing';
    }

    return {
      pupilId,
      pupilName: pupilData.name,
      classId,
      className: pupilData.class?.name || 'Unknown',
      session,
      term,
      baseFee,
      amountDue,
      arrears,
      totalDue,
      totalPaid,
      balance,
      credit,  
      status
    };

  } catch (error) {
    console.error('❌ calculateCurrentOutstanding error:', error);
    throw error;
  }
};

console.log('✅ calculateCurrentOutstanding() FIX 3 loaded');

/**
 * FIXED: Delete Item with Payment Protection
 * Prevents deletion of any financial records
 */
window.deleteItem = async function(collection, docId) {
  // CRITICAL: Block deletion of financial records
  if (collection === 'payments' || 
      collection === 'payment_transactions' || 
      collection === 'fee_structures' || 
      collection === 'arrears_log') {
    window.showToast?.(
      '🚫 Financial records cannot be deleted.\n\n' +
      'This is a security measure to maintain accurate financial history.\n\n' +
      'If you need to correct an error, contact your system administrator.',
      'danger',
      8000
    );
    return;
  }
  
  if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
    return;
  }
  
  try {
    const itemDoc = await db.collection(collection).doc(docId).get();
    const itemData = itemDoc.exists ? itemDoc.data() : {};
    
    await db.collection('audit_log').add({
      action: collection === 'teachers' || collection === 'pupils' ? 'delete_user' : 'delete_item',
      collection: collection,
      documentId: docId,
      deletedData: {
        name: itemData.name || 'Unknown',
        email: itemData.email || 'Unknown',
      },
      performedBy: auth.currentUser.uid,
      performedByEmail: auth.currentUser.email,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userAgent: navigator.userAgent
    });

    if (collection === 'pupils') {
      await db.collection('pupils').doc(docId).delete();
      await db.collection('users').doc(docId).delete();
      window.showToast?.('Pupil deleted successfully', 'success');
      loadPupils();
    } else if (collection === 'teachers') {
      await db.collection('teachers').doc(docId).delete();
      await db.collection('users').doc(docId).delete();
      window.showToast?.('Teacher deleted successfully', 'success');
      loadTeachers();
      loadTeacherAssignments();
    } else {
      await db.collection(collection).doc(docId).delete();
      window.showToast?.('Item deleted successfully', 'success');
      
      switch(collection) {
        case 'classes':
          loadClasses();
          loadTeacherAssignments();
          break;
        case 'subjects':
          loadSubjects();
          break;
        case 'announcements':
          loadAdminAnnouncements();
          break;
      }
    }
    
    loadDashboardStats();

  } catch (error) {
    console.error('Error deleting document:', error);
    window.handleError?.(error, 'Failed to delete item');
  }
};

const db = window.db;
const auth = window.auth;

// API_BASE_URL matches js/api-client.js and js/teacher.js's
// TEACHER_API_BASE_URL — update all three together when you deploy
// the Worker. admin.js stays a classic script (not an ES module),
// same reasoning as teacher.js: thousands of lines below reference
// module-level variables by bare name, so only the specific
// functions being migrated call this helper for now.
const ADMIN_API_BASE_URL = 'http://localhost:8787';

async function adminApiGet(path) {
  const token = await window.auth.currentUser.getIdToken();
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return adminApiHandleResponse(response);
}

async function adminApiPost(path, body) {
  const token = await window.auth.currentUser.getIdToken();
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return adminApiHandleResponse(response);
}

async function adminApiPatch(path, body) {
  const token = await window.auth.currentUser.getIdToken();
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return adminApiHandleResponse(response);
}

async function adminApiDelete(path) {
  const token = await window.auth.currentUser.getIdToken();
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return adminApiHandleResponse(response);
}

async function adminApiHandleResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed');
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return data;
}

console.log('🔧 Admin.js v7.0.0 loading...');

/* =====================================================
   SECONDARY AUTH INITIALIZATION
   This MUST run FIRST before anything else
===================================================== */

let secondaryAuth = null;
let secondaryApp = null;

(function initializeSecondaryAuth() {
  console.log('🔐 Initializing secondary auth for user creation...');
  
  try {
    // Check if secondary app already exists
    try {
      secondaryApp = firebase.app('Secondary');
      secondaryAuth = secondaryApp.auth();
      console.log('✓ Found existing secondary app');
    } catch (e) {
      // Create new secondary app
      secondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary');
      secondaryAuth = secondaryApp.auth();
      console.log('✓ Created new secondary app');
    }
    
    // Expose function to window IMMEDIATELY
    window.createSecondaryUser = async function(email, password) {
  console.log(`📝 createSecondaryUser called for: ${email}`);

  // Validate current user
  if (!auth.currentUser) {
    const error = new Error('Not authenticated');
    console.error('❌ createSecondaryUser error:', error);
    throw error;
  }

  console.log(`✓ Current admin: ${auth.currentUser.email}`);

  // Verify admin role
  try {
    const userDoc = await db.collection('users').doc(auth.currentUser.uid).get();
    if (!userDoc.exists) {
      throw new Error('Admin profile not found');
    }
    if (userDoc.data().role !== 'admin') {
      throw new Error('Unauthorized: Admin access required');
    }
    console.log('✓ Admin role verified');
  } catch (error) {
    console.error('❌ Admin verification failed:', error);
    throw error;
  }

  // Validate secondary auth
  if (!secondaryAuth) {
    const error = new Error('Secondary auth not initialized');
    console.error('❌ Secondary auth error:', error);
    throw error;
  }

  // Clear any stale session from a previous failed attempt
  try {
    if (secondaryAuth.currentUser) {
      console.warn('⚠️ Secondary auth had stale session, clearing before proceeding');
      await secondaryAuth.signOut();
    }
  } catch (cleanupError) {
    console.warn('⚠️ Could not clear stale secondary session:', cleanupError.message);
  }

  console.log('📧 Creating user account...');

  let newUid = null;

  try {
    const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
    
    // Capture UID immediately — never rely on secondaryAuth.currentUser later
    newUid = userCredential.user.uid;
    console.log(`✓ User created: ${newUid}`);

    // Send password reset email as non-fatal — a network blip should not
    // orphan the Auth account or leave secondaryAuth signed in
    try {
      console.log('📨 Sending password reset email...');
      await secondaryAuth.sendPasswordResetEmail(email);
      console.log('✓ Password reset email sent');
    } catch (emailError) {
      // Non-fatal — user was created successfully, admin can resend manually
      console.warn('⚠️ Password reset email failed (non-fatal):', emailError.message);
    }

    // Always sign out secondary auth regardless of email result
    await secondaryAuth.signOut();
    console.log('✓ Secondary auth signed out');

    return newUid;

  } catch (error) {
    console.error('❌ User creation failed:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);

    // Always clean up secondary auth session on any failure
    try {
      await secondaryAuth.signOut();
    } catch (cleanupError) {
      console.warn('⚠️ Cleanup signOut failed:', cleanupError.message);
    }

    throw error;
  }
};

console.log('✅ createSecondaryUser exposed to window');

} catch (error) {
  console.error('❌ CRITICAL: Secondary auth initialization failed:', error);

  // Fallback function that shows clear error
  window.createSecondaryUser = async function() {
    throw new Error(
      'Secondary authentication system failed to initialize. ' +
      'Please refresh the page. If problem persists, check Firebase configuration.'
    );
  };
}
})();

/* =====================================================
   WAIT FOR AUTHENTICATION
===================================================== */

console.log('🔐 Waiting for authentication...');

let authUser = null;
let domReady = false;

function tryInitialize() {
  if (authUser && domReady) {
    console.log('✅ Both auth and DOM ready - initializing portal');
    initializeAdminPortal();
  } else {
    console.log(`⏳ Waiting... (auth: ${!!authUser}, dom: ${domReady})`);
  }
}

// Wait for authentication
window.checkRole('admin')
  .then(async user => {
    console.log('✓ Admin authenticated:', user.email);
    authUser = user;
    tryInitialize();
  })
  .catch(err => {
    console.error('❌ Authentication failed:', err);
  });

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('✓ DOM ready');
    domReady = true;
    tryInitialize();
  });
} else {
  console.log('✓ DOM already ready');
  domReady = true;
  tryInitialize();
}

// Logout handler
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.logout();
  });
});

// ============================================
// INITIALIZATION WITH DATA LOADING
// ============================================

/**
 * Initialize admin portal with proper loading sequence
 */
async function initializeAdminPortal() {
  console.log('🚀 Initializing admin portal...');

  const sidebar    = document.getElementById('admin-sidebar');
  const hamburger  = document.getElementById('hamburger');
  const dashboard  = document.getElementById('dashboard');

  if (!sidebar || !hamburger || !dashboard) {
    console.error('❌ Critical elements missing, retrying in 200ms...');
    setTimeout(initializeAdminPortal, 200);
    return;
  }

  // Only set up sidebar if not already done.
  if (!window.adminSidebarInitialized) {
    setupSidebarNavigation();
  }

  isLoadingAdminData = true;

  try {
    await loadDashboardStats();
    adminDataLoaded = true;
    isLoadingAdminData = false;
  } catch (error) {
    console.error('❌ Failed to load admin data:', error);
    isLoadingAdminData = false;
    adminDataLoaded = false;
    window.showToast?.('Some data failed to load.', 'warning', 6000);
  }

  showSection('dashboard');

  try {
    await window.classHierarchy.initializeClassHierarchy();
  } catch (error) {
    console.error('⚠️ Class hierarchy init failed:', error);
  }

  console.log('✅ Admin portal initialized');
}

// ============================================
// LOADING STATE FLAGS
// ============================================
let adminDataLoaded = false;
let isLoadingAdminData = false;

// ============================================
// SIDEBAR NAVIGATION SETUP
// ============================================

function setupSidebarNavigation() {
  // Hard guard: one-time initialization only
  if (window.adminSidebarInitialized === true) {
    console.log('⚠️ Sidebar already initialized, skipping');
    return;
  }

  const hamburger = document.getElementById('hamburger');
  const sidebar   = document.getElementById('admin-sidebar');

  if (!hamburger || !sidebar) {
    console.error('❌ Hamburger or sidebar not found!');
    return;
  }

  console.log('✓ Setting up sidebar navigation...');

  // ── Hamburger toggle ───────────────────────────────────────────────────────
  // Clone to remove any stale listeners baked in from HTML or previous runs
  const newHamburger = hamburger.cloneNode(true);
  hamburger.parentNode.replaceChild(newHamburger, hamburger);
  const freshHamburger = document.getElementById('hamburger');

  freshHamburger.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    const isNowOpen = sidebar.classList.toggle('active');
    freshHamburger.classList.toggle('active', isNowOpen);
    freshHamburger.setAttribute('aria-expanded', String(isNowOpen));
    document.body.style.overflow = isNowOpen ? 'hidden' : '';

    console.log('🔘 Hamburger toggled. Sidebar open:', isNowOpen);
  });

  // ── Outside-click closes sidebar
  if (!window._adminSidebarOutsideClickHandler) {
    window._adminSidebarOutsideClickHandler = function (e) {
      const sb = document.getElementById('admin-sidebar');
      const hb = document.getElementById('hamburger');

      if (!sb || !sb.classList.contains('active')) return;
      if (sb.contains(e.target)) return;
      if (hb && hb.contains(e.target)) return;

      sb.classList.remove('active');
      if (hb) {
        hb.classList.remove('active');
        hb.setAttribute('aria-expanded', 'false');
      }
      document.body.style.overflow = '';
      console.log('📍 Sidebar closed (outside click)');
    };

    document.addEventListener('click', window._adminSidebarOutsideClickHandler);
  }

  // ── Escape key ─────────────────────────────────────────────────────────────
  if (!window._adminSidebarEscHandler) {
    window._adminSidebarEscHandler = function (e) {
      const sb = document.getElementById('admin-sidebar');
      const hb = document.getElementById('hamburger');

      if (e.key === 'Escape' && sb && sb.classList.contains('active')) {
        sb.classList.remove('active');
        if (hb) {
          hb.classList.remove('active');
          hb.setAttribute('aria-expanded', 'false');
        }
        document.body.style.overflow = '';
        console.log('⌨️ Sidebar closed (Escape)');
      }
    };

    document.addEventListener('keydown', window._adminSidebarEscHandler);
  }

  // ── Sidebar nav links ──────────────────────────────────────────────────────
  sidebar.querySelectorAll('a[data-section]').forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const sectionId = this.dataset.section;
      if (!sectionId) return;

      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      this.classList.add('active');

      showSection(sectionId);

      // Close sidebar on mobile
      if (window.innerWidth <= 1024) {
        const sb = document.getElementById('admin-sidebar');
        const hb = document.getElementById('hamburger');
        if (sb) sb.classList.remove('active');
        if (hb) {
          hb.classList.remove('active');
          hb.setAttribute('aria-expanded', 'false');
        }
        document.body.style.overflow = '';
      }
    });
  });

  // ── Resize handler ─────────────────────────────────────────────────────────
  if (!window._adminSidebarResizeHandler) {
    let resizeTimer;
    window._adminSidebarResizeHandler = function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        const sb = document.getElementById('admin-sidebar');
        const hb = document.getElementById('hamburger');

        if (window.innerWidth > 1024 && sb && sb.classList.contains('active')) {
          sb.classList.remove('active');
          if (hb) {
            hb.classList.remove('active');
            hb.setAttribute('aria-expanded', 'false');
          }
          document.body.style.overflow = '';
        }
      }, 250);
    };

    window.addEventListener('resize', window._adminSidebarResizeHandler);
  }

  // ✅ Set flag LAST — only after everything is fully wired up
  window.adminSidebarInitialized = true;
  console.log('✅ Sidebar navigation initialized');
}

// ============================================
// SHOW SECTION
// ============================================
function showSection(sectionId) {
  if (!sectionId) {
    console.error('❌ showSection called with no sectionId');
    return;
  }

  console.log(`📄 Showing section: ${sectionId}`);

  // Check if data is loaded (except dashboard)
  if (!adminDataLoaded && sectionId !== 'dashboard' && !isLoadingAdminData) {
    window.showToast?.('Loading data, please wait...', 'info', 3000);
    console.warn('⚠️ Data not loaded yet, showing dashboard instead');
    sectionId = 'dashboard'; // Fallback to dashboard
  }

  // Hide only TOP-LEVEL sections, not nested .admin-card elements
  document
    .querySelectorAll('main > .content-wrapper > .admin-card')
    .forEach(card => {
      card.style.display = 'none';
    });

  // Show target section
  const section = document.getElementById(sectionId);
  if (!section) {
    console.error(`❌ Section not found: ${sectionId}`);
    return;
  }

  section.style.display = 'block';

  // Update active link
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.remove('active');
  });

  const activeLink = document.querySelector(
    `.sidebar-link[data-section="${sectionId}"]`
  );

  if (activeLink) {
    activeLink.classList.add('active');

    // Expand parent group if nested
    const parentGroup = activeLink.closest(
      '.sidebar-group-content-modern'
    );

    if (parentGroup) {
      parentGroup.classList.add('active');
      const toggle = parentGroup.previousElementSibling;

      if (toggle?.classList.contains('sidebar-group-toggle-modern')) {
        toggle.setAttribute('aria-expanded', 'true');
        const icon = toggle.querySelector('.toggle-icon');
        if (icon) icon.style.transform = '';
      }
    }
  }

  // Load section data
  loadSectionData(sectionId);

  // Close mobile sidebar
  const sidebar = document.getElementById('admin-sidebar');
  const hamburger = document.getElementById('hamburger');

  if (sidebar?.classList.contains('active')) {
    sidebar.classList.remove('active');
    hamburger?.classList.remove('active');
    hamburger?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
}

/**
 * Load Settings Form
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('📝 Setting up settings form handler...');

  const settingsForm = document.getElementById('settings-form');

  if (!settingsForm) {
    console.warn('⚠️ Settings form not found');
    return;
  }

  // Remove old handlers by cloning
  const newSettingsForm = settingsForm.cloneNode(true);
  settingsForm.parentNode.replaceChild(newSettingsForm, settingsForm);

  const freshForm = document.getElementById('settings-form');

  freshForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('🎯 Settings form submitted');

    const startYear      = parseInt(document.getElementById('session-start-year').value);
    const endYear        = parseInt(document.getElementById('session-end-year').value);
    const startDate      = document.getElementById('session-start-date').value;
    const endDate        = document.getElementById('session-end-date').value;
    const newTerm        = document.getElementById('current-term').value;
    const resumptionDate = document.getElementById('resumption-date').value;

    if (!startYear || !endYear || !startDate || !endDate || !newTerm || !resumptionDate) {
      window.showToast?.('Please fill all required fields', 'warning');
      return;
    }

    if (endYear <= startYear) {
      window.showToast?.('End year must be after start year', 'warning');
      return;
    }

    const submitBtn = freshForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="btn-loading">Saving...</span>';
    }

    try {
      // Get OLD settings to detect term changes
      const oldSettings  = await window.getCurrentSettings();
      const oldTerm      = oldSettings.term;
      const oldSession   = oldSettings.session;
      const session      = `${startYear}/${endYear}`;

      // Save new settings
      await db.collection('settings').doc('current').set({
        currentSession: {
          name:      session,
          startYear: startYear,
          endYear:   endYear,
          startDate: firebase.firestore.Timestamp.fromDate(new Date(startDate)),
          endDate:   firebase.firestore.Timestamp.fromDate(new Date(endDate))
        },
        term:          newTerm,
        session:       session,
        resumptionDate: firebase.firestore.Timestamp.fromDate(new Date(resumptionDate)),
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Auto-migrate arrears if term changed within the same session
      if (oldTerm && oldTerm !== newTerm && oldSession === session) {
        console.log(`⚠️ Term changed: ${oldTerm} → ${newTerm}`);
        console.log('🔄 Automatically migrating arrears...');

        window.showToast?.('Migrating outstanding balances to new term...', 'info', 3000);

        const result = await migrateArrearsOnTermChange(oldTerm, newTerm, session);

        if (result.success && result.count > 0) {
          window.showToast?.(
            `✓ Settings saved & arrears migrated!\n\n` +
            `${result.count} pupil(s) with outstanding balances moved to ${newTerm}\n` +
            `Total arrears: ₦${result.totalArrears.toLocaleString()}`,
            'success',
            10000
          );
        } else {
          window.showToast?.('✓ Settings saved! No outstanding arrears to migrate.', 'success');
        }

      } else {
        window.showToast?.('✓ Settings saved successfully!', 'success');
      }

      await loadCurrentSettings();
      await loadSessionHistory();

    } catch (error) {
      console.error('❌ Error saving settings:', error);
      window.handleError?.(error, 'Failed to save settings');
    } finally {
      if (submitBtn) {
        submitBtn.disabled  = false;
        submitBtn.innerHTML = '💾 Save Settings';
      }
    }
  });

  console.log('✅ Settings form handler registered');
});

/**
 * Load Audit Log Section
 */
// Global variable to store all audit log data
let allAuditLogsData = [];

async function loadAuditLog() {
  console.log('📋 Loading audit log...');
  
  const container = document.getElementById('audit-log-container');
  if (!container) {
    console.error('❌ audit-log-container element not found');
    return;
  }
  
  container.innerHTML = `
    <div style="text-align:center; padding:var(--space-2xl);">
      <div class="spinner"></div>
      <p>Loading audit log...</p>
    </div>
  `;
  
  try {
    // Get latest 100 audit entries
    const logsSnap = await db.collection('audit_log')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    if (logsSnap.empty) {
      container.innerHTML = `
        <div style="text-align:center; padding:var(--space-2xl); color:var(--color-gray-600);">
          <p style="font-size:var(--text-lg); margin-bottom:var(--space-md);">📋 No Audit Logs Yet</p>
          <p style="font-size:var(--text-sm);">All administrative actions will be logged here for compliance and security.</p>
        </div>
      `;
      allAuditLogsData = [];
      return;
    }
    
    const logs = [];
    logsSnap.forEach(doc => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    
    // Store globally for search
    allAuditLogsData = logs;
    
    // Render audit log table with search
    container.innerHTML = `
      <div style="margin-bottom:var(--space-lg);">
        <input 
          type="text" 
          id="audit-search" 
          placeholder="🔍 Search by email, action, or collection..." 
          style="width:100%; padding:var(--space-sm); border:1px solid var(--color-gray-300); border-radius:var(--radius-sm);"
          oninput="filterAuditLog()">
        <p id="audit-search-count" style="margin-top: var(--space-xs); font-size: var(--text-sm); color: var(--color-gray-600);"></p>
      </div>
      
      <div class="table-container">
        <table class="responsive-table" id="audit-log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Collection</th>
              <th>Performed By</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="audit-log-tbody"></tbody>
        </table>
      </div>
      
      <button 
        class="btn btn-secondary" 
        onclick="downloadAuditLog()" 
        style="margin-top:var(--space-lg);">
        📥 Download Full Audit Log (CSV)
      </button>
    `;
    
    // Render with pagination
    renderAuditLogTable(allAuditLogsData);
    
    console.log(`✓ Loaded ${logs.length} audit log entries`);
    
  } catch (error) {
    console.error('❌ Error loading audit log:', error);
    container.innerHTML = `
      <div style="text-align:center; padding:var(--space-2xl); color:var(--color-danger);">
        <p><strong>Error Loading Audit Log</strong></p>
        <p>${error.message}</p>
        <button class="btn btn-primary" onclick="loadAuditLog()" style="margin-top:var(--space-md);">
          🔄 Retry
        </button>
      </div>
    `;
    window.showToast?.('Failed to load audit log', 'danger');
  }
}

/**
 * Render audit log table with pagination
 */
function renderAuditLogTable(logsData) {
  const tbody = document.getElementById('audit-log-tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (logsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-gray-600);">No logs match your search</td></tr>';
    return;
  }
  
  paginateTable(logsData, 'audit-log-tbody', 25, (log, tbody) => {
    const timestamp = log.timestamp 
      ? log.timestamp.toDate().toLocaleString('en-GB')
      : 'Unknown';
    
    const actionBadge = getActionBadge(log.action);
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Timestamp">${timestamp}</td>
      <td data-label="Action">${actionBadge}</td>
      <td data-label="Collection">${log.collection || '-'}</td>
      <td data-label="Performed By">${log.performedByEmail || 'Unknown'}</td>
      <td data-label="Details">
        <button class="btn-small btn-secondary" onclick="viewAuditDetails('${log.id}')">
          View Details
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Filter audit log by search term
 */
function filterAuditLog() {
  const searchInput = document.getElementById('audit-search');
  if (!searchInput) return;
  
  const searchTerm = searchInput.value.toLowerCase().trim();
  
  if (!searchTerm) {
    renderAuditLogTable(allAuditLogsData);
    return;
  }
  
  // Filter across all fields
  const filtered = allAuditLogsData.filter(log => {
    const email = (log.performedByEmail || '').toLowerCase();
    const action = (log.action || '').toLowerCase();
    const collection = (log.collection || '').toLowerCase();
    
    return email.includes(searchTerm) || 
           action.includes(searchTerm) || 
           collection.includes(searchTerm);
  });
  
  console.log(`Audit log search: "${searchTerm}" → ${filtered.length} of ${allAuditLogsData.length} matches`);
  
  renderAuditLogTable(filtered);
  
  const countDisplay = document.getElementById('audit-search-count');
  if (countDisplay) {
    countDisplay.textContent = filtered.length === allAuditLogsData.length 
      ? '' 
      : `Showing ${filtered.length} of ${allAuditLogsData.length}`;
  }
}

// Make functions globally available
window.filterAuditLog = filterAuditLog;
window.renderAuditLogTable = renderAuditLogTable;

// Make functions globally available
window.loadAuditLog = loadAuditLog;
window.viewAuditDetails = viewAuditDetails;
window.downloadAuditLog = downloadAuditLog;

/**
 * Helper: Get action badge with color coding
 */
function getActionBadge(action) {
  const badges = {
    'delete_user': '<span style="background:#dc3545; color:white; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600;">🗑️ DELETE USER</span>',
    'delete_item': '<span style="background:#ff9800; color:white; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600;">🗑️ DELETE ITEM</span>',
    'create_user': '<span style="background:#28a745; color:white; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600;">➕ CREATE USER</span>',
    'update_settings': '<span style="background:#2196F3; color:white; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600;">⚙️ UPDATE SETTINGS</span>',
    'promotion_approved': '<span style="background:#4CAF50; color:white; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600;">✓ PROMOTION APPROVED</span>',
    'promotion_rejected': '<span style="background:#f44336; color:white; padding:4px 8px; border-radius:4px; font-size:12px; font-weight:600;">✗ PROMOTION REJECTED</span>'
  };
  
  return badges[action] || `<span style="color:var(--color-gray-700); font-weight:600;">${action}</span>`;
}

/**
 * View detailed audit log entry
 */
async function viewAuditDetails(logId) {
  try {
    const logDoc = await db.collection('audit_log').doc(logId).get();
    
    if (!logDoc.exists) {
      window.showToast?.('Audit log entry not found', 'danger');
      return;
    }
    
    const log = logDoc.data();
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000; overflow-y:auto; padding:var(--space-lg);';
    modal.innerHTML = `
      <div style="background:white; padding:var(--space-2xl); border-radius:var(--radius-lg); max-width:700px; width:90%; max-height:80vh; overflow-y:auto;">
        <h3 style="margin-top:0;">📋 Audit Log Details</h3>
        
        <div style="margin-bottom:var(--space-md);">
          <strong>Action:</strong> ${getActionBadge(log.action)}
        </div>
        
        <div style="margin-bottom:var(--space-md);">
          <strong>Timestamp:</strong> ${log.timestamp ? log.timestamp.toDate().toLocaleString('en-GB') : 'Unknown'}
        </div>
        
        <div style="margin-bottom:var(--space-md);">
          <strong>Performed By:</strong> ${log.performedByEmail || 'Unknown'} 
          <span style="color:var(--color-gray-600); font-size:var(--text-sm);">(${log.performedBy || 'Unknown ID'})</span>
        </div>
        
        <div style="margin-bottom:var(--space-md);">
          <strong>Collection:</strong> ${log.collection || 'N/A'}
        </div>
        
        <div style="margin-bottom:var(--space-md);">
          <strong>Document ID:</strong> 
          <code style="background:#f5f5f5; padding:2px 6px; border-radius:4px;">${log.documentId || 'N/A'}</code>
        </div>
        
        ${log.deletedData ? `
          <div style="margin-bottom:var(--space-md);">
            <strong>Deleted Data:</strong>
            <pre style="background:#f5f5f5; padding:var(--space-md); border-radius:var(--radius-sm); overflow-x:auto; font-size:12px; max-height:300px;">${JSON.stringify(log.deletedData, null, 2)}</pre>
          </div>
        ` : ''}
        
        ${log.changes ? `
          <div style="margin-bottom:var(--space-md);">
            <strong>Changes Made:</strong>
            <pre style="background:#f5f5f5; padding:var(--space-md); border-radius:var(--radius-sm); overflow-x:auto; font-size:12px; max-height:300px;">${JSON.stringify(log.changes, null, 2)}</pre>
          </div>
        ` : ''}
        
        <div style="margin-bottom:var(--space-md);">
          <strong>User Agent:</strong>
          <div style="font-size:12px; color:var(--color-gray-600); word-break:break-all;">${log.userAgent || 'Unknown'}</div>
        </div>
        
        <button class="btn btn-primary" onclick="this.closest('[style*=position]').remove()">Close</button>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
    
  } catch (error) {
    console.error('Error loading audit details:', error);
    window.showToast?.('Failed to load audit details', 'danger');
  }
}

/**
 * Download full audit log as CSV
 */
async function downloadAuditLog() {
  try {
    window.showToast?.('Preparing audit log export...', 'info', 2000);
    
    const EXPORT_LIMIT = 5000;

    const logsSnap = await db.collection('audit_log')
      .orderBy('timestamp', 'desc')
      .limit(EXPORT_LIMIT)
      .get();
    
    if (logsSnap.empty) {
      window.showToast?.('No audit logs to download', 'info');
      return;
    }
    
    let csv = 'Timestamp,Action,Collection,Document ID,Performed By,Email,User Agent\n';
    
    logsSnap.forEach(doc => {
      const log = doc.data();
      const timestamp = log.timestamp ? log.timestamp.toDate().toISOString() : '';
      const action = (log.action || '').replace(/"/g, '""');
      const collection = (log.collection || '').replace(/"/g, '""');
      const docId = (log.documentId || '').replace(/"/g, '""');
      const userId = (log.performedBy || '').replace(/"/g, '""');
      const email = (log.performedByEmail || '').replace(/"/g, '""');
      const userAgent = (log.userAgent || '').replace(/"/g, '""');
      
      csv += `"${timestamp}","${action}","${collection}","${docId}","${userId}","${email}","${userAgent}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    if (logsSnap.size >= EXPORT_LIMIT) {
      window.showToast?.(
        `✓ Exported the most recent ${logsSnap.size} audit log entries. ` +
        `There are older entries beyond this that were not included.`,
        'warning',
        8000
      );
    } else {
      window.showToast?.(`✓ Exported ${logsSnap.size} audit log entries`, 'success');
    }
    
  } catch (error) {
    console.error('Error downloading audit log:', error);
    window.showToast?.('Failed to download audit log', 'danger');
  }
}

// ============================================
// LOAD SECTION DATA (Defensive loading)
// ============================================

/**
 * Load section data with validation
 */
function loadSectionData(sectionId) {
  console.log(`📊 Loading data for: ${sectionId}`);
  
  // Show loading indicator for data-heavy sections
  const showLoadingForSection = (id) => {
    const section = document.getElementById(id);
    if (!section) return;
    
    const container = section.querySelector('.table-container tbody') || 
                      section.querySelector('.stats-grid') ||
                      section;
    
    if (container) {
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'section-loading';
      loadingDiv.style.cssText = 'text-align:center; padding:var(--space-2xl); color:var(--color-gray-600);';
      loadingDiv.innerHTML = `
        <div class="spinner" style="margin: 0 auto var(--space-md);"></div>
        <p>Loading ${id.replace(/-/g, ' ')}...</p>
      `;
      container.innerHTML = '';
      container.appendChild(loadingDiv);
    }
  };
  
  try {
    // Show loading state for sections that take time
    const loadingSections = ['teachers', 'pupils', 'classes', 'subjects'];
    if (loadingSections.includes(sectionId)) {
      showLoadingForSection(sectionId);
    }
    
    switch(sectionId) {
      case 'dashboard':
        loadDashboardStats();
        break;
      case 'teachers':
        loadTeachers();
        break;
      case 'pupils':
        loadPupils();
        break;
      case 'classes':
        loadClasses();
        break;
      case 'subjects':
        loadSubjects();
        break;
      case 'assign-teachers':
        loadTeacherAssignments();
        break;
      case 'promotion-requests':
        loadPromotionRequests();
        break;
      case 'result-approvals':
        loadResultApprovals();
        break;
      case 'announcements':
        loadAdminAnnouncements();
        break;
      case 'alumni':
        loadAlumni();
        break;
      case 'audit-log':
        loadAuditLog();
        break;
      case 'view-results':
        loadViewResultsSection();
        break;
      case 'settings':
        loadCurrentSettings();
        loadSessionHistory();
        break;
      case 'fee-management':
        loadFeeManagementSection();
        break;
      case 'record-payment':
        loadPaymentRecordingSection();
        break;
      case 'outstanding-fees':
        loadOutstandingFeesReport();
        break;
      case 'financial-reports':
        loadFinancialReports();
        break;
      case 'school-calendar':
         loadSchoolCalendarSection();
         break;
      case 'lesson-notes':
        loadLessonNotesAdminSection();
        break;
      default:
        console.log(`ℹ️ No data loader for: ${sectionId}`);
    }
  } catch (error) {
    console.error(`❌ Error loading ${sectionId}:`, error);
    window.showToast?.(`Failed to load ${sectionId}`, 'danger');
  }
}

let _pupilEditToken = 0;
let _teacherEditToken = 0;

/* ======================================== 
   PROMOTION REQUESTS MANAGEMENT
======================================== */

let currentPromotionId = null;
let currentPromotionData = null;

async function loadPromotionRequests() {
  try {
    // Load promotion period status
    await loadPromotionPeriodStatus();
    
    // Load promotion requests
    const tbody = document.getElementById('promotion-requests-table');
    const noRequestsMsg = document.getElementById('no-requests-message');
    const bulkActions = document.getElementById('bulk-actions');
    
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading promotion requests...</td></tr>';
    
    const snapshot = await db.collection('promotions')
      .orderBy('createdAt', 'desc')
      .get();
    
    tbody.innerHTML = '';
    
    if (snapshot.empty) {
      if (noRequestsMsg) noRequestsMsg.style.display = 'block';
      if (bulkActions) bulkActions.style.display = 'none';
      return;
    }
    
    if (noRequestsMsg) noRequestsMsg.style.display = 'none';
    
    // Check if there are any pending requests
    const hasPending = snapshot.docs.some(doc => doc.data().status === 'pending');
    if (bulkActions) bulkActions.style.display = hasPending ? 'flex' : 'none';
    
    // Get all teacher names
    const teacherIds = new Set();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.initiatedBy) teacherIds.add(data.initiatedBy);
    });
    
    const teacherNames = {};
    for (const teacherId of teacherIds) {
      const teacherDoc = await db.collection('teachers').doc(teacherId).get();
      if (teacherDoc.exists) {
        teacherNames[teacherId] = teacherDoc.data().name;
      }
    }
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const teacherName = teacherNames[data.initiatedBy] || 'Unknown';
      
      let statusBadge = '';
      if (data.status === 'pending') {
        statusBadge = '<span class="status-pending">Pending</span>';
      } else if (data.status === 'approved') {
        statusBadge = '<span class="status-approved">Approved</span>';
      } else if (data.status === 'rejected') {
        statusBadge = '<span class="status-rejected">Rejected</span>';
      } else if (data.status === 'completed') {
        statusBadge = '<span class="status-completed">Completed</span>';
      }
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Teacher">${teacherName}</td>
        <td data-label="From Class">${data.fromClass?.name || '-'}</td>
        <td data-label="To Class">${data.toClass?.name || '-'}</td>
        <td data-label="Promote" style="text-align:center;">${data.promotedPupils?.length || 0}</td>
        <td data-label="Hold" style="text-align:center;">${data.heldBackPupils?.length || 0}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Actions">
          <button class="btn-small btn-primary" onclick="viewPromotionDetails('${doc.id}')">
            View Details
          </button>
          ${data.status === 'pending' ? `
            <button class="btn-small btn-success" onclick="quickApprovePromotion('${doc.id}')">
              ✓ Approve
            </button>
            <button class="btn-small btn-danger" onclick="quickRejectPromotion('${doc.id}')">
              ✗ Reject
            </button>
          ` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
    
  } catch (error) {
    console.error('Error loading promotion requests:', error);
    window.showToast?.('Failed to load promotion requests', 'danger');
    document.getElementById('promotion-requests-table').innerHTML = 
      '<tr><td colspan="7" style="text-align:center; color:var(--color-danger);">Error loading requests</td></tr>';
  }
}

async function togglePromotionPeriod() {
  try {
    const settingsDoc = await db.collection('settings').doc('current').get();
    const currentStatus = settingsDoc.exists && settingsDoc.data().promotionPeriodActive === true;
    const newStatus = !currentStatus;
    
    const action = newStatus ? 'open' : 'close';
    const confirmation = confirm(
      `${action.toUpperCase()} Promotion Period?\n\n` +
      (newStatus 
        ? 'Teachers will be able to submit promotion requests.'
        : 'Teachers will no longer be able to submit promotion requests.\nExisting pending requests will remain.')
    );
    
    if (!confirmation) return;
    
    await db.collection('settings').doc('current').set({
      promotionPeriodActive: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    window.showToast?.(
      `✓ Promotion period ${newStatus ? 'opened' : 'closed'} successfully`,
      'success'
    );
    
    await loadPromotionPeriodStatus();
    
  } catch (error) {
    console.error('Error toggling promotion period:', error);
    window.handleError(error, 'Failed to toggle promotion period');
  }
}

async function viewPromotionDetails(promotionId) {
  try {
    const doc = await db.collection('promotions').doc(promotionId).get();
    
    if (!doc.exists) {
      window.showToast?.('Promotion request not found', 'danger');
      return;
    }
    
    currentPromotionId = promotionId;
    currentPromotionData = doc.data();
    
    // Get teacher name
    let teacherName = 'Unknown';
    if (currentPromotionData.initiatedBy) {
      const teacherDoc = await db.collection('teachers').doc(currentPromotionData.initiatedBy).get();
      if (teacherDoc.exists) {
        teacherName = teacherDoc.data().name;
      }
    }
    
    const modal = document.getElementById('promotion-details-modal');
    const content = document.getElementById('promotion-details-content');
    const approveBtn = document.getElementById('approve-promotion-btn');
    const rejectBtn = document.getElementById('reject-promotion-btn');
    
    if (!modal || !content) return;
    
    // Build details HTML
    let html = `
      <div class="promotion-details-section">
        <h3>Request Information</h3>
        <p><strong>Submitted by:</strong> ${teacherName}</p>
        <p><strong>From Class:</strong> ${currentPromotionData.fromClass?.name || '-'}</p>
        <p><strong>To Class:</strong> ${currentPromotionData.toClass?.name || '-'}</p>
        <p><strong>Session:</strong> ${currentPromotionData.fromSession || '-'}</p>
        <p><strong>Status:</strong> ${currentPromotionData.status.toUpperCase()}</p>
        ${currentPromotionData.isTerminalClass ? '<p><strong>⚠️ Terminal Class:</strong> Pupils will be moved to Alumni</p>' : ''}
      </div>
      
      <div class="promotion-details-section">
        <h3>Pupils to Promote (${currentPromotionData.promotedPupils?.length || 0})</h3>
        <div class="pupil-list">
    `;
    
    if (currentPromotionData.promotedPupilsDetails && currentPromotionData.promotedPupilsDetails.length > 0) {
      currentPromotionData.promotedPupilsDetails.forEach(pupil => {
        html += `
          <div class="pupil-list-item">
            <input type="checkbox" 
                   class="override-promote-checkbox" 
                   data-pupil-id="${pupil.id}" 
                   checked 
                   onchange="handlePromotionOverride()">
            <span>${pupil.name}</span>
          </div>
        `;
      });
    } else {
      html += '<p style="color:var(--color-gray-600);">No pupils selected for promotion</p>';
    }
    
    html += `
        </div>
      </div>
      
      <div class="promotion-details-section">
        <h3>Pupils to Hold Back (${currentPromotionData.heldBackPupils?.length || 0})</h3>
        <div class="pupil-list">
    `;
    
    if (currentPromotionData.heldBackPupilsDetails && currentPromotionData.heldBackPupilsDetails.length > 0) {
      currentPromotionData.heldBackPupilsDetails.forEach(pupil => {
        html += `
          <div class="pupil-list-item">
            <input type="checkbox" 
                   class="override-hold-checkbox" 
                   data-pupil-id="${pupil.id}" 
                   onchange="handlePromotionOverride()">
            <span>${pupil.name}</span>
          </div>
        `;
      });
    } else {
      html += '<p style="color:var(--color-gray-600);">No pupils held back</p>';
    }
    
    html += `
        </div>
      </div>
      
      <div class="override-section">
        <h3>⚙️ Manual Overrides</h3>
        <p style="margin-bottom:var(--space-md);">You can override the teacher's recommendations by checking/unchecking pupils above, or manually move individual pupils to different classes below.</p>
        <div class="override-controls">
          <div class="form-group">
            <label>Move Pupil:</label>
            <select id="override-pupil-select" style="width:100%;">
              <option value="">-- Select Pupil --</option>
            </select>
          </div>
          <div class="form-group">
            <label>To Class:</label>
            <select id="override-class-select" style="width:100%;">
              <option value="">-- Select Class --</option>
            </select>
          </div>
          <button class="btn btn-secondary" onclick="addManualOverride()" style="align-self: flex-end;">
            Add Override
          </button>
        </div>
        <div id="manual-overrides-list" style="margin-top:var(--space-md);"></div>
      </div>
    `;
    
    content.innerHTML = html;
    
    // Populate override dropdowns
    await populateOverrideDropdowns();
    
    // Show/hide buttons based on status
    if (currentPromotionData.status === 'pending') {
      approveBtn.style.display = 'inline-block';
      rejectBtn.style.display = 'inline-block';
    } else {
      approveBtn.style.display = 'none';
      rejectBtn.style.display = 'none';
    }
    
    modal.style.display = 'block';
    
  } catch (error) {
    console.error('Error loading promotion details:', error);
    window.showToast?.('Failed to load promotion details', 'danger');
  }
}

function closePromotionDetailsModal() {
    const modal = document.getElementById('promotion-details-modal');
    if (modal) modal.style.display = 'none';
    currentPromotionId = null;
    currentPromotionData = null;
    manualOverrides = [];
}

async function populateOverrideDropdowns() {
  try {
    // Populate pupil dropdown
    const pupilSelect = document.getElementById('override-pupil-select');
    if (pupilSelect && currentPromotionData) {
      const allPupils = [
        ...(currentPromotionData.promotedPupilsDetails || []),
        ...(currentPromotionData.heldBackPupilsDetails || [])
      ];
      
      allPupils.forEach(pupil => {
        const opt = document.createElement('option');
        opt.value = pupil.id;
        opt.textContent = pupil.name;
        pupilSelect.appendChild(opt);
      });
    }
    
    // Populate class dropdown
    const classSelect = document.getElementById('override-class-select');
    if (classSelect) {
      const classesSnap = await db.collection('classes').orderBy('name').get();
      classesSnap.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = doc.data().name;
        classSelect.appendChild(opt);
      });
      
      // Add Alumni option
      const alumniOpt = document.createElement('option');
      alumniOpt.value = 'alumni';
      alumniOpt.textContent = 'Alumni (Graduate)';
      classSelect.appendChild(alumniOpt);
    }
  } catch (error) {
    console.error('Error populating override dropdowns:', error);
  }
}

let manualOverrides = [];

function handlePromotionOverride() {
  console.log('Promotion overrides changed');
}

function addManualOverride() {
  const pupilSelect = document.getElementById('override-pupil-select');
  const classSelect = document.getElementById('override-class-select');
  
  if (!pupilSelect || !classSelect) return;
  
  const pupilId = pupilSelect.value;
  const classId = classSelect.value;
  
  if (!pupilId || !classId) {
    window.showToast?.('Please select both pupil and class', 'warning');
    return;
  }
  
  const pupilName = pupilSelect.options[pupilSelect.selectedIndex].text;
  const className = classSelect.options[classSelect.selectedIndex].text;
  
  // Check if already exists
  const exists = manualOverrides.find(o => o.pupilId === pupilId);
  if (exists) {
    window.showToast?.('Override for this pupil already exists', 'warning');
    return;
  }
  
  manualOverrides.push({ pupilId, classId, pupilName, className });
  
  renderManualOverrides();
  
  // Reset selects
  pupilSelect.value = '';
  classSelect.value = '';
}

function renderManualOverrides() {
  const container = document.getElementById('manual-overrides-list');
  if (!container) return;
  
  if (manualOverrides.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = '<p style="margin-bottom:var(--space-sm);"><strong>Manual Overrides:</strong></p>';
  
  manualOverrides.forEach((override, index) => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:var(--space-sm); background:white; border-radius:var(--radius-sm); margin-bottom:var(--space-xs); display:flex; justify-content:space-between; align-items:center;';
    div.innerHTML = `
      <span>${override.pupilName} → ${override.className}</span>
      <button class="btn-small btn-danger" onclick="removeManualOverride(${index})">Remove</button>
    `;
    container.appendChild(div);
  });
}

function removeManualOverride(index) {
  manualOverrides.splice(index, 1);
  renderManualOverrides();
}

async function approvePromotion() {
  if (!currentPromotionId || !currentPromotionData) {
    window.showToast?.('No promotion selected', 'danger');
    return;
  }

  const confirmation = confirm(
    'Approve and Execute Promotion?\n\n' +
    'This will:\n' +
    '✓ Move pupils to their new classes\n' +
    '✓ Update all pupil records\n' +
    '✓ Move terminal class pupils to alumni (if applicable)\n\n' +
    'This action cannot be undone. Continue?'
  );

  if (!confirmation) return;

  const approveBtn = document.getElementById('approve-promotion-btn');
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.innerHTML = '<span class="btn-loading">Processing...</span>';
  }

  try {
    const pupilAssignment = new Map();

    // Process promote-list checkboxes first
    document.querySelectorAll('.override-promote-checkbox').forEach(checkbox => {
      const pupilId = checkbox.dataset.pupilId;
      if (!pupilId) return;
      pupilAssignment.set(pupilId, checkbox.checked ? 'promote' : 'hold');
    });

    // Process hold-list checkboxes
    document.querySelectorAll('.override-hold-checkbox').forEach(checkbox => {
      const pupilId = checkbox.dataset.pupilId;
      if (!pupilId) return;
      if (checkbox.checked) {
        pupilAssignment.set(pupilId, 'promote');
      } else {
        if (!pupilAssignment.has(pupilId)) {
          pupilAssignment.set(pupilId, 'hold');
        }
      }
    });

    const finalPromotedPupils = [];
    const finalHeldBackPupils = [];

    for (const [pupilId, decision] of pupilAssignment.entries()) {
      if (decision === 'promote') finalPromotedPupils.push(pupilId);
      else finalHeldBackPupils.push(pupilId);
    }

    // Defensive assertion — must never overlap
    const promotedSet = new Set(finalPromotedPupils);
    const overlap = finalHeldBackPupils.filter(id => promotedSet.has(id));
    if (overlap.length > 0) {
      throw new Error(
        `Promotion cannot proceed — same pupil(s) found in both lists: ${overlap.join(', ')}`
      );
    }

    console.log(`Promotion: ${finalPromotedPupils.length} promote, ${finalHeldBackPupils.length} hold`);

    await executePromotion(
      currentPromotionId,
      finalPromotedPupils,
      finalHeldBackPupils,
      manualOverrides
    );

    window.showToast?.('✓ Promotion approved and executed successfully!', 'success', 6000);

    closePromotionDetailsModal();
    manualOverrides = [];
    await loadPromotionRequests();

  } catch (error) {
    console.error('Error approving promotion:', error);
    window.handleError(error, 'Failed to approve promotion');
  } finally {
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.innerHTML = '✓ Approve & Execute';
    }
  }
}

async function executePromotion(promotionId, promotedPupils, heldBackPupils, manualOverrides) {
  const promotionDoc = await db.collection('promotions').doc(promotionId).get();
  
  if (!promotionDoc.exists) {
    throw new Error('Promotion request not found');
  }
  
  const data = promotionDoc.data();
  
  if (!data.toClass || !data.toClass.id) {
    throw new Error('Invalid promotion data: missing target class');
  }
  
 // Proper batch size limit
const BATCH_SIZE = 400;
let currentBatch = db.batch();
let operationCount = 0;
let batchNumber = 1;
let totalOperations = 0;

// Helper function to commit current batch safely
async function commitCurrentBatch() {
  if (operationCount > 0) {
    console.log(`📦 Committing batch ${batchNumber} with ${operationCount} operations...`);
    
    try {
      await currentBatch.commit();
      console.log(`✅ Batch ${batchNumber} committed successfully`);
      
      batchNumber++;
      currentBatch = db.batch();
      operationCount = 0;
      
      // Small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Batch ${batchNumber} failed:`, error);
      throw new Error(`Promotion failed at batch ${batchNumber}. Error: ${error.message}`);
    }
  }
}

// Get class details if not terminal
let toClassDetails = null;
if (!data.isTerminalClass) {
  const toClassDoc = await db.collection('classes').doc(data.toClass.id).get();
  if (toClassDoc.exists) {
    toClassDetails = toClassDoc.data();
  }
}

// Process promoted pupils
console.log(`📝 Processing ${promotedPupils.length} promoted pupils...`);

for (const pupilId of promotedPupils) {
  const pupilRef = db.collection('pupils').doc(pupilId);
  const pupilDoc = await pupilRef.get();
  
  if (!pupilDoc.exists) {
    console.warn(`⚠️ Pupil ${pupilId} not found, skipping`);
    continue;
  }
  
  const pupilData = pupilDoc.data();

  if (data.isTerminalClass) {
    const finalClassName = pupilData.class?.name || data.fromClass.name;
    const finalTeacherName = pupilData.assignedTeacher?.name || 'Unknown';
    
    currentBatch.update(pupilRef, {
      status: 'alumni',
      isActive: false,
      'class.id': null,
      'class.name': null,
      subjects: [],
      'assignedTeacher.id': null,
      'assignedTeacher.name': null,
      finalClass: finalClassName,
      finalTeacher: finalTeacherName,
      graduationSession: data.fromSession,
      graduationDate: firebase.firestore.FieldValue.serverTimestamp(),
      promotionDate: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    operationCount++;
    totalOperations++;
    
    const alumniRef = db.collection('alumni').doc(pupilId);
    currentBatch.set(alumniRef, {
      pupilId: pupilId,
      name: pupilData.name || 'Unknown',
      finalClass: finalClassName,
      finalTeacher: finalTeacherName,
      graduationSession: data.fromSession,
      graduationDate: firebase.firestore.FieldValue.serverTimestamp(),
      gender: pupilData.gender || null,
      admissionNo: pupilData.admissionNo || null
    });
    operationCount++;
    totalOperations++;
    
  } else {
    currentBatch.update(pupilRef, {
      'class.id': data.toClass.id,
      'class.name': data.toClass.name,
      subjects: toClassDetails?.subjects || [],
      promotionHistory: firebase.firestore.FieldValue.arrayUnion({
        session: data.fromSession,
        fromClass: data.fromClass.name,
        toClass: data.toClass.name,
        promoted: true,
        date: firebase.firestore.FieldValue.serverTimestamp()
      }),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    operationCount++;
    totalOperations++;
  }
  
  if (operationCount >= BATCH_SIZE) {
    await commitCurrentBatch();
  }
}

// Process held back pupils
console.log(`📝 Processing ${heldBackPupils.length} held back pupils...`);

for (const pupilId of heldBackPupils) {
  const pupilRef = db.collection('pupils').doc(pupilId);
  const pupilDoc = await pupilRef.get();
  
  if (!pupilDoc.exists) {
    console.warn(`⚠️ Pupil ${pupilId} not found, skipping`);
    continue;
  }
  
  currentBatch.update(pupilRef, {
    promotionHistory: firebase.firestore.FieldValue.arrayUnion({
      session: data.fromSession,
      fromClass: data.fromClass.name,
      toClass: data.fromClass.name,
      promoted: false,
      reason: 'Held back by admin/teacher decision',
      date: firebase.firestore.FieldValue.serverTimestamp()
    }),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  operationCount++;
  totalOperations++;
  
  if (operationCount >= BATCH_SIZE) {
    await commitCurrentBatch();
  }
}

// Process manual overrides
console.log(`📝 Processing ${manualOverrides.length} manual overrides...`);

for (const override of manualOverrides) {
  const pupilRef = db.collection('pupils').doc(override.pupilId);
  const pupilDoc = await pupilRef.get();
  
  if (!pupilDoc.exists) {
    console.warn(`⚠️ Pupil ${override.pupilId} not found, skipping`);
    continue;
  }
  
  const pupilData = pupilDoc.data();

  if (override.classId === 'alumni') {
    const finalClassName = pupilData.class?.name || data.fromClass?.name || 'Unknown';
    
    currentBatch.update(pupilRef, {
      status: 'alumni',
      isActive: false,
      'class.id': null,
      'class.name': null,
      subjects: [],
      'assignedTeacher.id': null,
      'assignedTeacher.name': null,
      finalClass: finalClassName,
      graduationSession: data.fromSession,
      graduationDate: firebase.firestore.FieldValue.serverTimestamp(),
      promotionDate: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    operationCount++;
    totalOperations++;
    
    const alumniRef = db.collection('alumni').doc(override.pupilId);
    currentBatch.set(alumniRef, {
      pupilId: override.pupilId,
      name: pupilData.name || 'Unknown',
      finalClass: finalClassName,
      graduationSession: data.fromSession,
      graduationDate: firebase.firestore.FieldValue.serverTimestamp(),
      gender: pupilData.gender || null,
      admissionNo: pupilData.admissionNo || null,
      manualOverride: true
    });
    operationCount++;
    totalOperations++;
      
  } else {
    const overrideClassDoc = await db.collection('classes').doc(override.classId).get();
      
    if (overrideClassDoc.exists) {
      const overrideClassData = overrideClassDoc.data();
        
      currentBatch.update(pupilRef, {
        'class.id': override.classId,
        'class.name': overrideClassData.name,
        subjects: overrideClassData.subjects || [],
        promotionHistory: firebase.firestore.FieldValue.arrayUnion({
          session: data.fromSession,
          fromClass: data.fromClass.name,
          toClass: overrideClassData.name,
          promoted: true,
          manualOverride: true,
          date: firebase.firestore.FieldValue.serverTimestamp()
        }),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      operationCount++;
      totalOperations++;
    }
  }
  
  if (operationCount >= BATCH_SIZE) {
    await commitCurrentBatch();
  }
}

// Mark promotion as completed
currentBatch.update(promotionDoc.ref, {
  status: 'completed',
  approvedBy: auth.currentUser.uid,
  approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
  executedAt: firebase.firestore.FieldValue.serverTimestamp()
});
operationCount++;
totalOperations++;

// Commit final batch
await commitCurrentBatch();

console.log(`✅ Promotion completed successfully!`);
console.log(`   - ${promotedPupils.length} pupils promoted`);
console.log(`   - ${heldBackPupils.length} pupils held back`);
console.log(`   - ${manualOverrides.length} manual overrides`);
console.log(`   - Total batches: ${batchNumber - 1}`);
console.log(`   - Total operations: ${totalOperations}`);
}

async function rejectPromotion() {
  if (!currentPromotionId) {
    window.showToast?.('No promotion selected', 'danger');
    return;
  }

  const reason = prompt('Reason for rejection (optional):');

  try {
    await db.collection('promotions').doc(currentPromotionId).update({
      status: 'rejected',
      rejectedBy: auth.currentUser.uid,
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectionReason: reason || 'No reason provided'
    });

    window.showToast?.('✓ Promotion request rejected', 'success');

    closePromotionDetailsModal();
    await loadPromotionRequests();
  } catch (error) {
    console.error('Error rejecting promotion:', error);
    window.handleError(error, 'Failed to reject promotion');
  }
}

async function quickApprovePromotion(promotionId) {
  const confirmation = confirm('Approve this promotion request without modifications?');
  if (!confirmation) return;

  try {
    const doc = await db.collection('promotions').doc(promotionId).get();
    const data = doc.data();

    await executePromotion(
      promotionId,
      data.promotedPupils || [],
      data.heldBackPupils || [],
      []
    );

    window.showToast?.('✓ Promotion approved and executed', 'success');
    await loadPromotionRequests();
  } catch (error) {
    console.error('Error quick approving:', error);
    window.handleError(error, 'Failed to approve promotion');
  }
}

async function quickRejectPromotion(promotionId) {
  const confirmation = confirm('Reject this promotion request?');
  if (!confirmation) return;

  try {
    await db.collection('promotions').doc(promotionId).update({
      status: 'rejected',
      rejectedBy: auth.currentUser.uid,
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.showToast?.('✓ Promotion request rejected', 'success');
    await loadPromotionRequests();
  } catch (error) {
    console.error('Error quick rejecting:', error);
    window.handleError(error, 'Failed to reject promotion');
  }
}

async function approveAllPendingPromotions() {
  const confirmation = confirm(
    'Approve ALL pending promotion requests?\n\n' +
      'This will execute all promotions without modifications.\n' +
      'Continue?'
  );
  if (!confirmation) return;

  try {
    const snapshot = await db
      .collection('promotions')
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) {
      window.showToast?.('No pending requests to approve', 'info');
      return;
    }

    for (const doc of snapshot.docs) {
      const data = doc.data();
      await executePromotion(
        doc.id,
        data.promotedPupils || [],
        data.heldBackPupils || [],
        []
      );
    }

    window.showToast?.(
      `✓ Approved and executed ${snapshot.size} promotion request(s)`,
      'success',
      6000
    );

    await loadPromotionRequests();
  } catch (error) {
    console.error('Error approving all promotions:', error);
    window.handleError(error, 'Failed to approve all promotions');
  }
}

async function rejectAllPendingPromotions() {
  const confirmation = confirm(
    'Reject ALL pending promotion requests?\n\n' +
      'This action cannot be undone.\n' +
      'Continue?'
  );
  if (!confirmation) return;

  try {
    const snapshot = await db
      .collection('promotions')
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) {
      window.showToast?.('No pending requests to reject', 'info');
      return;
    }

    const batch = db.batch();

    snapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'rejected',
        rejectedBy: auth.currentUser.uid,
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        rejectionReason: 'Bulk rejection by admin'
      });
    });

    await batch.commit();

    window.showToast?.(
      `✓ Rejected ${snapshot.size} promotion request(s)`,
      'success'
    );

    await loadPromotionRequests();
  } catch (error) {
    console.error('Error rejecting all promotions:', error);
    window.handleError(error, 'Failed to reject all promotions');
  }
}

// Make functions globally available
window.togglePromotionPeriod = togglePromotionPeriod;
window.viewPromotionDetails = viewPromotionDetails;
window.closePromotionDetailsModal = closePromotionDetailsModal;
window.handlePromotionOverride = handlePromotionOverride;
window.addManualOverride = addManualOverride;
window.removeManualOverride = removeManualOverride;
window.approvePromotion = approvePromotion;
window.rejectPromotion = rejectPromotion;
window.quickApprovePromotion = quickApprovePromotion;
window.quickRejectPromotion = quickRejectPromotion;
window.approveAllPendingPromotions = approveAllPendingPromotions;
window.rejectAllPendingPromotions = rejectAllPendingPromotions;

/**
 * Load promotion period status
 */
async function loadPromotionPeriodStatus() {
  const statusEl = document.getElementById('promotion-period-status');
  const toggleBtn = document.getElementById('toggle-promotion-period-btn');
  
  if (!statusEl || !toggleBtn) return;
  
  try {
    const settingsDoc = await db.collection('settings').doc('current').get();
    const isActive = settingsDoc.exists && settingsDoc.data().promotionPeriodActive === true;
    
    if (isActive) {
      statusEl.textContent = '✓ Promotion period is currently ACTIVE. Teachers can submit promotion requests.';
      statusEl.className = 'status-active';
      toggleBtn.textContent = '🔒 Close Promotion Period';
      toggleBtn.className = 'btn btn-danger';
    } else {
      statusEl.textContent = '✗ Promotion period is currently CLOSED. Teachers cannot submit requests.';
      statusEl.className = 'status-inactive';
      toggleBtn.textContent = '🔓 Open Promotion Period';
      toggleBtn.className = 'btn btn-success';
    }
  } catch (error) {
    console.error('Error loading promotion period status:', error);
    statusEl.textContent = 'Error loading status';
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────────────────────── */

let _resultApprovalsTab = 'pending';

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN LOADER
───────────────────────────────────────────────────────────────────────────── */

/**
 * Entry point — renders tab bar then delegates to the correct sub-loader.
 */
async function loadResultApprovals() {
  console.log('📋 Loading result approvals...');

  // ── Ensure tab bar exists ──────────────────────────────────────────────────
  _ensureTabBar();

  // ── Delegate ──────────────────────────────────────────────────────────────
  if (_resultApprovalsTab === 'approved') {
    await _loadApprovedResults();
  } else {
    await _loadPendingResults();
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAB BAR
───────────────────────────────────────────────────────────────────────────── */

function _ensureTabBar() {
  // Look for an existing controls container or create one before the table
  let controls = document.getElementById('result-approvals-tab-bar');

  if (controls) return;

  // Find the section root — try the section element first, then fall back
  const section = document.getElementById('result-approvals');
  if (!section) return;

  controls = document.createElement('div');
  controls.id = 'result-approvals-tab-bar';
  controls.style.cssText = `
    display: flex;
    gap: var(--space-xs);
    margin-bottom: var(--space-lg);
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 0;
  `;

  controls.innerHTML = `
    <button
      id="tab-btn-pending"
      onclick="switchResultApprovalsTab('pending')"
      style="${_tabBtnStyle(true)}">
      ⏳ Pending Approvals
    </button>
    <button
      id="tab-btn-approved"
      onclick="switchResultApprovalsTab('approved')"
      style="${_tabBtnStyle(false)}">
      ✅ Approved Results
    </button>
  `;

  // Insert before the first child of the section
  section.insertBefore(controls, section.firstChild);
}

function _tabBtnStyle(active) {
  return active
    ? `
      padding: 8px 20px;
      border: none;
      border-bottom: 3px solid #00B2FF;
      background: transparent;
      color: #00B2FF;
      font-weight: 700;
      font-size: var(--text-sm);
      cursor: pointer;
      margin-bottom: -2px;
    `
    : `
      padding: 8px 20px;
      border: none;
      border-bottom: 3px solid transparent;
      background: transparent;
      color: #64748b;
      font-weight: 600;
      font-size: var(--text-sm);
      cursor: pointer;
      margin-bottom: -2px;
    `;
}

/**
 * Called by tab buttons.
 */
async function switchResultApprovalsTab(tab) {
  _resultApprovalsTab = tab;

  // Update button styles
  const pendingBtn  = document.getElementById('tab-btn-pending');
  const approvedBtn = document.getElementById('tab-btn-approved');
  if (pendingBtn)  pendingBtn.style.cssText  = _tabBtnStyle(tab === 'pending');
  if (approvedBtn) approvedBtn.style.cssText = _tabBtnStyle(tab === 'approved');

  await loadResultApprovals();
}

/* ─────────────────────────────────────────────────────────────────────────────
   PENDING TAB 
───────────────────────────────────────────────────────────────────────────── */

async function _loadPendingResults() {
  const tbody = document.getElementById('result-approvals-table');
  const noApprovalsMsg = document.getElementById('no-approvals-message');

  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="table-loading">Loading approvals...</td></tr>';

  try {
    // Previously: a direct Firestore query here, plus a SEPARATE
    // results_draft query per submission just to count pupils. Now:
    // one call to the Worker's listSubmissions(), which already
    // stores pupilCount on the submission document at creation time
    // (see submitResults() in backend/business/results/
    // submissions.js) — no N+1 queries needed any more.
    const { submissions } = await adminApiGet('/api/admin/results/submissions?status=pending');

    tbody.innerHTML = '';

    if (submissions.length === 0) {
      if (noApprovalsMsg) noApprovalsMsg.style.display = 'block';
      const existingBulkBar = document.getElementById('results-bulk-action-bar');
      if (existingBulkBar) existingBulkBar.style.display = 'none';
      return;
    }

    if (noApprovalsMsg) noApprovalsMsg.style.display = 'none';

    // Inject bulk bar
    let bulkBar = document.getElementById('results-bulk-action-bar');
    if (!bulkBar) {
      bulkBar = document.createElement('div');
      bulkBar.id = 'results-bulk-action-bar';
      bulkBar.style.cssText = 'display:flex; gap:var(--space-md); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-md); padding:var(--space-md); background:#f8fafc; border:1px solid #e2e8f0; border-radius:var(--radius-md);';
      bulkBar.innerHTML = `
        <label style="display:flex; align-items:center; gap:var(--space-xs); cursor:pointer; font-weight:600;">
          <input type="checkbox" id="select-all-results" onchange="toggleAllResultsSelection(this)">
          Select All
        </label>
        <button id="approve-selected-results-btn" class="btn btn-success" disabled
            onclick="approveAllPendingResults()" style="font-size:var(--text-sm);">
          ✓ Approve Selected
        </button>
        <button id="approve-all-results-btn" class="btn btn-primary"
            onclick="(function(){ document.querySelectorAll('.result-submission-checkbox').forEach(cb => cb.checked=false); approveAllPendingResults(); })()"
            style="font-size:var(--text-sm);">
          ✓ Approve All Pending
        </button>
      `;
      tbody.closest('table').parentElement.insertBefore(bulkBar, tbody.closest('table'));
    } else {
      bulkBar.style.display = 'flex';
      const selectAll = document.getElementById('select-all-results');
      if (selectAll) selectAll.checked = false;
    }

    for (const submissionData of submissions) {
      const submissionId   = submissionData.id;

      const teacherName  = submissionData.teacherName  || 'Unknown';
      const className    = submissionData.className    || '-';
      const subject      = submissionData.subject      || '-';
      const term         = submissionData.term         || '-';
      const session      = submissionData.session      || '-';

      // submittedAt arrives as an ISO string from the Worker API —
      // new Date(...), not Firestore's .toDate().
      const submittedDate = submissionData.submittedAt
        ? new Date(submissionData.submittedAt).toLocaleDateString('en-GB')
        : '-';

      // pupilCount is already on the submission document, computed
      // by the Worker when the teacher submitted — no extra query.
      const pupilCount = submissionData.pupilCount || 0;

      const pupilCountDisplay = pupilCount > 0
        ? pupilCount
        : `<span style="color:#dc3545; font-weight:600;">0 ⚠️</span>`;

      const tr = document.createElement('tr');
      tr.dataset.submissionId = submissionId;
      tr.innerHTML = `
        <td data-label="Select" style="text-align:center;">
          <input type="checkbox" class="result-submission-checkbox"
                 data-submission-id="${submissionId}"
                 onchange="updateResultsBulkButtons()">
        </td>
        <td data-label="Teacher">${teacherName}</td>
        <td data-label="Class">${className}</td>
        <td data-label="Subject">${subject}</td>
        <td data-label="Term">${term}</td>
        <td data-label="Pupils" style="text-align:center;">${pupilCountDisplay}</td>
        <td data-label="Submitted">${submittedDate}</td>
        <td data-label="Status"><span class="status-pending">Pending</span></td>
        <td data-label="Actions">
          <button
            id="preview-btn-${submissionId}"
            class="btn-small btn-secondary"
            onclick="toggleResultPreview(
              '${submissionId}',
              '${submissionData.classId}',
              '${term}',
              '${subject}',
              '${session}',
              '${className}'
            )">
            🔍 Preview
          </button>
          ${pupilCount > 0 ? `
            <button class="btn-small btn-success" onclick="approveResultSubmission('${submissionId}')">
              ✓ Approve
            </button>
            <button class="btn-small btn-danger" onclick="rejectResultSubmission('${submissionId}')">
              ✗ Reject
            </button>
          ` : `
            <button class="btn-small btn-danger" onclick="rejectResultSubmission('${submissionId}')">
              ✗ Reject (No Data)
            </button>
            <span style="font-size:0.75rem; color:#dc3545; display:block; margin-top:4px;">
              ⚠️ No draft results found
            </span>
          `}
        </td>
      `;
      tbody.appendChild(tr);
    }

    console.log(`✓ Loaded ${submissions.length} pending submissions`);

  } catch (error) {
    console.error('❌ Error loading pending approvals:', error);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--color-danger);">Error loading approvals</td></tr>';
    window.showToast?.('Failed to load result approvals', 'danger');
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   APPROVED TAB
───────────────────────────────────────────────────────────────────────────── */

async function _loadApprovedResults() {
  const tbody = document.getElementById('result-approvals-table');
  const noApprovalsMsg = document.getElementById('no-approvals-message');

  if (!tbody) return;

  // Hide bulk bar — not needed for approved view
  const bulkBar = document.getElementById('results-bulk-action-bar');
  if (bulkBar) bulkBar.style.display = 'none';
  if (noApprovalsMsg) noApprovalsMsg.style.display = 'none';

  tbody.innerHTML = '<tr><td colspan="9" class="table-loading">Loading approved results...</td></tr>';

  try {
    const { submissions } = await adminApiGet('/api/admin/results/submissions?status=approved');

    tbody.innerHTML = '';

    if (submissions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:var(--space-2xl); color:var(--color-gray-600);">
            <div style="font-size:2rem; margin-bottom:var(--space-md);">✅</div>
            <p style="font-weight:600;">No approved results yet.</p>
            <p style="font-size:var(--text-sm);">Results will appear here once you approve pending submissions.</p>
          </td>
        </tr>
      `;
      return;
    }

    for (const d of submissions) {
      const id = d.id;

      // approvedAt/submittedAt arrive as ISO strings from the
      // Worker API now, not Firestore Timestamps.
      const approvedDate = d.approvedAt
        ? new Date(d.approvedAt).toLocaleDateString('en-GB')
        : '-';

      const submittedDate = d.submittedAt
        ? new Date(d.submittedAt).toLocaleDateString('en-GB')
        : '-';

      const resultsPublished = d.resultsPublished ?? '—';

      const tr = document.createElement('tr');
      tr.dataset.submissionId = id;
      tr.innerHTML = `
        <td data-label="Select">—</td>
        <td data-label="Teacher">${d.teacherName  || 'Unknown'}</td>
        <td data-label="Class">${d.className    || '-'}</td>
        <td data-label="Subject">${d.subject      || '-'}</td>
        <td data-label="Term">${d.term         || '-'}</td>
        <td data-label="Pupils" style="text-align:center;">${resultsPublished}</td>
        <td data-label="Submitted">${submittedDate}</td>
        <td data-label="Status">
          <span style="
            background:#16a34a;
            color:white;
            padding:3px 10px;
            border-radius:999px;
            font-size:var(--text-xs);
            font-weight:700;
          ">Approved ${approvedDate}</span>
        </td>
        <td data-label="Actions">
          <button
            id="preview-btn-${id}"
            class="btn-small btn-secondary"
            onclick="toggleResultPreview(
              '${id}',
              '${d.classId}',
              '${d.term}',
              '${d.subject}',
              '${d.session}',
              '${d.className}'
            )">
            🔍 Preview
          </button>
          <button
            class="btn-small btn-warning"
            style="background:#f59e0b; color:white; border:none;"
            onclick="unlockApprovedResult('${id}')">
            🔓 Unlock
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    console.log(`✓ Loaded ${submissions.length} approved submissions`);

  } catch (error) {
    console.error('❌ Error loading approved results:', error);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--color-danger);">Error loading approved results</td></tr>';
    window.showToast?.('Failed to load approved results', 'danger');
  }
}

/**
 * Unlock an approved submission so the teacher can re-edit and resubmit.
 */
async function unlockApprovedResult(submissionId) {
  if (!confirm(
    '🔓 UNLOCK APPROVED RESULTS?\n\n' +
    'This will:\n' +
    '• Hide these results from pupils immediately\n' +
    '• Allow the teacher to edit and resubmit\n' +
    '• Require you to re-approve after resubmission\n\n' +
    'Continue?'
  )) return;

  const reason = prompt(
    'Optional: Enter a reason for the teacher\n(e.g. "Scores need correction for pupil X"):'
  ) ?? 'Results unlocked by admin for correction';

  const unlockBtn = document.querySelector(
    `tr[data-submission-id="${submissionId}"] .btn-warning`
  );

  if (unlockBtn) {
    unlockBtn.disabled   = true;
    unlockBtn.innerHTML  = '<span class="btn-loading">Unlocking…</span>';
  }

  try {
    // Previously: read the submission, query results by classId/
    // term/subject then filter by session client-side, batch-update
    // every result doc plus the submission doc, then a separate
    // audit_log write — four+ round-trips, and it never removed the
    // result_locks document approveSubmission() creates, which
    // would have silently blocked re-approval after a resubmission.
    //
    // This feature didn't exist on the Worker at all before this
    // phase. unlockSubmission() now does all of the above as one
    // atomic commit (results + submission), plus deletes the lock,
    // plus writes a proper audit entry — see
    // backend/business/results/approval.js.
    const unlockResult = await adminApiPost(
        `/api/admin/results/submissions/${encodeURIComponent(submissionId)}/unlock`,
        { reason: reason.trim() }
    );

    window.showToast?.(
      `✅ Results unlocked!\n\n` +
      `• ${unlockResult.resultsReverted} result(s) hidden from pupils\n` +
      `• Teacher can now re-edit and resubmit\n` +
      `• Reason sent to teacher: "${unlockResult.submission.unlockReason}"`,
      'success',
      8000
    );

    // Reload approved tab (the row should disappear — it's now 'rejected')
    await loadResultApprovals();

  } catch (error) {
    console.error('❌ Error unlocking results:', error);
    window.showToast?.(`Failed to unlock results: ${error.message}`, 'danger', 8000);

    if (unlockBtn) {
      unlockBtn.disabled  = false;
      unlockBtn.innerHTML = '🔓 Unlock';
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   GLOBAL EXPORTS
───────────────────────────────────────────────────────────────────────────── */

window.loadResultApprovals      = loadResultApprovals;
window.switchResultApprovalsTab = switchResultApprovalsTab;
window.unlockApprovedResult     = unlockApprovedResult;

// Keep existing exports that the rest of admin.js references
window.approveResultSubmission  = approveResultSubmission;
window.rejectResultSubmission   = rejectResultSubmission;

console.log('✅ admin-results-unlock-patch.js loaded');
console.log('   • Pending tab: unchanged approval/rejection flow');
console.log('   • Approved tab: view all approved results + 🔓 Unlock button');
console.log('   • unlockApprovedResult(): reverts results to draft, submission to rejected');

/**
 * Approve results 
 */
async function approveResultSubmission(submissionId) {
    if (!confirm(
        'Approve these results?\n\n' +
        'This will:\n' +
        '✓ Lock the results (teacher cannot edit)\n' +
        '✓ Make results VISIBLE to pupils\n' +
        '✓ Publish to final results collection\n\n' +
        'Continue?'
    )) {
        return;
    }

    try {
        // Previously: a client-side transaction to claim the
        // submission (an "approving" status to guard against double
        // clicks), then a separate Firestore query to re-fetch
        // drafts, then a client-side batch write to copy drafts into
        // results + update the submission — three separate
        // round-trips the browser had to keep consistent itself.
        //
        // Now: ONE call to the Worker's approveSubmission(), which
        // does all of this as a single atomic Firestore commit
        // (published results + submission status + a result lock),
        // using the submission's updateTime as an optimistic-
        // concurrency guard instead of a separate "approving" status.
        // See backend/business/results/approval.js.
        const approval = await adminApiPost(
            `/api/admin/results/submissions/${encodeURIComponent(submissionId)}/approve`,
            {}
        );

        console.log(`✅ Published ${approval.publishedResults.length} results to final collection`);

        window.showToast?.(
            `✓ Results approved and published!\n\n` +
            `${approval.publishedResults.length} pupil result(s) are now VISIBLE to pupils.`,
            'success',
            8000
        );

        // Reload the approvals list
        await loadResultApprovals();

    } catch (error) {
        console.error('❌ Error approving results:', error);

        const FRIENDLY_MESSAGES = {
            SUBMISSION_NOT_FOUND: 'Submission not found.',
            INVALID_SUBMISSION_STATE: 'Cannot approve — this submission is no longer pending. It may already be processing or approved.',
            RESULT_LOCK_ALREADY_EXISTS: 'These results are already locked/approved.',
            EMPTY_SUBMISSION: '⚠️ No draft results found for this submission. The teacher may not have saved any results yet.',
        };

        const message = FRIENDLY_MESSAGES[error.code] || `Failed to approve results: ${error.message}`;
        window.showToast?.(message, error.code === 'SUBMISSION_NOT_FOUND' ? 'danger' : 'warning', 8000);

        // No client-side "approving" status to roll back any more —
        // the Worker never leaves a partial state, since it's one
        // atomic commit or nothing.
        await loadResultApprovals();
    }
}

/**
 * Reject results - keeps them in draft, allows teacher to edit
 */
async function rejectResultSubmission(submissionId) {
    const reason = prompt(
        'Reason for rejection?\n\n' +
        'Teacher will see this message and be able to edit and resubmit.'
    );
    
    if (!reason || reason.trim() === '') {
        window.showToast?.('Rejection cancelled - reason required', 'info');
        return;
    }
    
    try {
        // The Worker's rejectSubmission() just flips the submission's
        // status — results_draft is never touched, so the teacher's
        // drafts are automatically still there to edit and resubmit,
        // same as before.
        await adminApiPost(
            `/api/admin/results/submissions/${encodeURIComponent(submissionId)}/reject`,
            { reason: reason.trim() }
        );

        console.log('✓ Submission rejected, results remain in draft');
        
        window.showToast?.(
            `✓ Results rejected\n\n` +
            `Teacher can now edit and resubmit.\n\n` +
            `Reason: ${reason}`,
            'success',
            6000
        );
        
        // Reload the approvals list
        await loadResultApprovals();
        
    } catch (error) {
        console.error('❌ Error rejecting results:', error);
        window.showToast?.(
            `Failed to reject results: ${error.message}`,
            'danger',
            6000
        );
    }
}

// Make functions globally available
window.loadResultApprovals = loadResultApprovals;
window.approveResultSubmission = approveResultSubmission;
window.rejectResultSubmission = rejectResultSubmission;

/* ========================================
   VIEW PUPIL RESULTS BY SESSION
======================================== */

let currentResultsPupilId = null;
let currentResultsSession = null;
let currentResultsData = null;

async function loadViewResultsSection() {
  console.log('📊 Loading View Results section...');
  
  try {
    // Populate session dropdown
    await populateSessionFilter();
    
    // Reset filters
    const classSelect = document.getElementById('filter-class');
    const pupilSelect = document.getElementById('filter-pupil');
    const viewBtn = document.getElementById('view-results-btn');
    const sessionSelect = document.getElementById('filter-session');
    
    if (classSelect) classSelect.disabled = true;
    if (pupilSelect) pupilSelect.disabled = true;
    if (viewBtn) viewBtn.disabled = true;
    
    // Attach all event listeners properly
    // 1. Session select listener
    if (sessionSelect) {
      const newSessionSelect = sessionSelect.cloneNode(true);
      sessionSelect.parentNode.replaceChild(newSessionSelect, sessionSelect);
      
      newSessionSelect.addEventListener('change', loadFilteredClasses);
      console.log('✓ Session select listener attached');
    }
    
    // 2. View Results button listener
    if (viewBtn) {
      const newViewBtn = viewBtn.cloneNode(true);
      viewBtn.parentNode.replaceChild(newViewBtn, viewBtn);
      
      newViewBtn.addEventListener('click', loadPupilResults);
      console.log('✓ View Results button listener attached');
    }
    
    console.log('✓ View Results section ready');
  } catch (error) {
    console.error('Error loading View Results section:', error);
    window.showToast?.('Failed to load results section', 'danger');
  }
}

async function populateSessionFilter() {
  const sessionSelect = document.getElementById('filter-session');
  if (!sessionSelect) return;
  
  try {
    // Get current session
    const settings = await window.getCurrentSettings();
    const currentSession = settings.session || 'Current Session';
    
    // Clear and rebuild
    sessionSelect.innerHTML = '<option value="">-- Select Session --</option>';
    
    // Add current session
    const currentOpt = document.createElement('option');
    currentOpt.value = 'current';
    currentOpt.textContent = `Current Session (${currentSession})`;
    sessionSelect.appendChild(currentOpt);
    
    // Get all archived sessions
    const sessionsSnap = await db.collection('sessions')
      .orderBy('startYear', 'desc')
      .get();
    
    sessionsSnap.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement('option');
      opt.value = data.name;
      opt.textContent = `${data.name} Session`;
      sessionSelect.appendChild(opt);
    });
    
    console.log(`✓ Session filter populated: Current + ${sessionsSnap.size} archived`);
    
  } catch (error) {
    console.error('Error populating session filter:', error);
    sessionSelect.innerHTML = '<option value="">Error loading sessions</option>';
  }
}

/**
 * Load classes for result viewing - includes alumni option
 */
async function loadFilteredClasses() {
  const sessionSelect = document.getElementById('filter-session');
  let classSelect = document.getElementById('filter-class');
  let pupilSelect = document.getElementById('filter-pupil');
  
  if (!sessionSelect || !classSelect || !pupilSelect) return;
  
  const selectedSession = sessionSelect.value;
  
  classSelect.innerHTML = '<option value="">-- Select Class --</option>';
  classSelect.disabled = true;
  pupilSelect.innerHTML = '<option value="">-- Select Pupil --</option>';
  pupilSelect.disabled = true;
  
  const viewBtn = document.getElementById('view-results-btn');
  if (viewBtn) viewBtn.disabled = true;
  
  if (!selectedSession) return;
  
  try {
    let actualSession;
    if (selectedSession === 'current') {
      const settings = await window.getCurrentSettings();
      actualSession = settings.session;
    } else {
      actualSession = selectedSession;
    }
    
    currentResultsSession = actualSession;
    
    // Get all classes
    const classesSnap = await db.collection('classes').orderBy('name').get();
    
    const classOptions = [];
    
    // Add active classes that have pupils with results in this session
    for (const classDoc of classesSnap.docs) {
      const className = classDoc.data().name;
      const classId = classDoc.id;
      
      // Check if any results exist for this class in this session
      const resultsSnap = await db.collection('results')
        .where('classId', '==', classId)
        .where('session', '==', actualSession)
        .limit(1)
        .get();
      
      // Also check by className in results (some results may store className)
      let hasResults = !resultsSnap.empty;
      
      if (!hasResults) {
        // Fallback: check if any active pupils in this class have results
        const pupilsSnap = await db.collection('pupils')
          .where('class.id', '==', classId)
          .limit(1)
          .get();
        
        if (!pupilsSnap.empty) {
          const pupilId = pupilsSnap.docs[0].id;
          const pupilResultsSnap = await db.collection('results')
            .where('pupilId', '==', pupilId)
            .where('session', '==', actualSession)
            .limit(1)
            .get();
          hasResults = !pupilResultsSnap.empty;
        }
      }
      
      if (hasResults) {
        classOptions.push({ id: classId, name: className });
      }
    }
    
    // Also check if any alumni have results for this session
    const alumniResultsSnap = await db.collection('results')
      .where('session', '==', actualSession)
      .limit(1)
      .get();
    
    // Check if any alumni (status === 'alumni') have results this session
    let hasAlumniResults = false;
    if (!alumniResultsSnap.empty) {
      // Sample check - look for pupils with alumni status who have results
      const samplePupilId = alumniResultsSnap.docs[0].data().pupilId;
      if (samplePupilId) {
        const pupilDoc = await db.collection('pupils').doc(samplePupilId).get();
        if (pupilDoc.exists && pupilDoc.data().status === 'alumni') {
          hasAlumniResults = true;
        }
      }
      
      // More thorough check: look for any alumni with results this session
      if (!hasAlumniResults) {
        const alumniSnap = await db.collection('pupils')
          .where('status', '==', 'alumni')
          .get();
        
        for (const alumDoc of alumniSnap.docs) {
          const alumResultsSnap = await db.collection('results')
            .where('pupilId', '==', alumDoc.id)
            .where('session', '==', actualSession)
            .limit(1)
            .get();
          
          if (!alumResultsSnap.empty) {
            hasAlumniResults = true;
            break;
          }
        }
      }
    }
    
    if (hasAlumniResults) {
      classOptions.push({ id: '__alumni__', name: '🎓 Alumni (Graduated Pupils)' });
    }
    
    if (classOptions.length === 0) {
      classSelect.innerHTML = '<option value="">No classes with results in this session</option>';
      window.showToast?.('No results found for this session', 'warning', 4000);
      return;
    }
    
    // Sort: regular classes alphabetically, alumni at end
    classOptions.sort((a, b) => {
      if (a.id === '__alumni__') return 1;
      if (b.id === '__alumni__') return -1;
      return a.name.localeCompare(b.name);
    });
    
    classOptions.forEach(cls => {
      const opt = document.createElement('option');
      opt.value = cls.id;
      opt.textContent = cls.name;
      classSelect.appendChild(opt);
    });
    
    classSelect.disabled = false;
    
    classSelect = document.getElementById('filter-class');
    
    if (classSelect && classSelect.parentNode) {
      const newClassSelect = classSelect.cloneNode(true);
      classSelect.parentNode.replaceChild(newClassSelect, classSelect);
      newClassSelect.addEventListener('change', loadFilteredPupils);
      console.log(`✓ Loaded ${classOptions.length} class options for session: ${actualSession}`);
    }
    
  } catch (error) {
    console.error('Error loading classes:', error);
    window.showToast?.('Failed to load classes', 'danger');
  }
}

/**
 * Load pupils for result viewing - includes alumni
 */
async function loadFilteredPupils() {
  let classSelect = document.getElementById('filter-class');
  let pupilSelect = document.getElementById('filter-pupil');
  
  if (!classSelect || !pupilSelect) return;
  
  const selectedClass = classSelect.value;
  
  pupilSelect.innerHTML = '<option value="">-- Select Pupil --</option>';
  pupilSelect.disabled = true;
  
  const viewBtn = document.getElementById('view-results-btn');
  if (viewBtn) viewBtn.disabled = true;
  
  if (!selectedClass || !currentResultsSession) return;
  
  try {
    let pupilsWithResults = [];
    
    if (selectedClass === '__alumni__') {
      // Load alumni who have results in this session
      const alumniSnap = await db.collection('pupils')
        .where('status', '==', 'alumni')
        .get();
      
      for (const alumDoc of alumniSnap.docs) {
        const alumData = alumDoc.data();
        const alumId = alumDoc.id;
        
        const resultsSnap = await db.collection('results')
          .where('pupilId', '==', alumId)
          .where('session', '==', currentResultsSession)
          .limit(1)
          .get();
        
        if (!resultsSnap.empty) {
          pupilsWithResults.push({
            id: alumId,
            name: alumData.name || 'Unknown',
            data: alumData
          });
        }
      }
    } else {
      // Regular class: load active pupils with results in this session
      const pupilsSnap = await db.collection('pupils')
        .where('class.id', '==', selectedClass)
        .get();
      
      if (pupilsSnap.empty) {
        // Also check alumni who were in this class
        const classDoc = await db.collection('classes').doc(selectedClass).get();
        const className = classDoc.exists ? classDoc.data().name : null;
        
        if (className) {
          const alumniInClassSnap = await db.collection('pupils')
            .where('status', '==', 'alumni')
            .where('finalClass', '==', className)
            .get();
          
          for (const alumDoc of alumniInClassSnap.docs) {
            const alumData = alumDoc.data();
            
            const resultsSnap = await db.collection('results')
              .where('pupilId', '==', alumDoc.id)
              .where('session', '==', currentResultsSession)
              .limit(1)
              .get();
            
            if (!resultsSnap.empty) {
              pupilsWithResults.push({
                id: alumDoc.id,
                name: `${alumData.name || 'Unknown'} (Alumni)`,
                data: alumData
              });
            }
          }
        }
      } else {
        // Check active pupils in this class for results
        for (const pupilDoc of pupilsSnap.docs) {
          const pupilId = pupilDoc.id;
          const pupilData = pupilDoc.data();
          
          const resultsSnap = await db.collection('results')
            .where('pupilId', '==', pupilId)
            .where('session', '==', currentResultsSession)
            .limit(1)
            .get();
          
          if (!resultsSnap.empty) {
            pupilsWithResults.push({
              id: pupilId,
              name: pupilData.name || 'Unknown',
              data: pupilData
            });
          }
        }
        
        // Also include alumni who were in this class and have results
        const classDoc = await db.collection('classes').doc(selectedClass).get();
        const className = classDoc.exists ? classDoc.data().name : null;
        
        if (className) {
          const alumniInClassSnap = await db.collection('pupils')
            .where('status', '==', 'alumni')
            .where('finalClass', '==', className)
            .get();
          
          for (const alumDoc of alumniInClassSnap.docs) {
            // Avoid duplicates
            if (pupilsWithResults.find(p => p.id === alumDoc.id)) continue;
            
            const alumData = alumDoc.data();
            
            const resultsSnap = await db.collection('results')
              .where('pupilId', '==', alumDoc.id)
              .where('session', '==', currentResultsSession)
              .limit(1)
              .get();
            
            if (!resultsSnap.empty) {
              pupilsWithResults.push({
                id: alumDoc.id,
                name: `${alumData.name || 'Unknown'} (Alumni)`,
                data: alumData
              });
            }
          }
        }
      }
    }
    
    if (pupilsWithResults.length === 0) {
      pupilSelect.innerHTML = '<option value="">No results found for pupils in this selection</option>';
      window.showToast?.('No results found for this selection in the chosen session', 'warning', 4000);
      return;
    }
    
    // Sort by name
    pupilsWithResults.sort((a, b) => a.name.localeCompare(b.name));
    
    pupilsWithResults.forEach(pupil => {
      const opt = document.createElement('option');
      opt.value = pupil.id;
      opt.textContent = pupil.name;
      opt.dataset.pupilData = JSON.stringify(pupil.data);
      pupilSelect.appendChild(opt);
    });
    
    pupilSelect.disabled = false;
    
    pupilSelect = document.getElementById('filter-pupil');
    
    if (pupilSelect && pupilSelect.parentNode) {
      const newPupilSelect = pupilSelect.cloneNode(true);
      pupilSelect.parentNode.replaceChild(newPupilSelect, pupilSelect);
      
      newPupilSelect.addEventListener('change', function() {
        const viewBtn = document.getElementById('view-results-btn');
        if (viewBtn) viewBtn.disabled = !this.value;
      });
      
      console.log(`✓ Loaded ${pupilsWithResults.length} pupils/alumni with results`);
    }
    
  } catch (error) {
    console.error('Error loading pupils:', error);
    window.showToast?.('Failed to load pupils', 'danger');
  }
}

// Re-expose globally
window.loadFilteredClasses = loadFilteredClasses;
window.loadFilteredPupils = loadFilteredPupils;

async function loadPupilResults() {
    const pupilSelect = document.getElementById('filter-pupil');
    const container = document.getElementById('results-display-container');
    const infoCard = document.getElementById('pupil-info-card');
    
    if (!pupilSelect || !container) {
        console.error('Required elements not found');
        return;
    }
    
    const selectedPupil = pupilSelect.value;
    
    // Validate all required data before proceeding
    if (!selectedPupil) {
        infoCard.style.display = 'none';
        container.innerHTML = `
            <div style="text-align: center; padding: var(--space-2xl); color: var(--color-gray-600);">
                <div style="font-size: 3rem; margin-bottom: var(--space-md);">📊</div>
                <p>Select a pupil to view results</p>
            </div>
        `;
        return;
    }
    
    if (!currentResultsSession) {
        console.error('Session not selected');
        infoCard.style.display = 'none';
        container.innerHTML = `
            <div style="text-align: center; padding: var(--space-2xl); color: var(--color-warning);">
                <div style="font-size: 3rem; margin-bottom: var(--space-md);">⚠️</div>
                <p style="font-weight: 600;">Session not selected</p>
                <p>Please select a session from the filter above</p>
            </div>
        `;
        return;
    }
    
    currentResultsPupilId = selectedPupil;
    
    // Show loading
    container.innerHTML = `
        <div style="text-align: center; padding: var(--space-2xl);">
            <div class="spinner" style="margin: 0 auto var(--space-md);"></div>
            <p style="color: var(--color-gray-600);">Loading results for session: ${currentResultsSession}</p>
        </div>
    `;
    
    try {
        // Get pupil data
        const pupilDoc = await db.collection('pupils').doc(selectedPupil).get();
        
        if (!pupilDoc.exists) {
            throw new Error('Pupil not found');
        }
        
        const pupilData = pupilDoc.data();
        
        // Get pupil's class name
        let className = 'Unknown';
        if (pupilData.class) {
            if (typeof pupilData.class === 'object' && pupilData.class.name) {
                className = pupilData.class.name;
            } else if (typeof pupilData.class === 'string') {
                className = pupilData.class;
            }
        }
        
        // Update info card
        document.getElementById('pupil-info-name').textContent = pupilData.name || 'Unknown';
        document.getElementById('pupil-info-class').textContent = className;
        document.getElementById('pupil-info-session').textContent = currentResultsSession;
        document.getElementById('pupil-info-gender').textContent = pupilData.gender || '-';
        infoCard.style.display = 'block';
        
        console.log('🔍 Querying results with:', {
            pupilId: selectedPupil,
            session: currentResultsSession
        });
        
        // PRIMARY QUERY: Try with composite query first
        let results = [];
        let queryMethod = 'unknown';
        
        try {
            const resultsSnap = await db.collection('results')
                .where('pupilId', '==', selectedPupil)
                .where('session', '==', currentResultsSession)
                .get();
            
            console.log(`✓ Primary query returned ${resultsSnap.size} results`);
            
            if (!resultsSnap.empty) {
                resultsSnap.forEach(doc => {
                    const data = doc.data();
                    results.push({
                        term: data.term || 'Unknown',
                        subject: data.subject || 'Unknown',
                        caScore: typeof data.caScore === 'number' ? data.caScore : 0,
                        examScore: typeof data.examScore === 'number' ? data.examScore : 0,
                        total: (data.caScore || 0) + (data.examScore || 0)
                    });
                });
                queryMethod = 'primary';
            }
        } catch (primaryError) {
            console.warn('⚠️ Primary query failed (possibly missing index):', primaryError.code);
            
            // FALLBACK METHOD: Query without session filter
            if (primaryError.code === 'failed-precondition') {
                console.log('📋 Using fallback method: querying all pupil results and filtering manually');
                
                window.showToast?.(
                    'Loading results using alternative method...',
                    'info',
                    3000
                );
            }
        }
        
        // FALLBACK QUERY: If primary failed or returned empty
        if (results.length === 0) {
            console.log('🔄 Trying fallback method: manual filtering');
            
            const allResultsSnap = await db.collection('results')
                .where('pupilId', '==', selectedPupil)
                .get();
            
            console.log(`📊 Fallback query found ${allResultsSnap.size} total results for pupil`);
            
            // Filter manually by session
            allResultsSnap.forEach(doc => {
                const data = doc.data();
                if (data.session === currentResultsSession) {
                    results.push({
                        term: data.term || 'Unknown',
                        subject: data.subject || 'Unknown',
                        caScore: typeof data.caScore === 'number' ? data.caScore : 0,
                        examScore: typeof data.examScore === 'number' ? data.examScore : 0,
                        total: (data.caScore || 0) + (data.examScore || 0)
                    });
                }
            });
            
            console.log(`✓ Fallback filtered to ${results.length} results for session "${currentResultsSession}"`);
            queryMethod = 'fallback';
        }
        
        // Check if we found any results
        if (results.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: var(--space-2xl); color: var(--color-gray-600);">
                    <div style="font-size: 3rem; margin-bottom: var(--space-md);">📋</div>
                    <p style="font-size: var(--text-lg); font-weight: 600;">No results found</p>
                    <p>This pupil has no recorded results for session: <strong>${currentResultsSession}</strong></p>
                    <p style="font-size: var(--text-sm); margin-top: var(--space-md); color: var(--color-gray-500);">
                        Make sure results have been entered by the class teacher.
                    </p>
                </div>
            `;
            return;
        }
        
        // Success! Render results
        console.log(`✅ Successfully loaded ${results.length} results using ${queryMethod} method`);
        currentResultsData = results;
        await renderResultsDisplay(results, container);

    } catch (error) {
        console.error('❌ Error loading pupil results:', error);
        
        // Detailed error handling
        let errorMessage = 'Error loading results';
        let errorDetails = error.message || 'Unknown error';
        let showRetry = true;
        
        if (error.code === 'permission-denied') {
            errorMessage = 'Permission denied';
            errorDetails = 'You do not have permission to view this data';
            showRetry = false;
        } else if (error.code === 'unavailable') {
            errorMessage = 'Service unavailable';
            errorDetails = 'Cannot connect to server. Check your internet connection.';
        } else if (error.code === 'failed-precondition') {
            errorMessage = 'Database Configuration Issue';
            errorDetails = 'A required database index is missing. Please contact your system administrator.';
            showRetry = false;
        }
        
        container.innerHTML = `
            <div style="text-align: center; padding: var(--space-2xl); color: var(--color-danger);">
                <div style="font-size: 3rem; margin-bottom: var(--space-md);">⚠️</div>
                <p style="font-size: var(--text-lg); font-weight: 600;">${errorMessage}</p>
                <p style="margin-bottom: var(--space-lg);">${errorDetails}</p>
                ${showRetry ? `
                    <button class="btn btn-primary" onclick="loadPupilResults()" style="margin-top: var(--space-lg);">
                        🔄 Retry
                    </button>
                ` : ''}
            </div>
        `;
        
        window.showToast?.(errorMessage, 'danger', 5000);
    }
}

async function renderResultsDisplay(results, container) {
    container.innerHTML = '';
    
    // Group by term
    const terms = {};
    results.forEach(r => {
        if (!terms[r.term]) terms[r.term] = [];
        terms[r.term].push(r);
    });
    
    let overallTotal = 0;
    let overallCount = 0;
    
    ['First Term', 'Second Term', 'Third Term'].forEach(termName => {
        if (!terms[termName]) return;
        
        const termSection = document.createElement('div');
        termSection.style.marginBottom = 'var(--space-2xl)';
        
        const heading = document.createElement('h3');
        heading.textContent = termName;
        heading.style.marginBottom = 'var(--space-md)';
        heading.style.color = '#0f172a';
        heading.style.fontSize = 'var(--text-xl)';
        termSection.appendChild(heading);
        
        const table = document.createElement('table');
        table.className = 'responsive-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Subject</th>
                    <th style="text-align: center;">CA (40)</th>
                    <th style="text-align: center;">Exam (60)</th>
                    <th style="text-align: center;">Total (100)</th>
                    <th style="text-align: center;">Grade</th>
                    <th style="text-align: center;">Remark</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        
        const tbody = table.querySelector('tbody');
        
        let termTotal = 0;
        let subjectCount = 0;
        
        // Sort by subject name
        terms[termName].sort((a, b) => a.subject.localeCompare(b.subject));
        
        terms[termName].forEach(result => {
            const total = result.caScore + result.examScore;
            const grade = getGrade(total);
            const remark = getRemark(total);
            const gradeClass = `grade-${grade}`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Subject"><strong>${result.subject}</strong></td>
                <td data-label="CA" style="text-align: center;">${result.caScore}</td>
                <td data-label="Exam" style="text-align: center;">${result.examScore}</td>
                <td data-label="Total" style="text-align: center; font-weight: 700;">${total}</td>
                <td data-label="Grade" style="text-align: center;" class="${gradeClass}"><strong>${grade}</strong></td>
                <td data-label="Remark" style="text-align: center;">${remark}</td>
            `;
            tbody.appendChild(tr);
            
            termTotal += total;
            subjectCount++;
            overallTotal += total;
            overallCount++;
        });
        
        // Add term summary
        if (subjectCount > 0) {
            const average = (termTotal / subjectCount).toFixed(1);
            const avgGrade = getGrade(parseFloat(average));
            
            tbody.innerHTML += `
                <tr style="background: #f1f5f9; font-weight: 700;">
                    <td colspan="3"><strong>TERM TOTAL</strong></td>
                    <td colspan="3" style="text-align: center;"><strong>${termTotal} / ${subjectCount * 100}</strong></td>
                </tr>
                <tr style="background: #e0f2fe; font-weight: 700; color: #0369a1;">
                    <td colspan="3"><strong>TERM AVERAGE</strong></td>
                    <td colspan="3" style="text-align: center;"><strong>${average}% (${avgGrade})</strong></td>
                </tr>
            `;
        }
        
        termSection.appendChild(table);
        container.appendChild(termSection);
    });
    
    // Add overall session summary
    if (overallCount > 0) {
        const overallAverage = (overallTotal / overallCount).toFixed(1);
        const overallGrade = getGrade(parseFloat(overallAverage));
        
        const summaryCard = document.createElement('div');
        summaryCard.style.cssText = `
            background: linear-gradient(135deg, #00B2FF 0%, #0090CC 100%);
            color: white;
            padding: var(--space-xl);
            border-radius: var(--radius-lg);
            margin-top: var(--space-2xl);
            box-shadow: 0 4px 20px rgba(0, 178, 255, 0.3);
        `;
        
        summaryCard.innerHTML = `
            <h3 style="margin: 0 0 var(--space-lg); color: white; font-size: var(--text-xl);">
                📊 Session Summary: ${currentResultsSession}
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-lg);">
                <div>
                    <div style="font-size: var(--text-xs); opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em;">Total Subjects</div>
                    <div style="font-size: var(--text-3xl); font-weight: 700; margin-top: var(--space-xs);">${overallCount}</div>
                </div>
                <div>
                    <div style="font-size: var(--text-xs); opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em;">Overall Score</div>
                    <div style="font-size: var(--text-3xl); font-weight: 700; margin-top: var(--space-xs);">${overallTotal} / ${overallCount * 100}</div>
                </div>
                <div>
                    <div style="font-size: var(--text-xs); opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em;">Session Average</div>
                    <div style="font-size: var(--text-3xl); font-weight: 700; margin-top: var(--space-xs);">${overallAverage}%</div>
                </div>
                <div>
                    <div style="font-size: var(--text-xs); opacity: 0.9; text-transform: uppercase; letter-spacing: 0.05em;">Overall Grade</div>
                    <div style="font-size: var(--text-3xl); font-weight: 700; margin-top: var(--space-xs);">${overallGrade}</div>
                </div>
            </div>
        `;
        
        container.appendChild(summaryCard);
    }

    // Print / Full Report button (admin view)
    const printBtn = document.createElement('a');

    let admissionNo = null;
    try {
        const pupilDoc = await db.collection('pupils').doc(currentResultsPupilId).get();
        admissionNo = pupilDoc.exists ? (pupilDoc.data().admissionNo || null) : null;
    } catch (e) {
        console.warn('Could not fetch admissionNo for print URL:', e.message);
    }

    if (admissionNo) {
        printBtn.href = `print-results.html?admissionNo=${encodeURIComponent(admissionNo)}&session=${encodeURIComponent(currentResultsSession)}`;
    } else {
        console.warn('No admissionNo found, falling back to pupilId in URL');
        printBtn.href = `print-results.html?pupilId=${currentResultsPupilId}&session=${encodeURIComponent(currentResultsSession)}`;
    }

    printBtn.target = '_blank';
    printBtn.rel = 'noopener noreferrer';
    printBtn.className = 'btn';
    printBtn.style.cssText = 'display:inline-block; margin-top:var(--space-xl); margin-right:var(--space-md); background:#00B2FF; color:white; text-decoration:none;';
    printBtn.innerHTML = '🖨️ Open Full Report / Print';
    container.appendChild(printBtn);

    // Show session comparison button
    const comparisonBtn = document.createElement('button');
    comparisonBtn.className = 'btn';
    comparisonBtn.style.cssText = 'margin-top: var(--space-xl);';
    comparisonBtn.onclick = loadSessionComparison;
    comparisonBtn.innerHTML = '📈 Compare Across Sessions';
    container.appendChild(comparisonBtn);
    
    console.log(`✓ Rendered ${results.length} results successfully`);
}

function getGrade(score) {
  if (score >= 75) return 'A1';
  if (score >= 70) return 'B2';
  if (score >= 65) return 'B3';
  if (score >= 60) return 'C4';
  if (score >= 55) return 'C5';
  if (score >= 50) return 'C6';
  if (score >= 45) return 'D7';
  if (score >= 40) return 'D8';
  return 'F9';
}

function getRemark(score) {
    if (score >= 75) return 'Excellent';
    if (score >= 70) return 'Very Good';
    if (score >= 65) return 'Good';
    if (score >= 60) return 'Credit';
    if (score >= 50) return 'Credit';
    if (score >= 45) return 'Pass';
    return 'Fail';
}

function clearResultsFilter() {
  document.getElementById('filter-session').value = '';
  document.getElementById('filter-class').innerHTML = '<option value="">-- Select Class --</option>';
  document.getElementById('filter-class').disabled = true;
  document.getElementById('filter-pupil').innerHTML = '<option value="">-- Select Pupil --</option>';
  document.getElementById('filter-pupil').disabled = true;
  document.getElementById('view-results-btn').disabled = true;
  
  document.getElementById('pupil-info-card').style.display = 'none';
  document.getElementById('results-display-container').innerHTML = `
    <div style="text-align: center; padding: var(--space-2xl); color: var(--color-gray-600);">
      <div style="font-size: 3rem; margin-bottom: var(--space-md);">📊</div>
      <p style="font-size: var(--text-lg); font-weight: 600; margin-bottom: var(--space-xs);">
        Select filters to view results
      </p>
      <p style="font-size: var(--text-sm);">
        Choose session, class, and pupil from the filters above
      </p>
    </div>
  `;
  
  currentResultsPupilId = null;
  currentResultsSession = null;
  currentResultsData = null;
  
  document.getElementById('session-comparison-section').style.display = 'none';
}

async function exportPupilResults() {
  if (!currentResultsPupilId || !currentResultsSession || !currentResultsData) {
    window.showToast?.('No results to export', 'warning');
    return;
  }
  
  try {
    // Get pupil data
    const pupilDoc = await db.collection('pupils').doc(currentResultsPupilId).get();
    const pupilData = pupilDoc.data();
    
    // Create CSV content
    let csv = 'Session,Term,Subject,CA Score,Exam Score,Total,Grade\n';
    
    currentResultsData.forEach(result => {
      const grade = getGrade(result.total);
      csv += `${currentResultsSession},${result.term},${result.subject},${result.caScore},${result.examScore},${result.total},${grade}\n`;
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pupilData.name}_${currentResultsSession}_Results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    window.showToast?.('✓ Results exported successfully', 'success');
    
  } catch (error) {
    console.error('Error exporting results:', error);
    window.showToast?.('Failed to export results', 'danger');
  }
}

// Make functions globally available
window.loadViewResultsSection = loadViewResultsSection;
window.loadPupilResults = loadPupilResults;
window.clearResultsFilter = clearResultsFilter;
window.exportPupilResults = exportPupilResults;

/* ========================================
   SESSION COMPARISON & PROGRESS TRACKING
======================================== */

async function loadSessionComparison() {
  if (!currentResultsPupilId) {
    window.showToast?.('No pupil selected', 'warning');
    return;
  }
  
  const section = document.getElementById('session-comparison-section');
  const content = document.getElementById('session-comparison-content');
  
  if (!section || !content) return;
  
  section.style.display = 'block';
  content.innerHTML = `
    <div style="text-align: center; padding: var(--space-2xl);">
      <div class="spinner" style="margin: 0 auto var(--space-md);"></div>
      <p style="color: var(--color-gray-600);">Loading comparison data...</p>
    </div>
  `;
  
  // Scroll to comparison section
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  try {
    // Get all results for this pupil across all sessions
    const allResultsSnap = await db.collection('results')
      .where('pupilId', '==', currentResultsPupilId)
      .get();
    
    if (allResultsSnap.empty) {
      content.innerHTML = `
        <div style="text-align: center; padding: var(--space-2xl); color: var(--color-gray-600);">
          <p>No results found for comparison</p>
        </div>
      `;
      return;
    }
    
    // Group by session
    const sessionData = {};
    
    allResultsSnap.forEach(doc => {
      const data = doc.data();
      const session = data.session || 'Unknown';
      
      if (!sessionData[session]) {
        sessionData[session] = {
          results: [],
          totalScore: 0,
          subjectCount: 0
        };
      }
      
      const total = (data.caScore || 0) + (data.examScore || 0);
      sessionData[session].results.push({
        term: data.term,
        subject: data.subject,
        total: total
      });
      sessionData[session].totalScore += total;
      sessionData[session].subjectCount++;
    });
    
    // Calculate averages for each session
    const sessions = [];
    for (const [sessionName, data] of Object.entries(sessionData)) {
      const average = data.subjectCount > 0 ? (data.totalScore / data.subjectCount).toFixed(1) : 0;
      sessions.push({
        name: sessionName,
        average: parseFloat(average),
        subjectCount: data.subjectCount,
        totalScore: data.totalScore,
        grade: getGrade(parseFloat(average))
      });
    }
    
    // Sort by session year (newest first)
    sessions.sort((a, b) => {
      const yearA = parseInt(a.name.split('/')[0]) || 0;
      const yearB = parseInt(b.name.split('/')[0]) || 0;
      return yearB - yearA;
    });
    
    if (sessions.length < 2) {
      content.innerHTML = `
        <div class="alert alert-info">
          <strong>ℹ️ Comparison Not Available</strong>
          <p>This pupil only has results in one session (${sessions[0].name}). Comparison requires results from at least 2 sessions.</p>
        </div>
      `;
      return;
    }
    
    // Calculate progress
    const progressData = [];
    for (let i = 1; i < sessions.length; i++) {
      const current = sessions[i - 1];
      const previous = sessions[i];
      const change = current.average - previous.average;
      const percentChange = previous.average > 0 ? ((change / previous.average) * 100).toFixed(1) : 0;
      
      progressData.push({
        from: previous.name,
        to: current.name,
        change: change,
        percentChange: percentChange,
        improving: change > 0
      });
    }
    
    // Render comparison
    content.innerHTML = `
      <!-- Sessions Overview -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--space-lg); margin-bottom: var(--space-2xl);">
        ${sessions.map((session, index) => `
          <div style="background: ${index === 0 ? 'linear-gradient(135deg, #00B2FF 0%, #0090CC 100%)' : 'white'}; 
                      color: ${index === 0 ? 'white' : 'inherit'};
                      padding: var(--space-xl); 
                      border-radius: var(--radius-lg); 
                      border: 2px solid ${index === 0 ? '#00B2FF' : '#e2e8f0'};
                      position: relative;
                      box-shadow: ${index === 0 ? '0 4px 20px rgba(0, 178, 255, 0.3)' : '0 2px 8px rgba(0,0,0,0.05)'};;">
            ${index === 0 ? '<div style="position: absolute; top: var(--space-sm); right: var(--space-sm); background: rgba(255,255,255,0.3); padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700;">LATEST</div>' : ''}
            <div style="font-size: var(--text-sm); opacity: ${index === 0 ? '0.9' : '0.6'}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-xs);">
              Session
            </div>
            <div style="font-size: var(--text-xl); font-weight: 700; margin-bottom: var(--space-lg);">
              ${session.name}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-md);">
              <div>
                <div style="font-size: var(--text-xs); opacity: ${index === 0 ? '0.9' : '0.6'}; margin-bottom: 4px;">Average</div>
                <div style="font-size: var(--text-2xl); font-weight: 700;">${session.average}%</div>
              </div>
              <div>
                <div style="font-size: var(--text-xs); opacity: ${index === 0 ? '0.9' : '0.6'}; margin-bottom: 4px;">Grade</div>
                <div style="font-size: var(--text-2xl); font-weight: 700;">${session.grade}</div>
              </div>
            </div>
            <div style="font-size: var(--text-xs); opacity: ${index === 0 ? '0.9' : '0.6'};">
              ${session.subjectCount} subjects • ${session.totalScore} total points
            </div>
          </div>
        `).join('')}
      </div>
      
      <!-- Progress Analysis -->
      <div style="background: #f8fafc; padding: var(--space-xl); border-radius: var(--radius-lg); margin-bottom: var(--space-2xl);">
        <h4 style="margin: 0 0 var(--space-lg); color: #0f172a;">📊 Progress Analysis</h4>
        ${progressData.map(progress => `
          <div style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md); background: white; border-radius: var(--radius-md); margin-bottom: var(--space-sm); border-left: 4px solid ${progress.improving ? '#10b981' : '#ef4444'};">
            <div style="flex: 1;">
              <div style="font-weight: 600; margin-bottom: var(--space-xs);">
                ${progress.from} → ${progress.to}
              </div>
              <div style="font-size: var(--text-sm); color: var(--color-gray-600);">
                ${progress.improving ? 'Improvement' : 'Decline'}: ${progress.change > 0 ? '+' : ''}${progress.change.toFixed(1)} points (${progress.percentChange > 0 ? '+' : ''}${progress.percentChange}%)
              </div>
            </div>
            <div style="font-size: var(--text-3xl);">
              ${progress.improving ? '📈' : '📉'}
            </div>
          </div>
        `).join('')}
      </div>
      
      <!-- Performance Trend -->
      <div style="background: white; padding: var(--space-xl); border-radius: var(--radius-lg); border: 1px solid #e2e8f0;">
        <h4 style="margin: 0 0 var(--space-lg); color: #0f172a;">📈 Performance Trend</h4>
        <div style="display: flex; align-items: flex-end; gap: var(--space-sm); height: 200px; padding: var(--space-md) 0;">
          ${sessions.slice().reverse().map((session, index) => {
            const maxAverage = Math.max(...sessions.map(s => s.average));
            const height = (session.average / maxAverage) * 100;
            const isHighest = session.average === maxAverage;
            
            return `
              <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: var(--space-xs);">
                <div style="font-weight: 700; font-size: var(--text-lg); color: ${isHighest ? '#00B2FF' : '#0f172a'};">
                  ${session.average}%
                </div>
                <div style="width: 100%; height: ${height}%; background: ${isHighest ? 'linear-gradient(to top, #00B2FF, #0090CC)' : 'linear-gradient(to top, #cbd5e1, #94a3b8)'}; border-radius: var(--radius-sm); min-height: 20px; transition: all 0.3s ease;"></div>
                <div style="font-size: var(--text-xs); color: var(--color-gray-600); text-align: center; margin-top: var(--space-xs);">
                  ${session.name}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      
      <!-- Summary Insights -->
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: var(--space-xl); border-radius: var(--radius-lg); margin-top: var(--space-2xl); border: 2px solid #10b981;">
        <h4 style="margin: 0 0 var(--space-md); color: #065f46;">🎯 Summary Insights</h4>
        ${generateInsights(sessions, progressData)}
      </div>
    `;
    
    console.log(`✓ Loaded comparison across ${sessions.length} sessions`);
    
  } catch (error) {
    console.error('Error loading session comparison:', error);
    content.innerHTML = `
      <div style="text-align: center; padding: var(--space-2xl); color: var(--color-danger);">
        <p style="font-weight: 600;">Error loading comparison data</p>
        <p style="font-size: var(--text-sm);">${error.message}</p>
      </div>
    `;
  }
}

function generateInsights(sessions, progressData) {
  const insights = [];
  
  // Find best and worst sessions
  const sortedByAvg = [...sessions].sort((a, b) => b.average - a.average);
  const bestSession = sortedByAvg[0];
  const worstSession = sortedByAvg[sortedByAvg.length - 1];
  
  insights.push(`<p style="margin: 0 0 var(--space-xs);"><strong>• Best Performance:</strong> ${bestSession.name} with ${bestSession.average}% average (Grade ${bestSession.grade})</p>`);
  
  if (sessions.length > 1) {
    insights.push(`<p style="margin: 0 0 var(--space-xs);"><strong>• Lowest Performance:</strong> ${worstSession.name} with ${worstSession.average}% average (Grade ${worstSession.grade})</p>`);
  }
  
  // Overall trend
  const improvements = progressData.filter(p => p.improving).length;
  const declines = progressData.filter(p => !p.improving).length;
  
  if (improvements > declines) {
    insights.push(`<p style="margin: 0 0 var(--space-xs);"><strong>• Overall Trend:</strong> Generally improving (${improvements} improvement(s), ${declines} decline(s))</p>`);
  } else if (declines > improvements) {
    insights.push(`<p style="margin: 0 0 var(--space-xs);"><strong>• Overall Trend:</strong> Needs attention (${declines} decline(s), ${improvements} improvement(s))</p>`);
  } else {
    insights.push(`<p style="margin: 0 0 var(--space-xs);"><strong>• Overall Trend:</strong> Stable performance with mixed results</p>`);
  }
  
  // Average improvement
  if (progressData.length > 0) {
    const avgChange = progressData.reduce((sum, p) => sum + p.change, 0) / progressData.length;
    const direction = avgChange > 0 ? 'improved' : 'declined';
    insights.push(`<p style="margin: 0;"><strong>• Average Change:</strong> Performance has ${direction} by ${Math.abs(avgChange).toFixed(1)} points per session</p>`);
  }
  
  return insights.join('');
}

function toggleSessionComparison() {
  const section = document.getElementById('session-comparison-section');
  if (section) {
    section.style.display = 'none';
  }
}

// Make functions globally available
window.loadSessionComparison = loadSessionComparison;
window.toggleSessionComparison = toggleSessionComparison;

// Make functions globally available
window.loadPromotionRequests = loadPromotionRequests;
window.loadPromotionPeriodStatus = loadPromotionPeriodStatus;
window.populateSessionFilter = populateSessionFilter;

console.log('✓ Missing section loaders restored');

/* ========================================
   FINANCIAL MANAGEMENT SECTION LOADERS
======================================== */

/**
 * Load Fee Management Section
 */
async function loadFeeManagementSection() {
  console.log('💰 Loading fee management section...');

  try {
    // Target the section directly, not a non-existent nested .admin-card
    const feeSection = document.getElementById('fee-management');

    if (feeSection) {
      feeSection.style.display = 'block';
      console.log('✓ Fee management section forced visible');
    } else {
      console.error('❌ fee-management section not found in DOM');
    }

    await populateFeeClassSelector();
    const settings = await window.getCurrentSettings();

    const sessionDisplay = document.getElementById('fee-session-display');
    const termDisplay = document.getElementById('fee-term-display');
    if (sessionDisplay) sessionDisplay.textContent = settings.session;
    if (termDisplay) termDisplay.textContent = settings.term;

    await loadFeeStructures();
    console.log('✓ Fee management section loaded successfully');

  } catch (error) {
    console.error('❌ Error loading fee management:', error);
    window.showToast?.('Failed to load fee management section', 'danger');
  }
}

/**
 * Populate class selector for fee configuration
 */
async function populateFeeClassSelector() {
  const select = document.getElementById('fee-config-class');
  if (!select) return;
  
  try {
    const snapshot = await db.collection('classes').orderBy('name').get();
    
    select.innerHTML = '<option value="">-- Select Class --</option>';
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = data.name;
      opt.dataset.className = data.name;
      select.appendChild(opt);
    });
    
  } catch (error) {
    console.error('Error populating class selector:', error);
  }
}

/**
 *  Load Fee Structures (Class-Based Display)
 */
async function loadFeeStructures() {
  const container = document.getElementById('fee-structures-list');
  if (!container) return;
  
  container.innerHTML = '<div style="text-align:center; padding:var(--space-lg);"><div class="spinner"></div><p>Loading fee structures...</p></div>';
  
  try {
    // Query ALL fee structures (no session filter)
    const snapshot = await db.collection('fee_structures').get();
    
    console.log(`Found ${snapshot.size} fee structures`);
    
    if (snapshot.empty) {
      container.innerHTML = `
        <div style="text-align:center; padding:var(--space-2xl); color:var(--color-gray-600);">
          <p style="font-size:var(--text-lg); margin-bottom:var(--space-md);">📋 No Fee Structures Configured Yet</p>
          <p style="font-size:var(--text-sm);">Configure fees for your classes using the form above.</p>
        </div>
      `;
      return;
    }
    
    // Check for duplicates by classId
    const feesByClass = new Map();
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const classId = data.classId;
      
      if (!feesByClass.has(classId)) {
        feesByClass.set(classId, []);
      }
      
      feesByClass.get(classId).push({
        id: doc.id,
        ...data
      });
    });
    
    // Log duplicates
    feesByClass.forEach((fees, classId) => {
      if (fees.length > 1) {
        console.warn(`⚠️ DUPLICATE DETECTED: ${fees.length} fee structures for class ${classId}`);
        console.warn('   IDs:', fees.map(f => f.id));
      }
    });
    
    container.innerHTML = '';
    
    // Render each unique class (show most recent if duplicates exist)
    feesByClass.forEach((fees, classId) => {
      // If duplicates exist, use the most recently updated
      const feeToShow = fees.length > 1
        ? fees.reduce((latest, current) => {
            const latestTime = latest.updatedAt?.toMillis() || 0;
            const currentTime = current.updatedAt?.toMillis() || 0;
            return currentTime > latestTime ? current : latest;
          })
        : fees[0];
      
      const data = feeToShow;
      
      const feeItems = Object.entries(data.fees || {})
        .map(([key, value]) => `
          <div style="display:flex; justify-content:space-between; padding:var(--space-xs) 0;">
            <span style="text-transform:capitalize;">${key.replace(/_/g, ' ')}:</span>
            <strong>₦${parseFloat(value).toLocaleString()}</strong>
          </div>
        `).join('');
      
      const card = document.createElement('div');
      card.className = 'fee-structure-card';
      card.style.cssText = `
        background: white;
        border: 1px solid var(--color-gray-300);
        border-radius: var(--radius-md);
        padding: var(--space-lg);
        margin-bottom: var(--space-md);
        ${fees.length > 1 ? 'border-left: 4px solid #ff9800;' : ''}
      `;
      
      // Show as permanent (not session-specific)
      card.innerHTML = `
        ${fees.length > 1 ? `
          <div style="background: #fff3cd; border: 1px solid #ff9800; border-radius: var(--radius-sm); padding: var(--space-sm); margin-bottom: var(--space-md); font-size: var(--text-sm);">
            ⚠️ <strong>Note:</strong> ${fees.length} duplicate fee records exist for this class. Showing most recent. 
            <button class="btn-small btn-secondary" onclick="fixDuplicateFees('${classId}')" style="margin-left: var(--space-sm);">
              Fix Duplicates
            </button>
          </div>
        ` : ''}
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-md); padding-bottom:var(--space-md); border-bottom:1px solid var(--color-gray-200);">
          <div>
            <h3 style="margin:0; color:var(--color-primary);">${data.className}</h3>
            <p style="margin:var(--space-xs) 0 0; font-size:var(--text-sm); color:var(--color-gray-600);">
              <strong>Applies to ALL Terms & Sessions</strong>
            </p>
          </div>
          <div style="display:flex; gap:var(--space-sm);">
            <button class="btn-small btn-primary" onclick="editFeeStructure('${data.id}')">
              ✏️ Edit
            </button>
            <button class="btn-small btn-danger" onclick="deleteFeeStructure('${data.id}', '${data.className}')">
              Delete
            </button>
          </div>
        </div>
        
        <div style="margin-bottom:var(--space-md);">
          ${feeItems}
        </div>
        
        <div style="padding-top:var(--space-md); border-top:2px solid var(--color-primary); display:flex; justify-content:space-between; align-items:center;">
          <strong style="font-size:var(--text-lg);">Total per term:</strong>
          <strong style="font-size:var(--text-xl); color:var(--color-primary);">₦${parseFloat(data.total).toLocaleString()}</strong>
        </div>
        
        <div style="margin-top:var(--space-md); padding:var(--space-sm); background:#e3f2fd; border-left:4px solid #2196F3; border-radius:var(--radius-sm); font-size:var(--text-sm);">
          ℹ️ This fee structure is <strong>permanent</strong> and applies to all terms and sessions until you edit or delete it.
        </div>
      `;
      
      container.appendChild(card);
    });
    
    console.log(`✓ Displayed ${feesByClass.size} unique fee structures`);
    
  } catch (error) {
    console.error('❌ Error loading fee structures:', error);
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger);">Error loading fee structures</p>';
  }
}

window.loadFeeStructures = loadFeeStructures;

async function fixDuplicateFees(classId) {
  if (!confirm(
    `Fix Duplicate Fee Structures?\n\n` +
    `This will:\n` +
    `• Keep the most recent fee structure\n` +
    `• Archive all older duplicates\n` +
    `• Clean up the database\n\n` +
    `Continue?`
  )) {
    return;
  }
  
  try {
    // Get all fee structures for this class
    const snapshot = await db.collection('fee_structures')
      .where('classId', '==', classId)
      .get();
    
    if (snapshot.size <= 1) {
      window.showToast?.('No duplicates found', 'info');
      return;
    }
    
    const fees = [];
    snapshot.forEach(doc => {
      fees.push({ id: doc.id, ...doc.data() });
    });
    
    // Find most recent
    const mostRecent = fees.reduce((latest, current) => {
      const latestTime = latest.updatedAt?.toMillis() || latest.createdAt?.toMillis() || 0;
      const currentTime = current.updatedAt?.toMillis() || current.createdAt?.toMillis() || 0;
      return currentTime > latestTime ? current : latest;
    });
    
    console.log(`Most recent fee structure: ${mostRecent.id}`);
    
    // Archive and delete duplicates
    const batch = db.batch();
    let deleted = 0;
    
    for (const fee of fees) {
      if (fee.id !== mostRecent.id) {
        // Archive
        const archiveRef = db.collection('fee_structure_history').doc();
        batch.set(archiveRef, {
          ...fee,
          archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
          archivedBy: auth.currentUser.uid,
          reason: 'Duplicate cleanup - keeping most recent'
        });
        
        // Delete
        batch.delete(db.collection('fee_structures').doc(fee.id));
        deleted++;
      }
    }
    
    await batch.commit();
    
    window.showToast?.(
      `✓ Cleaned up ${deleted} duplicate(s)\n\nKept most recent fee structure.`,
      'success',
      5000
    );
    
    await loadFeeStructures();
    
  } catch (error) {
    console.error('Error fixing duplicates:', error);
    window.handleError?.(error, 'Failed to fix duplicates');
  }
}

// Make functions globally available
window.fixDuplicateFees = fixDuplicateFees;

console.log('✅ Fee structure duplicate prevention fix loaded');

/**
 * Load payment recording section
 */
async function loadPaymentRecordingSection() {
  try {
    // Populate class filter
    await populatePaymentClassFilter();
    
    // Load current settings
    const settings = await window.getCurrentSettings();
    
    const sessionDisplay = document.getElementById('payment-session-display');
    const termDisplay = document.getElementById('payment-term-display');
    
    if (sessionDisplay) sessionDisplay.textContent = settings.session;
    if (termDisplay) termDisplay.textContent = settings.term;
    
  } catch (error) {
    console.error('Error loading payment section:', error);
    window.showToast?.('Failed to load payment section', 'danger');
  }
}

/**
 * Populate class filter for payment recording
 */
async function populatePaymentClassFilter() {
  const select = document.getElementById('payment-class-filter');
  if (!select) return;
  
  try {
    const snapshot = await db.collection('classes').orderBy('name').get();
    
    select.innerHTML = '<option value="">-- Select Class --</option>';
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = data.name;
      select.appendChild(opt);
    });
    
  } catch (error) {
    console.error('Error populating class filter:', error);
  }
}

/**
 * Load pupils for payment recording
 */
async function loadPupilsForPayment() {
  const classId = document.getElementById('payment-class-filter')?.value;
  const pupilSelect = document.getElementById('payment-pupil-select');
  
  if (!pupilSelect) return;
  
  pupilSelect.innerHTML = '<option value="">-- Select Pupil --</option>';
  
  if (!classId) {
    document.getElementById('payment-form-container').style.display = 'none';
    return;
  }
  
  try {
    const snapshot = await db.collection('pupils')
      .where('class.id', '==', classId)
      .orderBy('name')
      .get();
    
    if (snapshot.empty) {
      pupilSelect.innerHTML = '<option value="">No pupils in this class</option>';
      document.getElementById('payment-form-container').style.display = 'none';
      return;
    }
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = data.name;
      opt.dataset.pupilName = data.name;
      opt.dataset.className = data.class?.name || 'Unknown';
      pupilSelect.appendChild(opt);
    });
    
  } catch (error) {
    console.error('Error loading pupils:', error);
    window.showToast?.('Failed to load pupils', 'danger');
  }
}

/**
 * Load Pupil Payment Status with safer auto-creation
 */
async function loadPupilPaymentStatus() {
  const pupilSelect = document.getElementById('payment-pupil-select');
  const pupilId = pupilSelect?.value;

  if (!pupilId) {
    document.getElementById('payment-form-container').style.display = 'none';
    return;
  }

  const classId = document.getElementById('payment-class-filter')?.value;
  const pupilName = pupilSelect.selectedOptions[0]?.dataset.pupilName;
  const className = pupilSelect.selectedOptions[0]?.dataset.className;

  const formContainer = document.getElementById('payment-form-container');
  const statusContainer = document.getElementById('payment-status-display');

  formContainer.style.display = 'block';
  statusContainer.innerHTML = '<div style="text-align:center; padding:var(--space-md);"><div class="spinner"></div></div>';

  try {
    const settings = await window.getCurrentSettings();
    const session = settings.session;
    const term = settings.term;

    // Step 1: Get pupil data
    const pupilDoc = await db.collection('pupils').doc(pupilId).get();
    
    if (!pupilDoc.exists) {
      throw new Error('Pupil record not found');
    }
    
    const pupilData = pupilDoc.data();
    
    console.log('📊 Loading payment status for:', pupilName);

    // Step 2: Get base fee
    const feeDocId = `fee_${classId}`;
    console.log(`Looking up fee structure: ${feeDocId}`);
    
    const feeDoc = await db.collection('fee_structures').doc(feeDocId).get();

    if (!feeDoc.exists) {
      statusContainer.innerHTML = `
        <div class="alert alert-warning">
          <strong>⚠️ Fee Structure Not Configured</strong>
          <p>No fee structure has been set for ${className}. Configure it in the Fee Management section first.</p>
        </div>
      `;
      document.getElementById('payment-input-section').style.display = 'none';
      return;
    }

    const feeStructure = feeDoc.data();
    const baseFee = Number(feeStructure.total) || 0;
    
    console.log(`✓ Base fee for ${className}: ₦${baseFee.toLocaleString()}`);

    // Step 3: Calculate adjusted fee
    if (typeof window.calculateAdjustedFee !== 'function') {
      throw new Error('CRITICAL ERROR: calculateAdjustedFee() not loaded');
    }
    
    const amountDue = window.calculateAdjustedFee(pupilData, baseFee, term);
    
    console.log(`📊 Fee calculation:`);
    console.log(`   Base fee: ₦${baseFee.toLocaleString()}`);
    console.log(`   Adjusted fee: ₦${amountDue.toLocaleString()}`);

    // Check if pupil is enrolled for this term
    if (amountDue === 0 && baseFee > 0) {
      statusContainer.innerHTML = `
        <div class="alert alert-info">
          <strong>ℹ️ ${pupilName} is not enrolled for ${term}</strong>
          <p>Admission term: ${pupilData.admissionTerm || 'First Term'} | Exit term: ${pupilData.exitTerm || 'Third Term'}</p>
          <p>Cannot record payment for unenrolled term.</p>
        </div>
      `;
      document.getElementById('payment-input-section').style.display = 'none';
      return;
    }

    // Step 4: Calculate arrears
    if (typeof window.calculateCompleteArrears !== 'function') {
      throw new Error('CRITICAL ERROR: calculateCompleteArrears() not loaded');
    }
    
    const arrears = await window.calculateCompleteArrears(pupilId, session, term);
    
    console.log(`💰 Arrears: ₦${arrears.toLocaleString()}`);

    // Step 5: Get/create payment record
    const encodedSession = session.replace(/\//g, '-');
    const paymentDocId = `${pupilId}_${encodedSession}_${term}`;
    
    let paymentDoc;
    let autoCreated = false;
    
    try {
      paymentDoc = await db.collection('payments').doc(paymentDocId).get();
    } catch (error) {
      console.warn('Could not fetch payment record:', error.message);
      paymentDoc = { exists: false };
    }

    let totalPaid = 0;
    let balance = amountDue + arrears;
    let status = arrears > 0 ? 'owing_with_arrears' : 'owing';

    // Auto-create with transaction guard to prevent race condition
    if (!paymentDoc.exists) {
      console.log('⚠️ Payment record missing, creating with transaction guard...');

      const paymentRef = db.collection('payments').doc(paymentDocId);

      try {
        await db.runTransaction(async (transaction) => {
          const docInTx = await transaction.get(paymentRef);

          if (!docInTx.exists) {
            transaction.set(paymentRef, {
              pupilId: pupilId,
              pupilName: pupilName,
              classId: classId,
              className: className,
              session: session,
              term: term,
              baseFee: baseFee,
              adjustedFee: amountDue,
              amountDue: amountDue,
              arrears: arrears,
              totalDue: amountDue + arrears,
              totalPaid: 0,
              balance: amountDue + arrears,
              status: arrears > 0 ? 'owing_with_arrears' : 'owing',
              lastPaymentDate: null,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              autoCreatedByAdmin: true
            });
            console.log('✅ Payment record created inside transaction');
          } else {
            console.log('ℹ️ Payment record already exists (concurrent session), skipping');
          }
        });

        autoCreated = true;

        paymentDoc = await db.collection('payments').doc(paymentDocId).get();

        if (!paymentDoc.exists) {
          throw new Error('Payment record creation failed post-transaction verification');
        }

      } catch (createError) {
        console.error('❌ Failed to create payment record:', createError);
        throw new Error(`Could not create payment record: ${createError.message}`);
      }
    }

    // Read existing data
    if (paymentDoc.exists) {
      const data = paymentDoc.data();
      totalPaid = Number(data.totalPaid) || 0;
      balance = Number(data.balance) || 0;
      status = data.status || (arrears > 0 ? 'owing_with_arrears' : 'owing');
      
      console.log(`✓ Payment record found${autoCreated ? ' (auto-created)' : ''}:`);
      console.log(`   Total paid: ₦${totalPaid.toLocaleString()}`);
      console.log(`   Balance: ₦${balance.toLocaleString()}`);
    }

    // Render status (existing code continues...)
    const totalDue = amountDue + arrears;
    
    let statusBadge = '';
    if (balance <= 0) {
      statusBadge = '<span class="status-badge" style="background:#4CAF50;">Paid in Full</span>';
    } else if (totalPaid > 0) {
      statusBadge = '<span class="status-badge" style="background:#ff9800;">Partial Payment</span>';
    } else if (arrears > 0) {
      statusBadge = '<span class="status-badge" style="background:#dc3545;">Owing (with Arrears)</span>';
    } else {
      statusBadge = '<span class="status-badge" style="background:#f44336;">Owing</span>';
    }

    // Build adjustment info
    let adjustmentBadge = '';
    if (amountDue !== baseFee) {
      const difference = baseFee - amountDue;
      const percentDiff = baseFee > 0 ? Math.abs((difference / baseFee) * 100).toFixed(0) : 0;
      
      if (amountDue === 0) {
        adjustmentBadge = `
          <div style="background: linear-gradient(135deg, #4CAF50 0%, #388E3C 100%); color: white; padding: var(--space-md); border-radius: var(--radius-md); margin-bottom: var(--space-md); text-align: center;">
            <strong>🎓 FREE EDUCATION APPLIED</strong>
            <p style="margin: var(--space-xs) 0 0; opacity: 0.9; font-size: var(--text-sm);">
              Base fee waived: ₦${baseFee.toLocaleString()}
            </p>
          </div>
        `;
      } else if (amountDue < baseFee) {
        adjustmentBadge = `
          <div style="background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); color: white; padding: var(--space-md); border-radius: var(--radius-md); margin-bottom: var(--space-md); text-align: center;">
            <strong>💎 SCHOLARSHIP/DISCOUNT APPLIED</strong>
            <p style="margin: var(--space-xs) 0 0; opacity: 0.9; font-size: var(--text-sm);">
              ${percentDiff}% reduction • Saving ₦${difference.toLocaleString()} per term
            </p>
          </div>
        `;
      } else {
        adjustmentBadge = `
          <div style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white; padding: var(--space-md); border-radius: var(--radius-md); margin-bottom: var(--space-md); text-align: center;">
            <strong>⚠️ FEE SURCHARGE APPLIED</strong>
            <p style="margin: var(--space-xs) 0 0; opacity: 0.9; font-size: var(--text-sm);">
              Additional charge: ₦${Math.abs(difference).toLocaleString()} per term
            </p>
          </div>
        `;
      }
    }

    // Arrears warning — only show if arrears haven't been fully paid off yet
const arrearsCleared = totalPaid >= arrears;
const arrearsHTML = (arrears > 0 && !arrearsCleared) ? `
  <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: var(--space-xl); border-radius: var(--radius-lg); margin-bottom: var(--space-lg); box-shadow: 0 4px 20px rgba(220, 53, 69, 0.3);">
    <div style="display: flex; align-items: center; gap: var(--space-md); margin-bottom: var(--space-md);">
      <i data-lucide="alert-circle" style="width: 32px; height: 32px;"></i>
      <div>
        <h3 style="margin: 0; color: white;">Outstanding Arrears</h3>
        <p style="margin: var(--space-xs) 0 0; opacity: 0.9;">From Previous Term(s)</p>
      </div>
    </div>
    <div style="font-size: var(--text-3xl); font-weight: 700; margin-bottom: var(--space-sm);">
      ₦${arrears.toLocaleString()}
    </div>
    <p style="margin: 0; opacity: 0.9; font-size: var(--text-sm);">
      ⚠️ Payments will prioritize clearing arrears first.
    </p>
  </div>
` : '';

    const percentPaid = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;

    // Render complete UI
    statusContainer.innerHTML = `
      <div style="background:white; border:1px solid var(--color-gray-300); border-radius:var(--radius-md); padding:var(--space-lg);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-md);">
          <div>
            <h3 style="margin:0;">${pupilName}</h3>
            <p style="margin:var(--space-xs) 0 0; color:var(--color-gray-600);">${className} • ${session} • ${term}</p>
          </div>
          ${statusBadge}
        </div>

        ${adjustmentBadge}
        ${arrearsHTML}

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:var(--space-md); margin-bottom:var(--space-xl);">
          ${baseFee !== amountDue ? `
          <div style="text-align:center; padding:var(--space-md); background:#f8fafc; border:1px solid #e2e8f0; border-radius:var(--radius-sm);">
            <div style="font-size:var(--text-xs); color:var(--color-gray-600); margin-bottom:var(--space-xs);">Base Fee</div>
            <div style="font-size:var(--text-lg); font-weight:700; color:var(--color-gray-700); text-decoration: line-through;">₦${baseFee.toLocaleString()}</div>
          </div>` : ''}

          ${arrears > 0 ? `
          <div style="text-align:center; padding:var(--space-md); background:#fef2f2; border:2px solid #dc3545; border-radius:var(--radius-sm);">
            <div style="font-size:var(--text-xs); color:#991b1b; margin-bottom:var(--space-xs); font-weight:600;">Arrears</div>
            <div style="font-size:var(--text-xl); font-weight:700; color:#dc3545;">₦${arrears.toLocaleString()}</div>
          </div>` : ''}

          <div style="text-align:center; padding:var(--space-md); background:var(--color-gray-50); border:1px solid var(--color-gray-300); border-radius:var(--radius-sm);">
            <div style="font-size:var(--text-xs); color:var(--color-gray-600); margin-bottom:var(--space-xs);">Current Term Fee</div>
            <div style="font-size:var(--text-xl); font-weight:700; color:var(--color-gray-900);">₦${amountDue.toLocaleString()}</div>
          </div>

          <div style="text-align:center; padding:var(--space-md); background:var(--color-success-light); border:1px solid var(--color-success); border-radius:var(--radius-sm);">
            <div style="font-size:var(--text-xs); color:var(--color-success-dark); margin-bottom:var(--space-xs);">Total Paid</div>
            <div style="font-size:var(--text-xl); font-weight:700; color:var(--color-success-dark);">₦${totalPaid.toLocaleString()}</div>
            <div style="font-size:var(--text-xs); opacity:0.8; margin-top:var(--space-xs);">
              ${totalPaid > 0 ? percentPaid + '% collected' : 'No payments yet'}
            </div>
          </div>

          <div style="text-align:center; padding:var(--space-md); background:${balance > 0 ? 'var(--color-danger-light)' : 'var(--color-success-light)'}; border:2px solid ${balance > 0 ? 'var(--color-danger)' : 'var(--color-success)'}; border-radius:var(--radius-sm);">
            <div style="font-size:var(--text-xs); color:${balance > 0 ? 'var(--color-danger-dark)' : 'var(--color-success-dark)'}; margin-bottom:var(--space-xs); font-weight:600;">Outstanding</div>
            <div style="font-size:var(--text-xl); font-weight:700; color:${balance > 0 ? 'var(--color-danger-dark)' : 'var(--color-success-dark)'};">₦${balance.toLocaleString()}</div>
          </div>
        </div>

        <div style="margin-top: var(--space-lg); padding: var(--space-md); background: ${balance > 0 ? '#fef2f2' : '#f0fdf4'}; border: 2px solid ${balance > 0 ? '#dc3545' : '#4CAF50'}; border-radius: var(--radius-md);">
          <h4 style="margin: 0 0 var(--space-sm); color: ${balance > 0 ? '#991b1b' : '#065f46'}; display: flex; align-items: center; gap: var(--space-sm);">
            <i data-lucide="${balance > 0 ? 'alert-triangle' : 'check-circle'}" style="width: 18px; height: 18px;"></i>
            ${balance > 0 ? 'Payment Required' : 'Term Fees Paid'}
          </h4>
          <p style="margin: 0; font-size: var(--text-sm); color: ${balance > 0 ? '#7f1d1d' : '#14532d'};">
            ${balance > 0 
              ? `Outstanding balance of ₦${balance.toLocaleString()} for ${term}. ${arrears > 0 ? `Includes ₦${arrears.toLocaleString()} arrears.` : ''}`
              : `All fees for ${term} have been paid in full. Thank you!`}
          </p>
        </div>
      </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Update payment input
    document.getElementById('payment-input-section').style.display = 'block';
    
    const amountInput = document.getElementById('payment-amount');
    if (amountInput) {
      amountInput.max = balance;
      amountInput.value = '';
      amountInput.placeholder = `Enter amount (max: ₦${balance.toLocaleString()})`;
    }

    // Load payment history
    await loadPaymentHistory(pupilId, session, term);
    
    console.log('✅ Payment status loaded successfully');

  } catch (error) {
    console.error('❌ Error loading payment status:', error);
    statusContainer.innerHTML = `
      <div style="padding:var(--space-lg); text-align:center; color:var(--color-danger);">
        <p style="font-weight:600;">Error Loading Payment Status</p>
        <p style="font-size:var(--text-sm);">${error.message}</p>
        <button class="btn btn-secondary" onclick="loadPupilPaymentStatus()" style="margin-top:var(--space-md);">
          🔄 Retry
        </button>
      </div>
    `;
  }
}

window.loadPupilPaymentStatus = loadPupilPaymentStatus;

console.log('✅ Admin payment status fix loaded - now matches pupil portal logic');

/**
 * Load complete payment history with proper query
 */
async function loadPaymentHistory(pupilId, session, term) {
  const container = document.getElementById('payment-history-list');
  if (!container) {
    console.error('payment-history-list container not found');
    return;
  }

  container.innerHTML = '<div style="text-align:center; padding:var(--space-md);"><div class="spinner"></div></div>';

  try {
    // Query by pupilId and session only (term is already in document ID)
    const snapshot = await db.collection('payment_transactions')
      .where('pupilId', '==', pupilId)
      .where('session', '==', session)
      .orderBy('paymentDate', 'desc')
      .get();

    if (snapshot.empty) {
      container.innerHTML = '<p style="text-align:center; color:var(--color-gray-600); padding:var(--space-lg);">No payment history yet for this session</p>';
      return;
    }

    const transactions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        receiptNo: data.receiptNo || 'N/A',
        amountPaid: data.amountPaid || 0,
        arrearsPayment: data.arrearsPayment || 0,
        currentTermPayment: data.currentTermPayment || 0,
        paymentDate: data.paymentDate || null,
        paymentMethod: data.paymentMethod || 'Cash',
        term: data.term || 'N/A',
        session: data.session || 'N/A',
        recordedBy: data.recordedBy || 'Unknown'
      });
    });

    container.innerHTML = transactions.map(txn => {
      const date = txn.paymentDate ? txn.paymentDate.toDate().toLocaleDateString('en-GB') : 'N/A';
      const hasArrears = txn.arrearsPayment > 0;
      const balanceAfter = typeof txn.balanceAfter === 'number' ? txn.balanceAfter : null;
      
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:var(--space-md); background:white; border:1px solid var(--color-gray-300); border-radius:var(--radius-sm); margin-bottom:var(--space-sm);">
          <div style="flex:1;">
            <div style="font-weight:700; font-size:var(--text-lg); margin-bottom:var(--space-xs);">
              ₦${Number(txn.amountPaid).toLocaleString()}
            </div>
            <div style="font-size:var(--text-sm); color:var(--color-gray-600);">
              ${date} • ${txn.paymentMethod} • Receipt #${txn.receiptNo} • ${txn.term}
            </div>
            ${balanceAfter !== null ? `
              <div style="font-size:var(--text-sm); margin-top:var(--space-xs); color:${balanceAfter <= 0 ? '#16a34a' : '#b45309'}; font-weight:600;">
                Balance after payment: ₦${Math.max(0, balanceAfter).toLocaleString()}
                ${balanceAfter <= 0 ? ' ✅ Fully paid' : ''}
              </div>
            ` : ''}
          </div>
          <button class="btn-small btn-secondary" onclick="printReceipt('${txn.receiptNo}')">
            Print Receipt
          </button>
        </div>
      `;
    }).join('');

    console.log(`✓ Loaded ${transactions.length} payment transactions for ${session}`);

  } catch (error) {
    console.error('❌ Error loading payment history:', error);
    container.innerHTML = '<p style="text-align:center; color:var(--color-danger);">Error loading payment history</p>';
  }
}

// Make function globally available
window.loadPaymentHistory = loadPaymentHistory;

/**
 *  Load Outstanding Fees Report using canonical calculation
 */
async function loadOutstandingFeesReport() {
  const container = document.getElementById('outstanding-fees-table');
  if (!container) return;

  const tbody = container.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading outstanding fees...</td></tr>';

  try {
    const settings    = await window.getCurrentSettings();
    const session     = settings.session;
    const currentTerm = settings.term;

    const pupilsSnap = await db.collection('pupils').get();

    if (pupilsSnap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:var(--space-2xl);">No pupils enrolled</td></tr>';
      updateSummaryDisplay(0, 0);
      return;
    }

    const outstandingPupils = [];
    const alumniWithBalance = [];
    let totalOutstanding    = 0;
    let errorCount          = 0;

    // Process pupils in small concurrent batches instead of strictly one at
    // a time. calculateCurrentOutstanding() does several Firestore reads
    // internally per pupil, so doing this one-by-one made the report take
    // longer and longer as the school enrolled more pupils. Batching 8 at a
    // time keeps this responsive as enrollment grows, with no change to the
    // actual calculation logic.
    const CONCURRENCY = 8;
    const allDocs = pupilsSnap.docs;

    for (let i = 0; i < allDocs.length; i += CONCURRENCY) {
      const batch = allDocs.slice(i, i + CONCURRENCY);

      const results = await Promise.all(batch.map(async (pupilDoc) => {
        const pupilId   = pupilDoc.id;
        const pupilData = pupilDoc.data();
        const isAlumni  = pupilData.status === 'alumni' || pupilData.isActive === false;

        try {
          const result = await window.calculateCurrentOutstanding(pupilId, session, currentTerm);
          return { isAlumni, result, error: null };
        } catch (error) {
          console.error(`❌ Error calculating for pupil ${pupilId}:`, error.message);
          return { isAlumni, result: null, error };
        }
      }));

      results.forEach(({ isAlumni, result, error }) => {
        if (error) {
          errorCount++;
          return;
        }

        if (isAlumni) {
          if (!result.reason && result.balance > 0) {
            console.warn(
              `⚠️ Alumni ${result.pupilName} has outstanding balance: ₦${result.balance.toLocaleString()}`
            );
            alumniWithBalance.push({ ...result, isAlumni: true });
          }
          return;
        }

        if (result.reason) return;

        if (result.balance > 0) {
          outstandingPupils.push(result);
          totalOutstanding += result.balance;
        }

        if (result.status === 'overpaid') {
          console.log(`ℹ️ ${result.pupilName} has credit of ₦${result.credit.toLocaleString()}`);
        }
      });
    }

    tbody.innerHTML = '';

    if (outstandingPupils.length === 0 && alumniWithBalance.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-success); padding:var(--space-2xl);">✓ All fees collected for ${currentTerm}!</td></tr>`;
      updateSummaryDisplay(0, 0);
      if (errorCount > 0) {
        window.showToast?.(`Report complete with ${errorCount} error(s). Check console.`, 'warning', 6000);
      }
      return;
    }

    outstandingPupils.sort((a, b) => b.balance - a.balance);

    const fragment = document.createDocumentFragment();

    outstandingPupils.forEach(pupil => {
      const tr = document.createElement('tr');

      let feeDisplay = `₦${pupil.amountDue.toLocaleString()}`;
      if (pupil.amountDue !== pupil.baseFee) {
        feeDisplay = `
          <span style="text-decoration:line-through; color:#999;">₦${pupil.baseFee.toLocaleString()}</span>
          <br>
          <strong style="color:${pupil.amountDue < pupil.baseFee ? '#2196F3' : '#ff9800'};">
            ₦${pupil.amountDue.toLocaleString()}
          </strong>`;
      }

      const arrearsNote = pupil.arrears > 0
        ? `<br><span style="color:#dc3545; font-size:0.85em; font-weight:600;">+ ₦${pupil.arrears.toLocaleString()} arrears</span>`
        : '';

      tr.innerHTML = `
        <td data-label="Pupil Name">${pupil.pupilName}</td>
        <td data-label="Class">${pupil.className}</td>
        <td data-label="Amount Due">${feeDisplay}${arrearsNote}</td>
        <td data-label="Total Paid">₦${pupil.totalPaid.toLocaleString()}</td>
        <td data-label="Balance" class="text-bold text-danger">₦${pupil.balance.toLocaleString()}</td>
        <td data-label="Status">
          <span class="status-badge" style="background:${
            pupil.status === 'partial'      ? '#ff9800' :
            pupil.arrears > 0              ? '#dc3545' :
                                             '#f44336'};">
            ${pupil.status === 'partial' ? 'Partial' : pupil.arrears > 0 ? 'With Arrears' : 'Owing'}
          </span>
        </td>
        <td data-label="Term">${currentTerm}</td>
      `;
      fragment.appendChild(tr);
    });

    if (alumniWithBalance.length > 0) {
      const alumniHeaderTr = document.createElement('tr');
      alumniHeaderTr.innerHTML = `
        <td colspan="7" style="
          background:#fff3cd;
          color:#856404;
          font-weight:700;
          padding:var(--space-sm) var(--space-md);
          border-top:2px solid #ffc107;
        ">
          ⚠️ Alumni with Outstanding Balances (${alumniWithBalance.length}) — 
          Resolve before finalising graduation records
        </td>
      `;
      fragment.appendChild(alumniHeaderTr);

      alumniWithBalance.sort((a, b) => b.balance - a.balance);

      alumniWithBalance.forEach(pupil => {
        const tr = document.createElement('tr');
        tr.style.background = '#fffdf0';
        tr.innerHTML = `
          <td data-label="Pupil Name">${pupil.pupilName} <em style="color:#856404;">(Alumni)</em></td>
          <td data-label="Class">${pupil.className || '—'}</td>
          <td data-label="Amount Due">₦${pupil.amountDue.toLocaleString()}</td>
          <td data-label="Total Paid">₦${pupil.totalPaid.toLocaleString()}</td>
          <td data-label="Balance" style="font-weight:700; color:#856404;">₦${pupil.balance.toLocaleString()}</td>
          <td data-label="Status">
            <span class="status-badge" style="background:#856404;">Alumni - Owing</span>
          </td>
          <td data-label="Term">${currentTerm}</td>
        `;
        fragment.appendChild(tr);
        totalOutstanding += pupil.balance;
      });
    }

    tbody.appendChild(fragment);

    updateSummaryDisplay(
      outstandingPupils.length + alumniWithBalance.length,
      totalOutstanding
    );

    if (errorCount > 0) {
      window.showToast?.(
        `Report loaded with ${errorCount} error(s). Some pupils may be missing.`,
        'warning', 6000
      );
    }

  } catch (error) {
    console.error('❌ Error loading outstanding fees:', error);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-danger);">Error: ${error.message}</td></tr>`;
    updateSummaryDisplay(0, 0);
  }
}

window.loadOutstandingFeesReport = loadOutstandingFeesReport;
console.log('✅ loadOutstandingFeesReport() loaded');

/**
 * Show detailed fee breakdown in modal
 */
function showFeeBreakdown(pupilName, termBreakdown) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;';
  
  const breakdownRows = termBreakdown
    .filter(t => t.due > 0)
    .map(t => `
      <tr>
        <td><strong>${t.term}</strong></td>
        <td style="text-align:right;">₦${t.due.toLocaleString()}</td>
        <td style="text-align:right;">₦${t.paid.toLocaleString()}</td>
        <td style="text-align:right; color:${t.balance > 0 ? '#f44336' : '#4CAF50'}; font-weight:700;">
          ₦${t.balance.toLocaleString()}
        </td>
      </tr>
    `).join('');
  
  const totalDue = termBreakdown.reduce((sum, t) => sum + t.due, 0);
  const totalPaid = termBreakdown.reduce((sum, t) => sum + t.paid, 0);
  const totalBalance = termBreakdown.reduce((sum, t) => sum + t.balance, 0);
  
  modal.innerHTML = `
    <div style="background:white; padding:var(--space-2xl); border-radius:var(--radius-lg); max-width:600px; width:90%; max-height:80vh; overflow-y:auto;">
      <h3 style="margin-top:0;">Fee Breakdown: ${pupilName}</h3>
      
      <table style="width:100%; border-collapse:collapse; margin-bottom:var(--space-lg);">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:var(--space-sm); text-align:left;">Term</th>
            <th style="padding:var(--space-sm); text-align:right;">Due</th>
            <th style="padding:var(--space-sm); text-align:right;">Paid</th>
            <th style="padding:var(--space-sm); text-align:right;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${breakdownRows}
        </tbody>
        <tfoot>
          <tr style="background:#e3f2fd; font-weight:700;">
            <td style="padding:var(--space-sm);"><strong>TOTAL</strong></td>
            <td style="padding:var(--space-sm); text-align:right;">₦${totalDue.toLocaleString()}</td>
            <td style="padding:var(--space-sm); text-align:right;">₦${totalPaid.toLocaleString()}</td>
            <td style="padding:var(--space-sm); text-align:right; color:#f44336;">₦${totalBalance.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      
      <button class="btn btn-primary" onclick="this.closest('[style*=position]').remove()">Close</button>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// Make functions globally available
window.showFeeBreakdown = showFeeBreakdown;

/**
 * Financial Reports using canonical calculation
 */
async function loadFinancialReports() {
  try {
    const settings    = await window.getCurrentSettings();
    const session     = settings.session;
    const currentTerm = settings.term;

    console.log(`📊 Generating financial report for ${session} - ${currentTerm}`);

    const pupilsSnap = await db.collection('pupils').get();

    if (pupilsSnap.empty) {
      updateFinancialDisplays(0, 0, 0, 0, 0, 0, 0, session, currentTerm);
      return;
    }

    console.log(`✓ Found ${pupilsSnap.size} pupils for financial report`);

    let totalCurrentFees  = 0;
    let totalArrears      = 0;
    let totalCollected    = 0;
    let totalOutstanding  = 0;
    let paidInFull        = 0;
    let partialPayments   = 0;
    let noPayment         = 0;

    let processedCount = 0;
    let skippedCount   = 0;
    let errorCount     = 0;

    const CONCURRENCY = 8;
    const activeDocs = pupilsSnap.docs.filter(pupilDoc => {
      const d = pupilDoc.data();
      return !(d.status === 'alumni' || d.isActive === false);
    });

    skippedCount += pupilsSnap.docs.length - activeDocs.length;

    for (let i = 0; i < activeDocs.length; i += CONCURRENCY) {
      const batch = activeDocs.slice(i, i + CONCURRENCY);

      const results = await Promise.all(batch.map(async (pupilDoc) => {
        const pupilId   = pupilDoc.id;
        const pupilData = pupilDoc.data();
        try {
          const result = await window.calculateCurrentOutstanding(pupilId, session, currentTerm);
          return { result, error: null, pupilName: pupilData.name };
        } catch (error) {
          return { result: null, error, pupilName: pupilData.name };
        }
      }));

      results.forEach(({ result, error, pupilName }) => {
        if (error) {
          console.error(`❌ Error calculating for ${pupilName}:`, error.message);
          errorCount++;
          return;
        }

        if (result.reason) {
          skippedCount++;
          return;
        }

        totalCurrentFees += result.amountDue;
        totalArrears     += result.arrears;
        totalCollected   += result.totalPaid;
        totalOutstanding += result.balance;

        if (result.balance === 0 && result.totalPaid > 0) {
          paidInFull++;
        } else if (result.totalPaid > 0 && result.balance > 0) {
          partialPayments++;
        } else if (result.totalPaid === 0) {
          noPayment++;
        }

        processedCount++;
      });
    }

    console.log(`\n📊 Financial Report Summary:`);
    console.log(`   Processed: ${processedCount} pupils`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Current term fees: ₦${totalCurrentFees.toLocaleString()}`);
    console.log(`   Arrears: ₦${totalArrears.toLocaleString()}`);
    console.log(`   Collected: ₦${totalCollected.toLocaleString()}`);
    console.log(`   Outstanding: ₦${totalOutstanding.toLocaleString()}`);

    const totalExpected = totalCurrentFees + totalArrears;

    const currentTermCollected = Math.min(totalCollected, totalCurrentFees);
    const currentTermCollectionRate = totalCurrentFees > 0
      ? ((currentTermCollected / totalCurrentFees) * 100).toFixed(1)
      : 0;

    const overallCollectionRate = totalExpected > 0
      ? ((totalCollected / totalExpected) * 100).toFixed(1)
      : 0;

    console.log(`   Current-term collection rate: ${currentTermCollectionRate}%`);
    console.log(`   Overall collection rate: ${overallCollectionRate}%`);

    updateFinancialDisplays(
      totalExpected,
      totalCollected,
      totalOutstanding,
      overallCollectionRate,
      paidInFull,
      partialPayments,
      noPayment,
      session,
      currentTerm
    );

    const currentTermRateEl = document.getElementById('report-current-term-collection-rate');
    if (currentTermRateEl) {
      currentTermRateEl.textContent = `${currentTermCollectionRate}%`;
    }

    const overallRateEl = document.getElementById('report-collection-rate');
    if (overallRateEl) {
      overallRateEl.textContent = `${overallCollectionRate}%`;
    }

    console.log(`✅ Financial report generated successfully`);

  } catch (error) {
    console.error('❌ Error loading financial reports:', error);
    window.showToast?.('Failed to load financial reports', 'danger');
  }
}

window.loadFinancialReports = loadFinancialReports;
console.log('✅ loadFinancialReports() loaded');

// Helper function (keep existing one)
function updateFinancialDisplays(
    totalExpected,
    totalCollected,
    totalOutstanding,
    collectionRate,
    paidInFull,
    partialPayments,
    noPayment,
    session,
    term
) {
    const expectedEl = document.getElementById('report-total-expected');
    const collectedEl = document.getElementById('report-total-collected');
    const outstandingEl = document.getElementById('report-total-outstanding');
    const rateEl = document.getElementById('report-collection-rate');
    
    if (expectedEl) expectedEl.textContent = `₦${Number(totalExpected).toLocaleString()}`;
    if (collectedEl) collectedEl.textContent = `₦${Number(totalCollected).toLocaleString()}`;
    if (outstandingEl) outstandingEl.textContent = `₦${Number(totalOutstanding).toLocaleString()}`;
    if (rateEl) rateEl.textContent = `${collectionRate}%`;
    
    const paidFullEl = document.getElementById('report-paid-full');
    if (paidFullEl) paidFullEl.textContent = paidInFull;
    
    const partialEl = document.getElementById('report-partial');
    if (partialEl) partialEl.textContent = partialPayments;
    
    const owingEl = document.getElementById('report-owing');
    if (owingEl) owingEl.textContent = noPayment;
    
    const sessionEl = document.getElementById('report-session-display');
    if (sessionEl) sessionEl.textContent = session || '—';
    
    const termEl = document.getElementById('report-term-display');
    if (termEl) termEl.textContent = term || '—';
}

function updateSummaryDisplay(count, total) {
    const countEl = document.getElementById('outstanding-count');
    const totalEl = document.getElementById('outstanding-total');
    
    if (countEl) countEl.textContent = count;
    if (totalEl) totalEl.textContent = `₦${total.toLocaleString()}`;
}

// Make all functions globally available
window.exportFinancialReport = exportFinancialReport;
window.exportFinancialCSV = exportFinancialCSV;
window.exportFinancialPDF = exportFinancialPDF;
window.getPreviousSessionName = getPreviousSessionName;
window.calculateSessionBalanceSafe = calculateSessionBalanceSafe;
window.updateFinancialDisplays = updateFinancialDisplays;
window.updateSummaryDisplay = updateSummaryDisplay;

console.log('✅ COMPLETE FINANCIAL SYSTEM FIX LOADED');
console.log('   - Outstanding fees: Pupil-based with class fee matching');
console.log('   - Financial reports: Pupil-based with class fee matching');
console.log('   - CSV export: Pupil-based with class fee matching');
console.log('   - PDF export: Pupil-based with class fee matching');


// Make functions globally available
window.updateFinancialDisplays = updateFinancialDisplays;

/**
 * FIXED: Fee Structure ID - Class-Based (No Session)
 * Replace saveFeeStructure() function
 */
async function saveFeeStructure() {
  const classSelect = document.getElementById('fee-config-class');
  const classId = classSelect?.value;
  const className = classSelect?.selectedOptions[0]?.dataset.className;

  if (!classId) {
    window.showToast?.('Please select a class', 'warning');
    return;
  }

  // Round all fee components to whole naira on input
  const tuition  = Math.round(parseFloat(document.getElementById('fee-tuition')?.value)  || 0);
  const examFee  = Math.round(parseFloat(document.getElementById('fee-exam')?.value)      || 0);
  const uniform  = Math.round(parseFloat(document.getElementById('fee-uniform')?.value)   || 0);
  const books    = Math.round(parseFloat(document.getElementById('fee-books')?.value)     || 0);
  const pta      = Math.round(parseFloat(document.getElementById('fee-pta')?.value)       || 0);
  const other    = Math.round(parseFloat(document.getElementById('fee-other')?.value)     || 0);

  const feeBreakdown = {
    tuition,
    exam_fee: examFee,
    uniform,
    books,
    pta,
    other
  };

  // Sum of already-rounded integers — total will always be a whole number
  const total = tuition + examFee + uniform + books + pta + other;

  if (total <= 0) {
    window.showToast?.('Please enter at least one fee amount', 'warning');
    return;
  }

  const saveBtn = document.getElementById('save-fee-structure-btn');
  const isEditing = saveBtn?.dataset.editingId;

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-loading">Saving...</span>';
  }

  try {
    const feeDocId = `fee_${classId}`;

    const existingFeeDoc = await db.collection('fee_structures').doc(feeDocId).get();

    if (existingFeeDoc.exists && !isEditing) {
      const existingData = existingFeeDoc.data();
      const existingTotal = Math.round(Number(existingData.total) || 0);

      const confirmation = confirm(
        `⚠️ FEE STRUCTURE ALREADY EXISTS\n\n` +
        `Class: ${className}\n\n` +
        `Current fee: ₦${existingTotal.toLocaleString()} per term\n` +
        `New fee: ₦${total.toLocaleString()} per term\n\n` +
        `This will UPDATE the existing fee structure.\n\n` +
        `Continue?`
      );

      if (!confirmation) {
        window.showToast?.('Operation cancelled', 'info');
        return;
      }
    }

    if (isEditing || existingFeeDoc.exists) {
      const oldDoc = await db.collection('fee_structures').doc(feeDocId).get();
      if (oldDoc.exists) {
        await db.collection('fee_structure_history').add({
          ...oldDoc.data(),
          archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
          archivedBy: auth.currentUser.uid,
          reason: isEditing ? 'Fee structure edited' : 'Fee structure updated'
        });
      }
    }

    const createdAt = existingFeeDoc.exists
      ? (existingFeeDoc.data()?.createdAt || firebase.firestore.FieldValue.serverTimestamp())
      : firebase.firestore.FieldValue.serverTimestamp();

    await db.collection('fee_structures').doc(feeDocId).set({
      classId,
      className,
      fees: feeBreakdown,
      total,
      createdAt,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastModifiedBy: auth.currentUser.uid
    });

    const action = existingFeeDoc.exists ? 'updated' : 'created';

    window.showToast?.(
      `✓ Fee structure ${action} for ${className}!\n\n` +
      `Per-term fee: ₦${total.toLocaleString()}\n\n` +
      `This fee applies to all terms until changed.`,
      'success',
      8000
    );

    document.getElementById('fee-config-class').value = '';
    ['fee-tuition', 'fee-exam', 'fee-uniform', 'fee-books', 'fee-pta', 'fee-other'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    if (saveBtn) {
      saveBtn.textContent = '💾 Save Fee Structure';
      delete saveBtn.dataset.editingId;
    }

    if (classSelect) classSelect.disabled = false;

    await loadFeeStructures();

  } catch (error) {
    console.error('❌ Error saving fee structure:', error);
    window.showToast?.('Failed to save fee structure: ' + error.message, 'danger');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = isEditing ? '✏️ Update Fee Structure' : '💾 Save Fee Structure';
    }
  }
}

window.saveFeeStructure = saveFeeStructure;

/**
 * Edit fee structure - Works with permanent (class-based) fee structures
 */
async function editFeeStructure(feeDocId) {
  try {
    const feeDoc = await db.collection('fee_structures').doc(feeDocId).get();
    
    if (!feeDoc.exists) {
      window.showToast?.('Fee structure not found', 'danger');
      return;
    }
    
    const data = feeDoc.data();
    
    // Populate form with existing data
    const classSelect = document.getElementById('fee-config-class');
    if (classSelect) {
      classSelect.value = data.classId;
      classSelect.disabled = true; // Prevent changing class during edit
    }
    
    document.getElementById('fee-tuition').value = data.fees?.tuition || 0;
    document.getElementById('fee-exam').value = data.fees?.exam_fee || 0;
    document.getElementById('fee-uniform').value = data.fees?.uniform || 0;
    document.getElementById('fee-books').value = data.fees?.books || 0;
    document.getElementById('fee-pta').value = data.fees?.pta || 0;
    document.getElementById('fee-other').value = data.fees?.other || 0;
    
    // Change button text and add data attribute
    const saveBtn = document.getElementById('save-fee-structure-btn');
    if (saveBtn) {
      saveBtn.textContent = '✏️ Update Fee Structure';
      saveBtn.dataset.editingId = feeDocId;
    }
    
    // Update form title
    const formTitle = document.querySelector('#fee-management h3');
    if (formTitle) {
      formTitle.textContent = `Edit Fee Structure: ${data.className}`;
    }
    
    // Scroll to form
    const feeConfigCard = document.querySelector('#fee-management .admin-card');
    if (feeConfigCard) {
      feeConfigCard.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
    }
    
    window.showToast?.(
      `Editing fee structure for ${data.className}\n\n` +
      `Note: You cannot change which class this fee applies to.\n` +
      `Current fee: ₦${data.total.toLocaleString()} per term`,
      'info',
      6000
    );
    
  } catch (error) {
    console.error('❌ Error loading fee for edit:', error);
    window.showToast?.('Failed to load fee structure', 'danger');
  }
}

/**
 * Delete fee structure - Works with permanent (class-based) fee structures
 */
async function deleteFeeStructure(docId, className) {
  try {
    const feeDoc = await db.collection('fee_structures').doc(docId).get();

    if (!feeDoc.exists) {
      window.showToast?.('Fee structure not found', 'danger');
      return;
    }

    const feeData = feeDoc.data();
    const classId = feeData.classId;
    const total = Math.round(Number(feeData.total) || 0);

    // Check payments AND transactions — both constitute financial history
    const [paymentsSnap, transactionsSnap] = await Promise.all([
      db.collection('payments').where('classId', '==', classId).limit(1).get(),
      db.collection('payment_transactions').where('classId', '==', classId).limit(1).get()
    ]);

    if (!paymentsSnap.empty || !transactionsSnap.empty) {
      window.showToast?.(
        `🚫 Cannot delete fee structure for ${className}.\n\n` +
        `Financial records exist for this class. ` +
        `Use Edit to change the fee amount instead.`,
        'danger',
        8000
      );
      return;
    }

    const confirmation = confirm(
      `⚠️ DELETE FEE STRUCTURE FOR ${className}?\n\n` +
      `Fee per term: ₦${total.toLocaleString()}\n\n` +
      `No payment records exist for this class.\n` +
      `A backup will be archived before deletion.\n\n` +
      `This cannot be undone. Continue?`
    );

    if (!confirmation) return;

    // Archive and delete atomically in a single batch
    const batch = db.batch();

    batch.set(db.collection('fee_structure_history').doc(), {
      classId,
      className,
      fees: feeData.fees || {},
      total,
      deletedBy: auth.currentUser.uid,
      deletedByEmail: auth.currentUser.email,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      reason: 'Admin deleted (no financial history)',
      originalData: feeData
    });

    batch.delete(db.collection('fee_structures').doc(docId));

    await batch.commit();

    window.showToast?.(`✓ Fee structure for ${className} deleted and archived.`, 'success', 5000);

    await loadFeeStructures();

  } catch (error) {
    console.error('❌ Error deleting fee structure:', error);
    window.handleError?.(error, 'Failed to delete fee structure');
  }
}

/**
 * Generate Payment Records (Class-Based Fee Lookup)
 */
async function generatePaymentRecordsForClass(classId, className, session, term, totalFee) {
  try {
    console.log(`Generating payment records for ${className}, ${term}...`);
    
    const pupilsSnap = await db.collection('pupils')
      .where('class.id', '==', classId)
      .get();
    
    if (pupilsSnap.empty) {
      console.log('No pupils found in this class');
      return { success: true, count: 0, skipped: 0, total: 0 };
    }
    
    // Get persistent fee structure (class-based)
    const feeDocId = `fee_${classId}`;
    const feeDoc = await db.collection('fee_structures').doc(feeDocId).get();
    
    if (!feeDoc.exists) {
      throw new Error(`No fee structure configured for class: ${className}`);
    }
    
    const feeStructure = feeDoc.data();
    const actualFeePerTerm = feeStructure.total || 0;
    
    if (actualFeePerTerm === 0) {
      throw new Error(`Fee structure exists but amount is ₦0 for ${className}`);
    }
    
    const batch = db.batch();
    let created = 0;
    let skipped = 0;
    
    const previousSession = getPreviousSessionName(session);
    const encodedSession = session.replace(/\//g, '-');
    
    for (const pupilDoc of pupilsSnap.docs) {
      const pupilData = pupilDoc.data();
      const pupilId = pupilDoc.id;
      const paymentDocId = `${pupilId}_${encodedSession}_${term}`;
      
      // Check if payment record already exists
      const existingPayment = await db.collection('payments').doc(paymentDocId).get();
      
      if (existingPayment.exists) {
        console.log(`⏭️ Skipping ${pupilData.name} - payment record already exists`);
        skipped++;
        continue;
      }
      
      // Calculate actual fee for this pupil in this term
      const actualFee = window.finance.calculatePupilTermFee(
        pupilData,
        actualFeePerTerm,
        term
      );
      
      // Skip if pupil is not enrolled for this term
      if (actualFee === 0) {
        console.log(`⏭️ Skipping ${pupilData.name} - not enrolled for ${term}`);
        skipped++;
        continue;
      }
      
      // Check for arrears from previous session
      let arrears = 0;
      if (previousSession) {
        const previousSessionBalance = await calculateSessionBalance(pupilId, previousSession);
        arrears = previousSessionBalance;
      }
      
      const paymentRef = db.collection('payments').doc(paymentDocId);
      
      // Create payment record with actual fee
      batch.set(paymentRef, {
        pupilId: pupilId,
        pupilName: pupilData.name || 'Unknown',
        classId: classId,
        className: className,
        session: session,
        term: term,
        amountDue: actualFee,
        arrears: arrears,
        totalDue: actualFee + arrears,
        totalPaid: 0,
        balance: actualFee + arrears,
        status: arrears > 0 ? 'owing_with_arrears' : 'owing',
        lastPaymentDate: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      created++;
    }
    
    if (created > 0) {
      await batch.commit();
      console.log(`✓ Created ${created} new payment records (${skipped} skipped)`);
    } else {
      console.log(`✓ All ${pupilsSnap.size} pupils already have payment records`);
    }
    
    return { 
      success: true, 
      count: created,
      skipped: skipped,
      total: pupilsSnap.size
    };
    
  } catch (error) {
    console.error('Error generating payment records:', error);
    throw error;
  }
}

window.generatePaymentRecordsForClass = generatePaymentRecordsForClass;

/**
 * Ensure all pupils have payment records using permanent fee structures
 */
async function ensureAllPupilsHavePaymentRecords() {
  const btn = document.getElementById('bulk-generate-btn');

  if (!confirm(
    'Generate/verify payment records for all pupils?\n\n' +
    'This will:\n' +
    '• Create records for pupils who don\'t have them\n' +
    '• Use current fee structures\n' +
    '• Preserve all existing payment data\n' +
    '• Calculate and apply arrears correctly\n\n' +
    '⚠️ Do not run this while payments are actively being recorded.\n\n' +
    'Continue?'
  )) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loading">Generating records...</span>';
  }

  try {
    const settings       = await window.getCurrentSettings();
    const session        = settings.session;
    const term           = settings.term;
    const encodedSession = session.replace(/\//g, '-');

    const pupilsSnap = await db.collection('pupils').get();

    if (pupilsSnap.empty) {
      window.showToast?.('No pupils found', 'info');
      return;
    }

    const feeStructuresSnap = await db.collection('fee_structures').get();
    const feeStructureMap   = {};
    feeStructuresSnap.forEach(doc => {
      const data = doc.data();
      feeStructureMap[data.classId] = Math.round(Number(data.total) || 0);
    });

    if (Object.keys(feeStructureMap).length === 0) {
      window.showToast?.('No fee structures configured. Please set up fees first.', 'warning');
      return;
    }

    let totalCreated = 0;
    let totalSkipped = 0;
    let totalArrears = 0;
    let totalErrors  = 0;

    const CONCURRENCY = 5;
    const allDocs = pupilsSnap.docs;

    for (let i = 0; i < allDocs.length; i += CONCURRENCY) {
      const batch = allDocs.slice(i, i + CONCURRENCY);

      const results = await Promise.all(batch.map(async (pupilDoc) => {
        const pupilId   = pupilDoc.id;
        const pupilData = pupilDoc.data();

        if (pupilData.status === 'alumni' || pupilData.isActive === false) {
          return { outcome: 'skipped' };
        }

        try {
          const classId = pupilData.class?.id;
          if (!classId) return { outcome: 'skipped' };

          const baseFee = feeStructureMap[classId];
          if (!baseFee) return { outcome: 'skipped' };

          const amountDue = window.calculateAdjustedFee
            ? window.calculateAdjustedFee(pupilData, baseFee, term)
            : baseFee;

          if (amountDue === 0 && baseFee > 0) return { outcome: 'skipped' };

          const paymentDocId = `${pupilId}_${encodedSession}_${term}`;
          const paymentRef   = db.collection('payments').doc(paymentDocId);

          let shouldCreate = false;

          await db.runTransaction(async (tx) => {
            const docInTx = await tx.get(paymentRef);
            if (docInTx.exists) {
              // Already exists — respect existing data, do nothing.
              return;
            }
            shouldCreate = true;
          });

          if (!shouldCreate) {
            return { outcome: 'skipped' };
          }

          // Calculate arrears outside the transaction
          let arrears = 0;
          try {
            arrears = await window.calculateCompleteArrears(pupilId, session, term);
          } catch (arrearsError) {
            console.warn(`⚠️ Arrears calc failed for ${pupilData.name}, defaulting to ₦0:`, arrearsError.message);
            arrears = 0;
          }

          // Second transaction: create the doc only if it still doesn't exist.
          // This handles the edge case where another session created it between
          // our check above and now.
          let wasCreated = false;

          await db.runTransaction(async (tx) => {
            const docInTx = await tx.get(paymentRef);

            if (docInTx.exists) {
              // Someone else created it between our two transactions — skip.
              return;
            }

            tx.set(paymentRef, {
              pupilId,
              pupilName:   pupilData.name || 'Unknown',
              classId,
              className:   pupilData.class?.name || 'Unknown',
              session,
              term,
              baseFee,
              adjustedFee: amountDue,
              amountDue,
              arrears,
              totalDue:    amountDue + arrears,
              totalPaid:   0,
              balance:     amountDue + arrears,
              status:      arrears > 0 ? 'owing_with_arrears' : 'owing',
              lastPaymentDate: null,
              createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
              autoCreated: true
            });

            wasCreated = true;
          });

          if (wasCreated) {
            return { outcome: 'created', arrears };
          } else {
            return { outcome: 'skipped' };
          }

        } catch (pupilError) {
          console.error(`⚠️ Skipping pupil ${pupilId}:`, pupilError.message);
          return { outcome: 'error' };
        }
      }));

      results.forEach(r => {
        if (r.outcome === 'created') {
          totalCreated++;
          if (r.arrears > 0) totalArrears += r.arrears;
        } else if (r.outcome === 'error') {
          totalErrors++;
          totalSkipped++;
        } else {
          totalSkipped++;
        }
      });
    }

    window.showToast?.(
      `✅ Payment records verified!\n\n` +
      `Created: ${totalCreated} new records\n` +
      `Skipped: ${totalSkipped}\n` +
      `Errors: ${totalErrors}\n` +
      `Total arrears captured: ₦${totalArrears.toLocaleString()}`,
      totalErrors > 0 ? 'warning' : 'success',
      10000
    );

    await loadOutstandingFeesReport();
    await loadFinancialReports();

  } catch (error) {
    console.error('Error generating payment records:', error);
    window.handleError?.(error, 'Failed to generate payment records');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📋 Generate All Missing Payment Records';
    }
  }
}

window.ensureAllPupilsHavePaymentRecords = ensureAllPupilsHavePaymentRecords;
console.log('✅ ensureAllPupilsHavePaymentRecords() FIX 7 loaded');

/**
 * Helper: Calculate total unpaid balance for entire session
 */
async function calculateSessionBalance(pupilId, session) {
  // Just delegate to the safe version
  return await calculateSessionBalanceSafe(pupilId, session);
}

/**
 * Record payment with atomic transaction protection
 */
async function recordPayment() {
  // Guard: finance module must be loaded before any payment work begins
  if (!window.finance || typeof window.finance.recordPayment !== 'function') {
    window.showToast?.(
      '⚠️ Payment module not loaded.\n\nPlease refresh the page and try again.\nIf this persists, contact your system administrator.',
      'danger',
      8000
    );
    console.error('❌ window.finance.recordPayment is not available');
    return;
  }

  const pupilSelect = document.getElementById('payment-pupil-select');
  const pupilId = pupilSelect?.value;
  const pupilName = pupilSelect?.selectedOptions[0]?.dataset.pupilName;
  const className = pupilSelect?.selectedOptions[0]?.dataset.className;
  const classId = document.getElementById('payment-class-filter')?.value;

  const amountInput = document.getElementById('payment-amount');
  const amountPaid = amountInput ? parseFloat(amountInput.value) : NaN;

  const paymentMethod = document.getElementById('payment-method')?.value;
  const notes = document.getElementById('payment-notes')?.value?.trim() || '';

  if (!pupilId || !classId) {
    window.showToast?.('Please select a pupil and class', 'warning');
    return;
  }

  if (isNaN(amountPaid) || amountPaid <= 0) {
    window.showToast?.('Please enter a valid payment amount', 'warning');
    return;
  }

  if (amountPaid > 10000000) {
    window.showToast?.('Payment amount exceeds maximum allowed. Please verify.', 'warning');
    return;
  }

  const recordBtn = document.getElementById('record-payment-btn');
  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.innerHTML = '<span class="btn-loading">Recording payment...</span>';
  }

  try {
    const settings = await window.getCurrentSettings();
    const session = settings.session;
    const term = settings.term;

    if (!session || !term) {
      throw new Error('School session or term not configured. Please check School Settings.');
    }

    const result = await window.finance.recordPayment(
      pupilId,
      pupilName,
      classId,
      className,
      session,
      term,
      {
        amountPaid,
        paymentMethod: paymentMethod || 'Cash',
        notes
      }
    );

    let message = `✓ Payment Recorded!\n\nReceipt #${result.receiptNo}\nAmount: ₦${result.amountPaid.toLocaleString()}`;

    if (result.arrearsPayment > 0) {
      message += `\n\nPayment Breakdown:`;
      message += `\n  • Arrears: ₦${result.arrearsPayment.toLocaleString()}`;
      if (result.currentTermPayment > 0) {
        message += `\n  • Current Term: ₦${result.currentTermPayment.toLocaleString()}`;
      }
    }

    message += `\n\nNew Balance: ₦${(result.newBalance || 0).toLocaleString()}`;

    window.showToast?.(message, 'success', 10000);

    if (amountInput) amountInput.value = '';
    const notesInput = document.getElementById('payment-notes');
    if (notesInput) notesInput.value = '';

    await loadPupilPaymentStatus();

    if (confirm('Payment recorded successfully!\n\nWould you like to print the receipt now?')) {
      printReceipt(result.receiptNo);
    }

  } catch (error) {
    console.error('❌ Error recording payment:', error);
    window.showToast?.(`Failed to record payment: ${error.message}`, 'danger', 8000);
  } finally {
    if (recordBtn) {
      recordBtn.disabled = false;
      recordBtn.innerHTML = '💰 Record Payment';
    }
  }
}

// Make globally available
window.recordPayment = recordPayment;

// Open receipt in new window for printing
function printReceipt(receiptNo) {
    const receiptWindow = window.open(
        `receipt.html?receipt=${receiptNo}`,
        '_blank',
        'width=1000,height=750,scrollbars=yes,resizable=yes'
    );

    if (!receiptWindow) {
        window.showToast?.('Please allow popups to print receipts', 'warning');
    }
}

async function migrateArrearsToNewSession() {
  const btn = document.getElementById('migrate-arrears-btn');

  if (!confirm(
    '⚠️ ARREARS MIGRATION\n\n' +
    'This will:\n' +
    '• Calculate unpaid balances from previous session Third Term\n' +
    '• Log arrears for current session First Term\n' +
    '• Update all affected pupil records\n\n' +
    'This should only be run ONCE at the start of a new session.\n\n' +
    'Continue?'
  )) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loading">Migrating arrears...</span>';
  }

  try {
    const settings = await window.getCurrentSettings();
    const currentSession = settings.session;
    const previousSession = getPreviousSessionName(currentSession);

    if (!previousSession) {
      window.showToast?.('Cannot determine previous session', 'danger');
      return;
    }

    const pupilsSnap = await db.collection('pupils').get();

    let processedCount = 0;
    let arrearsFoundCount = 0;
    let totalArrearsAmount = 0;
    let errorCount = 0;

    // Use let — batch must be renewable after 400 operations
    let batch = db.batch();
    let batchCount = 0;

    for (const pupilDoc of pupilsSnap.docs) {
      const pupilId = pupilDoc.id;
      const pupilData = pupilDoc.data();

      if (pupilData.status === 'alumni' || pupilData.isActive === false) {
        continue;
      }

      try {
        // calculateSessionBalanceSafe correctly reads only Third Term
        const arrears = await calculateSessionBalanceSafe(pupilId, previousSession);

        if (arrears > 0) {
          arrearsFoundCount++;
          totalArrearsAmount += arrears;

          const arrearsLogRef = db.collection('arrears_log').doc();
          batch.set(arrearsLogRef, {
            pupilId,
            pupilName: pupilData.name || 'Unknown',
            oldSession: previousSession,
            newSession: currentSession,
            arrearsAmount: arrears,
            migratedAt: firebase.firestore.FieldValue.serverTimestamp(),
            migratedBy: auth.currentUser.uid
          });

          batchCount++;

          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
            console.log(`Progress: ${processedCount} pupils processed...`);
          }
        }

        processedCount++;

      } catch (pupilError) {
        console.error(`⚠️ Error processing pupil ${pupilId}:`, pupilError.message);
        errorCount++;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    window.showToast?.(
      `✓ Arrears Migration Complete!\n\n` +
      `• Processed: ${processedCount} pupils\n` +
      `• Found arrears: ${arrearsFoundCount} pupils\n` +
      `• Total arrears: ₦${totalArrearsAmount.toLocaleString()}\n` +
      `• Errors: ${errorCount}`,
      'success',
      10000
    );

  } catch (error) {
    console.error('Arrears migration error:', error);
    window.showToast?.(`Migration failed: ${error.message}`, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 Migrate Arrears from Previous Session';
    }
  }
}

// Make functions globally available
window.generatePaymentRecordsForClass = generatePaymentRecordsForClass;
window.migrateArrearsToNewSession = migrateArrearsToNewSession;

console.log('✓ Cross-session debt tracking system loaded');

/**
 * Export financial report to CSV or PDF - FIXED: based on ALL pupils
 */
async function exportFinancialReport(format) {
    if (format !== 'csv' && format !== 'pdf') {
        window.showToast?.('Invalid export format', 'warning');
        return;
    }

    try {
        const settings = await window.getCurrentSettings();
        const session = settings.session;
        const term = settings.term;

        if (format === 'csv') {
            await exportFinancialCSV(session, term);
        } else {
            await exportFinancialPDF(session, term);
        }

    } catch (error) {
        console.error('❌ Error exporting financial report:', error);
        window.handleError?.(error, 'Failed to export report');
    }
}

/**
 * Export CSV using canonical calculation
 */
async function exportFinancialCSV(session, term) {
    try {
        window.showToast?.('Preparing CSV export...', 'info', 2000);

        const pupilsSnap = await db.collection('pupils').get();
        
        if (pupilsSnap.empty) {
            window.showToast?.('No pupils found', 'warning');
            return;
        }

        const reportData = [];
        
        let processedCount = 0;
        let skippedCount = 0;

        console.log(`📊 Exporting financial data for ${pupilsSnap.size} pupils...`);

        // Process pupils in small concurrent batches instead of one at a time.
        // This keeps CSV export fast even as pupil count grows into the hundreds.
        const CONCURRENCY = 8;
        const allDocs = pupilsSnap.docs;

        for (let i = 0; i < allDocs.length; i += CONCURRENCY) {
            const batch = allDocs.slice(i, i + CONCURRENCY);

            const results = await Promise.all(batch.map(async (pupilDoc) => {
                const pupilId   = pupilDoc.id;
                const pupilData = pupilDoc.data();

                try {
                    const result = await window.calculateCurrentOutstanding(pupilId, session, term);
                    return { result, error: null };
                } catch (error) {
                    console.error(`Error processing ${pupilData.name}:`, error.message);
                    return { result: null, error };
                }
            }));

            results.forEach(({ result, error }) => {
                if (error) {
                    skippedCount++;
                    return;
                }

                if (result.reason) {
                    skippedCount++;
                    return;
                }

                reportData.push({
                    pupilName: result.pupilName,
                    className: result.className,
                    baseFee: result.baseFee,
                    adjustedFee: result.amountDue,
                    arrears: result.arrears,
                    totalDue: result.totalDue,
                    totalPaid: result.totalPaid,
                    balance: result.balance,
                    status: result.status
                });

                processedCount++;
            });
        }

        if (reportData.length === 0) {
            window.showToast?.('No financial data to export', 'warning');
            return;
        }

        console.log(`✓ Export data prepared: ${processedCount} pupils`);

        // Create CSV with all relevant fields
        const headers = [
            'Pupil Name', 
            'Class', 
            'Base Fee', 
            'Adjusted Fee', 
            'Arrears', 
            'Total Due', 
            'Total Paid', 
            'Balance', 
            'Status'
        ];
        const csvRows = [headers.join(',')];
        
        reportData.forEach(p => {
            csvRows.push([
                `"${(p.pupilName || '').replace(/"/g, '""')}"`,
                `"${(p.className || '').replace(/"/g, '""')}"`,
                p.baseFee,
                p.adjustedFee,
                p.arrears,
                p.totalDue,
                p.totalPaid,
                p.balance,
                `"${p.status}"`
            ].join(','));
        });

        // Add summary
        const totalExpected = reportData.reduce((sum, p) => sum + p.totalDue, 0);
        const totalCollected = reportData.reduce((sum, p) => sum + p.totalPaid, 0);
        const totalOutstanding = reportData.reduce((sum, p) => sum + p.balance, 0);
        const collectionRate = totalExpected > 0 ? ((totalCollected / totalExpected) * 100).toFixed(1) : 0;

        csvRows.push([]);
        csvRows.push(['SUMMARY','','','','','','','','']);
        csvRows.push(['Pupils Processed', processedCount, '', '', '', '', '', '', '']);
        csvRows.push(['Pupils Skipped', skippedCount, '', '', '', '', '', '', '']);
        csvRows.push(['Total Expected', '', '', '', '', totalExpected, '', '', '']);
        csvRows.push(['Total Collected', '', '', '', '', totalCollected, '', '', '']);
        csvRows.push(['Total Outstanding', '', '', '', '', totalOutstanding, '', '', '']);
        csvRows.push(['Collection Rate', '', '', '', '', collectionRate + '%', '', '', '']);

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Financial_Report_${session.replace(/\//g, '-')}_${term}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        window.showToast?.(`✓ CSV exported: ${reportData.length} pupils`, 'success');

    } catch (error) {
        console.error('❌ Error exporting CSV:', error);
        window.showToast?.('Failed to export CSV', 'danger');
    }
}

/**
 * Export PDF using canonical calculation
 */
async function exportFinancialPDF(session, term) {
    try {
        if (typeof window.jspdf === 'undefined') {
            window.showToast?.('PDF library not loaded. Please refresh.', 'danger');
            return;
        }

        window.showToast?.('Preparing PDF export...', 'info', 2000);

        const pupilsSnap = await db.collection('pupils').get();
        
        if (pupilsSnap.empty) {
            window.showToast?.('No pupils found', 'warning');
            return;
        }

        const reportData = [];
        
        let processedCount = 0;
        let skippedCount = 0;

        console.log(`📊 Preparing PDF for ${pupilsSnap.size} pupils...`);

        // Process pupils in small concurrent batches instead of one at a time.
        const CONCURRENCY = 8;
        const allDocs = pupilsSnap.docs;

        for (let i = 0; i < allDocs.length; i += CONCURRENCY) {
            const batch = allDocs.slice(i, i + CONCURRENCY);

            const results = await Promise.all(batch.map(async (pupilDoc) => {
                const pupilId   = pupilDoc.id;
                const pupilData = pupilDoc.data();

                try {
                    const result = await window.calculateCurrentOutstanding(pupilId, session, term);
                    return { result, error: null };
                } catch (error) {
                    console.error(`Error processing ${pupilData.name}:`, error.message);
                    return { result: null, error };
                }
            }));

            results.forEach(({ result, error }) => {
                if (error) {
                    skippedCount++;
                    return;
                }

                if (result.reason) {
                    skippedCount++;
                    return;
                }

                reportData.push({
                    pupilName: result.pupilName,
                    className: result.className,
                    baseFee: `₦${result.baseFee.toLocaleString()}`,
                    adjustedFee: `₦${result.amountDue.toLocaleString()}`,
                    arrears: `₦${result.arrears.toLocaleString()}`,
                    totalDue: `₦${result.totalDue.toLocaleString()}`,
                    totalPaid: `₦${result.totalPaid.toLocaleString()}`,
                    balance: `₦${result.balance.toLocaleString()}`,
                    status: result.status.charAt(0).toUpperCase() + result.status.slice(1)
                });

                processedCount++;
            });
        }

        if (reportData.length === 0) {
            window.showToast?.('No financial data to export', 'warning');
            return;
        }

        console.log(`✓ PDF data prepared: ${processedCount} pupils`);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Header
        doc.setFontSize(18);
        doc.text('FAHMID NURSERY & PRIMARY SCHOOL', 105, 15, { align: 'center' });
        
        doc.setFontSize(14);
        doc.text('Financial Report', 105, 25, { align: 'center' });
        
        doc.setFontSize(10);
        doc.text(`Session: ${session} | Term: ${term}`, 105, 32, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 105, 38, { align: 'center' });

        // Table
        const tableData = reportData.map(p => [
            p.pupilName,
            p.className,
            p.adjustedFee,
            p.arrears,
            p.totalPaid,
            p.balance,
            p.status
        ]);

        doc.autoTable({
            startY: 45,
            head: [['Pupil', 'Class', 'Fee', 'Arrears', 'Paid', 'Balance', 'Status']],
            body: tableData,
            theme: 'grid',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [0, 178, 255] }
        });

        // Summary
        const totalExpected = reportData.reduce((sum, p) => sum + parseFloat(p.totalDue.replace(/[₦,]/g, '')), 0);
        const totalCollected = reportData.reduce((sum, p) => sum + parseFloat(p.totalPaid.replace(/[₦,]/g, '')), 0);
        const totalOutstanding = reportData.reduce((sum, p) => sum + parseFloat(p.balance.replace(/[₦,]/g, '')), 0);
        const collectionRate = totalExpected > 0 ? ((totalCollected / totalExpected) * 100).toFixed(1) : 0;

        const finalY = doc.lastAutoTable.finalY + 12;
        
        doc.setFontSize(12);
        doc.text('Summary', 14, finalY);
        
        doc.setFontSize(10);
        doc.text(`Pupils Processed:   ${processedCount}`, 14, finalY + 8);
        doc.text(`Pupils Skipped:     ${skippedCount}`, 14, finalY + 14);
        doc.text(`Total Expected:     ₦${totalExpected.toLocaleString()}`, 14, finalY + 20);
        doc.text(`Total Collected:    ₦${totalCollected.toLocaleString()}`, 14, finalY + 26);
        doc.text(`Total Outstanding:  ₦${totalOutstanding.toLocaleString()}`, 14, finalY + 32);
        doc.text(`Collection Rate:    ${collectionRate}%`, 14, finalY + 38);

        doc.save(`Financial_Report_${session.replace(/\//g, '-')}_${term}_${new Date().toISOString().split('T')[0]}.pdf`);
        
        window.showToast?.(`✓ PDF exported: ${reportData.length} pupils`, 'success');

    } catch (error) {
        console.error('❌ Error exporting PDF:', error);
        window.showToast?.('Failed to export PDF', 'danger');
    }
}

// Export and reporting
window.exportFinancialReport = exportFinancialReport;
window.printReceipt = printReceipt;

// Fee management
window.deleteFeeStructure = deleteFeeStructure;

// Section and data loaders
window.loadFeeManagementSection = loadFeeManagementSection;
window.loadPaymentRecordingSection = loadPaymentRecordingSection;
window.loadPupilsForPayment = loadPupilsForPayment;

// Initialization logs
console.log('✓ Financial management functions loaded');
console.log('✓ Finance section loaders initialized');

// ============================================
// MAKE FUNCTIONS GLOBALLY AVAILABLE
// ============================================

window.showSection = showSection;
window.setupSidebarNavigation = setupSidebarNavigation;
window.initializeAdminPortal = initializeAdminPortal;
window.loadSectionData = loadSectionData;

console.log('✓ Admin sidebar navigation - Teacher-style logic applied');

/* ======================================== 
   CLASS HIERARCHY MODULE (ADMIN ONLY)
======================================== */

window.classHierarchy = {
  /**
   * Initialize class hierarchy from classes collection
   */
  async initializeClassHierarchy() {
    try {
      console.log('🔧 Initializing class hierarchy...');
      
      // Check if hierarchy already exists
      const hierarchyDoc = await db.collection('settings').doc('classHierarchy').get();
      
      if (hierarchyDoc.exists && hierarchyDoc.data().orderedClassIds) {
        const orderedIds = hierarchyDoc.data().orderedClassIds;
        console.log(`✓ Class hierarchy loaded: ${orderedIds.length} classes`);
        return {
          success: true,
          isEmpty: orderedIds.length === 0,
          message: 'Hierarchy already exists'
        };
      }
      
      // Get all classes from classes collection
      const classesSnapshot = await db.collection('classes').orderBy('name').get();
      
      if (classesSnapshot.empty) {
        console.log('⚠️ No classes found - hierarchy empty');
        
        // Create empty hierarchy document
        await db.collection('settings').doc('classHierarchy').set({
          orderedClassIds: [],
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          success: true,
          isEmpty: true,
          message: 'No classes to initialize'
        };
      }
      
      // Create ordered list (alphabetical by default)
      const orderedClassIds = [];
      classesSnapshot.forEach(doc => {
        orderedClassIds.push(doc.id);
      });
      
      // Save to database
      await db.collection('settings').doc('classHierarchy').set({
        orderedClassIds: orderedClassIds,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✓ Class hierarchy initialized with ${orderedClassIds.length} classes`);
      
      return {
        success: true,
        isEmpty: false,
        count: orderedClassIds.length,
        message: 'Hierarchy initialized successfully'
      };
      
    } catch (error) {
      console.error('❌ Error initializing class hierarchy:', error);
      return {
        success: false,
        isEmpty: true,
        error: error.message
      };
    }
  },

  /**
   * Get the next class in progression
   */
  async getNextClass(currentClassName) {
    try {
      const hierarchyDoc = await db.collection('settings').doc('classHierarchy').get();
      
      if (!hierarchyDoc.exists || !hierarchyDoc.data().orderedClassIds) {
        console.warn('Class hierarchy not initialized');
        return null;
      }
      
      const orderedClassIds = hierarchyDoc.data().orderedClassIds;
      
      if (orderedClassIds.length === 0) {
        console.warn('Class hierarchy is empty');
        return null;
      }
      
      // Get all classes to map IDs to names
      const classesSnapshot = await db.collection('classes').get();
      const classesMap = {};
      
      classesSnapshot.forEach(doc => {
        classesMap[doc.id] = doc.data().name;
      });
      
      // Find current class ID by name
      let currentClassId = null;
      for (const [id, name] of Object.entries(classesMap)) {
        if (name === currentClassName) {
          currentClassId = id;
          break;
        }
      }
      
      if (!currentClassId) {
        console.warn(`Class "${currentClassName}" not found in database`);
        return null;
      }
      
      // Find current position in hierarchy
      const currentIndex = orderedClassIds.indexOf(currentClassId);
      
      if (currentIndex === -1) {
        console.warn(`Class "${currentClassName}" not in hierarchy order`);
        return null;
      }
      
      // Check if this is the last class (terminal)
      if (currentIndex === orderedClassIds.length - 1) {
        console.log(`Class "${currentClassName}" is terminal class`);
        return null;
      }
      
      // Get next class name
      const nextClassId = orderedClassIds[currentIndex + 1];
      const nextClassName = classesMap[nextClassId];
      
      console.log(`Next class after "${currentClassName}": "${nextClassName}"`);
      
      return nextClassName || null;
      
    } catch (error) {
      console.error('Error getting next class:', error);
      return null;
    }
  },

  /**
   * Check if a class is the terminal (last) class
   */
  async isTerminalClass(className) {
    try {
      const hierarchyDoc = await db.collection('settings').doc('classHierarchy').get();
      
      if (!hierarchyDoc.exists || !hierarchyDoc.data().orderedClassIds) {
        console.warn('Class hierarchy not initialized');
        return false;
      }
      
      const orderedClassIds = hierarchyDoc.data().orderedClassIds;
      
      if (orderedClassIds.length === 0) {
        return false;
      }
      
      // Get the last class in hierarchy
      const lastClassId = orderedClassIds[orderedClassIds.length - 1];
      
      // Get class name
      const classDoc = await db.collection('classes').doc(lastClassId).get();
      
      if (!classDoc.exists) {
        console.warn(`Terminal class ${lastClassId} not found`);
        return false;
      }
      
      const lastClassName = classDoc.data().name;
      
      const isTerminal = className === lastClassName;
      
      console.log(`Class "${className}" is terminal: ${isTerminal}`);
      
      return isTerminal;
      
    } catch (error) {
      console.error('Error checking terminal class:', error);
      return false;
    }
  },

  /**
   * Save class hierarchy order
   */
  async saveClassHierarchy(orderedClassIds) {
    try {
      if (!Array.isArray(orderedClassIds)) {
        throw new Error('orderedClassIds must be an array');
      }
      
      if (orderedClassIds.length === 0) {
        throw new Error('Cannot save empty class hierarchy');
      }
      
      // Validate all class IDs exist
      const classesSnapshot = await db.collection('classes').get();
      const validClassIds = new Set();
      
      classesSnapshot.forEach(doc => {
        validClassIds.add(doc.id);
      });
      
      const invalidIds = orderedClassIds.filter(id => !validClassIds.has(id));
      
      if (invalidIds.length > 0) {
        throw new Error(`Invalid class IDs: ${invalidIds.join(', ')}`);
      }
      
      // Save to database
      await db.collection('settings').doc('classHierarchy').set({
        orderedClassIds: orderedClassIds,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      console.log(`✓ Class hierarchy saved: ${orderedClassIds.length} classes`);
      
      return {
        success: true,
        count: orderedClassIds.length
      };
      
    } catch (error) {
      console.error('Error saving class hierarchy:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Get full hierarchy as ordered list
   */
  async getHierarchy() {
    try {
      const hierarchyDoc = await db.collection('settings').doc('classHierarchy').get();
      
      if (!hierarchyDoc.exists || !hierarchyDoc.data().orderedClassIds) {
        console.warn('Class hierarchy not initialized');
        return [];
      }
      
      const orderedClassIds = hierarchyDoc.data().orderedClassIds;
      
      if (orderedClassIds.length === 0) {
        return [];
      }
      
      // Get all classes
      const classesSnapshot = await db.collection('classes').get();
      
      const classesMap = {};
      classesSnapshot.forEach(doc => {
        classesMap[doc.id] = {
          id: doc.id,
          name: doc.data().name || 'Unnamed Class'
        };
      });
      
      // Build ordered list with names
      const hierarchy = [];
      orderedClassIds.forEach(classId => {
        if (classesMap[classId]) {
          hierarchy.push(classesMap[classId]);
        }
      });
      
      console.log(`✓ Retrieved hierarchy: ${hierarchy.length} classes`);
      
      return hierarchy;
      
    } catch (error) {
      console.error('Error getting hierarchy:', error);
      return [];
    }
  }
};

console.log('✓ Class hierarchy module initialized (admin only)');

/* ======================================== 
   HELPER FUNCTIONS - DECLARED FIRST!
======================================== */

/**
 * Moved to top to avoid hoisting issues
 */
function getClassIdFromPupilData(classData) {
  if (!classData) return null;
  if (typeof classData === 'object' && classData.id) {
    return classData.id;
  }
  return null;
}

/**
 * Splits a full name string into first, middle, and last name parts.
 * Convention: first token = first name, last token = last name,
 * anything in between = middle name. This matches the convention
 * already used elsewhere in the system (e.g. generatePupilCredentialsPDF
 * uses the last token as the surname).
 */
function splitPupilName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', middleName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], middleName: '', lastName: '' };
  }
  if (parts.length === 2) {
    return { firstName: parts[0], middleName: '', lastName: parts[1] };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1]
  };
}

window.splitPupilName = splitPupilName;

/**
 * Combines first, middle, and last name into a single full-name string,
 * in the same "First Middle Last" order the rest of the system expects
 * wherever it reads pupilData.name.
 */
function combinePupilName(firstName, middleName, lastName) {
  return [firstName, middleName, lastName]
    .map(p => (p || '').trim())
    .filter(Boolean)
    .join(' ');
}

window.combinePupilName = combinePupilName;

/**
 * RELIGION-BASED SUBJECT FILTERING
 */
function filterSubjectsByReligion(subjects, religion) {
  if (!Array.isArray(subjects) || subjects.length === 0) return subjects || [];

  const normalizedReligion = (religion || '').trim().toLowerCase();

  const isChristianRS = (name) => {
    const n = (name || '').toLowerCase();
    return (
      n.includes('christian religious') ||
      n === 'crs' ||
      n === 'crk' ||
      n.includes('bible knowledge')
    );
  };

  const isIslamicRS = (name) => {
    const n = (name || '').toLowerCase();
    return (
      n.includes('islamic religious') ||
      n === 'irs' ||
      n === 'irk' ||
      n.includes('islamic studies')
    );
  };

  if (normalizedReligion === 'muslim' || normalizedReligion === 'islam') {
    return subjects.filter(s => !isChristianRS(s));
  }

  if (normalizedReligion === 'christian' || normalizedReligion === 'christianity') {
    return subjects.filter(s => !isIslamicRS(s));
  }

  // Unspecified/"Other" — leave subjects untouched
  return subjects;
}

// Expose globally
window.filterSubjectsByReligion = filterSubjectsByReligion;

/**
 * Populate class dropdown with defensive checks
 */
async function populateClassDropdown(selectedClass = '') {
  const classSelect = document.getElementById('pupil-class');
  if (!classSelect) {
    console.warn('Class dropdown element not found');
    return;
  }

  try {
    const snapshot = await db.collection('classes').orderBy('name').get();
    classSelect.innerHTML = '<option value="">-- Select Class --</option>';

    if (snapshot.empty) {
      classSelect.innerHTML = '<option value="">No classes available - Create one first</option>';
      classSelect.disabled = true;
      window.showToast?.('Please create a class first', 'warning');
      return;
    }

    classSelect.disabled = false;
    snapshot.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = data.name || 'Unnamed Class';
      if (selectedClass && doc.id === selectedClass) {
        opt.selected = true;
      }
      classSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('Error populating class dropdown:', error);
    classSelect.innerHTML = '<option value="">Error loading classes</option>';
    classSelect.disabled = true;
    window.showToast?.('Failed to load classes. Please refresh the page.', 'danger');
  }
}

/**
 * Get class details with proper error handling
 */
async function getClassDetails(classId) {
  try {
    if (!classId) {
      console.warn('getClassDetails called with no classId');
      return null;
    }
    
    const doc = await db.collection('classes').doc(classId).get();
    
    if (!doc.exists) {
      console.warn(`Class ${classId} not found`);
      return null;
    }

    const data = doc.data();
    let teacherName = '';
    let teacherId = data.teacherId || '';

    if (teacherId) {
      try {
        const teacherDoc = await db.collection('teachers').doc(teacherId).get();
        if (teacherDoc.exists) {
          teacherName = teacherDoc.data().name || '';
        }
      } catch (teacherError) {
        console.error('Error fetching teacher:', teacherError);
      }
    }

    return {
      classId: doc.id,
      className: data.name || 'Unnamed Class',
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
      teacherId,
      teacherName
    };
  } catch (error) {
    console.error('Error in getClassDetails:', error);
    return null;
  }
}

/**
 * PAGINATION WITH MEMORY LEAK PREVENTION
 */

function paginateTable(data, tbodyId, itemsPerPage = 20, renderRowCallback) {
  const tbody = document.getElementById(tbodyId);
  
  if (!tbody || tbody.tagName !== 'TBODY') {
    console.error(`Invalid tbody element with id: ${tbodyId}`);
    return;
  }
  
  if (!Array.isArray(data)) {
    console.error('paginateTable: data must be an array');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--color-danger);">Invalid data format</td></tr>';
    return;
  }

  const safeFuncKey = tbodyId.replace(/[^a-zA-Z0-9_]/g, '_');
  const paginationFuncName = `changePage_${safeFuncKey}`;

  // Clean up existing pagination function to prevent memory leak
  if (window[paginationFuncName]) {
    delete window[paginationFuncName];
  }
  
  let currentPage = 1;
  const totalPages = Math.ceil(data.length / itemsPerPage) || 1;

  function renderPage(page) {
    tbody.innerHTML = '';
    
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    
    const start = (page - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    
    if (start >= data.length && data.length > 0) {
      renderPage(totalPages);
      return;
    }
    
    const pageData = data.slice(start, end);
    
    if (pageData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: var(--space-xl); color: var(--color-gray-600);">No data available</td></tr>';
      updatePaginationControls(1, 1);
      return;
    }
    
    pageData.forEach(item => {
      try {
        renderRowCallback(item, tbody);
      } catch (error) {
        console.error('Error rendering row:', error);
      }
    });
    
    updatePaginationControls(page, totalPages);
  }
  
  function updatePaginationControls(page, total) {
    const table = tbody.parentElement;
    if (!table) return;
    
    const container = table.parentElement;
    if (!container) return;
    
    let paginationContainer = container.querySelector(`#pagination-${safeFuncKey}`);
    
    if (!paginationContainer) {
      paginationContainer = document.createElement('div');
      paginationContainer.className = 'pagination';
      paginationContainer.id = `pagination-${safeFuncKey}`;
      container.appendChild(paginationContainer);
    }

    // Center the pagination controls
    paginationContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px 0;
      flex-wrap: wrap;
    `;

    if (total <= 1) {
      paginationContainer.innerHTML = '';
      paginationContainer.style.display = 'none';
      return;
    }

    paginationContainer.style.display = 'flex';

    paginationContainer.innerHTML = `
      <button
        class="pagination-prev"
        ${page === 1 ? 'disabled' : ''}
        aria-label="Previous page"
        style="padding:6px 16px; border:1.5px solid #e2e8f0; background:${page === 1 ? '#f8fafc' : 'white'}; border-radius:8px; cursor:${page === 1 ? 'not-allowed' : 'pointer'}; color:${page === 1 ? '#94a3b8' : '#0f172a'}; font-weight:600; font-size:0.875rem;">
        ← Prev
      </button>
      <span
        class="page-info"
        role="status"
        aria-live="polite"
        style="font-size:0.875rem; color:#64748b; font-weight:500; white-space:nowrap;">
        Page ${page} of ${total}
      </span>
      <button
        class="pagination-next"
        ${page === total ? 'disabled' : ''}
        aria-label="Next page"
        style="padding:6px 16px; border:1.5px solid #e2e8f0; background:${page === total ? '#f8fafc' : 'white'}; border-radius:8px; cursor:${page === total ? 'not-allowed' : 'pointer'}; color:${page === total ? '#94a3b8' : '#0f172a'}; font-weight:600; font-size:0.875rem;">
        Next →
      </button>
    `;

    // Use addEventListener instead of inline onclick to avoid identifier issues
    const prevBtn = paginationContainer.querySelector('.pagination-prev');
    const nextBtn = paginationContainer.querySelector('.pagination-next');

    if (prevBtn && page > 1) {
      prevBtn.addEventListener('click', function() {
        window[paginationFuncName](currentPage - 1);
      });
    }

    if (nextBtn && page < total) {
      nextBtn.addEventListener('click', function() {
        window[paginationFuncName](currentPage + 1);
      });
    }
  }
  
  // Expose page-change function using sanitized key
  window[paginationFuncName] = function(newPage) {
    if (newPage < 1 || newPage > totalPages) return;
    currentPage = newPage;
    renderPage(currentPage);
  };
  
  // Initial render
  renderPage(1);
  
  console.log(`✓ Pagination initialized for ${tbodyId} (${data.length} items, ${totalPages} pages)`);
}

// Export for use
window.paginateTable = paginateTable;

/**
 * Session history loader
 */
async function loadSessionHistory() {
  const tbody = document.getElementById('session-history-table');
  if (!tbody) {
    console.warn('Session history table not found');
    return;
  }
  
  tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Loading history...</td></tr>';
  
  try {
    const snapshot = await db.collection('sessions')
      .orderBy('startYear', 'desc')
      .limit(10)
      .get();
    
    tbody.innerHTML = '';
    
    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-gray-600);">No archived sessions yet</td></tr>';
      return;
    }
    
    snapshot.forEach(doc => {
      const data = doc.data();
      
      const startDate = data.startDate 
        ? data.startDate.toDate().toLocaleDateString('en-GB')
        : '-';
      
      const endDate = data.endDate 
        ? data.endDate.toDate().toLocaleDateString('en-GB')
        : '-';
      
      const status = data.status === 'archived' 
        ? '<span class="status-badge" style="background:#9e9e9e;">Archived</span>'
        : '<span class="status-badge" style="background:#4CAF50;">Active</span>';
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Session">${data.name || 'Unnamed Session'}</td>
        <td data-label="Start Date">${startDate}</td>
        <td data-label="End Date">${endDate}</td>
        <td data-label="Status">${status}</td>
      `;
      tbody.appendChild(tr);
    });
    
  } catch (error) {
    console.error('Error loading session history:', error);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-danger);">Error loading history</td></tr>';
    window.showToast?.('Failed to load session history', 'danger');
  }
}

/**
 * Alumni loader
 */
// Global variable to store all alumni data
let allAlumniData = [];

/**
 * Load Alumni (Client-Side Filtering)
 */
async function loadAlumni() {
  const tbody = document.getElementById('alumni-table');
  if (!tbody) {
    console.warn('Alumni table not found - section may not be visible');
    return;
  }
  
  tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Loading alumni...</td></tr>';
  
  try {
    // Query alumni directly instead of pulling the entire pupils collection
    // and throwing away everything that isn't alumni.
    const snapshot = await db.collection('pupils')
      .where('status', '==', 'alumni')
      .get();
    
    tbody.innerHTML = '';
    
    const alumni = [];
    snapshot.forEach(doc => {
      alumni.push({ id: doc.id, ...doc.data() });
    });
    
    if (alumni.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-gray-600);">No alumni yet. Pupils will appear here after graduating from terminal class.</td></tr>';
      allAlumniData = [];
      return;
    }
    
    // Sort by graduation date (newest first).
    alumni.sort((a, b) => {
      const dateA = a.graduationDate?.toMillis() || 0;
      const dateB = b.graduationDate?.toMillis() || 0;
      return dateB - dateA;
    });
    
    console.log(`✓ Loaded ${alumni.length} alumni directly (no longer scanning all pupils)`);
    
    allAlumniData = alumni;
    
    renderAlumniTable(allAlumniData);
    
  } catch (error) {
    console.error('Error loading alumni:', error);
    window.showToast?.('Failed to load alumni list', 'danger');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-danger);">Error loading alumni</td></tr>';
  }
}

/**
 * Render alumni table with pagination
 */
function renderAlumniTable(alumniData) {
  const tbody = document.getElementById('alumni-table');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (alumniData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-gray-600);">No alumni match your search</td></tr>';
    return;
  }
  
  paginateTable(alumniData, 'alumni-table', 20, (alum, tbody) => {
    const graduationDate = alum.graduationDate 
      ? alum.graduationDate.toDate().toLocaleDateString('en-GB')
      : '-';
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Name">${alum.name || 'Unknown'}</td>
      <td data-label="Final Class">${alum.finalClass || '-'}</td>
      <td data-label="Graduation Session">${alum.graduationSession || '-'}</td>
      <td data-label="Graduation Date">${graduationDate}</td>
      <td data-label="Actions">
        <button class="btn-small btn-danger" onclick="deleteAlumni('${alum.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Filter alumni by search term
 */
function filterAlumni() {
  const searchInput = document.getElementById('alumni-search');
  if (!searchInput) return;
  
  const searchTerm = searchInput.value.toLowerCase().trim();
  
  if (!searchTerm) {
    renderAlumniTable(allAlumniData);
    return;
  }
  
  // Filter by name or graduation session
  const filtered = allAlumniData.filter(alum => {
    const name = (alum.name || '').toLowerCase();
    const session = (alum.graduationSession || '').toLowerCase();
    
    return name.includes(searchTerm) || session.includes(searchTerm);
  });
  
  console.log(`Alumni search: "${searchTerm}" → ${filtered.length} of ${allAlumniData.length} matches`);
  
  renderAlumniTable(filtered);
  
  const countDisplay = document.getElementById('alumni-search-count');
  if (countDisplay) {
    countDisplay.textContent = filtered.length === allAlumniData.length 
      ? '' 
      : `Showing ${filtered.length} of ${allAlumniData.length}`;
  }
}

// Make functions globally available
window.filterAlumni = filterAlumni;
window.renderAlumniTable = renderAlumniTable;

/**
 * Delete Alumni (Non-Destructive Model)
 * Removes alumni status and restores to active pupil
 */
async function deleteAlumni(alumniId) {
  if (!alumniId) {
    window.showToast?.('Invalid alumni ID', 'warning');
    return;
  }

  if (!confirm(
    '⚠️ RESTORE PUPIL TO ACTIVE STATUS?\n\n' +
    'This will:\n' +
    '• Remove alumni status and restore to active\n' +
    '• Preserve all historical data\n\n' +
    '⚠️ The pupil will be restored WITHOUT a class assignment.\n' +
    'You must assign them to a class in the Pupils section\n' +
    'before they appear correctly in reports and fee calculations.\n\n' +
    'Continue?'
  )) return;

  try {
    const pupilDoc = await db.collection('pupils').doc(alumniId).get();
    if (!pupilDoc.exists) {
      window.showToast?.('Pupil record not found', 'danger');
      return;
    }

    await db.collection('pupils').doc(alumniId).update({
      status: 'active',
      isActive: true,

      'class.id': null,
      'class.name': 'UNASSIGNED — Please reassign',
      subjects: [],
      'assignedTeacher.id': null,
      'assignedTeacher.name': null,

      requiresClassAssignment: true,
      restoredFromAlumni: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    try {
      await db.collection('alumni').doc(alumniId).delete();
    } catch (indexError) {
      console.warn('Alumni index entry not found (OK):', indexError.message);
    }

    window.showToast?.(
      '✓ Pupil restored to active status.\n\n' +
      '⚠️ ACTION REQUIRED: Assign this pupil to a class\n' +
      'in the Pupils section before they appear in reports.',
      'warning',
      10000
    );

    loadAlumni();

  } catch (error) {
    console.error('Error restoring pupil:', error);
    window.handleError?.(error, 'Failed to restore pupil from alumni');
  }
}

// Make globally available
window.deleteAlumni = deleteAlumni;


/* ========================================
   SIDEBAR GROUP TOGGLE
======================================== */

/**
 * FIXED: Toggle sidebar group with proper state management
 */
function toggleSidebarGroup(button) {
  if (!button) {
    console.error('toggleSidebarGroup: button is null');
    return;
  }
  
  const content = button.nextElementSibling;
  
  if (!content) {
    console.error('toggleSidebarGroup: no content element found');
    return;
  }
  
  const isCollapsed = button.classList.contains('collapsed');
  
  if (isCollapsed) {
    // Expand the group
    button.classList.remove('collapsed');
    content.classList.add('active');
    button.setAttribute('aria-expanded', 'true');
  } else {
    // Collapse the group
    button.classList.add('collapsed');
    content.classList.remove('active');
    button.setAttribute('aria-expanded', 'false');
  }
}

// Make globally available
window.toggleSidebarGroup = toggleSidebarGroup;

/* ======================================== 
   DASHBOARD STATS 
======================================== */
async function loadDashboardStats() {
  console.log('📊 Loading dashboard stats...');

  // Wait a bit for DOM to be ready
  await new Promise(resolve => setTimeout(resolve, 100));

  const teacherCount = document.getElementById('teacher-count');
  const pupilCount = document.getElementById('pupil-count');
  const classCount = document.getElementById('class-count');
  const announceCount = document.getElementById('announce-count');

  if (!teacherCount || !pupilCount || !classCount || !announceCount) {
    console.error('❌ Dashboard stat elements missing!');
    return;
  }

  const CACHE_KEY = 'fahmid_dashboard_stats_cache';
  const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

  // Show cached numbers immediately (if we have any and they're not too old)
  let cachedStats = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      cachedStats = JSON.parse(raw);
      const age = Date.now() - (cachedStats.savedAt || 0);
      if (age < CACHE_MAX_AGE_MS) {
        teacherCount.textContent = cachedStats.teachers;
        pupilCount.textContent = cachedStats.pupils;
        classCount.textContent = cachedStats.classes;
        announceCount.textContent = cachedStats.announcements;
        console.log('✓ Dashboard stats shown from cache while fresh data loads...');
      } else {
        cachedStats = null; // too old — treat as if there's no cache
      }
    }
  } catch (e) {
    console.warn('⚠️ Could not read dashboard stats cache:', e.message);
    cachedStats = null;
  }

  // Only show spinners if we had nothing cached to show in the meantime
  if (!cachedStats) {
    teacherCount.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div>';
    pupilCount.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div>';
    classCount.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div>';
    announceCount.innerHTML = '<div class="spinner" style="width:20px; height:20px;"></div>';
  }

  try {
    const teachersSnap = await db.collection('teachers').get();
    const allPupilsSnap = await db.collection('pupils').get();

    let activePupilCount = 0;
    allPupilsSnap.forEach(doc => {
      const data = doc.data();
      if (data.status !== 'alumni') {
        activePupilCount++;
      }
    });

    const classesSnap = await db.collection('classes').get();
    const announcementsSnap = await db.collection('announcements').get();

    const freshStats = {
      teachers: teachersSnap.size,
      pupils: activePupilCount,
      classes: classesSnap.size,
      announcements: announcementsSnap.size,
      savedAt: Date.now()
    };

    if (!cachedStats || cachedStats.teachers !== freshStats.teachers) {
      teacherCount.textContent = freshStats.teachers;
    }
    if (!cachedStats || cachedStats.pupils !== freshStats.pupils) {
      pupilCount.textContent = freshStats.pupils;
    }
    if (!cachedStats || cachedStats.classes !== freshStats.classes) {
      classCount.textContent = freshStats.classes;
    }
    if (!cachedStats || cachedStats.announcements !== freshStats.announcements) {
      announceCount.textContent = freshStats.announcements;
    }

    // Save the fresh numbers for next time
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(freshStats));
    } catch (e) {
      console.warn('⚠️ Could not save dashboard stats cache:', e.message);
    }

    console.log(
      `✅ Dashboard stats loaded: ${freshStats.pupils} active pupils ` +
      `(${allPupilsSnap.size - freshStats.pupils} alumni)`
    );

  } catch (error) {
    console.error('❌ Error loading dashboard stats:', error);
    window.showToast?.('Failed to load dashboard statistics', 'danger');

    if (!cachedStats) {
      teacherCount.textContent = '!';
      pupilCount.textContent = '!';
      classCount.textContent = '!';
      announceCount.textContent = '!';
    }
  }
}

/* ======================================== 
   TEACHERS MANAGEMENT 
======================================== */
function showTeacherForm() {
  const form = document.getElementById('teacher-form');
  if (!form) return;

  // Reset form and hidden id
  document.getElementById('add-teacher-form').reset();
  document.getElementById('teacher-id').value = '';
  document.getElementById('teacher-form-title').innerHTML = '<i data-lucide="user-plus" style="width:16px;height:16px;"></i> Add New Teacher';
  document.getElementById('save-teacher-btn').textContent = 'Save Teacher';

  // Set today as default date joined
  const dateJoinedInput = document.getElementById('teacher-date-joined');
  if (dateJoinedInput && !dateJoinedInput.value) {
    dateJoinedInput.value = new Date().toISOString().split('T')[0];
  }

  // Show credentials section (new teacher mode)
  const credentialsSection = document.getElementById('teacher-credentials-section');
  if (credentialsSection) credentialsSection.style.display = 'block';

  // Reset password field to required
  const passwordField = document.getElementById('teacher-password');
  if (passwordField) {
    passwordField.setAttribute('required', '');
    passwordField.value = '';
  }

  // Reset email to editable
  const emailField = document.getElementById('teacher-email');
  if (emailField) {
    emailField.removeAttribute('readonly');
    emailField.style.background = '';
    emailField.style.color = '';
  }

  // Hide the edit-mode note if present
  const editNote = document.getElementById('teacher-credentials-edit-note');
  if (editNote) editNote.style.display = 'none';

  form.style.display = 'block';
  document.getElementById('teacher-name')?.focus();

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function cancelTeacherForm() {
  document.getElementById('teacher-form').style.display = 'none';
  document.getElementById('add-teacher-form').reset();
  document.getElementById('teacher-id').value = '';
  document.getElementById('teacher-form-title').innerHTML = '<i data-lucide="user-plus" style="width:16px;height:16px;"></i> Add New Teacher';
  document.getElementById('save-teacher-btn').textContent = 'Save Teacher';

  // Reset credentials section to default state
  const credentialsSection = document.getElementById('teacher-credentials-section');
  if (credentialsSection) credentialsSection.style.display = 'block';

  const passwordField = document.getElementById('teacher-password');
  if (passwordField) passwordField.setAttribute('required', '');

  const emailField = document.getElementById('teacher-email');
  if (emailField) {
    emailField.removeAttribute('readonly');
    emailField.style.background = '';
    emailField.style.color = '';
  }

  const editNote = document.getElementById('teacher-credentials-edit-note');
  if (editNote) editNote.style.display = 'none';
}

/* =====================================================
   TEACHER FORM HANDLER
===================================================== */

document.addEventListener('DOMContentLoaded', () => {
  console.log('📝 Setting up teacher form handler...');

  const teacherForm = document.getElementById('add-teacher-form');

  if (!teacherForm) {
    console.warn('⚠️ Teacher form not found');
    return;
  }

  // Remove old handlers by cloning
  const newTeacherForm = teacherForm.cloneNode(true);
  teacherForm.parentNode.replaceChild(newTeacherForm, teacherForm);

  const freshForm = document.getElementById('add-teacher-form');

  freshForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('🎯 Teacher form submitted');

    const teacherId  = document.getElementById('teacher-id')?.value;
    const name       = document.getElementById('teacher-name')?.value.trim();
    const gender     = document.getElementById('teacher-gender')?.value;
    const dob        = document.getElementById('teacher-dob')?.value || '';
    const contact    = document.getElementById('teacher-contact')?.value.trim() || '';
    const address    = document.getElementById('teacher-address')?.value.trim() || '';
    const employeeId = document.getElementById('teacher-employee-id')?.value.trim() || '';
    const dateJoined = document.getElementById('teacher-date-joined')?.value || '';
    const roleTitle  = document.getElementById('teacher-role-title')?.value || 'Class Teacher';
    const status     = document.getElementById('teacher-status')?.value || 'Active';
    const qualification   = document.getElementById('teacher-qualification')?.value || '';
    const specialization  = document.getElementById('teacher-specialization')?.value.trim() || '';
    const notes      = document.getElementById('teacher-notes')?.value.trim() || '';
    const email      = document.getElementById('teacher-email')?.value.trim();
    const tempPassword = document.getElementById('teacher-password')?.value;

    // Validation
    if (!name || !gender || !dateJoined || !email) {
      window.showToast?.('Full Name, Gender, Date Joined, and Email are required.', 'warning');
      return;
    }

    if (!teacherId && !tempPassword) {
      window.showToast?.('Temporary password is required for new teachers.', 'warning');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      window.showToast?.('Please enter a valid email address', 'warning');
      return;
    }

    const submitBtn = freshForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="btn-loading">Saving...</span>';
    }

    try {
      const teacherData = {
        name,
        gender,
        dob,
        contact,
        address,
        employeeId,
        dateJoined,
        roleTitle,
        status,
        qualification,
        specialization,
        notes,
        email,
      };

      if (teacherId) {
        console.log(`📝 Updating teacher: ${teacherId}`);

        // Previously: a Firestore update() straight from the
        // browser. Now: one PATCH call. validateTeacherPayload()
        // on the Worker had to be extended this phase to even
        // accept most of these fields (gender, dob, contact,
        // address, employeeId, dateJoined, roleTitle, status,
        // qualification, specialization, notes) — before that fix,
        // every one of them would have been silently stripped out
        // by the Worker's validation, discarding most of what this
        // form actually submits.
        await adminApiPatch(`/api/admin/teachers/${encodeURIComponent(teacherId)}`, teacherData);

        window.showToast?.(`✓ Teacher "${name}" updated successfully`, 'success');

      } else {
        // ── CREATE NEW TEACHER ────────────────────────────────────
        // NOTE: teacher creation is intentionally NOT converted in
        // this phase. It provisions a Firebase Auth account via a
        // client-side "secondary app" workaround (window.
        // createSecondaryUser) — moving account creation to the
        // Worker is a separate, security-sensitive piece of work
        // (it needs the Identity Toolkit REST API via a service
        // account) that deserves its own careful phase rather than
        // being folded into an edit-form conversion. This branch
        // still talks to Firestore/Firebase Auth directly, exactly
        // as before.
        console.log(`🚀 Creating new teacher: ${name} (${email})`);

        // Check for duplicate email
        const existingUsers = await db.collection('users').where('email', '==', email).get();
        if (!existingUsers.empty) {
          window.showToast?.('This email is already registered', 'warning');
          return;
        }

        if (typeof window.createSecondaryUser !== 'function') {
          throw new Error('User creation system not ready. Please refresh the page and try again.');
        }

        const uid = await window.createSecondaryUser(email, tempPassword);
        if (!uid) throw new Error('User creation returned no UID');

        console.log(`✓ User account created: ${uid}`);

        await db.collection('users').doc(uid).set({
          email,
          role: 'teacher',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        teacherData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        teacherData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('teachers').doc(uid).set(teacherData);

        console.log('✓ Teacher profile created');

        window.showToast?.(
          `✓ Teacher "${name}" added successfully!\n\nPassword reset email sent to ${email}`,
          'success',
          6000
        );
      }

      freshForm.reset();
      document.getElementById('teacher-id').value = '';
      document.getElementById('teacher-form').style.display = 'none';

      await loadTeachers();
      await loadDashboardStats();

    } catch (error) {
      console.error('❌ TEACHER SAVE FAILED:', error);

      let errorMessage = teacherId ? 'Failed to update teacher' : 'Failed to add teacher';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters';
      } else if (error.message) {
        errorMessage = error.message;
      }

      window.showToast?.(errorMessage, 'danger', 5000);

    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = teacherId ? 'Update Teacher' : 'Save Teacher';
      }
    }
  });

  console.log('✅ Teacher form handler registered');
});

/* =====================================================
   CRITICAL FIX #4: PUPIL FORM HANDLER
   Same improvements as teacher form
===================================================== */

document.addEventListener('DOMContentLoaded', () => {
  console.log('📝 Setting up pupil form handler...');
  
  const pupilForm = document.getElementById('add-pupil-form');
  
  if (!pupilForm) {
    console.warn('⚠️ Pupil form not found');
    return;
  }
  
  // Remove old handlers by cloning
  const newPupilForm = pupilForm.cloneNode(true);
  pupilForm.parentNode.replaceChild(newPupilForm, pupilForm);
  
  const freshForm = document.getElementById('add-pupil-form');
  
  freshForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('🎯 Pupil form submitted');
    
    // Get form values
    const pupilId = document.getElementById('pupil-id')?.value;

    // Read the three name boxes and combine them into the
    // same "name" field the rest of the system already expects.
    const firstName = document.getElementById('pupil-first-name')?.value.trim() || '';
    const middleName = document.getElementById('pupil-middle-name')?.value.trim() || '';
    const lastName = document.getElementById('pupil-last-name')?.value.trim() || '';
    const name = window.combinePupilName(firstName, middleName, lastName);

    const admissionNo = document.getElementById('pupil-admission-no')?.value.trim();
    const classId = document.getElementById('pupil-class')?.value;
    const email = document.getElementById('pupil-email')?.value.trim();
    const password = document.getElementById('pupil-password')?.value;

    // Religion — used to filter out the mismatched Religious Studies subject
    const religion = document.getElementById('pupil-religion')?.value || '';
    
    // Validation
    if (!firstName || !lastName || !classId) {
      console.warn('⚠️ Form validation failed');
      window.showToast?.('First name, last name, and class are required', 'warning');
      return;
    }
    
    // For new pupils, email and password are required
    if (!pupilId && (!email || !password)) {
      console.warn('⚠️ Email and password required for new pupils');
      window.showToast?.('Email and password required for new pupils', 'warning');
      return;
    }
    
    console.log(`📋 ${pupilId ? 'Updating' : 'Creating'} pupil: ${name}`);
    
    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        console.warn('⚠️ Invalid email format');
        window.showToast?.('Please enter a valid email address', 'warning');
        return;
      }
    }
    
    // Check for duplicate admission number
    if (admissionNo) {
      try {
        const duplicateSnap = await db.collection('pupils')
          .where('admissionNo', '==', admissionNo)
          .limit(1)
          .get();
        
        if (!duplicateSnap.empty) {
          const existingPupilId = duplicateSnap.docs[0].id;
          
          if (!pupilId || pupilId !== existingPupilId) {
            console.warn('⚠️ Duplicate admission number');
            window.showToast?.(
              `Admission number "${admissionNo}" is already assigned`,
              'danger',
              5000
            );
            return;
          }
        }
      } catch (error) {
        console.error('Error checking admission number:', error);
      }
    }
    
    // Get submit button
    const submitBtn = freshForm.querySelector('button[type="submit"]');
    
    // Disable button and show loading
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="btn-loading">Saving pupil...</span>';
    }
    
    try {
      // Get current session settings (needed for admissionTerm/admissionSession defaults)
      const settings = await window.getCurrentSettings();

      // Get class details
      const classDoc = await db.collection('classes').doc(classId).get();
      
      if (!classDoc.exists) {
        throw new Error('Selected class not found');
      }
      
      const classData = classDoc.data();
      
      // Get teacher info
      let teacherId = classData.teacherId || '';
      let teacherName = classData.teacherName || '';
      
      if (teacherId && !teacherName) {
        const teacherDoc = await db.collection('teachers').doc(teacherId).get();
        if (teacherDoc.exists) {
          teacherName = teacherDoc.data().name || '';
        }
      }

      // Filter class subjects by this pupil's religion so they never get
      // assigned the Religious Studies subject that doesn't match their faith.
      const rawClassSubjects = Array.isArray(classData.subjects) ? classData.subjects : [];
      const filteredSubjects = window.filterSubjectsByReligion
        ? window.filterSubjectsByReligion(rawClassSubjects, religion)
        : rawClassSubjects;
      
      // Build pupil data
      const pupilData = {
          admissionNo,
          name,
          firstName,
          middleName,
          lastName,
          dob: document.getElementById('pupil-dob')?.value || '',
          gender: document.getElementById('pupil-gender')?.value || '',
          religion: religion,
          parentName: document.getElementById('pupil-parent-name')?.value.trim() || '',
          parentEmail: document.getElementById('pupil-parent-email')?.value.trim() || '',
          contact: document.getElementById('pupil-contact')?.value.trim() || '',
          address: document.getElementById('pupil-address')?.value.trim() || '',
          class: {
              id: classId,
              name: classData.name || 'Unknown Class'
          },
          subjects: filteredSubjects,
          assignedTeacher: {
              id: teacherId,
              name: teacherName
          },

          admissionTerm: document.getElementById('pupil-admission-term')?.value || settings.term || 'First Term',
          admissionSession: settings.session || null,
          exitTerm: document.getElementById('pupil-exit-term')?.value || 'Third Term',
          feeAdjustmentPercent: parseFloat(document.getElementById('pupil-fee-adjustment-percent')?.value) || 0,
          feeAdjustmentAmount: parseFloat(document.getElementById('pupil-fee-adjustment-amount')?.value) || 0,

          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      if (pupilId) {
        // UPDATE EXISTING PUPIL
        console.log(`📝 Updating pupil: ${pupilId}`);
        
        await db.collection('pupils').doc(pupilId).update(pupilData);
        
        console.log('✓ Pupil updated');
        window.showToast?.(`✓ Pupil "${name}" updated successfully`, 'success');
        
      } else {
        // CREATE NEW PUPIL
        console.log('🚀 Creating new pupil...');
        
        // Check for duplicate email
        const existingUsers = await db.collection('users')
          .where('email', '==', email)
          .get();
        
        if (!existingUsers.empty) {
          throw new Error('This email is already registered');
        }
        
        // CRITICAL: Check if createSecondaryUser exists
        if (typeof window.createSecondaryUser !== 'function') {
          throw new Error(
            'User creation system not ready. Please refresh the page and try again.'
          );
        }
        
        // Create user account
        console.log('📝 Calling createSecondaryUser...');
        const uid = await window.createSecondaryUser(email, password);
        
        if (!uid) {
          throw new Error('User creation returned no UID');
        }
        
        console.log(`✓ User account created: ${uid}`);
        
        // Create user document
        await db.collection('users').doc(uid).set({
          email,
          role: 'pupil',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✓ User document created');
        
        // Create pupil profile
        pupilData.email = email;
        pupilData.createdAt = firebase.firestore.FieldValue.serverTimestamp();

        await db.collection('pupils').doc(uid).set(pupilData);

        console.log('✓ Pupil profile created');

        // Auto-create payment record using permanent fee structure ID
        try {
          const settings = await window.getCurrentSettings();
          const session = settings.session;
          const term = settings.term;
          
          // Use permanent class-based fee structure ID (not session-based)
          const feeDocId = `fee_${classId}`;
          const feeDoc = await db.collection('fee_structures').doc(feeDocId).get();
          
          if (feeDoc.exists) {
            const feeData = feeDoc.data();
            const baseFee = Number(feeData.total) || 0;
            
            // Calculate adjusted fee for this specific pupil
            const amountDue = window.calculateAdjustedFee
              ? window.calculateAdjustedFee(pupilData, baseFee, term)
              : baseFee;
            
            if (amountDue === 0 && baseFee > 0) {
              console.log(`ℹ️ Pupil not enrolled for ${term}, skipping payment record`);
            } else {
              console.log(`✓ Found fee structure for ${classData.name}: ₦${baseFee.toLocaleString()}`);
              
              // Calculate arrears from previous session
              const previousSession = getPreviousSessionName(session);
              let arrears = 0;
              if (previousSession && typeof window.calculateCompleteArrears === 'function') {
                arrears = await window.calculateCompleteArrears(uid, session, term);
              }
              
              const encodedSession = session.replace(/\//g, '-');
              const paymentDocId = `${uid}_${encodedSession}_${term}`;
              
              await db.collection('payments').doc(paymentDocId).set({
                pupilId: uid,
                pupilName: name,
                classId: classId,
                className: classData.name,
                session: session,
                term: term,
                baseFee: baseFee,
                adjustedFee: amountDue,
                amountDue: amountDue,
                arrears: arrears,
                totalDue: amountDue + arrears,
                totalPaid: 0,
                balance: amountDue + arrears,
                status: arrears > 0 ? 'owing_with_arrears' : 'owing',
                lastPaymentDate: null,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
              
              console.log(`✓ Auto-created payment record: ₦${amountDue.toLocaleString()} (arrears: ₦${arrears.toLocaleString()})`);
            }
          } else {
            console.log(`ℹ️ No fee structure configured for ${classData.name} yet`);
          }
        } catch (paymentError) {
          console.error('⚠️ Failed to auto-create payment record:', paymentError);
          // Do not throw — pupil was created successfully
        }
        
        window.showToast?.(
          `✓ Pupil "${name}" added successfully!\n\nPassword reset email sent to ${email}`,
          'success',
          6000
        );
      }
      
      // Reset form and hide
      freshForm.reset();
      document.getElementById('pupil-form').style.display = 'none';
      
      // Reload data
      await loadPupils();
      await loadDashboardStats();
      
    } catch (error) {
      console.error('❌ PUPIL SAVE FAILED:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      
      // Handle specific errors
      let errorMessage = 'Failed to save pupil';
      
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      window.showToast?.(errorMessage, 'danger', 5000);
      
    } finally {
      // Re-enable button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = pupilId ? 'Update Pupil' : 'Save Pupil';
      }
    }
  });
  
  console.log('✅ Pupil form handler registered');
});

// Global variable to store all teachers data
let allTeachersData = [];

async function loadTeachers() {
  const tbody = document.getElementById('teachers-table');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="5" class="table-loading">Loading teachers...</td></tr>';
  
  try {
    // Previously: a direct Firestore read of the whole teachers
    // collection. The Worker's listTeachers() didn't exist before
    // this phase — admin.js was the only thing that ever listed
    // teachers, and it always did so straight from the browser.
    const { teachers } = await adminApiGet('/api/admin/teachers');
    tbody.innerHTML = '';

    if (teachers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-gray-600);">No teachers registered yet. Add one above.</td></tr>';
      allTeachersData = [];
      return;
    }

    // listTeachers() already returns { uid, ...data } sorted by
    // name — but renderTeachersTable()/editTeacher() below read
    // teacher.id, so that's kept here for compatibility.
    allTeachersData = teachers.map(t => ({ id: t.uid, ...t }));

    renderTeachersTable(allTeachersData);
    
  } catch (error) {
    console.error('Error loading teachers:', error);
    window.showToast?.('Failed to load teachers list. Check connection and try again.', 'danger');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-danger);">Error loading teachers - please refresh</td></tr>';
  }
}

/**
 * Render teachers table with pagination
 */
function renderTeachersTable(teachersData) {
  const tbody = document.getElementById('teachers-table');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (teachersData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--color-gray-600);">No teachers match your search</td></tr>';
    return;
  }

  paginateTable(teachersData, 'teachers-table', 20, (teacher, tbody) => {
    const statusColor = {
      'Active':     '#16a34a',
      'On Leave':   '#d97706',
      'Suspended':  '#dc2626',
      'Resigned':   '#64748b'
    }[teacher.status] || '#64748b';

    const statusBadge = teacher.status
      ? `<span style="background:${statusColor};color:white;padding:2px 8px;border-radius:999px;font-size:0.6875rem;font-weight:700;">${teacher.status}</span>`
      : '<span style="color:#94a3b8;">—</span>';

    const canDirectPublish = teacher.canDirectPublish === true;

    const toggleStyle = canDirectPublish
      ? 'background:#16a34a; color:white; border:none; padding:4px 10px; border-radius:999px; font-size:0.6875rem; font-weight:700; cursor:pointer;'
      : 'background:#e2e8f0; color:#64748b; border:none; padding:4px 10px; border-radius:999px; font-size:0.6875rem; font-weight:700; cursor:pointer;';

    const toggleLabel = canDirectPublish ? '✓ Enabled' : 'Disabled';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Name"><strong>${teacher.name}</strong></td>
      <td data-label="Email">${teacher.email}</td>
      <td data-label="Role">${teacher.roleTitle || 'Class Teacher'}</td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Direct Publish" style="text-align:center;">
        <button
          style="${toggleStyle}"
          onclick="toggleDirectPublish('${teacher.id}', ${canDirectPublish})"
          title="${canDirectPublish ? 'Click to disable direct publishing of results' : 'Click to allow direct publishing of results without approval'}">
          ${toggleLabel}
        </button>
      </td>
      <td data-label="Actions">
        <button class="btn-small btn-primary" onclick="editTeacher('${teacher.id}')">Edit</button>
        <button class="btn-small btn-danger" onclick="deleteItem('teachers', '${teacher.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Toggle a teacher's ability to publish results directly without admin approval.
 */
async function toggleDirectPublish(teacherId, currentValue) {
  const newValue = !currentValue;
  const action = newValue ? 'ENABLE' : 'DISABLE';

  const teacher = allTeachersData.find(t => t.id === teacherId);
  const teacherName = teacher ? teacher.name : 'this teacher';

  const confirmed = confirm(
    `${action} Direct Publishing for ${teacherName}?\n\n` +
    (newValue
      ? 'This teacher will be able to publish results DIRECTLY to pupils\nwithout waiting for your approval.\n\nUse this when you trust the teacher or are unavailable.'
      : 'This teacher will go back to the normal approval workflow.\nAll new submissions will require your approval before pupils can see results.')
  );

  if (!confirmed) return;

  try {
    // Previously: an update() plus a separate hand-built audit_log
    // write, both from the browser, with the browser itself
    // stamping directPublishUpdatedAt/By. Now: one PATCH call — the
    // Worker stamps those two fields from the verified admin's own
    // token (never trusting a client-supplied uid/timestamp) and
    // writes the audit entry itself. See the PATCH handler in
    // backend/api/admin-routes.js.
    await adminApiPatch(`/api/admin/teachers/${encodeURIComponent(teacherId)}`, {
      canDirectPublish: newValue,
    });

    window.showToast?.(
      `✓ Direct publishing ${newValue ? 'enabled' : 'disabled'} for ${teacherName}`,
      'success',
      5000
    );

    await loadTeachers();

  } catch (error) {
    console.error('Error toggling direct publish:', error);
    window.showToast?.('Failed to update teacher permission', 'danger');
  }
}

window.toggleDirectPublish = toggleDirectPublish;

async function editTeacher(uid) {
  const myToken = ++_teacherEditToken;
  try {
    console.log(`📝 Loading teacher for edit: ${uid}`);

    const { teacher: data } = await adminApiGet(`/api/admin/teachers/${encodeURIComponent(uid)}`);
    if (!data) throw new Error('Teacher not found');
    if (myToken !== _teacherEditToken) return; // a newer edit click superseded this one

    document.getElementById('teacher-id').value = uid;
    document.getElementById('teacher-name').value        = data.name || '';
    document.getElementById('teacher-gender').value      = data.gender || '';
    document.getElementById('teacher-dob').value         = data.dob || '';
    document.getElementById('teacher-contact').value     = data.contact || '';
    document.getElementById('teacher-address').value     = data.address || '';
    document.getElementById('teacher-employee-id').value = data.employeeId || '';
    document.getElementById('teacher-date-joined').value = data.dateJoined || '';
    document.getElementById('teacher-role-title').value  = data.roleTitle || 'Class Teacher';
    document.getElementById('teacher-status').value      = data.status || 'Active';
    document.getElementById('teacher-qualification').value  = data.qualification || '';
    document.getElementById('teacher-specialization').value = data.specialization || '';
    document.getElementById('teacher-notes').value       = data.notes || '';

    // --- EDIT MODE: handle credentials section ---
    const emailField = document.getElementById('teacher-email');
    if (emailField) {
      emailField.value = data.email || '';
      emailField.setAttribute('readonly', '');
      emailField.style.background = '#f1f5f9';
      emailField.style.color = '#64748b';
    }

    // Hide password field entirely — not needed when editing
    const credentialsSection = document.getElementById('teacher-credentials-section');
    if (credentialsSection) credentialsSection.style.display = 'none';

    // Show an informational note instead
    const editNote = document.getElementById('teacher-credentials-edit-note');
    if (editNote) {
      editNote.style.display = 'block';
      editNote.innerHTML = `
        <div style="padding:0.75rem 1rem; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; font-size:0.8125rem; color:#1e40af; margin-bottom:0.5rem;">
          <strong>🔒 Login credentials cannot be changed here.</strong><br>
          Email: <strong>${data.email || 'Not set'}</strong><br>
          To reset the teacher's password, ask them to use "Forgot Password" on the login page.
        </div>
      `;
    }

    // Password not required when editing
    const passwordField = document.getElementById('teacher-password');
    if (passwordField) {
      passwordField.removeAttribute('required');
      passwordField.value = '';
    }

    document.getElementById('teacher-form-title').innerHTML = `<i data-lucide="pencil" style="width:16px;height:16px;"></i> Edit Teacher: ${data.name}`;
    document.getElementById('save-teacher-btn').textContent = 'Update Teacher';

    document.getElementById('teacher-form').style.display = 'block';
    document.getElementById('teacher-name')?.focus();

    if (typeof lucide !== 'undefined') lucide.createIcons();

    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (error) {
    console.error('❌ Error loading teacher for edit:', error);
    window.showToast?.('Failed to load teacher details for editing', 'danger');
  }
}

window.editTeacher = editTeacher;

/**
 * Export all teachers data to PDF
 */
async function exportTeachersPDF() {
  try {
    if (typeof window.jspdf === 'undefined') {
      window.showToast?.('PDF library not loaded. Please refresh the page.', 'danger');
      return;
    }

    window.showToast?.('Preparing teachers PDF...', 'info', 2000);

    const snapshot = await db.collection('teachers').orderBy('name').get();

    if (snapshot.empty) {
      window.showToast?.('No teachers found to export.', 'warning');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    // ── Header ────────────────────────────────────────────────────────────
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('FAHMID NURSERY & PRIMARY SCHOOL', 148, 14, { align: 'center' });

    doc.setFontSize(12);
    doc.text('Staff Directory', 148, 22, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB', { year:'numeric', month:'long', day:'numeric' })}`, 148, 28, { align: 'center' });

    // ── Table ─────────────────────────────────────────────────────────────
    const tableData = [];
    snapshot.forEach(doc_ => {
      const d = doc_.data();
      tableData.push([
        d.name           || '—',
        d.gender         || '—',
        d.roleTitle      || 'Class Teacher',
        d.qualification  || '—',
        d.specialization || '—',
        d.contact        || '—',
        d.email          || '—',
        d.employeeId     || '—',
        d.dateJoined     || '—',
        d.status         || 'Active'
      ]);
    });

    doc.autoTable({
      startY: 34,
      head: [[
        'Full Name',
        'Gender',
        'Role',
        'Qualification',
        'Specialization',
        'Phone',
        'Email',
        'Staff No.',
        'Date Joined',
        'Status'
      ]],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2.5,
        valign: 'middle',
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: [26, 58, 110],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8
      },
      alternateRowStyles: {
        fillColor: [245, 247, 250]
      },
      columnStyles: {
        0: { cellWidth: 36 },  // Name
        1: { cellWidth: 16 },  // Gender
        2: { cellWidth: 28 },  // Role
        3: { cellWidth: 28 },  // Qualification
        4: { cellWidth: 26 },  // Specialization
        5: { cellWidth: 24 },  // Phone
        6: { cellWidth: 40 },  // Email
        7: { cellWidth: 22 },  // Staff No
        8: { cellWidth: 20 },  // Date Joined
        9: { cellWidth: 16 }   // Status
      }
    });

    // ── Footer on each page ───────────────────────────────────────────────
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Page ${i} of ${pageCount}   |   Total Staff: ${snapshot.size}   |   Fahmid Nursery & Primary School`,
        148,
        doc.internal.pageSize.getHeight() - 6,
        { align: 'center' }
      );
    }

    doc.save(`Teachers_Directory_${new Date().toISOString().split('T')[0]}.pdf`);

    window.showToast?.(`✓ PDF exported: ${snapshot.size} teacher(s)`, 'success');

  } catch (error) {
    console.error('❌ Error exporting teachers PDF:', error);
    window.showToast?.('Failed to export PDF. Please try again.', 'danger');
  }
}

window.exportTeachersPDF = exportTeachersPDF;

/**
 * Filter teachers by search term
 */
function filterTeachers() {
  const searchInput = document.getElementById('teachers-search');
  if (!searchInput) return;
  
  const searchTerm = searchInput.value.toLowerCase().trim();
  
  if (!searchTerm) {
    renderTeachersTable(allTeachersData);
    return;
  }
  
  // Filter by name only
  const filtered = allTeachersData.filter(teacher => {
    const name = (teacher.name || '').toLowerCase();
    return name.includes(searchTerm);
  });
  
  console.log(`Teachers search: "${searchTerm}" → ${filtered.length} of ${allTeachersData.length} matches`);
  
  renderTeachersTable(filtered);
  
  const countDisplay = document.getElementById('teachers-search-count');
  if (countDisplay) {
    countDisplay.textContent = filtered.length === allTeachersData.length 
      ? '' 
      : `Showing ${filtered.length} of ${allTeachersData.length}`;
  }
}

// Make functions globally available
window.filterTeachers = filterTeachers;
window.renderTeachersTable = renderTeachersTable;

/**
 * Generate a printable PDF of pupil login credentials (admission number + password)
 * Password format: surname + year of birth (e.g. ogunwale2015)
 */
async function generatePupilCredentialsPDF() {
  const btn = document.getElementById('generate-credentials-pdf-btn');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loading">Generating PDF...</span>';
  }

  try {
    if (typeof window.jspdf === 'undefined') {
      window.showToast?.('PDF library not loaded. Please refresh the page.', 'danger');
      return;
    }

    window.showToast?.('Preparing pupil credentials PDF...', 'info', 2000);

    const pupilsSnap = await db.collection('pupils').orderBy('name').get();

    if (pupilsSnap.empty) {
      window.showToast?.('No pupils found', 'warning');
      return;
    }

    const pupilsByClass = {};
    let skippedCount = 0;

    pupilsSnap.forEach(doc => {
      const data = doc.data();

      if (data.status === 'alumni' || data.isActive === false) return;

      let className = 'Unassigned';
      if (data.class) {
        if (typeof data.class === 'object' && data.class.name) {
          className = data.class.name;
        } else if (typeof data.class === 'string') {
          className = data.class;
        }
      }

      if (!data.admissionNo) {
        console.warn(`Skipping ${data.name || doc.id}: no admission number on file`);
        skippedCount++;
        return;
      }

      const nameParts = (data.name || '').trim().split(/\s+/).filter(Boolean);
      const surname = nameParts.length > 0 ? nameParts[nameParts.length - 1] : '';

      let birthYear = '';
      if (data.dob) {
        const match = String(data.dob).match(/(\d{4})/);
        if (match) birthYear = match[1];
      }

      if (!surname || !birthYear) {
        console.warn(`Skipping ${data.name || doc.id}: missing name or date of birth needed to build password`);
        skippedCount++;
        return;
      }

      const password = `${surname.toLowerCase().replace(/[^a-z]/g, '')}${birthYear}`;

      if (!pupilsByClass[className]) {
        pupilsByClass[className] = [];
      }

      pupilsByClass[className].push({
        name: data.name || 'Unknown',
        admissionNo: data.admissionNo,
        password
      });
    });

    const classNames = Object.keys(pupilsByClass);

    if (classNames.length === 0) {
      window.showToast?.(
        'No pupils with complete data (admission number, name, date of birth) were found.',
        'warning',
        6000
      );
      return;
    }

    let orderedClassNames = classNames.slice().sort((a, b) => a.localeCompare(b));

    try {
      if (window.classHierarchy && typeof window.classHierarchy.getHierarchy === 'function') {
        const hierarchy = await window.classHierarchy.getHierarchy();
        if (hierarchy && hierarchy.length > 0) {
          const hierarchyOrder = hierarchy.map(c => c.name);
          orderedClassNames = classNames.slice().sort((a, b) => {
            const ia = hierarchyOrder.indexOf(a);
            const ib = hierarchyOrder.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
          });
        }
      }
    } catch (e) {
      console.warn('Could not load class hierarchy for sorting, using alphabetical order:', e.message);
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;

    const cardWidth = 88;
    const cardHeight = 42;
    const gapX = 4;
    const gapY = 4;
    const headerHeight = 14;

    const usableWidth = pageWidth - margin * 2;
    const cols = Math.max(1, Math.floor((usableWidth + gapX) / (cardWidth + gapX)));

    const usableHeightForCards = pageHeight - margin * 2 - headerHeight;
    const rows = Math.max(1, Math.floor((usableHeightForCards + gapY) / (cardHeight + gapY)));

    function drawClassHeader(className, pupilCount) {
      doc.setFillColor(26, 86, 219);
      doc.rect(margin, margin, usableWidth, headerHeight - 4, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(className, margin + 4, margin + 8);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`${pupilCount} pupil${pupilCount !== 1 ? 's' : ''}`, pageWidth - margin - 4, margin + 8, { align: 'right' });
      doc.setTextColor(0, 0, 0);
    }

    function drawCard(x, y, pupil) {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'S');

      // School name header
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(26, 86, 219);
      doc.text('FAHMID NURSERY & PRIMARY SCHOOL', x + cardWidth / 2, y + 5, { align: 'center' });

      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.2);
      doc.line(x + 4, y + 7, x + cardWidth - 4, y + 7);

      // Pupil name (wraps up to 2 lines if long)
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      const nameLines = doc.splitTextToSize(pupil.name, cardWidth - 8);
      doc.text(nameLines, x + cardWidth / 2, y + 13, { align: 'center' });

      const nameBlockHeight = nameLines.length * 4.5;
      let cursorY = y + 13 + nameBlockHeight + 2;

      // Admission number
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Admission No:', x + 5, cursorY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(pupil.admissionNo, x + cardWidth - 5, cursorY, { align: 'right' });

      cursorY += 6;

      // Password
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Password:', x + 5, cursorY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 118, 110);
      doc.text(pupil.password, x + cardWidth - 5, cursorY, { align: 'right' });

      // Footer separator 
      const footerLineY = y + cardHeight - 9;
      const footerTextY = y + cardHeight - 4;

      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.2);
      doc.line(x + 4, footerLineY, x + cardWidth - 4, footerLineY);

      // Website — the call to action for parents
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(26, 86, 219);
      doc.text('Visit www.fahmidschool.com.ng/login for portal access', x + cardWidth / 2, footerTextY, { align: 'center' });

      doc.setTextColor(0, 0, 0);
    }

    let totalPupilsPrinted = 0;
    let isFirstPageOverall = true;

    orderedClassNames.forEach(className => {
      const pupils = pupilsByClass[className];
      let indexInClass = 0;

      while (indexInClass < pupils.length) {
        if (!isFirstPageOverall) {
          doc.addPage();
        }
        isFirstPageOverall = false;

        drawClassHeader(className, pupils.length);

        const pageStartY = margin + headerHeight;

        for (let r = 0; r < rows && indexInClass < pupils.length; r++) {
          for (let c = 0; c < cols && indexInClass < pupils.length; c++) {
            const x = margin + c * (cardWidth + gapX);
            const y = pageStartY + r * (cardHeight + gapY);
            drawCard(x, y, pupils[indexInClass]);
            indexInClass++;
            totalPupilsPrinted++;
          }
        }
      }
    });

    doc.save(`Pupil_Login_Credentials_${new Date().toISOString().split('T')[0]}.pdf`);

    let message = `Credentials PDF generated for ${totalPupilsPrinted} pupil(s) across ${orderedClassNames.length} class(es).`;
    if (skippedCount > 0) {
      message += ` ${skippedCount} pupil(s) skipped due to missing admission number, name, or date of birth (see console for details).`;
    }

    window.showToast?.(message, skippedCount > 0 ? 'warning' : 'success', 8000);

  } catch (error) {
    console.error('Error generating pupil credentials PDF:', error);
    window.showToast?.('Failed to generate credentials PDF: ' + error.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="key" style="width:15px;height:15px;"></i> Print Login Credentials';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
}

window.generatePupilCredentialsPDF = generatePupilCredentialsPDF;

/* ======================================== 
   PUPILS MANAGEMENT
======================================== */

async function showPupilForm(isEditing = false) {
  const form = document.getElementById('pupil-form');
  if (!form) return;

  // Populate class dropdown first
  await populateClassDropdown();

  if (!isEditing) {
    // New pupil mode: show credentials section
    const credentialsSection = document.getElementById('pupil-credentials-section');
    if (credentialsSection) credentialsSection.style.display = 'block';

    const passwordField = document.getElementById('pupil-password');
    if (passwordField) {
      passwordField.setAttribute('required', '');
      passwordField.value = '';
    }

    const emailField = document.getElementById('pupil-email');
    if (emailField) {
      emailField.removeAttribute('readonly');
      emailField.style.background = '';
      emailField.style.color = '';
      emailField.setAttribute('required', '');
    }

    const editNote = document.getElementById('pupil-credentials-edit-note');
    if (editNote) editNote.style.display = 'none';
  }
  // If isEditing=true, credentials state is already set by editPupil() before this call

  form.style.display = 'block';
  document.getElementById('pupil-first-name')?.focus();
}

function cancelPupilForm() {
  document.getElementById('pupil-form').style.display = 'none';
  document.getElementById('add-pupil-form').reset();
  document.getElementById('pupil-id').value = '';

  document.getElementById('pupil-form-title').textContent = 'Add / Edit Pupil';
  document.getElementById('save-pupil-btn').textContent = 'Save Pupil';

  // Reset credentials section back to new-pupil state
  const credentialsSection = document.getElementById('pupil-credentials-section');
  if (credentialsSection) credentialsSection.style.display = 'block';

  const passwordField = document.getElementById('pupil-password');
  if (passwordField) {
    passwordField.setAttribute('required', '');
    passwordField.value = '';
  }

  const emailField = document.getElementById('pupil-email');
  if (emailField) {
    emailField.value = '';
    emailField.removeAttribute('readonly');
    emailField.style.background = '';
    emailField.style.color = '';
    emailField.setAttribute('required', '');
  }

  const editNote = document.getElementById('pupil-credentials-edit-note');
  if (editNote) editNote.style.display = 'none';
}

/**
 * Load Pupils with Proper Event Delegation
 */
// Global variable to store all pupils data
let allPupilsData = [];
// Tracks pagination state for the Pupils "Load More" button
let pupilsLastVisibleDoc = null;  
let pupilsHasMoreToLoad = true;  
const PUPILS_PAGE_SIZE = 200;     
let pupilsSearchDebounceTimer = null; 

/**
 * Load Pupils (Client-Side Alumni Filtering)
 */
async function loadPupils() {
  const tbody = document.getElementById('pupils-table');
  if (!tbody) return;

  await populateClassDropdown();

  tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading pupils...</td></tr>';

  // Reset pagination state — this is a fresh load, not a "load more" click
  pupilsLastVisibleDoc = null;
  pupilsHasMoreToLoad = true;
  allPupilsData = [];

  try {
    const snapshot = await db.collection('pupils')
      .orderBy('name')
      .limit(PUPILS_PAGE_SIZE)
      .get();

    tbody.innerHTML = '';

    if (snapshot.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-gray-600);">No pupils registered yet. Add one above.</td></tr>';

      const bulkActionsBar = document.getElementById('bulk-actions-bar');
      if (bulkActionsBar) bulkActionsBar.style.display = 'none';

      pupilsHasMoreToLoad = false;
      updateLoadMorePupilsButton();
      return;
    }

    // Remember the last document fetched, so "Load More" knows where to continue
    pupilsLastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];

    // If we got fewer results than we asked for, there's nothing left to load
    pupilsHasMoreToLoad = snapshot.docs.length === PUPILS_PAGE_SIZE;

    const pupils = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status !== 'alumni') {
        pupils.push({ id: doc.id, ...data });
      }
    });

    console.log(`✓ Loaded ${snapshot.size} pupils this batch, ${pupils.length} active (${snapshot.size - pupils.length} alumni filtered out)`);

    allPupilsData = pupils;

    const bulkActionsBar = document.getElementById('bulk-actions-bar');
    if (bulkActionsBar) bulkActionsBar.style.display = pupils.length > 0 ? 'flex' : 'none';

    renderPupilsTable(allPupilsData);
    updateLoadMorePupilsButton();

    setupBulkActionsEventListeners();

  } catch (error) {
    console.error('Error loading pupils:', error);
    window.showToast?.('Failed to load pupils list. Check connection and try again.', 'danger');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-danger);">Error loading pupils - please refresh</td></tr>';
  }
}

/**
 * Fetches the next batch of pupils and appends them to the list already
 * shown on screen. 
 */
async function loadMorePupils() {
  if (!pupilsHasMoreToLoad || !pupilsLastVisibleDoc) {
    return;
  }

  const loadMoreBtn = document.getElementById('load-more-pupils-btn');
  if (loadMoreBtn) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.innerHTML = '<span class="btn-loading">Loading more...</span>';
  }

  try {
    const snapshot = await db.collection('pupils')
      .orderBy('name')
      .startAfter(pupilsLastVisibleDoc)
      .limit(PUPILS_PAGE_SIZE)
      .get();

    if (snapshot.empty) {
      pupilsHasMoreToLoad = false;
      updateLoadMorePupilsButton();
      return;
    }

    pupilsLastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];
    pupilsHasMoreToLoad = snapshot.docs.length === PUPILS_PAGE_SIZE;

    const newPupils = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status !== 'alumni') {
        newPupils.push({ id: doc.id, ...data });
      }
    });

    console.log(`✓ Loaded ${newPupils.length} more active pupils (total now: ${allPupilsData.length + newPupils.length})`);

    // Add the newly fetched pupils onto the list already on screen
    allPupilsData = allPupilsData.concat(newPupils);

    // Re-apply whatever search term is currently typed, so new pupils
    // are correctly included or excluded from the visible results
    const searchInput = document.getElementById('pupils-search');
    if (searchInput && searchInput.value.trim() !== '') {
      filterPupils();
    } else {
      renderPupilsTable(allPupilsData);
    }

    updateLoadMorePupilsButton();

  } catch (error) {
    console.error('Error loading more pupils:', error);
    window.showToast?.('Failed to load more pupils. Please try again.', 'danger');
  } finally {
    if (loadMoreBtn) {
      loadMoreBtn.disabled = false;
      loadMoreBtn.innerHTML = 'Load More Pupils';
    }
  }
}

/**
 * Shows or hides the "Load More Pupils" button depending on whether
 * more pupils exist beyond what's currently loaded.
 */
function updateLoadMorePupilsButton() {
  const wrapper = document.getElementById('load-more-pupils-wrapper');
  if (!wrapper) return;

  wrapper.style.display = pupilsHasMoreToLoad ? 'block' : 'none';
}

window.loadMorePupils = loadMorePupils;
window.updateLoadMorePupilsButton = updateLoadMorePupilsButton;

/**
 * Render pupils table with pagination
 */
function renderPupilsTable(pupilsData) {
  const tbody = document.getElementById('pupils-table');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (pupilsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-gray-600);">No pupils match your search</td></tr>';
    return;
  }

  paginateTable(pupilsData, 'pupils-table', 20, (pupil, tbody) => {
    let className = '-';
    if (pupil.class) {
      if (typeof pupil.class === 'object' && pupil.class.name) {
        className = pupil.class.name;
      } else if (typeof pupil.class === 'string') {
        className = pupil.class;
      }
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Select" style="text-align:center;">
        <input type="checkbox" class="pupil-checkbox" data-pupil-id="${pupil.id}">
      </td>
      <td data-label="Name">${pupil.name}</td>
      <td data-label="Class">${className}</td>
      <td data-label="Gender">${pupil.gender || '-'}</td>
      <td data-label="Parent Name">${pupil.parentName || '-'}</td>
      <td data-label="Parent Contact">${pupil.contact || '-'}</td>
      <td data-label="Actions">
        <button class="btn-small btn-primary" onclick="editPupil('${pupil.id}')">Edit</button>
        <button class="btn-small btn-danger" onclick="deleteItem('pupils', '${pupil.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Handles typing in the pupils search box.
 */
function filterPupils() {
  const searchInput = document.getElementById('pupils-search');
  if (!searchInput) return;

  const searchTerm = searchInput.value.toLowerCase().trim();

  // Step 1: instant search of what's already loaded
  renderFilteredPupils(searchTerm);

  // Cancel any previously scheduled Firestore search — the admin is still typing
  clearTimeout(pupilsSearchDebounceTimer);

  if (!searchTerm) return;

  // Step 2: only bother checking Firestore if there's more data we haven't loaded yet
  if (pupilsHasMoreToLoad) {
    pupilsSearchDebounceTimer = setTimeout(() => {
      searchPupilsInFirestore(searchTerm);
    }, 400); // small delay so it doesn't search on every single keystroke
  }
}

/**
 * Filters the pupils currently held in memory (allPupilsData) and renders
 * the result.
 */
function renderFilteredPupils(searchTerm) {
  if (!searchTerm) {
    renderPupilsTable(allPupilsData);
    const countDisplay = document.getElementById('pupils-search-count');
    if (countDisplay) countDisplay.textContent = '';
    return;
  }

  const filtered = allPupilsData.filter(pupil => {
    const name = (pupil.name || '').toLowerCase();
    const admissionNo = (pupil.admissionNo || '').toLowerCase();
    return name.includes(searchTerm) || admissionNo.includes(searchTerm);
  });

  console.log(`Pupils search: "${searchTerm}" → ${filtered.length} of ${allPupilsData.length} loaded pupils`);

  renderPupilsTable(filtered);

  const countDisplay = document.getElementById('pupils-search-count');
  if (countDisplay) {
    countDisplay.textContent = filtered.length === allPupilsData.length
      ? ''
      : `Showing ${filtered.length} of ${allPupilsData.length} loaded pupils`;
  }
}

/**
 * Looks up Firestore directly for pupils matching the search term that
 * haven't been loaded into the browser yet, and merges any found into
 * the working list.
 */
async function searchPupilsInFirestore(searchTerm) {
  const rawInput = document.getElementById('pupils-search')?.value.trim();
  if (!rawInput) return;

  const countDisplay = document.getElementById('pupils-search-count');
  const previousCountText = countDisplay ? countDisplay.textContent : '';
  if (countDisplay) {
    countDisplay.textContent = 'Checking for more matches...';
  }

  try {
    // Try both as typed, and a Capitalized version, since Firestore search
    // is case-sensitive and names are usually stored with capital letters.
    const nameVariants = Array.from(new Set([rawInput, capitalizeWords(rawInput)]));
    const admissionVariants = Array.from(new Set([rawInput, rawInput.toUpperCase()]));

    const queries = [];

    nameVariants.forEach(term => {
      queries.push(
        db.collection('pupils')
          .orderBy('name')
          .startAt(term)
          .endAt(term + '\uf8ff')
          .limit(50)
          .get()
          .catch(err => {
            console.warn('Name search query failed, skipping:', err.message);
            return null;
          })
      );
    });

    admissionVariants.forEach(term => {
      queries.push(
        db.collection('pupils')
          .orderBy('admissionNo')
          .startAt(term)
          .endAt(term + '\uf8ff')
          .limit(50)
          .get()
          .catch(err => {
            console.warn('Admission number search query failed, skipping:', err.message);
            return null;
          })
      );
    });

    const snapshots = await Promise.all(queries);

    const existingIds = new Set(allPupilsData.map(p => p.id));
    let newMatchesCount = 0;

    snapshots.forEach(snap => {
      if (!snap) return;
      snap.forEach(doc => {
        if (existingIds.has(doc.id)) return;
        const data = doc.data();
        if (data.status === 'alumni') return; // keep alumni out, same as everywhere else

        allPupilsData.push({ id: doc.id, ...data });
        existingIds.add(doc.id);
        newMatchesCount++;
      });
    });

    if (newMatchesCount > 0) {
      console.log(`✓ Found ${newMatchesCount} additional matching pupil(s) not yet loaded — added to results`);
    }

    // Re-filter and re-render now that allPupilsData may have grown
    renderFilteredPupils(searchTerm);

  } catch (error) {
    console.error('Error searching pupils in Firestore:', error);
    if (countDisplay) countDisplay.textContent = previousCountText;
  }
}

/**
 * Small helper: turns "ade" into "Ade", "ade tunde" into "Ade Tunde" —
 * used to guess proper-case name formatting for the Firestore search above.
 */
function capitalizeWords(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Make functions globally available
window.filterPupils = filterPupils;
window.renderPupilsTable = renderPupilsTable;
window.renderFilteredPupils = renderFilteredPupils;
window.searchPupilsInFirestore = searchPupilsInFirestore;

/* =====================================================
   BULK OPERATIONS - COMPLETE IMPLEMENTATION
===================================================== */

/**
 * Setup bulk actions event listeners
 */
function setupBulkActionsEventListeners() {
  console.log('🔧 Setting up bulk actions event listeners...');
  
  // 1. Select All checkbox
  const selectAllCheckbox = document.getElementById('select-all-pupils');
  if (selectAllCheckbox) {
    const newSelectAll = selectAllCheckbox.cloneNode(true);
    selectAllCheckbox.parentNode.replaceChild(newSelectAll, selectAllCheckbox);
    
    newSelectAll.addEventListener('change', function() {
      const checkboxes = document.querySelectorAll('.pupil-checkbox');
      checkboxes.forEach(checkbox => { checkbox.checked = this.checked; });
      updateBulkActionButtons();
    });
  }
  
  // 2. Individual pupil checkboxes
  const tableContainer = document.querySelector('#pupils .table-container') 
    || document.getElementById('pupils-table')?.closest('.table-container')
    || document.getElementById('pupils-table')?.parentElement;
  
  if (tableContainer) {
    if (!tableContainer.dataset.bulkDelegationActive) {
      tableContainer.addEventListener('change', function(e) {
        if (e.target.classList.contains('pupil-checkbox')) {
          updateBulkActionButtons();
        }
      });
      tableContainer.dataset.bulkDelegationActive = 'true';
      console.log('✓ Bulk checkbox delegation attached to table container');
    }
  }
  
  // 3. Apply button
  const applyBtn = document.getElementById('apply-bulk-action-btn');
  if (applyBtn) {
    const newApplyBtn = applyBtn.cloneNode(true);
    applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
    document.getElementById('apply-bulk-action-btn').addEventListener('click', applyBulkAction);
  }
  
  console.log('✅ Bulk actions event listeners setup complete');
}

window.setupBulkActionsEventListeners = setupBulkActionsEventListeners;

/**
 * Update bulk action buttons based on selection
 */
function updateBulkActionButtons() {
  const checkboxes = document.querySelectorAll('.pupil-checkbox:checked');
  const count = checkboxes.length;
  
  console.log(`📊 ${count} pupils selected`);
  
  const countDisplay = document.getElementById('selected-count');
  const actionSelect = document.getElementById('bulk-action-select');
  const applyBtn = document.getElementById('apply-bulk-action-btn');
  const selectAllCheckbox = document.getElementById('select-all-pupils');
  
  if (countDisplay) {
    countDisplay.textContent = `${count} selected`;
    countDisplay.style.fontWeight = count > 0 ? '600' : 'normal';
    countDisplay.style.color = count > 0 ? 'var(--color-primary)' : 'var(--color-gray-600)';
  }
  
  if (actionSelect) actionSelect.disabled = count === 0;
  if (applyBtn) applyBtn.disabled = count === 0;
  
  // Update "Select All" checkbox state
  const allCheckboxes = document.querySelectorAll('.pupil-checkbox');
  if (selectAllCheckbox && allCheckboxes.length > 0) {
    selectAllCheckbox.checked = count === allCheckboxes.length;
    selectAllCheckbox.indeterminate = count > 0 && count < allCheckboxes.length;
  }
}

/**
 * Apply bulk action to selected pupils
 */
async function applyBulkAction() {
  const action = document.getElementById('bulk-action-select')?.value;
  const checkboxes = document.querySelectorAll('.pupil-checkbox:checked');
  
  if (!action || checkboxes.length === 0) {
    window.showToast?.('Please select an action and at least one pupil', 'warning');
    return;
  }
  
  const selectedPupilIds = Array.from(checkboxes).map(cb => cb.dataset.pupilId);
  
  console.log(`Applying ${action} to ${selectedPupilIds.length} pupils`);
  
  switch(action) {
    case 'reassign-class':
      await bulkReassignClass(selectedPupilIds);
      break;
    case 'set-religion':
      await bulkSetReligion(selectedPupilIds);
      break;
    case 'delete':
      await bulkDeletePupils(selectedPupilIds);
      break;
    default:
      window.showToast?.('Invalid action selected', 'warning');
  }
}

/**
 * Bulk reassign pupils to a new class
 */
async function bulkReassignClass(pupilIds) {
  console.log(`📝 bulkReassignClass called with ${pupilIds.length} pupils`);
  
  try {
    // Get all classes
    const classesSnap = await db.collection('classes').orderBy('name').get();
    
    if (classesSnap.empty) {
      window.showToast?.('No classes available', 'warning');
      return;
    }
    
    // Build class options
    let classOptions = '<option value="">-- Select New Class --</option>';
    classesSnap.forEach(doc => {
      const data = doc.data();
      classOptions += `<option value="${doc.id}">${data.name}</option>`;
    });
    
    // Create modal with unique ID
    const modalId = 'bulk-reassign-modal-' + Date.now();
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;';
    modal.innerHTML = `
      <div style="background:white; padding:var(--space-2xl); border-radius:var(--radius-lg); max-width:500px; width:90%;">
        <h3 style="margin-top:0;">Reassign ${pupilIds.length} Pupil(s) to New Class</h3>
        <p style="color:var(--color-gray-600); margin-bottom:var(--space-lg);">
          Select the new class for the selected pupils. Their subjects and teacher will be updated automatically.
        </p>
        <select id="bulk-class-select-${modalId}" style="width:100%; padding:var(--space-sm); margin-bottom:var(--space-lg);">
          ${classOptions}
        </select>
        <div style="display:flex; gap:var(--space-md); justify-content:flex-end;">
          <button class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button class="btn btn-primary" data-action="confirm">
            Reassign All
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Cleanup function
    const cleanup = () => {
      modal.remove();
      document.removeEventListener('keydown', escapeHandler);
      console.log('✓ Modal cleaned up');
    };
    
    // Escape key handler
    const escapeHandler = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Button handlers
    modal.querySelector('[data-action="cancel"]').onclick = cleanup;
    
    modal.querySelector('[data-action="confirm"]').onclick = async function() {
      const selectId = `bulk-class-select-${modalId}`;
      const newClassId = document.getElementById(selectId)?.value;
      
      if (!newClassId) {
        window.showToast?.('Please select a class', 'warning');
        return;
      }
      
      this.disabled = true;
      this.innerHTML = '<span class="btn-loading">Reassigning...</span>';
      
      try {
        // Get new class details
        const classDoc = await db.collection('classes').doc(newClassId).get();
        if (!classDoc.exists) {
          throw new Error('Class not found');
        }
        
        const classData = classDoc.data();
        
        // Get teacher info
        let teacherId = classData.teacherId || '';
        let teacherName = classData.teacherName || '';
        
        if (teacherId && !teacherName) {
          const teacherDoc = await db.collection('teachers').doc(teacherId).get();
          if (teacherDoc.exists) {
            teacherName = teacherDoc.data().name || '';
          }
        }
        
        // Batch update pupils (with proper chunking)
        const BATCH_SIZE = 450;
        let batch = db.batch();
        let count = 0;
        
        for (const pupilId of pupilIds) {
          const pupilRef = db.collection('pupils').doc(pupilId);

          let pupilReligion = '';
          try {
            const pupilSnap = await pupilRef.get();
            pupilReligion = pupilSnap.exists ? (pupilSnap.data().religion || '') : '';
          } catch (readError) {
            console.warn(`⚠️ Could not read religion for pupil ${pupilId}:`, readError.message);
          }

          const filteredSubjects = window.filterSubjectsByReligion
            ? window.filterSubjectsByReligion(classData.subjects || [], pupilReligion)
            : (classData.subjects || []);
          
          batch.update(pupilRef, {
            'class.id': newClassId,
            'class.name': classData.name,
            subjects: filteredSubjects,
            'assignedTeacher.id': teacherId,
            'assignedTeacher.name': teacherName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          
          count++;
          
          if (count >= BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }
        
        if (count > 0) {
          await batch.commit();
        }
        
        window.showToast?.(
          `✓ Successfully reassigned ${pupilIds.length} pupil(s) to ${classData.name}`,
          'success',
          5000
        );
        
        cleanup();
        await loadPupils();
        
      } catch (error) {
        console.error('Bulk reassign error:', error);
        window.showToast?.(`Failed to reassign pupils: ${error.message}`, 'danger');
        this.disabled = false;
        this.innerHTML = 'Reassign All';
      }
    };
    
  } catch (error) {
    console.error('Error in bulkReassignClass:', error);
    window.showToast?.('Failed to load classes', 'danger');
  }
}

/**
 * Bulk-set religion for selected pupils.
 */
async function bulkSetReligion(pupilIds) {
  console.log(`📝 bulkSetReligion called with ${pupilIds.length} pupils`);

  // Create modal
  const modalId = 'bulk-religion-modal-' + Date.now();
  const modal = document.createElement('div');
  modal.id = modalId;
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;';
  modal.innerHTML = `
    <div style="background:white; padding:var(--space-2xl); border-radius:var(--radius-lg); max-width:500px; width:90%;">
      <h3 style="margin-top:0;">Set Religion for ${pupilIds.length} Pupil(s)</h3>
      <p style="color:var(--color-gray-600); margin-bottom:var(--space-lg);">
        This will set the religion for all selected pupils and automatically remove
        the mismatched Religious Studies subject (Christian/Islamic) from their subject list.
      </p>
      <select id="bulk-religion-select-${modalId}" style="width:100%; padding:var(--space-sm); margin-bottom:var(--space-lg);">
        <option value="">-- Select Religion --</option>
        <option value="Christian">Christian</option>
        <option value="Muslim">Muslim</option>
        <option value="Other">Other / Not Specified</option>
      </select>
      <div style="display:flex; gap:var(--space-md); justify-content:flex-end;">
        <button class="btn btn-secondary" data-action="cancel">Cancel</button>
        <button class="btn btn-primary" data-action="confirm">
          Apply to All
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cleanup = () => {
    modal.remove();
    document.removeEventListener('keydown', escapeHandler);
    console.log('✓ Modal cleaned up');
  };

  const escapeHandler = (e) => {
    if (e.key === 'Escape') cleanup();
  };
  document.addEventListener('keydown', escapeHandler);

  modal.querySelector('[data-action="cancel"]').onclick = cleanup;

  modal.querySelector('[data-action="confirm"]').onclick = async function() {
    const selectId = `bulk-religion-select-${modalId}`;
    const religion = document.getElementById(selectId)?.value;

    if (!religion) {
      window.showToast?.('Please select a religion', 'warning');
      return;
    }

    this.disabled = true;
    this.innerHTML = '<span class="btn-loading">Applying...</span>';

    try {
      // Cache class subject lists so we don't re-fetch the same class repeatedly
      const classSubjectsCache = {};

      async function getClassSubjects(classId) {
        if (!classId) return [];
        if (classSubjectsCache[classId]) return classSubjectsCache[classId];

        const classDoc = await db.collection('classes').doc(classId).get();
        const subjects = classDoc.exists && Array.isArray(classDoc.data().subjects)
          ? classDoc.data().subjects
          : [];

        classSubjectsCache[classId] = subjects;
        return subjects;
      }

      const BATCH_SIZE = 400;
      let batch = db.batch();
      let count = 0;
      let updatedCount = 0;
      let errorCount = 0;

      for (const pupilId of pupilIds) {
        try {
          const pupilDoc = await db.collection('pupils').doc(pupilId).get();
          if (!pupilDoc.exists) {
            console.warn(`⚠️ Pupil ${pupilId} not found, skipping`);
            errorCount++;
            continue;
          }

          const pupilData = pupilDoc.data();
          const classId = pupilData.class?.id || null;

          // Get the FULL master subject list from the pupil's class
          const masterSubjects = await getClassSubjects(classId);

          const filteredSubjects = window.filterSubjectsByReligion
            ? window.filterSubjectsByReligion(masterSubjects, religion)
            : masterSubjects;

          const pupilRef = db.collection('pupils').doc(pupilId);
          batch.update(pupilRef, {
            religion: religion,
            subjects: filteredSubjects,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });

          count++;
          updatedCount++;

          if (count >= BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }

        } catch (pupilError) {
          console.error(`❌ Error processing pupil ${pupilId}:`, pupilError.message);
          errorCount++;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      const message = errorCount === 0
        ? `✓ Successfully set religion to "${religion}" for ${updatedCount} pupil(s).\n\nSubjects have been updated accordingly.`
        : `Updated ${updatedCount} pupil(s). ${errorCount} failed — check console.`;

      window.showToast?.(message, errorCount > 0 ? 'warning' : 'success', 6000);

      cleanup();
      await loadPupils();

    } catch (error) {
      console.error('Bulk set religion error:', error);
      window.showToast?.(`Failed to set religion: ${error.message}`, 'danger');
      this.disabled = false;
      this.innerHTML = 'Apply to All';
    }
  };
}

// Make globally available
window.bulkSetReligion = bulkSetReligion;

/**
 * Bulk delete selected pupils
 */
async function bulkDeletePupils(pupilIds) {
  const confirmation = confirm(
    `⚠️ DELETE ${pupilIds.length} PUPIL(S)?\n\n` +
    `This will permanently delete:\n` +
    `• ${pupilIds.length} pupil record(s) and user account(s)\n` +
    `• All associated payment records\n` +
    `• All associated results and drafts\n\n` +
    `This action CANNOT be undone!`
  );

  if (!confirmation) return;

  const confirmText = prompt('Type DELETE to confirm:');
  if (confirmText !== 'DELETE') {
    window.showToast?.('Deletion cancelled', 'info');
    return;
  }

  let deletedCount = 0;
  let errorCount = 0;

  try {
    for (const pupilId of pupilIds) {
      // ✅ Per-pupil isolation
      try {
        let batch = db.batch();
        let batchCount = 0;

        const flushIfNeeded = async () => {
          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        };

        batch.delete(db.collection('pupils').doc(pupilId));
        batchCount++;

        batch.delete(db.collection('users').doc(pupilId));
        batchCount++;

        // Delete associated payment records
        const paymentsSnap = await db.collection('payments')
          .where('pupilId', '==', pupilId).get();
        paymentsSnap.forEach(doc => { batch.delete(doc.ref); batchCount++; });
        await flushIfNeeded();

        // Delete associated payment transactions
        const txSnap = await db.collection('payment_transactions')
          .where('pupilId', '==', pupilId).get();
        txSnap.forEach(doc => { batch.delete(doc.ref); batchCount++; });
        await flushIfNeeded();

        // Delete associated approved results
        const resultsSnap = await db.collection('results')
          .where('pupilId', '==', pupilId).get();
        resultsSnap.forEach(doc => { batch.delete(doc.ref); batchCount++; });
        await flushIfNeeded();

        // Delete associated draft results
        const draftsSnap = await db.collection('results_draft')
          .where('pupilId', '==', pupilId).get();
        draftsSnap.forEach(doc => { batch.delete(doc.ref); batchCount++; });
        await flushIfNeeded();

        if (batchCount > 0) await batch.commit();

        deletedCount++;

      } catch (pupilError) {
        console.error(`❌ Error deleting pupil ${pupilId}:`, pupilError.message);
        errorCount++;
      }
    }

    const message = errorCount === 0
      ? `✓ Successfully deleted ${deletedCount} pupil(s) and all associated records`
      : `Deleted ${deletedCount} pupil(s). ${errorCount} failed — check console.`;

    window.showToast?.(message, errorCount > 0 ? 'warning' : 'success', 6000);

    await loadPupils();
    await loadDashboardStats();

  } catch (error) {
    console.error('Bulk delete error:', error);
    window.showToast?.(`Failed to complete deletion: ${error.message}`, 'danger');
  }
}

// Make ALL functions globally available
window.loadPupils = loadPupils;
window.setupBulkActionsEventListeners = setupBulkActionsEventListeners;
window.updateBulkActionButtons = updateBulkActionButtons;
window.applyBulkAction = applyBulkAction;
window.bulkReassignClass = bulkReassignClass;
window.bulkDeletePupils = bulkDeletePupils;

console.log('✅ Bulk operations module loaded and exposed globally');

async function editPupil(uid) {
  const myToken = ++_pupilEditToken;
  try {
    console.log(`📝 Loading pupil for edit: ${uid}`);

    const doc = await db.collection('pupils').doc(uid).get();
    if (!doc.exists) throw new Error('Pupil not found');
    if (myToken !== _pupilEditToken) return; // a newer edit click superseded this one

    const data = doc.data();

    // Set up credentials section BEFORE showPupilForm so it won't be overwritten
    const credentialsSection = document.getElementById('pupil-credentials-section');
    if (credentialsSection) credentialsSection.style.display = 'none';

    const editNote = document.getElementById('pupil-credentials-edit-note');
    if (editNote) {
      editNote.style.display = 'block';
      editNote.innerHTML = `
        <div style="padding:0.75rem 1rem; background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; font-size:0.8125rem; color:#1e40af; margin-bottom:0.5rem;">
          <strong>🔒 Login credentials cannot be changed here.</strong><br>
          Email: <strong>${data.email || 'Not set'}</strong><br>
          To reset the pupil's password, ask them to use "Forgot Password" on the login page.
        </div>
      `;
    }

    const passwordField = document.getElementById('pupil-password');
    if (passwordField) {
      passwordField.removeAttribute('required');
      passwordField.value = '';
    }

    const emailField = document.getElementById('pupil-email');
    if (emailField) {
      emailField.value = data.email || '';
      emailField.setAttribute('readonly', '');
      emailField.style.background = '#f1f5f9';
      emailField.style.color = '#64748b';
      emailField.removeAttribute('required');
    }

    if (myToken !== _pupilEditToken) return; // check again before touching the shared form

    // Now call showPupilForm with isEditing=true so it won't reset credentials
    await showPupilForm(true);

    if (myToken !== _pupilEditToken) return;

    // Populate all other fields after form is shown
    const classId = getClassIdFromPupilData(data.class);
    await populateClassDropdown(classId);

    if (myToken !== _pupilEditToken) return;

    document.getElementById('pupil-id').value = uid;

    // Populate the three name fields.
    const nameParts = (data.firstName && data.lastName)
      ? { firstName: data.firstName, middleName: data.middleName || '', lastName: data.lastName }
      : window.splitPupilName(data.name || '');

    document.getElementById('pupil-first-name').value = nameParts.firstName || '';
    document.getElementById('pupil-middle-name').value = nameParts.middleName || '';
    document.getElementById('pupil-last-name').value = nameParts.lastName || '';

    document.getElementById('pupil-admission-no').value = data.admissionNo || '';
    document.getElementById('pupil-dob').value = data.dob || '';
    document.getElementById('pupil-gender').value = data.gender || '';

    // Populate religion field (used for Religious Studies subject filtering)
    const religionField = document.getElementById('pupil-religion');
    if (religionField) religionField.value = data.religion || '';

    document.getElementById('pupil-parent-name').value = data.parentName || '';
    document.getElementById('pupil-parent-email').value = data.parentEmail || '';
    document.getElementById('pupil-contact').value = data.contact || '';
    document.getElementById('pupil-address').value = data.address || '';

    const classSelect = document.getElementById('pupil-class');
    if (classSelect && classId) {
      classSelect.value = classId;
      console.log('Class selected in dropdown:', classId);
    }

    const admissionTermSelect = document.getElementById('pupil-admission-term');
    const exitTermSelect = document.getElementById('pupil-exit-term');
    if (admissionTermSelect) admissionTermSelect.value = data.admissionTerm || 'First Term';
    if (exitTermSelect) exitTermSelect.value = data.exitTerm || 'Third Term';

    const percentInput = document.getElementById('pupil-fee-adjustment-percent');
    const amountInput = document.getElementById('pupil-fee-adjustment-amount');
    if (percentInput) percentInput.value = data.feeAdjustmentPercent || 0;
    if (amountInput) amountInput.value = data.feeAdjustmentAmount || 0;

    // Handle old-format class data
    if (!classId && data.class && typeof data.class === 'string') {
      const className = data.class;
      console.warn(`⚠️ Old class format detected: "${className}"`);

      const classesSnapshot = await db.collection('classes')
        .where('name', '==', className)
        .get();

      if (myToken !== _pupilEditToken) return;

      if (classesSnapshot.empty) {
        window.showToast?.(
          `Warning: Class "${className}" not found. Please select the correct class manually.`,
          'warning', 6000
        );
      } else if (classesSnapshot.size > 1) {
        window.showToast?.(
          `⚠️ Multiple classes named "${className}" found. Please select the correct one manually.`,
          'warning', 10000
        );
        const cs = document.getElementById('pupil-class');
        if (cs) {
          cs.value = '';
          cs.style.background = '#fff3cd';
          cs.style.border = '2px solid #ffc107';
          cs.addEventListener('change', function removeHighlight() {
            this.style.background = '';
            this.style.border = '';
            this.removeEventListener('change', removeHighlight);
          });
        }
      } else {
        const matchedClassId = classesSnapshot.docs[0].id;
        const cs = document.getElementById('pupil-class');
        if (cs) cs.value = matchedClassId;
        window.showToast?.('Note: Old class data format detected. Saving will upgrade it.', 'info', 5000);
      }
    } else if (!classId) {
      const className = data.class?.name || data.class || 'Unknown';
      window.showToast?.(`Warning: Could not find class "${className}". Please select the correct class.`, 'warning', 6000);
    }

    document.getElementById('pupil-form-title').textContent = `Edit Pupil: ${data.name}`;
    document.getElementById('save-pupil-btn').textContent = 'Update Pupil';

    document.getElementById('pupil-first-name')?.focus();

    // Scroll to top of the page so the admin sees the edit form immediately
    // (mirrors the same behavior already present in editTeacher())
    window.scrollTo({ top: 0, behavior: 'smooth' });

    console.log('✅ Pupil form loaded successfully for editing');

  } catch (error) {
    console.error('❌ Error loading pupil for edit:', error);
    window.showToast?.('Failed to load pupil details for editing', 'danger');
  }
}

// Make globally available
window.editPupil = editPupil;

/* ======================================== 
   CLASSES MANAGEMENT 
======================================== */
function showClassForm() {
  const form = document.getElementById('class-form');
  if (form) {
    form.style.display = 'block';
    document.getElementById('class-name')?.focus();
  }
}

/**
 * Add Class with Duplicate Name Prevention
 */
async function addClass() {
  const className = document.getElementById('class-name')?.value.trim();
  
  if (!className) {
    window.showToast?.('Class name is required', 'warning');
    return;
  }
  
  // Check for duplicate class names (case-insensitive)
  try {
    const existingSnap = await db.collection('classes')
      .where('name', '==', className)
      .get();
    
    if (!existingSnap.empty) {
      window.showToast?.(
        `Class "${className}" already exists. Please use a unique name.`,
        'warning',
        5000
      );
      return;
    }
    
    // Also check case-insensitive duplicates
    const allClassesSnap = await db.collection('classes').get();
    const duplicateFound = allClassesSnap.docs.some(doc => {
      const existingName = doc.data().name || '';
      return existingName.toLowerCase() === className.toLowerCase();
    });
    
    if (duplicateFound) {
      window.showToast?.(
        `A class with a similar name already exists (case-insensitive match). Please use a unique name.`,
        'warning',
        6000
      );
      return;
    }
    
    // Create the class
    await db.collection('classes').add({
      name: className,
      subjects: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.currentUser?.uid || 'unknown'
    });
    
    window.showToast?.('✓ Class created successfully', 'success');
    document.getElementById('class-form').style.display = 'none';
    document.getElementById('class-name').value = '';
    loadClasses();
    loadDashboardStats();
    
  } catch (error) {
    console.error('Error adding class:', error);
    window.handleError(error, 'Failed to create class');
  }
}

async function loadClasses() {
  const tbody = document.getElementById('classes-table');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Loading classes...</td></tr>';
  
  try {
    const classesSnap = await db.collection('classes').get();
    const pupilsSnap = await db.collection('pupils').get();
    
// Exclude alumni from class pupil counts
const pupilCountMap = {};
pupilsSnap.forEach(pupilDoc => {
  const pupilData = pupilDoc.data();
  
  // Skip alumni
  if (pupilData.status === 'alumni' || pupilData.isActive === false) {
    return;
  }
  
  const classData = pupilData.class;
  
  let className = null;
  if (classData) {
    if (typeof classData === 'object' && classData.name) {
      className = classData.name;
    } else if (typeof classData === 'string') {
      className = classData;
    }
  }
  
  if (className) {
    pupilCountMap[className] = (pupilCountMap[className] || 0) + 1;
  }
});
    
    tbody.innerHTML = '';
    
    if (classesSnap.empty) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-gray-600);">No classes created yet. Add one above.</td></tr>';
      return;
    }
    
    const classes = [];
    classesSnap.forEach(doc => {
      const data = doc.data();
      classes.push({
        id: doc.id,
        name: data.name,
        subjects: data.subjects || [],
        pupilCount: pupilCountMap[data.name] || 0
      });
    });
    
    classes.sort((a, b) => a.name.localeCompare(b.name));
    
    paginateTable(classes, 'classes-table', 20, (classItem, tbody) => {
      const subjectList = classItem.subjects.length > 0 
        ? classItem.subjects.slice(0, 3).join(', ') + (classItem.subjects.length > 3 ? '...' : '')
        : 'No subjects assigned';
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Class Name">${classItem.name}</td>
        <td data-label="Pupil Count">${classItem.pupilCount}</td>
        <td data-label="Subjects">${subjectList}</td>
        <td data-label="Actions">
          <button class="btn-small btn-primary" onclick="openSubjectAssignmentModal('${classItem.id}', '${classItem.name}')">
            Assign Subjects
          </button>
          <button class="btn-small btn-danger" onclick="deleteItem('classes', '${classItem.id}')">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error loading classes:', error);
    window.showToast?.('Failed to load classes list. Check connection and try again.', 'danger');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--color-danger);">Error loading classes - please refresh</td></tr>';
  }
}

/* ======================================== 
   SUBJECTS MANAGEMENT
======================================== */
function showSubjectForm() {
  const form = document.getElementById('subject-form');
  if (form) {
    form.style.display = 'block';
    document.getElementById('subject-name')?.focus();
  }
}

async function addSubject() {
  const subjectName = document.getElementById('subject-name')?.value.trim();
  
  if (!subjectName) {
    window.showToast?.('Subject name is required', 'warning');
    return;
  }
  
  try {
    const existingSnap = await db.collection('subjects').where('name', '==', subjectName).get();
    
    if (!existingSnap.empty) {
      window.showToast?.('This subject already exists', 'warning');
      return;
    }
    
    await db.collection('subjects').add({
      name: subjectName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    window.showToast?.('Subject created successfully', 'success');
    document.getElementById('subject-form').style.display = 'none';
    document.getElementById('subject-name').value = '';
    loadSubjects();
  } catch (error) {
    console.error('Error adding subject:', error);
    window.handleError(error, 'Failed to create subject');
  }
}

async function loadSubjects() {
  const tbody = document.getElementById('subjects-table');
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="2" class="table-loading">Loading subjects...</td></tr>';

  try {
    const snapshot = await db.collection('subjects').get();
    tbody.innerHTML = '';

    if (snapshot.empty) {
      tbody.innerHTML =
        '<tr><td colspan="2" style="text-align:center; color:var(--color-gray-600);">No subjects created yet. Add one above.</td></tr>';
      return;
    }

    const subjects = [];

    snapshot.forEach(doc => {
      subjects.push({
        id: doc.id,
        name: doc.data().name
      });
    });

    subjects.sort((a, b) => a.name.localeCompare(b.name));

    paginateTable(subjects, 'subjects-table', 20, (subject, tbodyEl) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Subject Name">${subject.name}</td>
        <td data-label="Actions">
          <button class="btn-small btn-danger" onclick="deleteItem('subjects', '${subject.id}')">Delete</button>
        </td>
      `;
      tbodyEl.appendChild(tr);
    });

  } catch (error) {
    console.error('Error loading subjects:', error);
    window.showToast?.(
      'Failed to load subjects list. Check connection and try again.',
      'danger'
    );
    tbody.innerHTML =
      '<tr><td colspan="2" style="text-align:center; color:var(--color-danger);">Error loading subjects please refresh</td></tr>';
  }
}

/* ========================================
SUBJECT ASSIGNMENT TO CLASSES
======================================== */

let currentAssignmentClassId = null;
let currentAssignmentClassName = null;

async function openSubjectAssignmentModal(classId, className) {
  currentAssignmentClassId = classId;
  currentAssignmentClassName = className;

  const modal = document.getElementById('subject-assignment-modal');
  const classNameEl = document.getElementById('assignment-class-name');
  const checkboxContainer = document.getElementById('subject-checkboxes');

  if (!modal || !classNameEl || !checkboxContainer) {
    console.error('Modal elements not found');
    return;
  }

  classNameEl.textContent = `Class: ${className}`;
  checkboxContainer.innerHTML =
    '<p style="text-align:center; color:var(--color-gray-600);">Loading subjects...</p>';

  modal.style.display = 'block';

  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const subjectsSnap = await db.collection('subjects').orderBy('name').get();

    if (subjectsSnap.empty) {
      checkboxContainer.innerHTML =
        '<p style="text-align:center; color:var(--color-gray-600);">No subjects available. Create subjects first in the Subjects section.</p>';
      return;
    }

    const classDoc = await db.collection('classes').doc(classId).get();
    const currentSubjects = classDoc.exists ? (classDoc.data().subjects || []) : [];

    checkboxContainer.innerHTML = '';

    subjectsSnap.forEach(doc => {
      const subjectName = doc.data().name;
      const isChecked = currentSubjects.includes(subjectName);

      const itemDiv = document.createElement('div');
      itemDiv.className = 'subject-checkbox-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `subject-${doc.id}`;
      checkbox.value = subjectName;
      checkbox.checked = isChecked;

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = subjectName;

      itemDiv.appendChild(checkbox);
      itemDiv.appendChild(label);
      checkboxContainer.appendChild(itemDiv);
    });

  } catch (error) {
    console.error('Error loading subjects for assignment:', error);
    checkboxContainer.innerHTML =
      '<p style="text-align:center; color:var(--color-danger);">Error loading subjects. Please try again.</p>';
    window.showToast?.('Failed to load subjects', 'danger');
  }
}

function closeSubjectAssignmentModal() {
  const modal = document.getElementById('subject-assignment-modal');
  if (modal) modal.style.display = 'none';

  currentAssignmentClassId = null;
  currentAssignmentClassName = null;
}

async function saveClassSubjects() {
  if (!currentAssignmentClassId) {
    window.showToast?.('No class selected', 'warning');
    return;
  }

  const checkboxes = document.querySelectorAll(
    '#subject-checkboxes input[type="checkbox"]:checked'
  );
  const selectedSubjects = Array.from(checkboxes).map(cb => cb.value);

  if (selectedSubjects.length === 0) {
    if (!confirm('No subjects selected. This will remove all subjects from this class. Continue?')) {
      return;
    }
  }

  try {
    // Use transaction for atomic updates
    await db.runTransaction(async (transaction) => {
      const classRef = db.collection('classes').doc(currentAssignmentClassId);
      
      // Read class document
      const classDoc = await transaction.get(classRef);
      if (!classDoc.exists) {
        throw new Error('Class not found');
      }
      
      const classData = classDoc.data();
      
      // Read all pupils in this class BEFORE any updates
      const pupilsSnap = await db
        .collection('pupils')
        .where('class.id', '==', currentAssignmentClassId)
        .get();
      
      console.log(`Found ${pupilsSnap.size} pupils to update`);
      
      // Update class subjects (class-level list is unfiltered — the "master" list)
      transaction.update(classRef, {
        subjects: selectedSubjects,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      // Update each pupil's subjects individually
      pupilsSnap.forEach(pupilDoc => {
        const pupilReligion = pupilDoc.data().religion || '';
        const filteredSubjects = window.filterSubjectsByReligion
          ? window.filterSubjectsByReligion(selectedSubjects, pupilReligion)
          : selectedSubjects;

        transaction.update(pupilDoc.ref, {
          subjects: filteredSubjects,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      
      console.log('✓ Transaction prepared with all updates (religion-filtered per pupil)');
    });

    window.showToast?.(
      `✓ Subjects updated atomically for class "${currentAssignmentClassName}"`,
      'success',
      5000
    );

    closeSubjectAssignmentModal();
    loadClasses();

  } catch (error) {
    console.error('Error saving subjects:', error);
    
    if (error.message === 'Class not found') {
      window.showToast?.('Class no longer exists', 'danger');
    } else {
      window.handleError(error, 'Failed to save subjects');
    }
  }
}

/* ===============================
   Global function declarations
   =============================== */

window.openSubjectAssignmentModal = openSubjectAssignmentModal;
window.closeSubjectAssignmentModal = closeSubjectAssignmentModal;
window.saveClassSubjects = saveClassSubjects;
window.showSubjectForm = showSubjectForm;
window.addSubject = addSubject;

/* ========================================
TEACHER ASSIGNMENT
======================================== */

async function loadTeacherAssignments() {
  const teacherSelect = document.getElementById('assign-teacher');
  const classSelect = document.getElementById('assign-class');
  const tbody = document.getElementById('assignments-table');

  if (!teacherSelect || !classSelect || !tbody) return;

  try {
    // Previously: window.getAllTeachers() (an unconverted legacy
    // helper reading Firestore directly) plus a direct classes
    // query. Both now come from the Worker API.
    const { teachers } = await adminApiGet('/api/admin/teachers');

    teacherSelect.innerHTML = '<option value="">-- Select Teacher --</option>';

    teachers.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.uid;
      opt.textContent = `${t.name} (${t.email})`;
      teacherSelect.appendChild(opt);
    });

    const { classes: rawClasses } = await adminApiGet('/api/admin/classes');
    classSelect.innerHTML = '<option value="">-- Select Class --</option>';

    const classes = rawClasses.map(c => ({
      id: c.id,
      name: c.name,
      teacherId: c.teacherId || null
    }));

    classes.sort((a, b) => a.name.localeCompare(b.name));

    classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      classSelect.appendChild(opt);
    });

    tbody.innerHTML = '';

    classes.forEach(cls => {
      const assignedTeacher = teachers.find(t => t.uid === cls.teacherId);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Class">${cls.name}</td>
        <td data-label="Assigned Teacher">${assignedTeacher ? assignedTeacher.name : '<em>None assigned</em>'}</td>
        <td data-label="Actions">
          ${cls.teacherId ? `<button class="btn-small btn-danger" onclick="unassignTeacher('${cls.id}')">Remove Assignment</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (error) {
    console.error('Error loading assignments:', error);
    window.showToast?.(
      'Failed to load assignment data. Check connection and try again.',
      'danger'
    );
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center; color:var(--color-danger);">Error loading assignments please refresh</td></tr>';
  }
}

async function assignTeacherToClass() {
  const teacherUid = document.getElementById('assign-teacher')?.value;
  const classId = document.getElementById('assign-class')?.value;

  if (!teacherUid || !classId) {
    window.showToast?.('Please select both a teacher and a class', 'warning');
    return;
  }

  try {
    // Previously: a client-side transaction that updated the class
    // doc AND denormalized assignedTeacher.id/.name onto every
    // pupil in the class. The Worker's assign-teacher route
    // (backend/api/admin-routes.js) deliberately does NOT cascade
    // onto pupils — pupil-facing code (backend/business/school/
    // pupil-profile.js) resolves the teacher by looking up the
    // class's teacherId instead, so that denormalized copy isn't
    // needed any more. This is an intentional behavior change, not
    // an oversight: one less place for teacher info to go stale.
    await adminApiPost(`/api/admin/classes/${encodeURIComponent(classId)}/assign-teacher`, {
      teacherId: teacherUid,
    });

    window.showToast?.('Teacher assigned successfully!', 'success', 5000);

    loadTeacherAssignments();

  } catch (error) {
    console.error('Error assigning teacher:', error);
    window.handleError(error, 'Failed to assign teacher');
  }
}

async function unassignTeacher(classId) {
  if (!confirm('Remove teacher assignment from this class?')) return;

  try {
    // Same assign-teacher endpoint as assignTeacherToClass(), with
    // teacherId: null — and the same intentional change: no pupil
    // cascade-update, since pupils aren't denormalized with teacher
    // info any more. See the comment in assignTeacherToClass().
    await adminApiPost(`/api/admin/classes/${encodeURIComponent(classId)}/assign-teacher`, {
      teacherId: null,
    });

    window.showToast?.('Teacher unassigned successfully', 'success');

    loadTeacherAssignments();

  } catch (error) {
    console.error('Error unassigning teacher:', error);
    window.handleError(error, 'Failed to remove assignment');
  }
}

/* ========================================
ANNOUNCEMENTS
======================================== */

async function showAnnounceForm() {
  const form = document.getElementById('announce-form');
  if (!form) return;

  // Populate teacher dropdown if not already done
  const teacherSel = document.getElementById('announce-target-teacher');
  if (teacherSel && teacherSel.options.length <= 1) {
    try {
      const snap = await db.collection('teachers').orderBy('name').get();
      teacherSel.innerHTML = '<option value="">-- Select Teacher --</option>';
      snap.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = 'user:' + doc.id;
        opt.textContent = doc.data().name || doc.data().email || doc.id;
        teacherSel.appendChild(opt);
      });
    } catch (e) {
      console.error('Could not load teachers for announcement form:', e);
    }
  }

  // Populate class dropdown if not already done
  const classSel = document.getElementById('announce-target-class');
  if (classSel && classSel.options.length <= 1) {
    try {
      const snap = await db.collection('classes').orderBy('name').get();
      classSel.innerHTML = '<option value="">-- Select Class --</option>';
      snap.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = 'class:' + doc.id;
        opt.textContent = doc.data().name || doc.id;
        classSel.appendChild(opt);
      });
    } catch (e) {
      console.error('Could not load classes for announcement form:', e);
    }
  }

  // Populate individual pupil dropdown if not already done
  const pupilSel = document.getElementById('announce-target-pupil');
  if (pupilSel && pupilSel.options.length <= 1) {
    try {
      const snap = await db.collection('pupils').orderBy('name').get();
      pupilSel.innerHTML = '<option value="">-- Select Pupil --</option>';
      snap.forEach(doc => {
        const data = doc.data();
        if (data.status === 'alumni') return;
        const opt = document.createElement('option');
        opt.value = 'user:' + doc.id;
        const cls = typeof data.class === 'object' && data.class
          ? ' (' + (data.class.name || '') + ')'
          : '';
        opt.textContent = (data.name || doc.id) + cls;
        pupilSel.appendChild(opt);
      });
    } catch (e) {
      console.error('Could not load pupils for announcement form:', e);
    }
  }

  form.style.display = 'block';
  document.getElementById('announce-title')?.focus();
}

function toggleAudienceFields() {
  const type = document.getElementById('announce-audience')?.value;
  const rows = {
    'specific-teacher': document.getElementById('announce-teacher-row'),
    'specific-class':   document.getElementById('announce-class-row'),
    'specific-pupil':   document.getElementById('announce-pupil-row')
  };
  Object.keys(rows).forEach(key => {
    if (rows[key]) rows[key].style.display = (type === key) ? '' : 'none';
  });
}
window.toggleAudienceFields = toggleAudienceFields;

async function addAnnouncement() {
  const title   = document.getElementById('announce-title')?.value.trim();
  const content = document.getElementById('announce-content')?.value.trim();
  const audienceType = document.getElementById('announce-audience')?.value || 'all';
  const priority     = document.getElementById('announce-priority')?.value  || 'normal';
  const expiresAtInput = document.getElementById('announce-expires-at')?.value;

  if (!title || !content) {
    window.showToast?.('Title and content are required', 'warning');
    return;
  }

  // Validate expiry is in the future if provided
  let expiresAt = null;
  if (expiresAtInput) {
    const expiresDate = new Date(expiresAtInput);
    if (expiresDate <= new Date()) {
      window.showToast?.('Expiry date must be in the future', 'warning');
      return;
    }
    expiresAt = firebase.firestore.Timestamp.fromDate(expiresDate);
  }

  // Resolve the final targetAudience value
  let targetAudience = audienceType;
  if (audienceType === 'specific-teacher') {
    const val = document.getElementById('announce-target-teacher')?.value;
    if (!val) { window.showToast?.('Please select a teacher', 'warning'); return; }
    targetAudience = val;
  } else if (audienceType === 'specific-class') {
    const val = document.getElementById('announce-target-class')?.value;
    if (!val) { window.showToast?.('Please select a class', 'warning'); return; }
    targetAudience = val;
  } else if (audienceType === 'specific-pupil') {
    const val = document.getElementById('announce-target-pupil')?.value;
    if (!val) { window.showToast?.('Please select a pupil', 'warning'); return; }
    targetAudience = val;
  }

  const saveBtn = document.getElementById('save-announcement-btn');
  const origHTML = saveBtn?.innerHTML;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = 'Publishing...'; }

  try {
    const docData = {
      title,
      content,
      targetAudience,
      priority,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: firebase.auth().currentUser?.uid || 'admin'
    };

    // Only write expiresAt if the admin actually set one
    if (expiresAt) {
      docData.expiresAt = expiresAt;
    }

    await db.collection('announcements').add(docData);

    // Clean up any already-expired announcements while we're here
    await _deleteExpiredAnnouncements();

    window.showToast?.('Announcement published successfully', 'success');
    document.getElementById('announce-form').style.display = 'none';

    // Reset form fields
    ['announce-title', 'announce-content', 'announce-expires-at'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const audEl = document.getElementById('announce-audience');
    if (audEl) { audEl.value = 'all'; toggleAudienceFields(); }
    const priEl = document.getElementById('announce-priority');
    if (priEl) priEl.value = 'normal';

    loadAdminAnnouncements();
    loadDashboardStats();
  } catch (error) {
    console.error('Error adding announcement:', error);
    window.handleError?.(error, 'Failed to publish announcement');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origHTML; }
  }
}

// Delete all announcements whose expiresAt is in the past.
async function _deleteExpiredAnnouncements() {
  try {
    const now = firebase.firestore.Timestamp.now();
    const snap = await db.collection('announcements')
      .where('expiresAt', '<=', now)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`Auto-deleted ${snap.size} expired announcement(s)`);
  } catch (err) {
    console.warn('Could not delete expired announcements:', err);
  }
}

async function loadAdminAnnouncements() {
  const list = document.getElementById('announcements-list');
  if (!list) return;

  list.innerHTML = '<div class="loading-container"><div class="spinner"></div><p>Loading announcements...</p></div>';

  await _deleteExpiredAnnouncements();

  function getAudienceBadge(audience) {
    const map = {
      'all':      { label: 'Everyone',      color: '#1a56db', bg: '#eff6ff' },
      'teachers': { label: 'All Teachers',  color: '#7c3aed', bg: '#faf5ff' },
      'pupils':   { label: 'All Pupils',    color: '#0f9764', bg: '#ecfdf5' }
    };
    if (!audience || audience === 'all') return map['all'];
    if (map[audience]) return map[audience];
    if (audience.startsWith('class:')) return { label: 'Specific Class',  color: '#d97706', bg: '#fffbeb' };
    if (audience.startsWith('user:'))  return { label: 'Individual User', color: '#dc2626', bg: '#fef2f2' };
    return map['all'];
  }

  function getPriorityHTML(priority) {
    if (priority === 'urgent') {
      return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;background:#fee2e2;color:#dc2626;">Urgent</span>';
    }
    if (priority === 'important') {
      return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;background:#fef3c7;color:#d97706;">Important</span>';
    }
    return '';
  }

  function getExpiryHTML(ann) {
    if (!ann.expiresAt) return '';
    const expiryDate = ann.expiresAt.toDate ? ann.expiresAt.toDate() : new Date(ann.expiresAt);
    const now = new Date();
    const diffMs = expiryDate - now;
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    const dateStr = expiryDate.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    // Colour-code by urgency: red if expiring within 24 h, amber within 3 days, grey otherwise
    let color = '#64748b';
    let bg = '#f1f5f9';
    let icon = '⏳';

    if (diffHours < 0) {
      color = '#dc2626'; bg = '#fef2f2'; icon = '🗑️';
    } else if (diffHours < 24) {
      color = '#dc2626'; bg = '#fef2f2'; icon = '⚠️';
    } else if (diffDays < 3) {
      color = '#d97706'; bg = '#fffbeb'; icon = '⏳';
    }

    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${bg};color:${color};">
      ${icon} Expires ${dateStr}
    </span>`;
  }

  function getAudienceIconClass(audience) {
    if (!audience || audience === 'all') return 'ph ph-megaphone';
    if (audience === 'teachers')         return 'ph ph-chalkboard-teacher';
    if (audience === 'pupils')           return 'ph ph-student';
    if (audience.startsWith('class:'))   return 'ph ph-door';
    if (audience.startsWith('user:'))    return 'ph ph-user';
    return 'ph ph-megaphone';
  }

  try {
    const snapshot = await db
      .collection('announcements')
      .orderBy('createdAt', 'desc')
      .get();

    list.innerHTML = '';

    if (snapshot.empty) {
      list.innerHTML = `
        <div class="empty-state">
          <i data-lucide="megaphone"></i>
          <p class="empty-state-title">No announcements yet</p>
          <p class="empty-state-desc">Use the form above to publish your first announcement.</p>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    const now = new Date();

    snapshot.forEach(doc => {
      const ann = Object.assign({ id: doc.id }, doc.data());

      // Skip any that slipped through the cleanup (edge case)
      if (ann.expiresAt) {
        const exp = ann.expiresAt.toDate ? ann.expiresAt.toDate() : new Date(ann.expiresAt);
        if (exp < now) return;
      }

      const badge = getAudienceBadge(ann.targetAudience);
      const postedDate = ann.createdAt
        ? ann.createdAt.toDate().toLocaleDateString('en-GB', {
            year: 'numeric', month: 'long', day: 'numeric'
          })
        : 'Just now';

      const div = document.createElement('div');
      div.style.cssText = [
        'background:white',
        'border:1px solid #e2e8f0',
        'border-left:4px solid ' + badge.color,
        'border-radius:10px',
        'padding:16px 20px',
        'margin-bottom:10px',
        'transition:box-shadow 0.2s ease'
      ].join(';');
      div.onmouseenter = () => { div.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)'; };
      div.onmouseleave = () => { div.style.boxShadow = 'none'; };

      div.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-size:0.9375rem;font-weight:700;color:#0f172a;">${ann.title}</span>
              ${getPriorityHTML(ann.priority)}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="display:inline-flex;align-items:center;gap:5px;background:${badge.bg};color:${badge.color};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;">
                <i class="${getAudienceIconClass(ann.targetAudience)}" style="font-size:12px;"></i>
                ${badge.label}
              </span>
              <span style="font-size:12px;color:#94a3b8;">Posted: ${postedDate}</span>
              ${getExpiryHTML(ann)}
            </div>
          </div>
          <button
            class="btn btn-small btn-danger"
            onclick="deleteItem('announcements', '${ann.id}')"
            style="flex-shrink:0;">
            Delete
          </button>
        </div>
        <p style="margin:0;font-size:0.875rem;color:#475569;line-height:1.6;white-space:pre-wrap;">${ann.content}</p>
      `;
      list.appendChild(div);
    });

    // If all were expired and filtered out
    if (list.children.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <i data-lucide="megaphone"></i>
          <p class="empty-state-title">No announcements yet</p>
          <p class="empty-state-desc">Use the form above to publish your first announcement.</p>
        </div>`;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (error) {
    console.error('Error loading announcements:', error);
    list.innerHTML = '<p style="text-align:center;color:var(--color-danger);">Error loading announcements. Please refresh.</p>';
  }
}

/* ======================================== 
   LOAD CURRENT SETTINGS INTO FORM
======================================== */

async function loadCurrentSettings() {
  try {
    console.log('📋 Loading school settings...');
    
    const settingsDoc = await db.collection('settings').doc('current').get();
    
    if (!settingsDoc.exists) {
      window.showToast?.('No settings found. Please configure school settings.', 'warning');
      return;
    }
    
    const data = settingsDoc.data();
    
    // Display current session info in status card
    if (data.currentSession && typeof data.currentSession === 'object') {
      const session = data.currentSession;
      
      const displaySessionName = document.getElementById('display-session-name');
      const displayCurrentTerm = document.getElementById('display-current-term');
      const displaySessionStart = document.getElementById('display-session-start');
      const displaySessionEnd = document.getElementById('display-session-end');
      
      if (displaySessionName) {
        displaySessionName.textContent = session.name || `${session.startYear}/${session.endYear}`;
      }
      
      if (displayCurrentTerm) {
        displayCurrentTerm.textContent = data.term || 'First Term';
      }
      
      if (session.startDate && displaySessionStart) {
        const startDate = session.startDate.toDate();
        displaySessionStart.textContent = startDate.toLocaleDateString('en-GB');
      }
      
      if (session.endDate && displaySessionEnd) {
        const endDate = session.endDate.toDate();
        displaySessionEnd.textContent = endDate.toLocaleDateString('en-GB');
      }
      
      // Check if session is ending soon
      if (session.endDate) {
        const endDate = session.endDate.toDate();
        const today = new Date();
        const daysUntilEnd = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        const statusBadge = document.getElementById('session-status-badge');
        const alertDiv = document.getElementById('session-end-alert');
        
        if (daysUntilEnd < 0 && statusBadge) {
          statusBadge.textContent = 'Ended';
          statusBadge.className = 'status-badge ended';
          if (alertDiv) alertDiv.style.display = 'block';
        } else if (daysUntilEnd <= 30 && statusBadge) {
          statusBadge.textContent = 'Ending Soon';
          statusBadge.className = 'status-badge ending-soon';
          if (alertDiv) alertDiv.style.display = 'block';
        } else if (statusBadge) {
          statusBadge.textContent = 'Active';
          statusBadge.className = 'status-badge';
          if (alertDiv) alertDiv.style.display = 'none';
        }
      }
      
      // Populate edit form
      const startYearInput = document.getElementById('session-start-year');
      const endYearInput = document.getElementById('session-end-year');
      const startDateInput = document.getElementById('session-start-date');
      const endDateInput = document.getElementById('session-end-date');
      
      if (startYearInput) startYearInput.value = session.startYear || '';
      if (endYearInput) endYearInput.value = session.endYear || '';
      
      if (session.startDate && startDateInput) {
        const startDate = session.startDate.toDate();
        startDateInput.value = startDate.toISOString().split('T')[0];
      }
      
      if (session.endDate && endDateInput) {
        const endDate = session.endDate.toDate();
        endDateInput.value = endDate.toISOString().split('T')[0];
      }
    } else if (data.session) {
      const displaySessionName = document.getElementById('display-session-name');
      const displayCurrentTerm = document.getElementById('display-current-term');
      
      if (displaySessionName) displaySessionName.textContent = data.session;
      if (displayCurrentTerm) displayCurrentTerm.textContent = data.term || 'First Term';
    }
    
    // Current term
    const currentTermSelect = document.getElementById('current-term');
    if (currentTermSelect) {
      currentTermSelect.value = data.term || 'First Term';
    }
    
    // Resumption date handling
    const displayNextResumption = document.getElementById('display-next-resumption');
    const resumptionDateInput = document.getElementById('resumption-date');
    
    if (data.resumptionDate) {
      try {
        const resumptionDate = data.resumptionDate.toDate();
        
        if (displayNextResumption) {
          displayNextResumption.textContent = resumptionDate.toLocaleDateString('en-GB');
        }
        
        if (resumptionDateInput) {
          resumptionDateInput.value = resumptionDate.toISOString().split('T')[0];
        }
      } catch (error) {
        console.error('Error parsing resumption date:', error);
        if (displayNextResumption) displayNextResumption.textContent = 'Not set';
        if (resumptionDateInput) resumptionDateInput.value = '';
      }
    } else {
      if (displayNextResumption) displayNextResumption.textContent = 'Not set';
      if (resumptionDateInput) resumptionDateInput.value = '';
    }
    
    console.log('✓ Settings loaded successfully');
    
    // Load class hierarchy AFTER settings display is complete
    setTimeout(async () => {
      try {
        console.log('📊 Initializing class hierarchy...');
        const hierarchyStatus = await window.classHierarchy.initializeClassHierarchy();
        
        if (hierarchyStatus && hierarchyStatus.isEmpty) {
          console.log('⚠️ Class hierarchy is empty');
        }
        
        // Only load UI if we're still on settings page
        const settingsSection = document.getElementById('settings');
        if (settingsSection && settingsSection.style.display !== 'none') {
          await loadClassHierarchyUI();
          console.log('✓ Class hierarchy UI loaded');
        } else {
          console.log('ℹ️ User navigated away, skipping hierarchy UI load');
        }
      } catch (error) {
        console.error('⚠️ Class hierarchy load failed:', error);
      }
    }, 300);
    
  } catch (error) {
    console.error('Error loading settings:', error);
    window.showToast?.('Failed to load settings', 'danger');
  }
}

/* ======================================== 
   UPDATE SESSION SETTINGS
======================================== */

async function updateSessionSettings() {
  const startYear       = parseInt(document.getElementById('session-start-year')?.value);
  const endYear         = parseInt(document.getElementById('session-end-year')?.value);
  const startDateVal    = document.getElementById('session-start-date')?.value;
  const endDateVal      = document.getElementById('session-end-date')?.value;
  const currentTerm     = document.getElementById('current-term')?.value;
  const resumptionVal   = document.getElementById('resumption-date')?.value;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!startYear || !endYear) {
    window.showToast?.('Please enter both start and end years for the session', 'warning');
    return;
  }

  if (endYear !== startYear + 1) {
    window.showToast?.('End year must be exactly one year after start year (e.g. 2025/2026)', 'warning');
    return;
  }

  if (!currentTerm) {
    window.showToast?.('Please select the current term', 'warning');
    return;
  }

  if (!startDateVal || !endDateVal) {
    window.showToast?.('Please set both session start and end dates', 'warning');
    return;
  }

  const startDate   = new Date(startDateVal);
  const endDate     = new Date(endDateVal);

  if (endDate <= startDate) {
    window.showToast?.('Session end date must be after the start date', 'warning');
    return;
  }

  // ── Detect term change for arrears migration ───────────────────────────────
  let previousTerm = null;
  try {
    const existingDoc = await db.collection('settings').doc('current').get();
    if (existingDoc.exists) {
      previousTerm = existingDoc.data().term || null;
    }
  } catch (e) {
    console.warn('Could not read existing term for comparison:', e.message);
  }

  const termChanged   = previousTerm && previousTerm !== currentTerm;
  const sessionName   = `${startYear}/${endYear}`;

  // ── Confirm if term is changing ────────────────────────────────────────────
  if (termChanged) {
    const confirmed = confirm(
      `⚠️ TERM CHANGE DETECTED\n\n` +
      `Changing from: ${previousTerm}\n` +
      `Changing to:   ${currentTerm}\n\n` +
      `This will automatically create payment records for all pupils\n` +
      `in the new term with correct arrears carried forward.\n\n` +
      `Continue?`
    );
    if (!confirmed) return;
  }

  // ── Save button state ──────────────────────────────────────────────────────
  const saveBtn = document.getElementById('save-settings-btn');
  if (saveBtn) {
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="btn-loading">Saving...</span>';
  }

  try {
    const updateData = {
      session: sessionName,
      term:    currentTerm,
      currentSession: {
        name:      sessionName,
        startYear: startYear,
        endYear:   endYear,
        startDate: firebase.firestore.Timestamp.fromDate(startDate),
        endDate:   firebase.firestore.Timestamp.fromDate(endDate)
      },
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy:   auth.currentUser.uid
    };

    // Resumption date (optional)
    if (resumptionVal) {
      updateData.resumptionDate = firebase.firestore.Timestamp.fromDate(new Date(resumptionVal));
    }

    await db.collection('settings').doc('current').set(updateData, { merge: true });

    // ── Audit log ────────────────────────────────────────────────────────────
    await db.collection('audit_log').add({
      action:           'update_settings',
      collection:       'settings',
      documentId:       'current',
      changes: {
        session:      sessionName,
        term:         currentTerm,
        startYear,
        endYear,
        termChanged,
        previousTerm: previousTerm || null
      },
      performedBy:      auth.currentUser.uid,
      performedByEmail: auth.currentUser.email,
      timestamp:        firebase.firestore.FieldValue.serverTimestamp(),
      userAgent:        navigator.userAgent
    });

    console.log('✅ Session settings saved successfully');

    // ── Run arrears migration if term changed ─────────────────────────────────
    if (termChanged && typeof window.migrateArrearsOnTermChange === 'function') {
      window.showToast?.('Settings saved! Running arrears migration for new term...', 'info', 4000);

      try {
        const migrationResult = await window.migrateArrearsOnTermChange(
          previousTerm,
          currentTerm,
          sessionName
        );

        window.showToast?.(
          `✅ Settings updated!\n\n` +
          `Session: ${sessionName}\n` +
          `Term: ${currentTerm}\n\n` +
          `Arrears migration:\n` +
          `• ${migrationResult.count} payment records created\n` +
          `• ${migrationResult.arrearsCount} pupils have arrears\n` +
          `• Total arrears: ₦${(migrationResult.totalArrears || 0).toLocaleString()}`,
          'success',
          10000
        );
      } catch (migrationError) {
        console.error('⚠️ Arrears migration failed:', migrationError);
        window.showToast?.(
          `Settings saved, but arrears migration failed:\n${migrationError.message}\n\n` +
          `You can run it manually from the Fee Management section.`,
          'warning',
          8000
        );
      }

    } else {
      window.showToast?.(
        `✅ Settings updated!\n\nSession: ${sessionName}\nTerm: ${currentTerm}`,
        'success',
        5000
      );
    }

    // Reload display
    await loadCurrentSettings();
    await loadSessionHistory();

  } catch (error) {
    console.error('❌ Error saving session settings:', error);
    window.showToast?.(`Failed to save settings: ${error.message}`, 'danger', 6000);
  } finally {
    if (saveBtn) {
      saveBtn.disabled  = false;
      saveBtn.innerHTML = '💾 Save Settings';
    }
  }
}

// Expose globally
window.updateSessionSettings = updateSessionSettings;

// ── Wire up the save button via DOMContentLoaded ───────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('save-settings-btn');
  if (saveBtn) {
    const freshBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(freshBtn, saveBtn);
    document.getElementById('save-settings-btn').addEventListener('click', updateSessionSettings);
    console.log('✅ Session settings save button wired up');
  }
});

/* ======================================== 
   START NEW ACADEMIC SESSION
======================================== */

async function confirmStartNewSession() {
  // Check for pending promotions
  const pendingPromotions = await db.collection('promotions')
    .where('status', '==', 'pending')
    .get();
  
  const pendingCount = pendingPromotions.size;
  
  // Check for pupils in terminal class
  let pupilsInTerminalClass = 0;
  
  try {
    // Get class hierarchy to find terminal class
    const hierarchy = await window.classHierarchy.getHierarchy();
    
    if (hierarchy.length > 0) {
      const terminalClassName = hierarchy[hierarchy.length - 1].name;
      
      const pupilsSnap = await db.collection('pupils')
        .where('class.name', '==', terminalClassName)
        .get();
      
      pupilsInTerminalClass = pupilsSnap.size;
    }
  } catch (error) {
    console.error('Error checking terminal class pupils:', error);
  }
  
  // Build warning message
  const issues = [];
  
  if (pendingCount > 0) {
    issues.push(`• ${pendingCount} pending promotion request(s) not yet approved`);
  }
  
  if (pupilsInTerminalClass > 0) {
    issues.push(`• ${pupilsInTerminalClass} pupil(s) still in terminal class (should be in alumni)`);
  }
  
  // Show blocking or warning dialog
  if (issues.length > 0) {
    const warningMessage = 
      '⚠️ WARNING: Issues detected before starting new session:\n\n' +
      issues.join('\n') + '\n\n' +
      'RECOMMENDATIONS:\n' +
      '1. Approve or reject all pending promotions\n' +
      '2. Move terminal class pupils to alumni\n' +
      '3. Verify all teachers have completed their work\n\n' +
      'Do you want to:\n' +
      '• Click CANCEL to fix these issues first (RECOMMENDED)\n' +
      '• Click OK to force start anyway (NOT RECOMMENDED)';
    
    const forceProceed = confirm(warningMessage);
    
    if (!forceProceed) {
      window.showToast?.('Session start cancelled. Please resolve pending issues first.', 'info', 5000);
      return;
    }
    
    // Admin chose to force - require password confirmation
    const adminConfirm = prompt(
      '⚠️ FORCE START NEW SESSION\n\n' +
      'This will archive the current session with unresolved issues.\n\n' +
      'Type "FORCE START" (without quotes) to confirm:'
    );
    
    if (adminConfirm !== 'FORCE START') {
      window.showToast?.('Session start cancelled', 'info');
      return;
    }
    
    // Log forced start with issues
    await db.collection('session_issues').add({
      sessionStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
      forcedBy: auth.currentUser.uid,
      pendingPromotions: pendingCount,
      pupilsInTerminalClass: pupilsInTerminalClass,
      issues: issues,
      type: 'forced_session_start'
    });
    
  } else {
    const confirmation = confirm(
      '⚠️ START NEW ACADEMIC SESSION?\n\n' +
      'This will:\n' +
      '• Archive the current session\n' +
      '• Create a new session (next year)\n' +
      '• Reset current term to "First Term"\n' +
      '• Open promotion period for teachers\n\n' +
      'Continue?'
    );
    
    if (!confirmation) return;
    
    // Double confirmation
    const doubleCheck = prompt(
      'Type "START NEW SESSION" (without quotes) to confirm:'
    );
    
    if (doubleCheck !== 'START NEW SESSION') {
      window.showToast?.('Action cancelled', 'info');
      return;
    }
  }
  
  // Proceed with session start
  await startNewSession();
}

async function startNewSession() {
  const btn = document.getElementById('start-new-session-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loading">Starting new session...</span>';
  }
  
  try {
    const settingsDoc = await db.collection('settings').doc('current').get();
    
    if (!settingsDoc.exists) {
      window.showToast?.('No current session found', 'danger');
      return;
    }
    
    const currentData = settingsDoc.data();
    const currentSession = currentData.currentSession;
    
    if (!currentSession || !currentSession.endYear) {
      window.showToast?.('Invalid session data. Please configure settings first.', 'danger');
      return;
    }
    
    // Archive current session
    const archiveId = `${currentSession.startYear}-${currentSession.endYear}`;
    await db.collection('sessions').doc(archiveId).set({
      ...currentSession,
      status: 'archived',
      archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
      archivedBy: auth.currentUser.uid
    });
    
    // Create new session
    const newStartYear = currentSession.endYear;
    const newEndYear = currentSession.endYear + 1;
    const newSessionName = `${newStartYear}/${newEndYear}`;
    
    const newStartDate = new Date(newStartYear, 8, 1);
    const newEndDate = new Date(newEndYear, 6, 31);
    const newResumptionDate = new Date(newStartYear, 8, 1);
    
    await db.collection('settings').doc('current').update({
      currentSession: {
        name: newSessionName,
        startYear: newStartYear,
        endYear: newEndYear,
        startDate: firebase.firestore.Timestamp.fromDate(newStartDate),
        endDate: firebase.firestore.Timestamp.fromDate(newEndDate)
      },
      session: newSessionName,
      term: 'First Term',
      resumptionDate: firebase.firestore.Timestamp.fromDate(newResumptionDate),
      promotionPeriodActive: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

// ════════════════════════════════════════════════════════════════
// New-session arrears migration
// ════════════════════════════════════════════════════════════════

console.log('🔄 Migrating arrears from old session to new session...');

const oldSessionName  = `${currentSession.startYear}/${currentSession.endYear}`;
const encodedOldSess  = oldSessionName.replace(/\//g, '-');
const encodedNewSess  = newSessionName.replace(/\//g, '-');

const pupilsSnap = await db.collection('pupils').get();

// Pre-load all fee structures once
const feeStructuresSnap = await db.collection('fee_structures').get();
const feeStructureMap   = {};
feeStructuresSnap.forEach(doc => {
  const d = doc.data();
  feeStructureMap[d.classId] = Math.round(Number(d.total) || 0);
});

let prevTermRepaired   = 0;
let newDocsCreated     = 0;
let newDocsUpdated     = 0;
let pupilsWithArrears  = 0;
let totalArrearsAmount = 0;
let skippedCount       = 0;

// Ensure old session Third Term docs exist ─────────────
for (const pupilDoc of pupilsSnap.docs) {
  const pupilId   = pupilDoc.id;
  const pupilData = pupilDoc.data();
  const classId   = pupilData.class?.id;

  if (pupilData.status === 'alumni' || pupilData.isActive === false) continue;
  if (!classId) continue;

  const baseFee = feeStructureMap[classId] || 0;
  if (baseFee === 0) continue;

  const thirdTermAmountDue = window.calculateAdjustedFee
    ? window.calculateAdjustedFee(pupilData, baseFee, 'Third Term')
    : baseFee;

  // Not enrolled for Third Term — nothing to carry forward
  if (thirdTermAmountDue === 0 && baseFee > 0) continue;

  const thirdTermDocId = `${pupilId}_${encodedOldSess}_Third Term`;
  const thirdTermRef   = db.collection('payments').doc(thirdTermDocId);

  try {
    const thirdTermDoc = await thirdTermRef.get();

    if (!thirdTermDoc.exists) {
      let thirdTermArrears = 0;
      try {
        thirdTermArrears = await window.calculateCompleteArrears(
          pupilId, oldSessionName, 'Third Term'
        );
      } catch (e) {
        console.warn(`  ⚠️ Could not get Third Term arrears for ${pupilData.name}:`, e.message);
      }

      // Sum actual payments made for Third Term
      let thirdTermPaid = 0;
      try {
        const txSnap = await db.collection('payment_transactions')
          .where('pupilId', '==', pupilId)
          .where('session', '==', oldSessionName)
          .where('term',    '==', 'Third Term')
          .get();
        txSnap.forEach(tx => {
          thirdTermPaid += Math.round(Number(tx.data().amountPaid) || 0);
        });
      } catch (e) {
        console.warn(`  ⚠️ Could not sum Third Term transactions for ${pupilData.name}:`, e.message);
      }

      const thirdTermTotalDue = thirdTermAmountDue + thirdTermArrears;
      const thirdTermBalance  = Math.max(0, thirdTermTotalDue - thirdTermPaid);

      await thirdTermRef.set({
        pupilId,
        pupilName:   pupilData.name || 'Unknown',
        classId,
        className:   pupilData.class?.name || 'Unknown',
        session:     oldSessionName,
        term:        'Third Term',
        baseFee,
        adjustedFee: thirdTermAmountDue,
        amountDue:   thirdTermAmountDue,
        arrears:     thirdTermArrears,
        totalDue:    thirdTermTotalDue,
        totalPaid:   thirdTermPaid,
        balance:     thirdTermBalance,
        status:      thirdTermBalance <= 0   ? 'paid'
                   : thirdTermPaid   >  0    ? 'partial'
                   : thirdTermArrears > 0    ? 'owing_with_arrears'
                   :                           'owing',
        lastPaymentDate: null,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
        autoCreatedBySessionMigration: true
      });

      prevTermRepaired++;
      console.log(
        `  🔧 Created missing Third Term doc for ${pupilData.name}: ` +
        `balance=₦${thirdTermBalance.toLocaleString()}`
      );

    } else {
      // Doc exists — repair corrupted balance if needed
      const storedBalance = thirdTermDoc.data().balance;
      if (isNaN(Number(storedBalance))) {
        console.warn(`  ⚠️ Corrupted Third Term balance for ${pupilData.name}, repairing...`);
        const repairedBalance = await window._recalculateTermBalance(
          pupilId, oldSessionName, 'Third Term'
        );
        await thirdTermRef.update({
          balance:    repairedBalance,
          updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
          repairedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        prevTermRepaired++;
      }
    }
  } catch (repairError) {
    console.error(
      `  ❌ Failed to repair Third Term doc for ${pupilData.name}:`,
      repairError.message
    );
  }
}

console.log(`  ✓ Old session Third Term repair complete: ${prevTermRepaired} created/repaired`);

// Create new session First Term payment docs ───────────
let batch      = db.batch();
let batchCount = 0;

for (const pupilDoc of pupilsSnap.docs) {
  const pupilId   = pupilDoc.id;
  const pupilData = pupilDoc.data();
  const classId   = pupilData.class?.id;

  if (pupilData.status === 'alumni' || pupilData.isActive === false) {
    skippedCount++;
    continue;
  }

  if (!classId) {
    skippedCount++;
    continue;
  }

  const baseFee = feeStructureMap[classId] || 0;
  if (baseFee === 0) {
    skippedCount++;
    continue;
  }

  const amountDue = window.calculateAdjustedFee
    ? window.calculateAdjustedFee(pupilData, baseFee, 'First Term')
    : baseFee;

  if (amountDue === 0 && baseFee > 0) {
    skippedCount++;
    continue;
  }

  try {
    const arrears = await window.calculateCompleteArrears(
      pupilId, newSessionName, 'First Term'
    );

    if (arrears > 0) {
      pupilsWithArrears++;
      totalArrearsAmount += arrears;
      console.log(`  💰 ${pupilData.name}: carrying ₦${arrears.toLocaleString()} into ${newSessionName}`);
    }

    const newFirstTermDocId = `${pupilId}_${encodedNewSess}_First Term`;
    const newFirstTermRef   = db.collection('payments').doc(newFirstTermDocId);
    const existingDoc       = await newFirstTermRef.get();

    const payload = {
      pupilId,
      pupilName:   pupilData.name || 'Unknown',
      classId,
      className:   pupilData.class?.name || 'Unknown',
      session:     newSessionName,
      term:        'First Term',
      baseFee,
      adjustedFee: amountDue,
      amountDue,
      arrears,
      totalDue:    amountDue + arrears,
      totalPaid:   0,
      balance:     amountDue + arrears,
      status:      arrears > 0 ? 'owing_with_arrears' : 'owing',
      lastPaymentDate: null,
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      migratedFromSession: oldSessionName
    };

    if (!existingDoc.exists) {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      batch.set(newFirstTermRef, payload);
      newDocsCreated++;
    } else {
      const existingPaid = Math.round(Number(existingDoc.data().totalPaid) || 0);
      const newTotalDue  = amountDue + arrears;
      const newBalance   = Math.max(0, newTotalDue - existingPaid);

      batch.update(newFirstTermRef, {
        arrears,
        amountDue,
        adjustedFee: amountDue,
        totalDue:    newTotalDue,
        balance:     newBalance,
        status:      newBalance   <= 0    ? 'paid'
                   : existingPaid >  0    ? 'partial'
                   : arrears      >  0    ? 'owing_with_arrears'
                   :                        'owing',
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
        migratedFromSession: oldSessionName
      });
      newDocsUpdated++;
    }

    batchCount++;

    if (batchCount >= 400) {
      await batch.commit();
      batch      = db.batch();
      batchCount = 0;
    }

    // Log to arrears_log for audit trail (only if there are arrears)
    if (arrears > 0) {
      await db.collection('arrears_log').add({
        pupilId,
        pupilName:     pupilData.name || 'Unknown',
        oldSession:    oldSessionName,
        newSession:    newSessionName,
        arrearsAmount: arrears,
        migratedAt:    firebase.firestore.FieldValue.serverTimestamp(),
        migratedBy:    auth.currentUser.uid,
        migrationReason: 'New session started'
      });
    }

  } catch (pupilError) {
    console.error(`  ⚠️ Error processing ${pupilData.name}:`, pupilError.message);
    skippedCount++;
  }
}

if (batchCount > 0) {
  await batch.commit();
}

console.log(`\n✅ New session arrears migration summary:`);
console.log(`   Old session Third Term docs repaired: ${prevTermRepaired}`);
console.log(`   New First Term docs created:          ${newDocsCreated}`);
console.log(`   New First Term docs updated:          ${newDocsUpdated}`);
console.log(`   Pupils with arrears:                  ${pupilsWithArrears}`);
console.log(`   Total arrears carried forward:        ₦${totalArrearsAmount.toLocaleString()}`);
console.log(`   Skipped (alumni/no class/no fee):     ${skippedCount}`);

window.showToast?.(
  `✓ New session ${newSessionName} started!\n\n` +
  `Arrears Migration:\n` +
  `• ${pupilsWithArrears} pupils with outstanding balances\n` +
  `• Total carried forward: ₦${totalArrearsAmount.toLocaleString()}\n` +
  `• ${newDocsCreated} new payment records created\n\n` +
  `Promotion period is now ACTIVE for teachers.`,
  'success',
  12000
);
    
    await loadCurrentSettings();
    await loadSessionHistory();
    
  } catch (error) {
    console.error('Error starting new session:', error);
    window.handleError(error, 'Failed to start new session');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🚀 Start New Session';
    }
  }
}

// Make function globally available
window.confirmStartNewSession = confirmStartNewSession;

/* ========================================
CLASS HIERARCHY MANAGEMENT
======================================== */
let currentHierarchy = null;

async function loadClassHierarchyUI() {
  const container = document.getElementById('hierarchy-container');
  
  if (!container) {
    console.error('❌ hierarchy-container element not found in DOM');
    return;
  }
  
  console.log('📋 Loading class hierarchy UI...');
  
  try {
    const classesSnapshot = await db.collection('classes').orderBy('name').get();
    
    if (classesSnapshot.empty) {
      console.warn('⚠️ No classes found in classes collection');
      renderEmptyHierarchyUI();
      return;
    }
    
    console.log(`✓ Found ${classesSnapshot.size} classes in database`);
    
    // Get all classes as objects
    const allClasses = [];
    classesSnapshot.forEach(doc => {
      allClasses.push({
        id: doc.id,
        name: doc.data().name || 'Unnamed Class'
      });
    });
    
    // Get saved hierarchy order from settings
    const hierarchyDoc = await db.collection('settings').doc('classHierarchy').get();
    
    let orderedClasses = [];
    
    if (hierarchyDoc.exists && hierarchyDoc.data().orderedClassIds) {
      const savedOrder = hierarchyDoc.data().orderedClassIds;
      console.log(`✓ Found saved order with ${savedOrder.length} classes`);
      
      // Sort classes according to saved order
      savedOrder.forEach(classId => {
        const found = allClasses.find(c => c.id === classId);
        if (found) {
          orderedClasses.push(found);
        }
      });
      
      // Add any NEW classes that aren't in the saved order yet (append to end)
      allClasses.forEach(cls => {
        if (!savedOrder.includes(cls.id)) {
          orderedClasses.push(cls);
          console.log(`➕ Adding new class "${cls.name}" to hierarchy`);
        }
      });
    } else {
      // No saved order - use alphabetical order from classes
      console.log('ℹ️ No saved order found, using alphabetical order');
      orderedClasses = allClasses.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    console.log(`✓ Rendering ${orderedClasses.length} classes in hierarchy UI`);
    renderHierarchyUI(orderedClasses);
    
  } catch (error) {
    console.error('❌ Error loading class hierarchy UI:', error);
    if (container) {
      container.innerHTML = `
        <div style="padding:var(--space-lg); text-align:center; color:var(--color-danger);">
          <p><strong>Error Loading Classes</strong></p>
          <p>${error.message}</p>
          <button class="btn btn-primary" onclick="window.refreshHierarchyUI()">
            🔄 Retry
          </button>
        </div>
      `;
    }
    window.showToast?.('Failed to load class hierarchy', 'danger');
  }
}

function renderEmptyHierarchyUI() {
  const container = document.getElementById('hierarchy-container');
  if (!container) return;
  
  console.log('📭 Rendering empty hierarchy UI');
  
  container.innerHTML = `
    <div style="text-align:center; padding:var(--space-2xl); background:var(--color-gray-100); border-radius:var(--radius-md);">
      <h3 style="color:var(--color-gray-600); margin-bottom:var(--space-md);">📚 No Classes Created Yet</h3>
      <p style="color:var(--color-gray-600); margin-bottom:var(--space-lg);">
        You need to create classes first in the <strong>"Classes"</strong> section above, then return here to arrange them in progression order.
      </p>
      <button class="btn btn-primary" onclick="window.showSection('classes')">
        ➕ Go to Classes Section
      </button>
    </div>
  `;
}

function renderHierarchyUI(orderedClasses) {
  const container = document.getElementById('hierarchy-container');
  if (!container) {
    console.error('❌ hierarchy-container element not found in DOM');
    return;
  }

  if (!Array.isArray(orderedClasses) || orderedClasses.length === 0) {
    console.warn('⚠️ No classes provided to renderHierarchyUI');
    renderEmptyHierarchyUI();
    return;
  }

  console.log(`🎨 Rendering ${orderedClasses.length} classes in UI`);

  container.innerHTML = `
    <div class="hierarchy-instructions">
      <p><strong>📋 Class Progression Order (${orderedClasses.length} classes found)</strong></p>
      <p>Drag classes to rearrange the order from lowest to highest level. The <strong>last class</strong> is the terminal/graduation class.</p>
      <p style="color:var(--color-gray-600); font-size:var(--text-sm); margin-top:var(--space-sm);">
        💡 <strong>Tip:</strong> To add/remove classes, go to the "Classes" section above, then click "🔄 Refresh from Classes" below.
      </p>
    </div>

    <div id="sortable-class-list" class="sortable-list"></div>

    <div style="margin-top:var(--space-lg); display:flex; gap:var(--space-md); flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="window.saveHierarchyOrder()">
        💾 Save Progression Order
      </button>
      <button class="btn btn-secondary" onclick="window.refreshHierarchyUI()">
        🔄 Refresh from Classes
      </button>
    </div>

    <div style="margin-top:var(--space-lg); padding:var(--space-md); background:#e3f2fd; border-radius:var(--radius-sm);">
      <p style="margin:0; color:#1565c0; font-size:var(--text-sm);">
        ℹ️ <strong>Currently showing ${orderedClasses.length} class(es)</strong> from your Classes section.
        If you added new classes, click "🔄 Refresh from Classes" to see them here.
      </p>
    </div>
  `;

  const listContainer = document.getElementById('sortable-class-list');
  if (!listContainer) {
    console.error('❌ sortable-class-list not found after innerHTML update');
    return;
  }

  // ── Build items ──────────────────────────────────────────────────────────
  orderedClasses.forEach((cls, index) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'hierarchy-item draggable';
    itemDiv.draggable = true;
    itemDiv.dataset.classId = cls.id;
    itemDiv.dataset.index = index;

    const isTerminal = index === orderedClasses.length - 1;

    itemDiv.innerHTML = `
      <span class="drag-handle" style="cursor:grab;">☰</span>
      <span class="hierarchy-number">${index + 1}</span>
      <span class="class-name">${cls.name}</span>
      ${isTerminal ? '<span class="terminal-badge">🎓 Terminal/Graduation Class</span>' : ''}
    `;

    listContainer.appendChild(itemDiv);
  });

  // ── Drag state ───────────────────────────────────────────────────────────
  let dragSrc = null;   
  let dragSrcIndex = -1;  

  // ── Helper: re-number all items and update terminal badge ─────────────────
  function updateNumbers() {
    const items = listContainer.querySelectorAll('.hierarchy-item');
    items.forEach((item, idx) => {
      const numEl = item.querySelector('.hierarchy-number');
      if (numEl) numEl.textContent = idx + 1;

      const badge = item.querySelector('.terminal-badge');
      const isLast = idx === items.length - 1;

      if (isLast && !badge) {
        const span = document.createElement('span');
        span.className = 'terminal-badge';
        span.textContent = '🎓 Terminal/Graduation Class';
        item.appendChild(span);
      } else if (!isLast && badge) {
        badge.remove();
      }
    });
  }

  // ── Helper: get element directly below the cursor in the list ─────────────
  function getDragAfterElement(y) {
    const draggables = [...listContainer.querySelectorAll('.hierarchy-item:not(.dragging)')];

    return draggables.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // ── Attach listeners to each item ────────────────────────────────────────
  function attachListeners(item) {
    item.addEventListener('dragstart', function (e) {
      dragSrc = this;
      dragSrcIndex = [...listContainer.children].indexOf(this);
      this.classList.add('dragging');
      this.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.dataset.classId);
    });

    item.addEventListener('dragend', function () {
      this.classList.remove('dragging');
      this.style.opacity = '';
      dragSrc = null;
      dragSrcIndex = -1;
      // Clear any hover highlights
      listContainer.querySelectorAll('.hierarchy-item').forEach(el => {
        el.style.borderTop = '';
        el.style.borderBottom = '';
      });
      updateNumbers();
    });

    item.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    item.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!dragSrc || dragSrc === this) return;

      // Determine drop position relative to the target's midpoint
      const box = this.getBoundingClientRect();
      const midY = box.top + box.height / 2;
      const insertBefore = e.clientY < midY;

      if (insertBefore) {
        listContainer.insertBefore(dragSrc, this);
      } else {
        listContainer.insertBefore(dragSrc, this.nextSibling);
      }
    });
  }

  listContainer.querySelectorAll('.hierarchy-item').forEach(attachListeners);

  // ── Container-level dragover: handle dragging over the empty bottom area ──
  listContainer.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (!dragSrc) return;

    const afterEl = getDragAfterElement(e.clientY);
    if (afterEl == null) {
      listContainer.appendChild(dragSrc);
    } else {
      listContainer.insertBefore(dragSrc, afterEl);
    }
  });

  // ── saveHierarchyOrder ────────────────────────────────────────────────────
  window.saveHierarchyOrder = async function () {
    const items = listContainer.querySelectorAll('.hierarchy-item');

    if (items.length === 0) {
      window.showToast?.('No classes to save', 'warning');
      return;
    }

    const orderedClassIds = Array.from(items).map(item => item.dataset.classId);

    try {
      const result = await window.classHierarchy.saveClassHierarchy(orderedClassIds);

      if (result.success) {
        window.showToast?.('✓ Class progression order saved successfully!', 'success');
        await loadClassHierarchyUI();
      } else {
        window.showToast?.('Failed to save progression order', 'danger');
      }
    } catch (error) {
      console.error('Error saving hierarchy order:', error);
      window.handleError?.(error, 'Failed to save progression order');
    }
  };

  // ── refreshHierarchyUI ────────────────────────────────────────────────────
  window.refreshHierarchyUI = async function () {
    console.log('🔄 Refreshing hierarchy from classes...');

    const btn = document.querySelector('#hierarchy-container button.btn-secondary');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-loading">Refreshing...</span>';
    }

    try {
      await window.classHierarchy.initializeClassHierarchy();
      await loadClassHierarchyUI();
      window.showToast?.('✓ Refreshed from Classes section', 'success');
    } catch (error) {
      console.error('❌ Error refreshing hierarchy:', error);
      window.showToast?.('Failed to refresh hierarchy', 'danger');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 Refresh from Classes';
      }
    }
  };

  console.log(`✓ Successfully rendered ${orderedClasses.length} classes in hierarchy UI`);
}

/**
 * Automatic arrears migration when term changes
 */
async function migrateArrearsOnTermChange(oldTerm, newTerm, session) {
  console.log(`\n🔄 TERM CHANGE MIGRATION: ${oldTerm} → ${newTerm} (${session})`);

  try {
    const encodedSession = session.replace(/\//g, '-');

    // Ensure previous term payment docs exist ──────────────────
    console.log(`  📋 Ensuring ${oldTerm} payment docs exist before migrating...`);

    const pupilsSnap = await db.collection('pupils').get();

    if (pupilsSnap.empty) {
      return { success: true, count: 0, totalArrears: 0 };
    }

    const feeStructuresSnap = await db.collection('fee_structures').get();
    const feeStructureMap = {};
    feeStructuresSnap.forEach(doc => {
      const data = doc.data();
      feeStructureMap[data.classId] = Math.round(Number(data.total) || 0);
    });

    // Build/repair previous term docs ──────────────────────────
    let prevTermRepaired = 0;

    for (const pupilDoc of pupilsSnap.docs) {
      const pupilId   = pupilDoc.id;
      const pupilData = pupilDoc.data();
      const classId   = pupilData.class?.id;

      if (pupilData.status === 'alumni' || pupilData.isActive === false) continue;
      if (!classId) continue;

      const baseFee = feeStructureMap[classId] || 0;
      if (baseFee === 0) continue;

      const oldTermAmountDue = window.calculateAdjustedFee
        ? window.calculateAdjustedFee(pupilData, baseFee, oldTerm)
        : baseFee;

      // Not enrolled for old term — skip
      if (oldTermAmountDue === 0 && baseFee > 0) continue;

      const oldTermDocId  = `${pupilId}_${encodedSession}_${oldTerm}`;
      const oldTermRef    = db.collection('payments').doc(oldTermDocId);
      const oldTermDoc    = await oldTermRef.get();

      if (!oldTermDoc.exists) {
        // Doc is missing — calculate what the balance should be.
        let oldTermArrears = 0;
        try {
          oldTermArrears = await window.calculateCompleteArrears(pupilId, session, oldTerm);
        } catch (e) {
          console.warn(`  ⚠️ Could not calculate arrears for ${oldTerm}:`, e.message);
        }

        const oldTermTotalDue = oldTermAmountDue + oldTermArrears;

        // Check how much was actually paid for old term
        let oldTermPaid = 0;
        try {
          const txSnap = await db.collection('payment_transactions')
            .where('pupilId', '==', pupilId)
            .where('session', '==', session)
            .where('term',    '==', oldTerm)
            .get();
          txSnap.forEach(tx => {
            oldTermPaid += Math.round(Number(tx.data().amountPaid) || 0);
          });
        } catch (e) {
          console.warn(`  ⚠️ Could not sum transactions for ${oldTerm}:`, e.message);
        }

        const oldTermBalance = Math.max(0, oldTermTotalDue - oldTermPaid);

        await oldTermRef.set({
          pupilId,
          pupilName:   pupilData.name || 'Unknown',
          classId,
          className:   pupilData.class?.name || 'Unknown',
          session,
          term:        oldTerm,
          baseFee,
          adjustedFee: oldTermAmountDue,
          amountDue:   oldTermAmountDue,
          arrears:     oldTermArrears,
          totalDue:    oldTermTotalDue,
          totalPaid:   oldTermPaid,
          balance:     oldTermBalance,
          status:      oldTermBalance <= 0 ? 'paid'
                     : oldTermPaid  >  0   ? 'partial'
                     : oldTermArrears > 0  ? 'owing_with_arrears'
                     :                       'owing',
          lastPaymentDate: null,
          createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
          autoCreatedByMigration: true
        });

        prevTermRepaired++;
        console.log(
          `  🔧 Created missing ${oldTerm} doc for ${pupilData.name}: ` +
          `due=₦${oldTermTotalDue.toLocaleString()}, paid=₦${oldTermPaid.toLocaleString()}, ` +
          `balance=₦${oldTermBalance.toLocaleString()}`
        );

      } else {
        // Doc exists — verify balance field is a valid number.
        // If corrupted, recalculate and repair it.
        const storedBalance = oldTermDoc.data().balance;
        const storedPaid    = oldTermDoc.data().totalPaid;

        if (isNaN(Number(storedBalance))) {
          console.warn(`  ⚠️ Corrupted balance field for ${pupilData.name} ${oldTerm}, repairing...`);

          const repairedBalance = await window._recalculateTermBalance(pupilId, session, oldTerm);

          await oldTermRef.update({
            balance:   repairedBalance,
            status:    repairedBalance <= 0  ? 'paid'
                     : Number(storedPaid) > 0 ? 'partial'
                     :                          'owing',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            repairedAt: firebase.firestore.FieldValue.serverTimestamp()
          });

          prevTermRepaired++;
        }
      }
    }

    console.log(`  ✓ Previous term doc repair complete: ${prevTermRepaired} created/repaired`);

    // Now create new-term payment docs ─────────────────────────

    let createdCount      = 0;
    let updatedCount      = 0;
    let arrearsCount      = 0;
    let totalArrearsAmount = 0;
    let skippedCount      = 0;

    let batch      = db.batch();
    let batchCount = 0;

    for (const pupilDoc of pupilsSnap.docs) {
      const pupilId   = pupilDoc.id;
      const pupilData = pupilDoc.data();
      const classId   = pupilData.class?.id;

      if (pupilData.status === 'alumni' || pupilData.isActive === false) {
        skippedCount++;
        continue;
      }

      if (!classId) {
        skippedCount++;
        continue;
      }

      const baseFee = feeStructureMap[classId] || 0;
      if (baseFee === 0) {
        skippedCount++;
        continue;
      }

      const amountDue = window.calculateAdjustedFee
        ? window.calculateAdjustedFee(pupilData, baseFee, newTerm)
        : baseFee;

      if (amountDue === 0 && baseFee > 0) {
        skippedCount++;
        continue;
      }

      try {
        // Now that previous term docs exist, this will cascade correctly
        const arrears = await window.calculateCompleteArrears(pupilId, session, newTerm);

        if (arrears > 0) {
          arrearsCount++;
          totalArrearsAmount += arrears;
        }

        const newPaymentDocId = `${pupilId}_${encodedSession}_${newTerm}`;
        const newPaymentRef   = db.collection('payments').doc(newPaymentDocId);
        const existingDoc     = await newPaymentRef.get();

        const paymentPayload = {
          pupilId,
          pupilName:   pupilData.name || 'Unknown',
          classId,
          className:   pupilData.class?.name || 'Unknown',
          session,
          term:        newTerm,
          baseFee,
          adjustedFee: amountDue,
          amountDue,
          arrears,
          totalDue:    amountDue + arrears,
          totalPaid:   0,
          balance:     amountDue + arrears,
          status:      arrears > 0 ? 'owing_with_arrears' : 'owing',
          lastPaymentDate: null,
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
          migratedFrom: oldTerm,
          autoCreated: true
        };

        if (!existingDoc.exists) {
          // Fresh create
          paymentPayload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          batch.set(newPaymentRef, paymentPayload);
          createdCount++;
        } else {
          // Doc already exists (e.g. from a previous partial migration attempt).
          // Only update the arrears/balance fields — preserve any payments already recorded.
          const existingData  = existingDoc.data();
          const existingPaid  = Math.round(Number(existingData.totalPaid) || 0);
          const newTotalDue   = amountDue + arrears;
          const newBalance    = Math.max(0, newTotalDue - existingPaid);

          batch.update(newPaymentRef, {
            arrears,
            amountDue,
            adjustedFee: amountDue,
            totalDue:    newTotalDue,
            balance:     newBalance,
            status:      newBalance <= 0    ? 'paid'
                       : existingPaid > 0   ? 'partial'
                       : arrears > 0        ? 'owing_with_arrears'
                       :                      'owing',
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
            migratedFrom: oldTerm
          });
          updatedCount++;
        }

        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          batch      = db.batch();
          batchCount = 0;
        }

      } catch (pupilError) {
        console.error(`⚠️ Error processing ${pupilData.name}:`, pupilError.message);
        skippedCount++;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`\n✅ Term change migration complete:`);
    console.log(`   Previous term docs repaired: ${prevTermRepaired}`);
    console.log(`   New term docs created:       ${createdCount}`);
    console.log(`   New term docs updated:       ${updatedCount}`);
    console.log(`   Pupils with arrears:         ${arrearsCount}`);
    console.log(`   Total arrears migrated:      ₦${totalArrearsAmount.toLocaleString()}`);
    console.log(`   Skipped:                     ${skippedCount}`);

    return {
      success:      true,
      count:        createdCount + updatedCount,
      arrearsCount,
      totalArrears: totalArrearsAmount
    };

  } catch (error) {
    console.error('❌ Term change migration failed:', error);
    throw error;
  }
}

window.migrateArrearsOnTermChange = migrateArrearsOnTermChange;
// Export hierarchy functions globally
window.loadClassHierarchyUI = loadClassHierarchyUI;
window.renderEmptyHierarchyUI = renderEmptyHierarchyUI;
window.renderHierarchyUI = renderHierarchyUI;
window.showSection = showSection;

// Make functions globally available
window.editFeeStructure = editFeeStructure;
window.migrateArrearsOnTermChange = migrateArrearsOnTermChange;


console.log('✅ Complete fee management fixes loaded');

// Make all UI functions globally available
window.showTeacherForm = showTeacherForm;
window.cancelTeacherForm = cancelTeacherForm;
window.showPupilForm = showPupilForm;
window.cancelPupilForm = cancelPupilForm;
window.editPupil = editPupil;
window.showClassForm = showClassForm;
window.addClass = addClass;
window.showSubjectForm = showSubjectForm;
window.addSubject = addSubject;
window.assignTeacherToClass = assignTeacherToClass;
window.unassignTeacher = unassignTeacher;
window.showAnnounceForm = showAnnounceForm;
window.addAnnouncement = addAnnouncement;
window.loadCurrentSettings = loadCurrentSettings;
window.loadAlumni = loadAlumni;

/* ======================================== 
   SESSION VALIDATION ON LOAD
======================================== */

window.addEventListener('load', async () => {
  try {
    const settings = await window.getCurrentSettings();
    
    // Check if session is configured
    if (!settings.session || !settings.currentSession) {
      window.showToast?.(
        '⚠️ School settings incomplete. Please configure session details in School Settings.',
        'warning',
        8000
      );
      console.warn('Session not configured properly:', settings);
    } else {
      console.log('✓ Session validated:', settings.session);
    }
  } catch (error) {
    console.error('Error validating session:', error);
  }
});

console.log('✓ Session validation loaded');

/* ========================================
   INITIALIZE LUCIDE ICONS
======================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
        console.log('✓ Lucide icons initialized');
    }
});

// Toggle all pupils selection for bulk operations
function toggleAllPupils(masterCheckbox) {
  console.log('🔘 toggleAllPupils called:', masterCheckbox?.checked);
  
  const checkboxes = document.querySelectorAll('.pupil-checkbox');
  const isChecked = masterCheckbox.checked;
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = isChecked;
  });
  
  updateBulkActionButtons();
}

window.toggleAllPupils = toggleAllPupils;
window.updateBulkActionButtons = updateBulkActionButtons;
window.applyBulkAction = applyBulkAction;
window.bulkReassignClass = bulkReassignClass;
window.bulkDeletePupils = bulkDeletePupils;

console.log('✓ Bulk operations functions loaded and exposed globally');

/**
 * Export all pupils data to CSV
 */
async function exportPupilsData() {
    try {
        window.showToast?.('Preparing pupils export...', 'info', 2000);

        const snap = await db.collection('pupils').get();

        if (snap.empty) {
            window.showToast?.('No pupils found to export', 'warning', 4000);
            return;
        }

        const headers = [
            'Name', 'Admission No', 'Class', 'Gender', 'Date of Birth',
            'Parent Name', 'Parent Email', 'Contact', 'Address', 'Email'
        ];

        const rows = snap.docs.map(doc => {
            const p = doc.data();
            return [
                p.name || '',
                p.admissionNo || '',
                p.class?.name || p.class || '-',
                p.gender || '',
                p.dob || '',
                p.parentName || '',
                p.parentEmail || '',
                p.contact || '',
                p.address || '',
                p.email || ''
            ];
        });

        const csv = [
            headers,
            ...rows
        ].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
         .join('\n');

        downloadCSV(csv, `pupils_export_${new Date().toISOString().split('T')[0]}.csv`);

        window.showToast?.(`✓ Exported ${snap.size} pupil record(s)`, 'success');
    } catch (err) {
        console.error('Pupils export failed:', err);
        window.showToast?.('Export failed. Please try again.', 'danger');
    }
}

/**
 * Export results (filtered by term/session)
 */
async function exportResultsData() {
    try {
        const term = prompt('Enter term (First Term / Second Term / Third Term):')?.trim();
        if (!term) return;

        const session = prompt('Enter session (e.g. 2025/2026) or leave empty for all:')?.trim();

        window.showToast?.('Preparing results export...', 'info', 2000);

        let query = db.collection('results');
        if (term)   query = query.where('term', '==', term);
        if (session) query = query.where('session', '==', session);

        const snap = await query.get();

        if (snap.empty) {
            window.showToast?.('No results found for selected filters', 'warning');
            return;
        }

        const headers = ['Pupil ID', 'Term', 'Session', 'Subject', 'CA Score', 'Exam Score', 'Total'];

        const rows = snap.docs.map(doc => {
            const r = doc.data();
            const total = (Number(r.caScore) || 0) + (Number(r.examScore) || 0);
            return [
                r.pupilId || '',
                r.term || '',
                r.session || '',
                r.subject || '',
                r.caScore ?? 0,
                r.examScore ?? 0,
                total
            ];
        });

        const csv = [
            headers,
            ...rows
        ].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
         .join('\n');

        const filename = `results_${term.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
        downloadCSV(csv, filename);

        window.showToast?.(`✓ Exported ${snap.size} result record(s)`, 'success');
    } catch (err) {
        console.error('Results export failed:', err);
        window.showToast?.('Export failed. Please try again.', 'danger');
    }
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

// Expose globally
window.exportPupilsData = exportPupilsData;
window.exportResultsData = exportResultsData;

console.log('✓ Data export functions loaded');

/**
 * ✅ Helper functions for financial calculations
 */
window.getPreviousSessionName = function(currentSession) {
    const match = currentSession.match(/(\d{4})\/(\d{4})/);
    if (!match) return null;
    
    const startYear = parseInt(match[1]);
    const endYear = parseInt(match[2]);
    
    return `${startYear - 1}/${endYear - 1}`;
};

/* ========================================
   BULK RESULT APPROVAL
======================================== */

/**
 * Approve all currently pending result submissions.
 */
async function approveAllPendingResults() {
  const pendingCheckboxes = document.querySelectorAll('.result-submission-checkbox:checked');
  const useSelected = pendingCheckboxes.length > 0;

  const targetIds = useSelected
    ? Array.from(pendingCheckboxes).map(cb => cb.dataset.submissionId)
    : null;

  // If no checkboxes selected, fetch all pending from Firestore
  let submissionIds = [];

  if (useSelected) {
    submissionIds = targetIds;
  } else {
    try {
      const { submissions } = await adminApiGet('/api/admin/results/submissions?status=pending');

      if (submissions.length === 0) {
        window.showToast?.('No pending result submissions found.', 'info');
        return;
      }

      submissionIds = submissions.map(s => s.id);
    } catch (error) {
      console.error('❌ Error fetching pending submissions:', error);
      window.showToast?.('Failed to fetch pending submissions.', 'danger');
      return;
    }
  }

  if (submissionIds.length === 0) {
    window.showToast?.('No submissions selected or pending.', 'info');
    return;
  }

  const confirmed = confirm(
    `Approve ${submissionIds.length} pending result submission(s)?\n\n` +
    'This will publish all selected results and make them visible to pupils.\n\n' +
    'Continue?'
  );

  if (!confirmed) return;

  const btn = document.getElementById('approve-all-results-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-loading">Approving...</span>';
  }

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  // Previously: a manual re-check-then-transaction dance per
  // submission, duplicated almost line-for-line from
  // approveResultSubmission() into a separate "_silently" copy. The
  // Worker's approveSubmission() is already atomic and already
  // rejects anything that isn't "pending" (INVALID_SUBMISSION_STATE),
  // so that race-condition guard now lives in one place on the
  // server instead of two places in the browser.
  for (const submissionId of submissionIds) {
    try {
      await adminApiPost(
        `/api/admin/results/submissions/${encodeURIComponent(submissionId)}/approve`,
        {}
      );
      successCount++;
    } catch (error) {
      if (error.code === 'SUBMISSION_NOT_FOUND' || error.code === 'INVALID_SUBMISSION_STATE') {
        console.log(`⏭️ Submission ${submissionId} not available to approve (${error.code}), skipping`);
        skipCount++;
      } else {
        console.error(`❌ Failed to approve submission ${submissionId}:`, error);
        failCount++;
      }
    }
  }

  // Refresh UI once after all approvals
  await loadResultApprovals();

  const message =
    `✅ Bulk Approval Complete!\n\n` +
    `• Approved: ${successCount}\n` +
    `• Skipped (already processed): ${skipCount}\n` +
    `• Failed: ${failCount}`;

  window.showToast?.(message, failCount > 0 ? 'warning' : 'success', 8000);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '✓ Approve All Pending';
  }
}

/**
 * Toggle all result submission checkboxes
 */
function toggleAllResultsSelection(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.result-submission-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = masterCheckbox.checked;
  });
  updateResultsBulkButtons();
}

/**
 * Update bulk action button state based on selection
 */
function updateResultsBulkButtons() {
  const checked = document.querySelectorAll('.result-submission-checkbox:checked');
  const approveSelectedBtn = document.getElementById('approve-selected-results-btn');

  if (approveSelectedBtn) {
    approveSelectedBtn.disabled = checked.length === 0;
    approveSelectedBtn.textContent = checked.length > 0
      ? `✓ Approve Selected (${checked.length})`
      : '✓ Approve Selected';
  }
}

// Expose globally
window.approveAllPendingResults = approveAllPendingResults;
window.toggleAllResultsSelection = toggleAllResultsSelection;
window.updateResultsBulkButtons = updateResultsBulkButtons;

/* ============================================================
   RESULT APPROVAL — INLINE PERFORMANCE PREVIEW PANEL
   ============================================================ */

function computePreviewStats(drafts) {
  if (!drafts || drafts.length === 0) {
    return null;
  }

  const scores = drafts.map(d => {
    const ca   = Number(d.caScore)   || 0;
    const exam = Number(d.examScore) || 0;
    return ca + exam;
  });

  const total   = scores.reduce((sum, s) => sum + s, 0);
  const average = total / scores.length;
  const highest = Math.max(...scores);
  const lowest  = Math.min(...scores);
  const passed  = scores.filter(s => s >= 50).length;
  const failed  = scores.length - passed;
  const passRate = ((passed / scores.length) * 100).toFixed(1);

  // Grade distribution using existing getGrade() logic
  const gradeMap = { A1: 0, B2: 0, B3: 0, C4: 0, C5: 0, C6: 0, D7: 0, D8: 0, F9: 0 };
  scores.forEach(s => {
    const g = getGrade(s);
    gradeMap[g] = (gradeMap[g] || 0) + 1;
  });

  return {
    count:     scores.length,
    average:   average.toFixed(1),
    highest,
    lowest,
    passed,
    failed,
    passRate,
    gradeMap,
    scores
  };
}

function renderResultPreviewPanel(stats, meta) {
  if (!stats) {
    return `
      <div style="padding:var(--space-lg); text-align:center; color:var(--color-gray-600);">
        ⚠️ No draft results found for this submission. The teacher may not have saved scores yet.
      </div>
    `;
  }

  const avgNum      = parseFloat(stats.average);
  const avgGrade    = getGrade(avgNum);
  const avgRemark   = getRemark(avgNum);

  // Colour coding for average
  const avgColor =
    avgNum >= 70 ? '#16a34a' :
    avgNum >= 50 ? '#d97706' :
                   '#dc2626';

  // Grade bar — only grades that have at least 1 pupil
  const gradeOrder = ['A1','B2','B3','C4','C5','C6','D7','D8','F9'];
  const gradeColors = {
    A1: '#16a34a', B2: '#22c55e', B3: '#4ade80',
    C4: '#84cc16', C5: '#a3e635', C6: '#facc15',
    D7: '#fb923c', D8: '#f97316', F9: '#dc2626'
  };

  const gradeBars = gradeOrder
    .filter(g => stats.gradeMap[g] > 0)
    .map(g => {
      const count   = stats.gradeMap[g];
      const percent = ((count / stats.count) * 100).toFixed(0);
      return `
        <div style="display:flex; align-items:center; gap:var(--space-sm); margin-bottom:6px;">
          <span style="
            min-width:28px;
            font-size:11px;
            font-weight:700;
            color:white;
            background:${gradeColors[g]};
            padding:2px 6px;
            border-radius:4px;
            text-align:center;
          ">${g}</span>
          <div style="flex:1; height:10px; background:#e2e8f0; border-radius:999px; overflow:hidden;">
            <div style="
              width:${percent}%;
              height:100%;
              background:${gradeColors[g]};
              border-radius:999px;
              transition: width 0.4s ease;
            "></div>
          </div>
          <span style="min-width:48px; font-size:12px; color:#475569; text-align:right;">
            ${count} pupil${count !== 1 ? 's' : ''} (${percent}%)
          </span>
        </div>
      `;
    }).join('');

  // Score distribution sparkline (simple bar chart across pupils)
  const sparkBars = stats.scores
    .slice()
    .sort((a, b) => b - a)
    .map(s => {
      const h       = Math.max(4, Math.round((s / 100) * 48));
      const barColor =
        s >= 70 ? '#16a34a' :
        s >= 50 ? '#d97706' :
                  '#dc2626';
      return `<div title="${s}/100" style="
        width:6px;
        height:${h}px;
        background:${barColor};
        border-radius:2px 2px 0 0;
        flex-shrink:0;
      "></div>`;
    }).join('');

  return `
    <div style="
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-top: 3px solid #00B2FF;
      padding: var(--space-xl);
      animation: previewFadeIn 0.25s ease;
    ">
      <style>
        @keyframes previewFadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      </style>

      <!-- Header row -->
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        margin-bottom:var(--space-lg);
        flex-wrap:wrap;
        gap:var(--space-md);
      ">
        <div>
          <h4 style="margin:0 0 4px; color:#0f172a; font-size:var(--text-lg);">
            📊 Class Performance Preview
          </h4>
          <p style="margin:0; font-size:var(--text-sm); color:#64748b;">
            ${meta.subject} &nbsp;·&nbsp; ${meta.className} &nbsp;·&nbsp; ${meta.term} &nbsp;·&nbsp; ${meta.session}
          </p>
        </div>
        <div style="
          background:white;
          border:2px solid ${avgColor};
          border-radius:var(--radius-lg);
          padding:var(--space-sm) var(--space-lg);
          text-align:center;
          min-width:90px;
        ">
          <div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">
            Class Avg
          </div>
          <div style="font-size:var(--text-2xl); font-weight:800; color:${avgColor}; line-height:1.1;">
            ${stats.average}
          </div>
          <div style="font-size:11px; font-weight:700; color:${avgColor};">
            ${avgGrade} · ${avgRemark}
          </div>
        </div>
      </div>

      <!-- Key stats grid -->
      <div style="
        display:grid;
        grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));
        gap:var(--space-md);
        margin-bottom:var(--space-xl);
      ">
        ${[
          { label: 'Pupils',    value: stats.count,       icon: '👥', color: '#0369a1' },
          { label: 'Highest',   value: stats.highest,     icon: '🏆', color: '#16a34a' },
          { label: 'Lowest',    value: stats.lowest,      icon: '📉', color: '#dc2626' },
          { label: 'Passed',    value: stats.passed,      icon: '✅', color: '#16a34a' },
          { label: 'Failed',    value: stats.failed,      icon: '❌', color: '#dc2626' },
          { label: 'Pass Rate', value: stats.passRate + '%', icon: '📈', color: parseFloat(stats.passRate) >= 70 ? '#16a34a' : parseFloat(stats.passRate) >= 50 ? '#d97706' : '#dc2626' },
        ].map(item => `
          <div style="
            background:white;
            border:1px solid #e2e8f0;
            border-radius:var(--radius-md);
            padding:var(--space-md);
            text-align:center;
            box-shadow:0 1px 3px rgba(0,0,0,0.05);
          ">
            <div style="font-size:18px; margin-bottom:4px;">${item.icon}</div>
            <div style="font-size:var(--text-xl); font-weight:800; color:${item.color};">${item.value}</div>
            <div style="font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;">${item.label}</div>
          </div>
        `).join('')}
      </div>

      <!-- Two-column bottom: grade distribution + score sparkline -->
      <div style="
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:var(--space-xl);
      ">
        <!-- Grade Distribution -->
        <div>
          <p style="
            margin:0 0 var(--space-md);
            font-size:var(--text-sm);
            font-weight:700;
            color:#475569;
            text-transform:uppercase;
            letter-spacing:0.05em;
          ">Grade Distribution</p>
          ${gradeBars || '<p style="color:#94a3b8; font-size:var(--text-sm);">No grades to display</p>'}
        </div>

        <!-- Score Sparkline -->
        <div>
          <p style="
            margin:0 0 var(--space-md);
            font-size:var(--text-sm);
            font-weight:700;
            color:#475569;
            text-transform:uppercase;
            letter-spacing:0.05em;
          ">Score Distribution (ranked)</p>
          <div style="
            display:flex;
            align-items:flex-end;
            gap:2px;
            height:52px;
            padding:var(--space-xs) 0;
            overflow:hidden;
          ">
            ${sparkBars}
          </div>
          <div style="
            display:flex;
            justify-content:space-between;
            font-size:10px;
            color:#94a3b8;
            margin-top:4px;
          ">
            <span>Highest → Lowest</span>
            <span>Each bar = 1 pupil</span>
          </div>
        </div>
      </div>

      <!-- Pass/fail visual bar -->
      <div style="margin-top:var(--space-xl);">
        <div style="
          display:flex;
          justify-content:space-between;
          font-size:12px;
          font-weight:600;
          margin-bottom:6px;
          color:#475569;
        ">
          <span style="color:#16a34a;">✅ Passed: ${stats.passed} (${stats.passRate}%)</span>
          <span style="color:#dc2626;">❌ Failed: ${stats.failed} (${(100 - parseFloat(stats.passRate)).toFixed(1)}%)</span>
        </div>
        <div style="
          height:12px;
          border-radius:999px;
          overflow:hidden;
          background:#fee2e2;
          box-shadow:inset 0 1px 3px rgba(0,0,0,0.1);
        ">
          <div style="
            width:${stats.passRate}%;
            height:100%;
            background:linear-gradient(90deg, #16a34a, #4ade80);
            border-radius:999px;
            transition:width 0.5s ease;
          "></div>
        </div>
      </div>

      <!-- Recommendation banner -->
      <div style="
        margin-top:var(--space-lg);
        padding:var(--space-md) var(--space-lg);
        border-radius:var(--radius-md);
        background:${
          parseFloat(stats.passRate) >= 70 ? '#f0fdf4' :
          parseFloat(stats.passRate) >= 50 ? '#fffbeb' :
                                             '#fef2f2'
        };
        border-left:4px solid ${
          parseFloat(stats.passRate) >= 70 ? '#16a34a' :
          parseFloat(stats.passRate) >= 50 ? '#d97706' :
                                             '#dc2626'
        };
        font-size:var(--text-sm);
        color:${
          parseFloat(stats.passRate) >= 70 ? '#14532d' :
          parseFloat(stats.passRate) >= 50 ? '#78350f' :
                                             '#7f1d1d'
        };
      ">
        ${
          parseFloat(stats.passRate) >= 70
            ? `<strong>✅ Good performance.</strong> Class average is ${stats.average}/100 with ${stats.passRate}% pass rate. Results appear suitable for approval.`
            : parseFloat(stats.passRate) >= 50
            ? `<strong>⚠️ Mixed performance.</strong> Class average is ${stats.average}/100 with ${stats.passRate}% pass rate. Review carefully before approving.`
            : `<strong>🚨 Poor performance.</strong> Class average is ${stats.average}/100 with only ${stats.passRate}% pass rate. Consider rejecting and requesting review.`
        }
      </div>
    </div>
  `;
}

async function toggleResultPreview(submissionId, classId, term, subject, session, className) {
  const previewRowId = `preview-row-${submissionId}`;
  const btnId        = `preview-btn-${submissionId}`;

  const existingRow = document.getElementById(previewRowId);
  const btn         = document.getElementById(btnId);

  // Collapse if already open
  if (existingRow) {
    existingRow.remove();
    if (btn) {
      btn.textContent = '🔍 Preview';
      btn.style.background = '';
    }
    return;
  }

  // Show loading state on button
  if (btn) {
    btn.textContent = '⏳ Loading...';
    btn.disabled    = true;
  }

  try {
    // Previously: a direct Firestore query against results_draft,
    // filtered by session client-side. Now: a dedicated admin
    // endpoint — intentionally NOT the same /api/teacher/results/
    // drafts route teacher.js uses, since that route restricts
    // results to the calling teacher's own drafts and an admin
    // needs to preview any teacher's submission.
    const draftsQuery = new URLSearchParams({ classId, session, term, subject });
    const { drafts: validDrafts } = await adminApiGet(`/api/admin/results/drafts?${draftsQuery}`);

    const stats = computePreviewStats(validDrafts);
    const meta  = { subject, className, term, session };
    const html  = renderResultPreviewPanel(stats, meta);

    // Find the submission row and insert a new TR after it
    const submissionRow = document.querySelector(`tr[data-submission-id="${submissionId}"]`);

    if (!submissionRow) {
      console.error('Could not find submission row for', submissionId);
      return;
    }

    const colCount = submissionRow.querySelectorAll('td').length;

    const previewTr      = document.createElement('tr');
    previewTr.id         = previewRowId;
    previewTr.className  = 'result-preview-row';

    const previewTd      = document.createElement('td');
    previewTd.colSpan    = colCount;
    previewTd.style.padding = '0';
    previewTd.innerHTML  = html;

    previewTr.appendChild(previewTd);
    submissionRow.insertAdjacentElement('afterend', previewTr);

    if (btn) {
      btn.textContent      = '🔼 Hide Preview';
      btn.style.background = '#e0f2fe';
      btn.disabled         = false;
    }

  } catch (error) {
    console.error('❌ Error loading result preview:', error);
    window.showToast?.('Failed to load result preview', 'danger');

    if (btn) {
      btn.textContent = '🔍 Preview';
      btn.disabled    = false;
    }
  }
}

// Expose globally
window.toggleResultPreview  = toggleResultPreview;
window.computePreviewStats  = computePreviewStats;
window.renderResultPreviewPanel = renderResultPreviewPanel;

console.log('✅ Result approval performance preview loaded');
console.log('✅ Bulk result approval feature loaded');
console.log('✅ Financial helper functions loaded');
console.log('✅ Admin.js v7.0.0 loaded successfully');
console.log('User creation system: READY');
