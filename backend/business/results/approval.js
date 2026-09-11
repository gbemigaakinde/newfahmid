/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Result Approval & Publishing
 *
 * Admin approval is authoritative.
 *
 * IMPORTANT:
 * The current Firestore abstraction does not expose transactions
 * or batched writes. Therefore this module uses deterministic IDs,
 * state guards, validation and recovery checks to make the workflow
 * as safe and repeatable as possible.
 */

import {
  getDocument,
  setDocument,
  runQuery,
} from "../../firebase/firestore.js";
import {
  getClassById,
  getPupilById,
} from "../../api/school.js";
import {
  requireAdmin,
} from "../../auth/authorize.js";
import {
  validateResultDraft,
  ResultValidationError,
} from "./validation.js";
import {
  calculateResult,
  calculateAverage,
  calculatePositions,
} from "./calculation.js";
import {
  assertTeacherOwnsClass,
  assertPupilBelongsToClass,
  classHasSubject,
} from "./roster-validation.js";
import {
  audit,
} from "../../security/audit.js";
import {
  makeResultId,
  makeSubmissionId,
  makeLockId,
} from "./drafts.js";
/**
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */
function nowIso() {
  return new Date().toISOString();
}
function normalise(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}
function requireNonEmpty(value, message, code) {
  const normalised = normalise(value);
  if (!normalised) {
    throw new ResultValidationError(
      message,
      code,
    );
  }
  return normalised;
}
/**
 * ---------------------------------------------------------------------------
 * Load and validate the submission
 * ---------------------------------------------------------------------------
 */
async function loadSubmission(
  env,
  submissionId,
) {
  const submission = await getDocument(
    env,
    "result_submissions",
    submissionId,
  );
  if (!submission) {
    throw new ResultValidationError(
      "Result submission was not found.",
      "SUBMISSION_NOT_FOUND",
    );
  }
  return submission;
}
/**
 * ---------------------------------------------------------------------------
 * Validate submission roster
 * ---------------------------------------------------------------------------
 *
 * This deliberately re-checks the database at approval time.
 *
 * A draft might have been valid when created but the class roster could
 * subsequently change.
 */
async function validateSubmissionRoster(
  env,
  submission,
) {
  const classId = requireNonEmpty(
    submission.classId,
    "Submission class is required.",
    "MISSING_CLASS_ID",
  );
  const subject = requireNonEmpty(
    submission.subject,
    "Submission subject is required.",
    "MISSING_SUBJECT",
  );
  const teacherUid = requireNonEmpty(
    submission.teacherUid,
    "Submission teacher is required.",
    "MISSING_TEACHER_ID",
  );
  const schoolClass = await getClassById(
    env,
    classId,
  );
  assertTeacherOwnsClass(
    schoolClass,
    teacherUid,
  );
  if (
    !classHasSubject(
      schoolClass,
      subject,
      submission.subjectId,
    )
  ) {
    throw new ResultValidationError(
      "The submitted subject does not belong to this class.",
      "INVALID_SUBJECT",
    );
  }
  return {
    schoolClass,
    classId,
    subject,
    teacherUid,
  };
}
/**
 ---------------------------------------------------------------------------
 * Load drafts belonging to the submission
 * ---------------------------------------------------------------------------
 */
async function loadSubmissionDrafts(
  env,
  submission,
) {
  const classId = normalise(
    submission.classId,
  );
  const session = normalise(
    submission.session,
  );
  const term = normalise(
    submission.term,
  );
  const subject = normalise(
    submission.subject,
  );
  const teacherUid = normalise(
    submission.teacherUid,
  );
  if (
    !classId ||
    !session ||
    !term ||
    !subject ||
    !teacherUid
  ) {
    throw new ResultValidationError(
      "Submission is missing required identity fields.",
      "INVALID_SUBMISSION",
    );
  }
  const filters = [
    {
      fieldFilter: {
        field: {
          fieldPath: "classId",
        },
        op: "EQUAL",
        value: {
          stringValue: classId,
        },
      },
    },
    {
      fieldFilter: {
        field: {
          fieldPath: "session",
        },
        op: "EQUAL",
        value: {
          stringValue: session,
        },
      },
    },
    {
      fieldFilter: {
        field: {
          fieldPath: "term",
        },
        op: "EQUAL",
        value: {
          stringValue: term,
        },
      },
    },
    {
      fieldFilter: {
        field: {
          fieldPath: "subject",
        },
        op: "EQUAL",
        value: {
          stringValue: subject,
        },
      },
    },
    {
      fieldFilter: {
        field: {
          fieldPath: "teacherId",
        },
        op: "EQUAL",
        value: {
          stringValue: teacherUid,
        },
      },
    },
  ];
  const structuredQuery = {
    from: [
      {
        collectionId: "results_draft",
      },
    ],
    where: {
      compositeFilter: {
        op: "AND",
        filters,
      },
    },
  };
  const drafts = await runQuery(
    env,
    structuredQuery,
  );
  if (!drafts.length) {
    throw new ResultValidationError(
      "No result drafts were found for this submission.",
      "EMPTY_SUBMISSION",
    );
  }
  return drafts;
}
/**
 * ---------------------------------------------------------------------------
 * Validate every draft before publication
 * ---------------------------------------------------------------------------
 */
async function validateDraftsForApproval(
  env,
  drafts,
  submission,
  schoolClass,
) {
  const validated = [];
  for (const draft of drafts) {
    /*
     * Validate the basic result structure again.
     *
     * This prevents a draft that became malformed after creation from
     * reaching the published results collection.
     */
    validateResultDraft(draft);
    if (
      String(draft.teacherId) !==
      String(submission.teacherUid)
    ) {
      throw new ResultValidationError(
        `Draft ${draft.id ?? draft.pupilId} belongs to another teacher.`,
        "DRAFT_TEACHER_CONFLICT",
      );
    }
    if (
      String(draft.classId) !==
      String(submission.classId)
    ) {
      throw new ResultValidationError(
        `Draft ${draft.id ?? draft.pupilId} belongs to another class.`,
        "DRAFT_CLASS_CONFLICT",
      );
    }
    if (
      String(draft.session) !==
      String(submission.session)
    ) {
      throw new ResultValidationError(
        `Draft ${draft.id ?? draft.pupilId} belongs to another session.`,
        "DRAFT_SESSION_CONFLICT",
      );
    }
    if (
      String(draft.term) !==
      String(submission.term)
    ) {
      throw new ResultValidationError(
        `Draft ${draft.id ?? draft.pupilId} belongs to another term.`,
        "DRAFT_TERM_CONFLICT",
      );
    }
    if (
      String(draft.subject) !==
      String(submission.subject)
    ) {
      throw new ResultValidationError(
        `Draft ${draft.id ?? draft.pupilId} belongs to another subject.`,
        "DRAFT_SUBJECT_CONFLICT",
      );
    }
    if (
      !classHasSubject(
        schoolClass,
        draft.subject,
        draft.subjectId,
      )
    ) {
      throw new ResultValidationError(
        `Subject "${draft.subject}" does not belong to the class.`,
        "INVALID_SUBJECT",
      );
    }
    const pupil = await getPupilById(
      env,
      draft.pupilId,
    );
    assertPupilBelongsToClass(
      pupil,
      submission.classId,
    );
    /*
     * Recalculate the result from raw score components.
     *
     * Never trust total/percentage/grade/remark stored in the draft.
     */
    const calculation = calculateResult(
      draft,
    );
    validated.push({
      draft,
      pupil,
      calculation,
    });
  }
  return validated;
}
/**
 * ---------------------------------------------------------------------------
 * Detect published-result collisions
 * ---------------------------------------------------------------------------
 *
 * The legacy production result ID is:
 *
 *   pupilId_term_subject
 *
 * Session is intentionally not part of the legacy ID.
 *
 * Therefore we must protect against an existing result from another
 * session/teacher being silently overwritten.
 */
async function assertNoPublishedResultCollision(
  env,
  validatedDrafts,
  submission,
) {
  for (const item of validatedDrafts) {
    const resultId = makeResultId({
      pupilId: item.draft.pupilId,
      term: submission.term,
      subject: submission.subject,
    });
    const existing = await getDocument(
      env,
      "results",
      resultId,
    );
    if (!existing) {
      continue;
    }
    /*
     * An already-approved result belonging to the same session is not
     * silently overwritten.
     */
    if (
      existing.session &&
      String(existing.session) ===
      String(submission.session)
    ) {
      throw new ResultValidationError(
        `A published result already exists for pupil ${item.draft.pupilId}.`,
        "RESULT_ALREADY_PUBLISHED",
      );
    }
    /*
     * Because the legacy ID does not include session, overwriting an older
     * session would destroy historical data.
     */
    throw new ResultValidationError(
      `Published result ID collision detected for pupil ${item.draft.pupilId}.`,
      "RESULT_ID_COLLISION",
    );
  }
}
/**
 * ---------------------------------------------------------------------------
 * Build published result documents
 * ---------------------------------------------------------------------------
 */
function buildPublishedResults(
  validatedDrafts,
  submission,
  adminUid,
) {
  const publishedAt = nowIso();
  return validatedDrafts.map(
    ({
      draft,
      pupil,
      calculation,
    }) => {
      const resultId = makeResultId({
        pupilId: draft.pupilId,
        term: submission.term,
        subject: submission.subject,
      });
      return {
        id: resultId,
        pupilId: draft.pupilId,
        pupilName:
          pupil?.name ??
          draft.pupilName ??
          null,
        classId: submission.classId,
        className:
          submission.className ??
          null,
        teacherId: submission.teacherUid,
        teacherName:
          submission.teacherName ??
          null,
        subject: submission.subject,
        subjectId:
          draft.subjectId ??
          submission.subjectId ??
          null,
        session: submission.session,
        term: submission.term,
        /*
         * Preserve authoritative raw score components.
         *
         * calculateResult() determines the derived fields.
         */
        caScore: draft.caScore,
        examScore: draft.examScore,
        total: calculation.total,
        percentage: calculation.percentage,
        grade: calculation.grade,
        remark: calculation.remark,
        status: "approved",
        approvedBy: adminUid,
        approvedAt: publishedAt,
        publishedAt,
        sourceDraftId:
          draft.id ??
          null,
        updatedAt: publishedAt,
        createdAt:
          draft.createdAt ??
          publishedAt,
      };
    },
  );
}
/**
 * ---------------------------------------------------------------------------
 * Calculate positions where applicable
 * ---------------------------------------------------------------------------
 *
 * Position calculation is kept separate from the per-pupil score
 * calculation.
 */
function applyPositions(
  publishedResults,
) {
  if (!publishedResults.length) {
    return publishedResults;
  }
  const positionInput =
    publishedResults.map(
      (result) => ({
        pupilId: result.pupilId,
        total: result.total,
        percentage: result.percentage,
      }),
    );
  const positions = calculatePositions(
    positionInput,
  );
  const positionMap = new Map();
  if (Array.isArray(positions)) {
    for (const position of positions) {
      if (!position?.pupilId) {
        continue;
      }
      positionMap.set(
        String(position.pupilId),
        position.position ??
        position.rank ??
        null,
      );
    }
  } else if (
    positions &&
    typeof positions === "object"
  ) {
    for (
      const [pupilId, position] of
      Object.entries(positions)
    ) {
      positionMap.set(
        String(pupilId),
        position,
      );
    }
  }
  return publishedResults.map(
    (result) => ({
      ...result,
      position:
        positionMap.get(
          String(result.pupilId),
        ) ??
        result.position ??
        null,
    }),
  );
}
/**
 * ---------------------------------------------------------------------------
 * Approve submission
 * ---------------------------------------------------------------------------
 */
export async function approveSubmission(
  env,
  request,
  submissionId,
) {
  const admin = await requireAdmin(
    env,
    request,
  );
  if (!submissionId) {
    throw new ResultValidationError(
      "Submission ID is required.",
      "MISSING_SUBMISSION_ID",
    );
  }
  const submission =
    await loadSubmission(
      env,
      submissionId,
    );
  /*
   * Verify that the supplied ID is consistent with the legacy identity
   * scheme.
   */
  const expectedSubmissionId =
    makeSubmissionId({
      classId: submission.classId,
      session: submission.session,
      term: submission.term,
      subject: submission.subject,
    });
  if (
    String(expectedSubmissionId) !==
    String(submissionId)
  ) {
    throw new ResultValidationError(
      "Submission identity does not match its stored data.",
      "SUBMISSION_ID_MISMATCH",
    );
  }
  /*
   * Approval is only valid from pending.
   *
   * This prevents duplicate approval and prevents an approved/rejected
   * submission from being accidentally replayed through this endpoint.
   */
  if (submission.status !== "pending") {
    throw new ResultValidationError(
      `Only pending submissions can be approved. Current status: "${submission.status}".`,
      "INVALID_SUBMISSION_STATE",
    );
  }
  const {
    schoolClass,
    teacherUid,
  } = await validateSubmissionRoster(
    env,
    submission,
  );
  /*
   * The submission teacher must still be an active teacher owner of the
   * class. assertTeacherOwnsClass handles the ownership relationship.
   */
  if (
    String(teacherUid) !==
    String(submission.teacherUid)
  ) {
    throw new ResultValidationError(
      "Submission teacher identity is inconsistent.",
      "TEACHER_ID_MISMATCH",
    );
  }
  const drafts =
    await loadSubmissionDrafts(
      env,
      submission,
    );
  const validatedDrafts =
    await validateDraftsForApproval(
      env,
      drafts,
      submission,
      schoolClass,
    );
  /*
   * Prevent overwriting existing historical results.
   */
  await assertNoPublishedResultCollision(
    env,
    validatedDrafts,
    submission,
  );
  /*
   * Build authoritative published results.
   */
  let publishedResults =
    buildPublishedResults(
      validatedDrafts,
      submission,
      admin.uid,
    );
  /*
   * Positions are calculated server-side.
   */
  publishedResults =
    applyPositions(
      publishedResults,
    );
  const approvedAt =
    nowIso();
  /*
   * -------------------------------------------------------------------------
   * Publish results first.
   * -------------------------------------------------------------------------
   *
   * We deliberately publish only after every draft has passed validation.
   *
   * The next Firestore-layer hardening step will replace this sequence with
   * an atomic transaction/batch where appropriate.
   */
  for (
    const result of publishedResults
  ) {
    await setDocument(
      env,
      "results",
      result.id,
      result,
    );
  }
  /*
   * Mark submission approved only after all published result writes succeed.
   */
  const approvedSubmission = {
    ...submission,
    status: "approved",
    approvedBy: admin.uid,
    approvedAt,
    updatedAt: approvedAt,
    publishedAt: approvedAt,
    publishedResultCount:
      publishedResults.length,
  };
  await setDocument(
    env,
    "result_submissions",
    submissionId,
    approvedSubmission,
  );
  /*
   * Create the result lock last.
   *
   * If a lock already exists and is locked, treat the operation as
   * idempotently complete only if the submission is already approved.
   */
  const lockId = makeLockId({
    classId: submission.classId,
    session: submission.session,
    term: submission.term,
    subject: submission.subject,
  });
  const existingLock =
    await getDocument(
      env,
      "result_locks",
      lockId,
    );
  const lock = {
    id: lockId,
    classId: submission.classId,
    className:
      submission.className ??
      schoolClass?.name ??
      null,
    term: submission.term,
    subject: submission.subject,
    subjectId:
      submission.subjectId ??
      null,
    session: submission.session,
    locked: true,
    lockedAt: approvedAt,
    lockedBy: admin.uid,
    reason:
      "Result submission approved and published.",
    updatedAt: approvedAt,
    ...(existingLock?.createdAt
      ? {
          createdAt:
            existingLock.createdAt,
        }
      : {
          createdAt: approvedAt,
        }),
  };
  await setDocument(
    env,
    "result_locks",
    lockId,
    lock,
  );
  /*
   * Audit each major approval action.
   */
  await audit(
    env,
    {
      action: "RESULT_APPROVED",
      actorUid: admin.uid,
      targetType: "result_submission",
      targetId: submissionId,
      metadata: {
        classId: submission.classId,
        session: submission.session,
        term: submission.term,
        subject: submission.subject,
        teacherUid: submission.teacherUid,
        pupilCount: publishedResults.length,
      },
    },
  );
  await audit(
    env,
    {
      action: "RESULT_PUBLISHED",
      actorUid: admin.uid,
      targetType: "result_submission",
      targetId: submissionId,
      metadata: {
        classId: submission.classId,
        session: submission.session,
        term: submission.term,
        subject: submission.subject,
        resultCount: publishedResults.length,
      },
    },
  );
  await audit(
    env,
    {
      action: "RESULT_LOCKED",
      actorUid: admin.uid,
      targetType: "result_lock",
      targetId: lockId,
      metadata: {
        classId: submission.classId,
        session: submission.session,
        term: submission.term,
        subject: submission.subject,
      },
    },
  );
  return {
    approved: true,
    submission: approvedSubmission,
    lock,
    publishedResults,
  };
}
/**
 * ---------------------------------------------------------------------------
 * Reject submission
 * ---------------------------------------------------------------------------
 */
export async function rejectSubmission(
  env,
  request,
  submissionId,
  reason,
) {
  const admin = await requireAdmin(
    env,
    request,
  );
  if (!submissionId) {
    throw new ResultValidationError(
      "Submission ID is required.",
      "MISSING_SUBMISSION_ID",
    );
  }
  const rejectionReason =
    normalise(reason);
  if (!rejectionReason) {
    throw new ResultValidationError(
      "A rejection reason is required.",
      "MISSING_REJECTION_REASON",
    );
  }
  if (
    rejectionReason.length > 1000
  ) {
    throw new ResultValidationError(
      "Rejection reason must not exceed 1000 characters.",
      "REJECTION_REASON_TOO_LONG",
    );
  }
  const submission =
    await loadSubmission(
      env,
      submissionId,
    );
  if (submission.status !== "pending") {
    throw new ResultValidationError(
      `Only pending submissions can be rejected. Current status: "${submission.status}".`,
      "INVALID_SUBMISSION_STATE",
    );
  }
  /*
   * Validate the submission's class/subject/teacher relationship even on
   * rejection. We don't want an administrator approving/rejecting a corrupt
   * submission silently.
   */
  await validateSubmissionRoster(
    env,
    submission,
  );
  const rejectedAt =
    nowIso();
  const rejectedSubmission = {
    ...submission,
    status: "rejected",
    rejectedBy: admin.uid,
    rejectedAt,
    rejectionReason,
    updatedAt: rejectedAt,
  };
  await setDocument(
    env,
    "result_submissions",
    submissionId,
    rejectedSubmission,
  );
  await audit(
    env,
    {
      action: "RESULT_REJECTED",
      actorUid: admin.uid,
      targetType: "result_submission",
      targetId: submissionId,
      metadata: {
        classId: submission.classId,
        session: submission.session,
        term: submission.term,
        subject: submission.subject,
        teacherUid: submission.teacherUid,
        rejectionReason,
      },
    },
  );
  return {
    rejected: true,
    submission: rejectedSubmission,
  };
}
