/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Pupil-Facing Results Lookup
 *
 * Ported from populateSessionSelector() and loadSessionResults()
 * in the old js/pupil.js. A pupil only ever sees results whose
 * status is "approved".
 */

import { getDocument, runQuery } from "../../firebase/firestore.js";

function equalsFilter(field, value) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: "EQUAL",
      value: { stringValue: value },
    },
  };
}

async function fetchApprovedResults(env, pupilId, session) {
  // Try the indexed compound query first; if Firestore hasn't been
  // given a composite index for (pupilId, session, status), fall
  // back to filtering in memory — same safety net the original
  // browser code used.
  try {
    return await runQuery(env, {
      from: [{ collectionId: "results" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            equalsFilter("pupilId", pupilId),
            equalsFilter("session", session),
            equalsFilter("status", "approved"),
          ],
        },
      },
    });
  } catch {
    const all = await runQuery(env, {
      from: [{ collectionId: "results" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [equalsFilter("pupilId", pupilId), equalsFilter("session", session)],
        },
      },
    });
    return all.filter((doc) => doc.status === "approved");
  }
}

/**
 * Every past session this pupil has at least one *approved* result
 * in (excluding the current session, which is offered separately
 * as the "current" option by the caller).
 */
export async function getAvailablePastSessions(env, pupilId, currentSession, isAlumni) {
  const allResults = await runQuery(env, {
    from: [{ collectionId: "results" }],
    where: equalsFilter("pupilId", pupilId),
  });

  const sessions = new Set();

  for (const doc of allResults) {
    if (doc.session && doc.status === "approved") {
      if (isAlumni || doc.session !== currentSession) {
        sessions.add(doc.session);
      }
    }
  }

  return Array.from(sessions).sort((a, b) => {
    const yearA = parseInt(String(a).split("/")[0], 10) || 0;
    const yearB = parseInt(String(b).split("/")[0], 10) || 0;
    return yearB - yearA;
  });
}

/**
 * Approved results for one session, grouped by term, each subject
 * entry carrying its CA/exam/total score.
 */
export async function getApprovedResultsForSession(env, pupilId, session) {
  const docs = await fetchApprovedResults(env, pupilId, session);

  return docs.map((doc) => ({
    term: doc.term || "Unknown Term",
    subject: doc.subject || "Unknown Subject",
    caScore: doc.caScore || 0,
    examScore: doc.examScore || 0,
    total: (doc.caScore || 0) + (doc.examScore || 0),
  }));
}

export async function isAlumniPupil(env, pupilId) {
  const pupilData = await getDocument(env, "pupils", pupilId);
  return Boolean(pupilData && (pupilData.status === "alumni" || pupilData.isActive === false));
}
