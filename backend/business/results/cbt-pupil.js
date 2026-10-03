/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Pupil-Facing CBT Test List
 *
 * Ported from the inline <script> in pupil.html (loadPupilTests /
 * renderPupilTestsPage). This only covers *browsing* available
 * tests — taking a test still happens on cbt.html via js/cbt.js,
 * which is its own, separate migration phase.
 */

import { getDocument, runQuery } from "../../firebase/firestore.js";

function equalsFilter(field, value, valueType = "stringValue") {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: "EQUAL",
      value: { [valueType]: value },
    },
  };
}

function isTestSubjectApplicable(subject, religion) {
  const s = String(subject || "").toLowerCase();
  const r = String(religion || "").trim().toLowerCase();

  const isChristianRS =
    s.includes("christian religious") || s === "crs" || s === "crk" || s.includes("bible knowledge");
  const isIslamicRS =
    s.includes("islamic religious") || s === "irs" || s === "irk" || s.includes("islamic studies");

  if (!isChristianRS && !isIslamicRS) return true;
  if (r === "muslim" || r === "islam") return !isChristianRS;
  if (r === "christian" || r === "christianity") return !isIslamicRS;
  return true; // religion unset — don't hide either
}

function timestampMillis(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export async function getAvailableTestsForPupil(env, pupilId) {
  const pupilData = await getDocument(env, "pupils", pupilId);
  if (!pupilData) {
    throw new Error("Pupil not found");
  }

  const classId =
    typeof pupilData.class === "object" && pupilData.class !== null ? pupilData.class.id : null;

  if (!classId) {
    return { tests: [], reason: "Class information missing. Contact admin to update your profile." };
  }

  const settingsDoc = await getDocument(env, "settings", "current");
  const currentSession = settingsDoc?.session || null;
  const currentTerm = settingsDoc?.term || null;

  if (!currentSession || !currentTerm) {
    return { tests: [], reason: "School session/term settings are not configured yet." };
  }

  const rawTests = await runQuery(env, {
    from: [{ collectionId: "cbt_tests" }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: [
          equalsFilter("classId", classId),
          equalsFilter("published", true, "booleanValue"),
          equalsFilter("session", currentSession),
          equalsFilter("term", currentTerm),
        ],
      },
    },
  });

  if (rawTests.length === 0) {
    return { tests: [], currentTerm };
  }

  const applicableTests = rawTests.filter((t) =>
    isTestSubjectApplicable(t.subject, pupilData.religion)
  );

  if (applicableTests.length === 0) {
    return { tests: [], currentTerm };
  }

  const completedAttempts = await runQuery(env, {
    from: [{ collectionId: "cbt_attempts" }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: [
          equalsFilter("pupilId", pupilId),
          equalsFilter("status", "completed"),
        ],
      },
    },
  });
  const completedTestIds = new Set(completedAttempts.map((a) => a.testId));

  const now = Date.now();

  const enriched = await Promise.all(
    applicableTests.map(async (t) => {
      const done = completedTestIds.has(t.id);

      let windowStatus = "open";
      if (t.scheduledDate && timestampMillis(t.scheduledDate) > now) windowStatus = "upcoming";
      if (t.expiryDate && timestampMillis(t.expiryDate) < now) windowStatus = "expired";

      let result = null;
      if (done) {
        try {
          const results = await runQuery(env, {
            from: [{ collectionId: "cbt_results" }],
            where: {
              compositeFilter: {
                op: "AND",
                filters: [equalsFilter("testId", t.id), equalsFilter("pupilId", pupilId)],
              },
            },
            limit: 1,
          });
          if (results[0]) {
            const r = results[0];
            result = { score: r.score, total: r.total, percentage: r.percentage, grade: r.grade };
          }
        } catch {
          // Score display is non-critical.
        }
      }

      return {
        id: t.id,
        title: t.title,
        subject: t.subject || "—",
        type: t.type || "Test",
        timerMinutes: t.timerMinutes || null,
        term: t.term || "—",
        scheduledDate: t.scheduledDate || null,
        expiryDate: t.expiryDate || null,
        done,
        windowStatus,
        canTake: !done && windowStatus === "open",
        result,
      };
    })
  );

  enriched.sort((a, b) => {
    const priority = (t) => {
      if (t.done) return 3;
      if (t.windowStatus === "expired") return 2;
      if (t.windowStatus === "upcoming") return 1;
      return 0;
    };
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return timestampMillis(b.scheduledDate || b.expiryDate) - timestampMillis(a.scheduledDate || a.expiryDate);
  });

  return { tests: enriched, currentTerm };
}
