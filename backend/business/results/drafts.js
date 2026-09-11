/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Result Drafts
 *
 * Teacher-owned result entry and editing.
 *
 * Security rules:
 * - Teacher must be authenticated.
 * - Teacher must own the class.
 * - Subject must belong to the class.
 * - Pupil must belong to the class.
 * - Locked/submitted results cannot be edited.
 * - Calculated result fields are never trusted from the client.
 */

import {
  getDocument,
  setDocument,
  deleteDocument,
  runQuery,
} from "../../firebase/firestore.js";
import {
  getClassById,
  getPupilById,
} from "../../api/school.js";
import {
  requireTeacher,
} from "../../auth/authorize.js";
import {
  validateResultDraft,
  ResultValidationError,
} from "./validation.js";
import {
  calculateResult,
} from "./calculation.js";
import {
  assertTeacherOwnsClass,
  assertPupilBelongsToClass,
  classHasSubject,
} from "./roster-validation.js";
import {
  audit,
} from "../../security/audit.js";
/**
 * ---------------------------------------------------------------------------
 * Result draft identifiers
 * ---------------------------------------------------------------------------
 *
 * These identifiers intentionally preserve the legacy application's
 * deterministic IDs.
 *
 * Published result:
 *   pupilId_term_subject
 *
 * Submission:
 *   classId_session_term_subject
 *
 * Lock:
 *   classId_session_term_subject
 */
export function makeResultId({
  pupilId,
  term,
  subject,
}) {
  return [
    String(pupilId),
    String(term),
    String(subject),
  ].join("_");
}
export function makeSubmissionId({
  classId,
  session,
  term,
  subject,
}) {
  return [
    String(classId),
    String(session),
    String(term),
    String(subject),
  ].join("_");
}
export function makeLockId({
  classId,
  session,
  term,
  subject,
}) {
  return makeSubmissionId({
    classId,
    session,
    term,
    subject,
  });
}
/**
 * ---------------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------------
 */
function normaliseSubject(subject) {
  if (subject === undefined || subject === null) {
    return "";
  }
  return String(subject).trim();
}
function normaliseTerm(term) {
  if (term === undefined || term === null) {
    return "";
  }
  return String(term).trim();
}
function normaliseSession(session) {
  if (session === undefined || session === null) {
    return "";
  }
  return String(session).trim();
}
/**
 * Convert a Firestore draft document into the application's result shape.
 *
 * Important:
 * calculated fields are NEVER trusted from the database/client.
 * They are recalculated from the authoritative raw score components.
 */
export function parseDraftDocument(document) {
  if (!document) {
    return null;
  }
  const calculation = calculateResult(document);
  return {
    ...document,
    total: calculation.total,
    percentage: calculation.percentage,
    grade: calculation.grade,
    remark: calculation.remark,
  };
}
/**
 * Verify that a draft is still editable.
 *
 * A teacher may edit only while:
 *
 *   - no submission exists, or
 *   - the submission has been rejected
 *
 * Once submitted/pending, approved, or locked, ordinary teacher editing
 * is blocked.
 */
async function assertUnlockedAndEditable(
  env,
  {
    classId,
    session,
    term,
    subject,
  },
) {
  const lockId = makeLockId({
    classId,
    session,
    term,
    subject,
  });
  const lock = await getDocument(
    env,
    "result_locks",
    lockId,
  );
  if (lock?.locked === true) {
    throw new ResultValidationError(
      "This result is locked and cannot be edited.",
      "RESULT_LOCKED",
    );
  }
  const submissionId = makeSubmissionId({
    classId,
    session,
    term,
    subject,
  });
  const submission = await getDocument(
    env,
    "result_submissions",
    submissionId,
  );
  if (!submission) {
    return;
  }
  if (submission.status === "pending") {
    throw new ResultValidationError(
      "This result has already been submitted and is awaiting review.",
      "RESULT_SUBMITTED",
    );
  }
  if (submission.status === "approved") {
    throw new ResultValidationError(
      "This result has already been approved and cannot be edited.",
      "RESULT_APPROVED",
    );
  }
  /*
   * Rejected submissions are intentionally editable.
   *
   * Any other unexpected state is rejected rather than silently allowing
   * modification.
   */
  if (
    submission.status !== "rejected" &&
    submission.status !== "draft"
  ) {
    throw new ResultValidationError(
      `Result cannot be edited while submission is in status "${submission.status}".`,
      "RESULT_NOT_EDITABLE",
    );
  }
}
/**
 * Validate the complete roster relationship:
 *
 * teacher -> class -> subject -> pupil
 *
 * This prevents a teacher from submitting arbitrary pupil IDs or subjects
 * belonging to another class.
 */
async function validateRosterForDraft(
  env,
  draft,
  teacherUid,
) {
  const schoolClass = await getClassById(
    env,
    draft.classId,
  );
  assertTeacherOwnsClass(
    schoolClass,
    teacherUid,
  );
  const pupil = await getPupilById(
    env,
    draft.pupilId,
  );
  assertPupilBelongsToClass(
    pupil,
    draft.classId,
  );
  if (
    !classHasSubject(
      schoolClass,
      draft.subject,
      draft.subjectId,
    )
  ) {
    throw new ResultValidationError(
      "The selected subject does not belong to this class.",
      "INVALID_SUBJECT",
    );
  }
  return {
    schoolClass,
    pupil,
  };
}
/**
 * ---------------------------------------------------------------------------
 * Get one draft
 * ---------------------------------------------------------------------------
 */
export async function getDraft(
  env,
  request,
  draftId,
) {
  const user = await requireTeacher(
    env,
    request,
  );
  if (!draftId) {
    throw new ResultValidationError(
      "Draft ID is required.",
      "MISSING_DRAFT_ID",
    );
  }
  const draft = await getDocument(
    env,
    "results_draft",
    draftId,
  );
  if (!draft) {
    return null;
  }
  /*
   * The stored teacher ID is authoritative for ownership checks.
   */
  if (
    String(draft.teacherId) !== String(user.uid)
  ) {
    throw new ResultValidationError(
      "You do not have access to this result draft.",
      "DRAFT_ACCESS_DENIED",
    );
  }
  await validateRosterForDraft(
    env,
    draft,
    user.uid,
  );
  return parseDraftDocument(draft);
}
/**
 * ---------------------------------------------------------------------------
 * List drafts
 * ---------------------------------------------------------------------------
 *
 * Filters:
 *   teacherId
 *   classId
 *   pupilId
 *   session
 *   term
 *   subject
 */
export async function listDrafts(
  env,
  filters = {},
) {
  const {
    teacherId,
    classId,
    pupilId,
    session,
    term,
    subject,
  } = filters;
  const filtersList = [];
  if (teacherId) {
    filtersList.push({
      fieldFilter: {
        field: {
          fieldPath: "teacherId",
        },
        op: "EQUAL",
        value: {
          stringValue: String(teacherId),
        },
      },
    });
  }
  if (classId) {
    filtersList.push({
      fieldFilter: {
        field: {
          fieldPath: "classId",
        },
        op: "EQUAL",
        value: {
          stringValue: String(classId),
        },
      },
    });
  }
  if (pupilId) {
    filtersList.push({
      fieldFilter: {
        field: {
          fieldPath: "pupilId",
        },
        op: "EQUAL",
        value: {
          stringValue: String(pupilId),
        },
      },
    });
  }
  if (session) {
    filtersList.push({
      fieldFilter: {
        field: {
          fieldPath: "session",
        },
        op: "EQUAL",
        value: {
          stringValue: String(session),
        },
      },
    });
  }
  if (term) {
    filtersList.push({
      fieldFilter: {
        field: {
          fieldPath: "term",
        },
        op: "EQUAL",
        value: {
          stringValue: String(term),
        },
      },
    });
  }
  if (subject) {
    filtersList.push({
      fieldFilter: {
        field: {
          fieldPath: "subject",
        },
        op: "EQUAL",
        value: {
          stringValue: String(subject),
        },
      },
    });
  }
  const structuredQuery = {
    from: [
      {
        collectionId: "results_draft",
      },
    ],
  };
  if (filtersList.length === 1) {
    structuredQuery.where = filtersList[0];
  } else if (filtersList.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: "AND",
        filters: filtersList,
      },
    };
  }
  const documents = await runQuery(
    env,
    structuredQuery,
  );
  return documents.map(parseDraftDocument);
}
/**
 * ---------------------------------------------------------------------------
 * Save draft
 * ---------------------------------------------------------------------------
 *
 * Creates or updates a teacher result draft.
 *
 * Important:
 *   - client-calculated total/percentage/grade/remark are ignored
 *   - teacher ownership is checked server-side
 *   - class ownership is checked server-side
 *   - pupil membership is checked server-side
 *   - subject membership is checked server-side
 *   - locks/submission state are checked server-side
 */
export async function saveDraft(
  env,
  request,
  input,
) {
  const user = await requireTeacher(
    env,
    request,
  );
  if (!input || typeof input !== "object") {
    throw new ResultValidationError(
      "Result draft payload is required.",
      "INVALID_DRAFT",
    );
  }
  const draft = {
    ...input,
  };
  /*
   * The authenticated teacher is authoritative.
   *
   * Never trust teacherId supplied by the browser.
   */
  draft.teacherId = user.uid;
  /*
   * Validate raw input before performing writes.
   */
  validateResultDraft(draft);
  /*
   * Normalise important identifiers.
   */
  draft.pupilId = String(draft.pupilId).trim();
  draft.classId = String(draft.classId).trim();
  draft.session = normaliseSession(draft.session);
  draft.term = normaliseTerm(draft.term);
  draft.subject = normaliseSubject(draft.subject);
  if (!draft.pupilId) {
    throw new ResultValidationError(
      "Pupil ID is required.",
      "MISSING_PUPIL_ID",
    );
  }
  if (!draft.classId) {
    throw new ResultValidationError(
      "Class ID is required.",
      "MISSING_CLASS_ID",
    );
  }
  if (!draft.session) {
    throw new ResultValidationError(
      "Session is required.",
      "MISSING_SESSION",
    );
  }
  if (!draft.term) {
    throw new ResultValidationError(
      "Term is required.",
      "MISSING_TERM",
    );
  }
  if (!draft.subject) {
    throw new ResultValidationError(
      "Subject is required.",
      "MISSING_SUBJECT",
    );
  }
  /*
   * Verify:
   *
   *   teacher -> class
   *   pupil -> class
   *   subject -> class
   */
  const {
    schoolClass,
  } = await validateRosterForDraft(
    env,
    draft,
    user.uid,
  );
  /*
   * Make sure the result is still editable.
   */
  await assertUnlockedAndEditable(
    env,
    {
      classId: draft.classId,
      session: draft.session,
      term: draft.term,
      subject: draft.subject,
    },
  );
  /*
   * Deterministic legacy-compatible draft ID.
   *
   * We intentionally use pupil + term + subject here so repeated saves
   * update the same draft rather than creating duplicate records.
   */
  const draftId = makeResultId({
    pupilId: draft.pupilId,
    term: draft.term,
    subject: draft.subject,
  });
  /*
   * Prevent an existing draft belonging to another teacher from being
   * overwritten.
   */
  const existing = await getDocument(
    env,
    "results_draft",
    draftId,
  );
  if (
    existing &&
    String(existing.teacherId) !== String(user.uid)
  ) {
    throw new ResultValidationError(
      "This result draft belongs to another teacher.",
      "DRAFT_OWNERSHIP_CONFLICT",
    );
  }
  /*
   * Prevent a draft for the same pupil/term/subject from silently being
   * moved to another class or session.
   */
  if (existing) {
    if (
      existing.classId &&
      String(existing.classId) !== String(draft.classId)
    ) {
      throw new ResultValidationError(
        "An existing draft for this pupil belongs to another class.",
        "DRAFT_CLASS_CONFLICT",
      );
    }
    if (
      existing.session &&
      String(existing.session) !== String(draft.session)
    ) {
      throw new ResultValidationError(
        "An existing draft for this pupil belongs to another session.",
        "DRAFT_SESSION_CONFLICT",
      );
    }
    if (
      existing.subjectId &&
      draft.subjectId &&
      String(existing.subjectId) !== String(draft.subjectId)
    ) {
      throw new ResultValidationError(
        "An existing draft for this pupil uses another subject.",
        "DRAFT_SUBJECT_CONFLICT",
      );
    }
  }
  /*
   * Authoritative calculation.
   *
   * Any total/percentage/grade/remark supplied by the client is discarded.
   */
  const calculation = calculateResult(draft);
  const now = new Date().toISOString();
  const document = {
    ...draft,
    /*
     * Explicitly preserve authoritative identity fields.
     */
    id: draftId,
    teacherId: user.uid,
    pupilId: draft.pupilId,
    classId: draft.classId,
    session: draft.session,
    term: draft.term,
    subject: draft.subject,
    /*
     * Server-calculated values.
     */
    total: calculation.total,
    percentage: calculation.percentage,
    grade: calculation.grade,
    remark: calculation.remark,
    /*
     * Metadata.
     */
    updatedAt: now,
    ...(existing
      ? {}
      : {
          createdAt: now,
        }),
  };
  /*
   * Persist the draft.
   *
   * The existing Firestore helper's merge behavior is deliberately not
   * relied upon here; this writes the complete authoritative draft.
   */
  await setDocument(
    env,
    "results_draft",
    draftId,
    document,
  );
  await audit(
    env,
    {
      action: existing
        ? "RESULT_DRAFT_UPDATED"
        : "RESULT_DRAFT_CREATED",
      actorUid: user.uid,
      targetType: "result_draft",
      targetId: draftId,
      metadata: {
        pupilId: document.pupilId,
        classId: document.classId,
        className: schoolClass?.name ?? null,
        subject: document.subject,
        subjectId: document.subjectId ?? null,
        session: document.session,
        term: document.term,
      },
    },
  );
  return parseDraftDocument(document);
}
/**
 * ---------------------------------------------------------------------------
 * Delete draft
 * ---------------------------------------------------------------------------
 */
export async function deleteDraft(
  env,
  request,
  draftId,
) {
  const user = await requireTeacher(
    env,
    request,
  );
  if (!draftId) {
    throw new ResultValidationError(
      "Draft ID is required.",
      "MISSING_DRAFT_ID",
    );
  }
  const existing = await getDocument(
    env,
    "results_draft",
    draftId,
  );
  if (!existing) {
    return {
      deleted: false,
      draftId,
    };
  }
  /*
   * Ownership check.
   */
  if (
    String(existing.teacherId) !== String(user.uid)
  ) {
    throw new ResultValidationError(
      "You do not have permission to delete this result draft.",
      "DRAFT_ACCESS_DENIED",
    );
  }
  /*
   * Re-check the complete roster before allowing deletion.
   *
   * This prevents a teacher from using an old/forged draft ID to operate
   * on a pupil or subject outside their current class roster.
   */
  await validateRosterForDraft(
    env,
    existing,
    user.uid,
  );
  /*
   * A draft may only be deleted while the result remains editable.
   */
  await assertUnlockedAndEditable(
    env,
    {
      classId: existing.classId,
      session: existing.session,
      term: existing.term,
      subject: existing.subject,
    },
  );
  await deleteDocument(
    env,
    "results_draft",
    draftId,
  );
  await audit(
    env,
    {
      action: "RESULT_DRAFT_DELETED",
      actorUid: user.uid,
      targetType: "result_draft",
      targetId: draftId,
      metadata: {
        pupilId: existing.pupilId,
        classId: existing.classId,
        subject: existing.subject,
        subjectId: existing.subjectId ?? null,
        session: existing.session,
        term: existing.term,
      },
    },
  );
  return {
    deleted: true,
    draftId,
  };
}
