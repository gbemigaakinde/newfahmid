/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Teacher-Side Promotion Requests
 *
 * Ported from loadPromotionSection(), loadPromotionPupils(),
 * calculatePupilAverage(), and submitPromotionRequest() in the old
 * js/teacher.js. Admin-side review/approval/execution of these
 * requests is a separate, not-yet-migrated phase.
 */

import { getDocument, setDocument, runQuery } from "../../firebase/firestore.js";
import { getTeacherRoster } from "./teacher-roster.js";
import { ValidationError } from "../../security/validation.js";

function equalsFilter(field, value) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: "EQUAL",
      value: { stringValue: value },
    },
  };
}

function getGradeFromScore(score) {
  if (score >= 75) return "A1";
  if (score >= 70) return "B2";
  if (score >= 65) return "B3";
  if (score >= 60) return "C4";
  if (score >= 55) return "C5";
  if (score >= 50) return "C6";
  if (score >= 45) return "D7";
  if (score >= 40) return "D8";
  return "F9";
}

/**
 * Average across every APPROVED result for one pupil in one
 * term/session — deliberately the published `results` collection,
 * not `results_draft`, same as the original.
 */
async function calculatePupilAverage(env, pupilId, term, session) {
  if (!term || !session) {
    return { average: 0, grade: null };
  }

  const results = await runQuery(env, {
    from: [{ collectionId: "results" }],
    where: {
      compositeFilter: {
        op: "AND",
        filters: [
          equalsFilter("pupilId", pupilId),
          equalsFilter("term", term),
          equalsFilter("session", session),
        ],
      },
    },
  });

  if (results.length === 0) {
    return { average: 0, grade: null };
  }

  const total = results.reduce(
    (sum, r) => sum + (Number(r.caScore) || 0) + (Number(r.examScore) || 0),
    0
  );
  const average = Math.round((total / results.length) * 10) / 10;

  return { average, grade: getGradeFromScore(average) };
}

/**
 * Where a class sits in the promotion order. Deliberately
 * distinguishes "not found in the hierarchy at all" (a
 * configuration problem — isTerminal stays false, so the UI can
 * warn rather than wrongly treat it as a graduating class) from
 * "found, and it's the last one" (genuinely terminal). The existing
 * getNextClass() in classes.js conflates these two into a single
 * null, which isn't enough to tell them apart here.
 */
async function resolveClassPosition(env, classId) {
  const hierarchy = await getDocument(env, "settings", "classHierarchy");
  const orderedIds = hierarchy?.orderedClassIds || [];
  const index = orderedIds.indexOf(classId);

  if (index === -1) {
    return { found: false, isTerminal: false, nextClassId: null };
  }

  if (index === orderedIds.length - 1) {
    return { found: true, isTerminal: true, nextClassId: null };
  }

  return { found: true, isTerminal: false, nextClassId: orderedIds[index + 1] };
}

export function makePromotionId({ fromClassId, fromSession }) {
  return `${fromClassId}_${String(fromSession).replace(/\//g, "-")}`;
}

/**
 * Everything the teacher promotion screen needs in one call:
 * whether the promotion period is open, the teacher's class and
 * where it sits in the hierarchy, and every pupil with their
 * current-term average.
 */
export async function getPromotionOverview(env, teacherUid) {
  const roster = await getTeacherRoster(env, teacherUid);

  if (roster.classes.length === 0) {
    return { hasClass: false };
  }

  // Teachers are expected to have exactly one class for promotion
  // purposes, same assumption the original code made.
  const currentClass = roster.classes[0];

  const settings = (await getDocument(env, "settings", "current")) || {};

  if (!settings.promotionPeriodActive) {
    return {
      hasClass: true,
      promotionPeriodActive: false,
      currentClass: { id: currentClass.id, name: currentClass.name },
    };
  }

  const position = await resolveClassPosition(env, currentClass.id);

  let nextClass = null;
  if (position.nextClassId) {
    const nextClassDoc = await getDocument(env, "classes", position.nextClassId);
    if (nextClassDoc) {
      nextClass = { id: position.nextClassId, name: nextClassDoc.name };
    }
  }

  const pupilsWithAverages = await Promise.all(
    roster.pupils.map(async (pupil) => {
      const { average, grade } = await calculatePupilAverage(
        env,
        pupil.id,
        settings.term,
        settings.session
      );
      return { id: pupil.id, name: pupil.name, average, grade };
    })
  );

  pupilsWithAverages.sort((a, b) => b.average - a.average);

  return {
    hasClass: true,
    promotionPeriodActive: true,
    currentClass: { id: currentClass.id, name: currentClass.name },
    isTerminalClass: position.isTerminal,
    hierarchyConfigured: position.found,
    nextClass,
    session: settings.session,
    term: settings.term,
    pupils: pupilsWithAverages,
  };
}

/**
 * Create or update this teacher's promotion request for their
 * current class/session.
 *
 * Deliberately uses a deterministic ID (classId_session) instead of
 * the original's auto-generated-ID-plus-query-for-an-existing-
 * pending-request pattern — the exact problem the original's "BUG 6
 * FIX" comment was working around. A resubmission after rejection
 * overwrites the same document rather than creating a second one,
 * which matches how result submissions already behave elsewhere in
 * this backend (e.g. classId_session_term_subject in
 * results/submissions.js).
 */
export async function submitPromotionRequest(
  env,
  teacherUid,
  { promotedPupilIds = [], heldBackPupilIds = [] }
) {
  const roster = await getTeacherRoster(env, teacherUid);

  if (roster.classes.length === 0) {
    throw new ValidationError("You have no assigned class.");
  }

  const currentClass = roster.classes[0];

  const settings = (await getDocument(env, "settings", "current")) || {};

  if (!settings.promotionPeriodActive) {
    throw new ValidationError("The promotion period is not currently active.");
  }

  const position = await resolveClassPosition(env, currentClass.id);

  let toClass;
  if (position.isTerminal) {
    toClass = { id: "alumni", name: "Alumni" };
  } else if (position.nextClassId) {
    const nextClassDoc = await getDocument(env, "classes", position.nextClassId);
    if (!nextClassDoc) {
      throw new ValidationError("The next class in the hierarchy could not be found.");
    }
    toClass = { id: position.nextClassId, name: nextClassDoc.name };
  } else {
    throw new ValidationError(
      "Next class not found in the hierarchy. Contact admin."
    );
  }

  const pupilsById = new Map(roster.pupils.map((p) => [p.id, p]));

  const describePupils = (ids) =>
    ids.map((id) => ({ id, name: pupilsById.get(id)?.name || "Unknown" }));

  const promotionId = makePromotionId({
    fromClassId: currentClass.id,
    fromSession: settings.session,
  });

  const existing = await getDocument(env, "promotions", promotionId);
  const now = new Date().toISOString();

  const document = {
    fromSession: settings.session,
    fromClass: { id: currentClass.id, name: currentClass.name },
    toClass,
    isTerminalClass: position.isTerminal,
    promotedPupils: promotedPupilIds,
    promotedPupilsDetails: describePupils(promotedPupilIds),
    heldBackPupils: heldBackPupilIds,
    heldBackPupilsDetails: describePupils(heldBackPupilIds),
    initiatedBy: teacherUid,
    status: "pending",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await setDocument(env, "promotions", promotionId, document);

  return { id: promotionId, ...document };
}
