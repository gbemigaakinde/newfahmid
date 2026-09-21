/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Outstanding Fees / Arrears Calculation
 *
 * Ported from the old browser-side js/finance.js "finance" object.
 * This is money-handling logic, so it now runs only on the Worker —
 * it used to run in the browser against Firestore directly.
 *
 * Pure calculation helpers (calculateAdjustedFee, getPreviousSession,
 * makePaymentDocumentId) already live in ./fees.js and are reused
 * here rather than duplicated.
 */

import { getDocument, runQuery } from "../../firebase/firestore.js";
import { calculateAdjustedFee, getPreviousSession } from "./fees.js";

const TERM_ORDER = {
  "First Term": 1,
  "Second Term": 2,
  "Third Term": 3,
};

function encodeSession(session) {
  return String(session || "").replace(/\//g, "-");
}

function sessionStartYear(session) {
  const match = String(session || "").match(/(\d{4})\//);
  return match ? parseInt(match[1], 10) : 0;
}

function getClassIdSafely(pupilData) {
  if (!pupilData || !pupilData.class) return null;
  if (typeof pupilData.class === "object" && pupilData.class.id) {
    return pupilData.class.id;
  }
  return null;
}

async function wasEnrolledIn(pupilData, checkSession, checkTerm) {
  const admissionSession = pupilData.admissionSession || null;
  const admissionTerm = pupilData.admissionTerm || "First Term";
  const exitTerm = pupilData.exitTerm || "Third Term";

  if ((TERM_ORDER[checkTerm] || 1) > (TERM_ORDER[exitTerm] || 3)) return false;

  if (!admissionSession) {
    return (TERM_ORDER[checkTerm] || 1) >= (TERM_ORDER[admissionTerm] || 1);
  }

  const admissionYear = sessionStartYear(admissionSession);
  const checkYear = sessionStartYear(checkSession);

  if (checkYear < admissionYear) return false;
  if (checkYear > admissionYear) return true;

  if ((TERM_ORDER[admissionTerm] || 1) > (TERM_ORDER[checkTerm] || 1)) return false;

  return true;
}

/**
 * Re-derive a term's balance from scratch when its `payments` doc is
 * missing or corrupted, using the earliest recorded transaction (if
 * any) to pin down which class/fee applied at the time.
 */
async function recalculateTermBalance(env, pupilId, session, term) {
  try {
    const pupilData = await getDocument(env, "pupils", pupilId);
    if (!pupilData) return 0;

    let resolvedClassId = null;
    let resolvedBaseFee = null;

    try {
      const transactions = await runQuery(env, {
        from: [{ collectionId: "payment_transactions" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "pupilId" },
                  op: "EQUAL",
                  value: { stringValue: pupilId },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "session" },
                  op: "EQUAL",
                  value: { stringValue: session },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "term" },
                  op: "EQUAL",
                  value: { stringValue: term },
                },
              },
            ],
          },
        },
        orderBy: [
          { field: { fieldPath: "paymentDate" }, direction: "ASCENDING" },
        ],
        limit: 1,
      });

      const firstTx = transactions[0];
      if (firstTx) {
        if (firstTx.classId) resolvedClassId = firstTx.classId;
        if (typeof firstTx.baseFee === "number" && firstTx.baseFee > 0) {
          resolvedBaseFee = firstTx.baseFee;
        }
      }
    } catch {
      // No historical transaction snapshot available.
    }

    if (!resolvedClassId) {
      resolvedClassId = getClassIdSafely(pupilData);
      if (!resolvedClassId) return 0;
    }

    if (resolvedBaseFee === null) {
      const feeDoc = await getDocument(env, "fee_structures", `fee_${resolvedClassId}`);
      if (!feeDoc) return 0;
      resolvedBaseFee = Math.round(Number(feeDoc.total) || 0);
    }

    const amountDue = calculateAdjustedFee(pupilData, resolvedBaseFee, term);

    const paymentDocId = `${pupilId}_${encodeSession(session)}_${term}`;
    let totalPaid = 0;
    try {
      const paymentDoc = await getDocument(env, "payments", paymentDocId);
      if (paymentDoc) totalPaid = Number(paymentDoc.totalPaid) || 0;
    } catch {
      // No payment doc — totalPaid stays 0.
    }

    return Math.max(0, amountDue - totalPaid);
  } catch {
    return 0;
  }
}

/**
 * Walk backward through a whole session's terms (Third → First) to
 * find the last recorded balance, falling back to a full
 * recalculation if none of the term documents can be trusted.
 */
async function calculateSessionBalanceSafe(env, pupilId, session) {
  try {
    const termsToCheck = ["Third Term", "Second Term", "First Term"];

    for (const termName of termsToCheck) {
      const docId = `${pupilId}_${encodeSession(session)}_${termName}`;

      try {
        const termDoc = await getDocument(env, "payments", docId);

        if (termDoc) {
          const rawBalance = termDoc.balance;
          const balance = Number(rawBalance);

          if (rawBalance === undefined || rawBalance === null || isNaN(balance)) {
            const outstanding = await calculateCurrentOutstanding(env, pupilId, session, termName);
            return outstanding.balance || 0;
          }

          return Math.max(0, Math.round(balance));
        }
      } catch {
        // Could not fetch this term doc — move to an earlier term.
      }
    }

    try {
      const pupilData = await getDocument(env, "pupils", pupilId);
      if (pupilData?.admissionSession) {
        const admissionYear = sessionStartYear(pupilData.admissionSession);
        const checkYear = sessionStartYear(session);
        if (checkYear < admissionYear) return 0;
      }
    } catch {
      // Could not verify enrolment — fall through to recalculation.
    }

    return await recalculateTermBalance(env, pupilId, session, "Third Term");
  } catch {
    return 0;
  }
}

/**
 * How much (if anything) is still owed from before the current term.
 */
async function calculateCompleteArrears(env, pupilId, currentSession, currentTerm) {
  try {
    const currentTermNum = TERM_ORDER[currentTerm] || 1;
    const pupilData = await getDocument(env, "pupils", pupilId);

    if (currentTermNum === 1) {
      const previousSession = getPreviousSession(currentSession);
      if (!previousSession) return 0;

      if (pupilData) {
        const enrolled = await wasEnrolledIn(pupilData, previousSession, "Third Term");
        if (!enrolled) return 0;
      }

      try {
        return await calculateSessionBalanceSafe(env, pupilId, previousSession);
      } catch {
        return 0;
      }
    }

    const previousTermName = Object.keys(TERM_ORDER).find(
      (key) => TERM_ORDER[key] === currentTermNum - 1
    );
    if (!previousTermName) return 0;

    if (pupilData) {
      const enrolled = await wasEnrolledIn(pupilData, currentSession, previousTermName);
      if (!enrolled) return 0;
    }

    const prevTermDocId = `${pupilId}_${encodeSession(currentSession)}_${previousTermName}`;

    try {
      const prevTermDoc = await getDocument(env, "payments", prevTermDocId);

      if (prevTermDoc) {
        const rawBalance = prevTermDoc.balance;
        const parsed = Number(rawBalance);

        if (rawBalance === undefined || rawBalance === null || isNaN(parsed)) {
          const outstanding = await calculateCurrentOutstanding(env, pupilId, currentSession, previousTermName);
          return outstanding.balance || 0;
        }

        return Math.max(0, Math.round(parsed));
      }

      try {
        const outstanding = await calculateCurrentOutstanding(env, pupilId, currentSession, previousTermName);
        return outstanding.balance || 0;
      } catch {
        return await recalculateTermBalance(env, pupilId, currentSession, previousTermName);
      }
    } catch {
      return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * The main entry point: everything a pupil (or staff member) needs
 * to know about where a pupil's fees stand for one term.
 */
export async function calculateCurrentOutstanding(env, pupilId, session, term) {
  const pupilData = await getDocument(env, "pupils", pupilId);
  if (!pupilData) {
    throw new Error("Pupil not found");
  }

  if (pupilData.status === "alumni" || pupilData.isActive === false) {
    return {
      amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
      balance: 0, credit: 0,
      reason: "Alumni — not an active pupil",
    };
  }

  const classId = getClassIdSafely(pupilData);
  if (!classId) {
    return {
      pupilId, pupilName: pupilData.name, session, term,
      amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
      balance: 0, credit: 0,
      reason: "Invalid class data - contact admin",
    };
  }

  const feeDoc = await getDocument(env, "fee_structures", `fee_${classId}`);
  if (!feeDoc) {
    return {
      pupilId, pupilName: pupilData.name, classId,
      className: pupilData.class?.name || "Unknown",
      session, term,
      amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
      balance: 0, credit: 0,
      reason: "No fee structure configured for this class",
    };
  }

  const baseFee = Math.round(Number(feeDoc.total) || 0);
  const amountDue = calculateAdjustedFee(pupilData, baseFee, term);

  if (amountDue === 0 && baseFee > 0) {
    return {
      pupilId, pupilName: pupilData.name, classId,
      className: pupilData.class?.name || "Unknown",
      session, term,
      amountDue: 0, arrears: 0, totalDue: 0, totalPaid: 0,
      balance: 0, credit: 0,
      reason: "Not enrolled for this term",
    };
  }

  const arrears = await calculateCompleteArrears(env, pupilId, session, term);

  const paymentDocId = `${pupilId}_${encodeSession(session)}_${term}`;
  let totalPaid = 0;
  try {
    const paymentDoc = await getDocument(env, "payments", paymentDocId);
    if (paymentDoc) {
      totalPaid = Math.round(Math.max(0, Number(paymentDoc.totalPaid) || 0));
    }
  } catch {
    // No payment doc yet.
  }

  const totalDue = amountDue + arrears;
  const rawBalance = totalDue - totalPaid;
  const balance = Math.max(0, rawBalance);
  const credit = rawBalance < 0 ? Math.abs(rawBalance) : 0;

  let status;
  if (rawBalance < 0) status = "overpaid";
  else if (balance === 0) status = totalPaid > 0 ? "paid" : "owing";
  else if (totalPaid > 0) status = "partial";
  else if (arrears > 0) status = "owing_with_arrears";
  else status = "owing";

  return {
    pupilId,
    pupilName: pupilData.name,
    classId,
    className: pupilData.class?.name || "Unknown",
    session,
    term,
    baseFee,
    amountDue,
    arrears,
    totalDue,
    totalPaid,
    balance,
    credit,
    status,
  };
}

/**
 * All of a pupil's recorded payment transactions, most recent first.
 * Optionally scoped to one session and/or term.
 */
export async function getPupilPaymentHistory(env, pupilId, session = null, term = null) {
  try {
    const filters = [
      {
        fieldFilter: {
          field: { fieldPath: "pupilId" },
          op: "EQUAL",
          value: { stringValue: pupilId },
        },
      },
    ];

    if (session) {
      filters.push({
        fieldFilter: {
          field: { fieldPath: "session" },
          op: "EQUAL",
          value: { stringValue: session },
        },
      });
    }

    if (term) {
      filters.push({
        fieldFilter: {
          field: { fieldPath: "term" },
          op: "EQUAL",
          value: { stringValue: term },
        },
      });
    }

    const where =
      filters.length === 1
        ? filters[0]
        : { compositeFilter: { op: "AND", filters } };

    return await runQuery(env, {
      from: [{ collectionId: "payment_transactions" }],
      where,
      orderBy: [{ field: { fieldPath: "paymentDate" }, direction: "DESCENDING" }],
    });
  } catch {
    return [];
  }
}
