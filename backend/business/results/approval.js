/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Result Approval & Publishing
 *
 * Admin approval is authoritative.
 *
 * Approval uses one atomic Firestore commit for:
 *
 *   1. published results
 *   2. result submission status
 *   3. result lock
 *
 * This prevents the dangerous partial state where results are published
 * but the submission/lock update fails afterwards.
 */

import {
  getDocument,
  getDocumentSnapshot,
  runQuery,
  commitWrites,
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

function nowIso() {
  return new Date().toISOString();
}

function normalise(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function requireNonEmpty(
  value,
  message,
  code,
) {
  const result = normalise(value);

  if (!result) {
    throw new ResultValidationError(
      message,
      code,
    );
  }

  return result;
}

async function loadSubmission(
  env,
  submissionId,
) {
  const snapshot =
    await getDocumentSnapshot(
      env,
      "result_submissions",
      submissionId,
    );

  if (!snapshot) {
    throw new ResultValidationError(
      "Result submission was not found.",
      "SUBMISSION_NOT_FOUND",
    );
  }

  return snapshot;
}

async function validateSubmissionRoster(
  env,
  submission,
) {
  const classId =
    requireNonEmpty(
      submission.classId,
      "Submission class is required.",
      "MISSING_CLASS_ID",
    );

  const subject =
    requireNonEmpty(
      submission.subject,
      "Submission subject is required.",
      "MISSING_SUBJECT",
    );

  const teacherUid =
    requireNonEmpty(
      submission.teacherUid,
      "Submission teacher is required.",
      "MISSING_TEACHER_ID",
    );

  const schoolClass =
    await getClassById(
      env,
      classId,
    );

  if (!schoolClass) {
    throw new ResultValidationError(
      "The submission class was not found.",
      "CLASS_NOT_FOUND",
    );
  }

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

async function loadSubmissionDrafts(
  env,
  submission,
) {
  const classId =
    normalise(submission.classId);

  const session =
    normalise(submission.session);

  const term =
    normalise(submission.term);

  const subject =
    normalise(submission.subject);

  const teacherUid =
    normalise(submission.teacherUid);

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

  const drafts = await runQuery(
    env,
    {
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
    },
  );

  if (!drafts.length) {
    throw new ResultValidationError(
      "No result drafts were found for this submission.",
      "EMPTY_SUBMISSION",
    );
  }

  return drafts;
}

async function validateDraftsForApproval(
  env,
  drafts,
  submission,
  schoolClass,
) {
  const validated = [];

  for (const draft of drafts) {
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

    const pupil =
      await getPupilById(
        env,
        draft.pupilId,
      );

    assertPupilBelongsToClass(
      pupil,
      submission.classId,
    );

    validated.push({
      draft,
      pupil,
      calculation:
        calculateResult(draft),
    });
  }

  return validated;
}

async function assertNoPublishedResultCollision(
  env,
  validatedDrafts,
  submission,
) {
  for (const item of validatedDrafts) {
    const resultId =
      makeResultId({
        pupilId:
          item.draft.pupilId,
        term:
          submission.term,
        subject:
          submission.subject,
      });

    const existing =
      await getDocument(
        env,
        "results",
        resultId,
      );

    if (existing) {
      throw new ResultValidationError(
        `Published result ID collision detected for pupil ${item.draft.pupilId}.`,
        "RESULT_ID_COLLISION",
      );
    }
  }
}

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
    }) => ({
      id: makeResultId({
        pupilId:
          draft.pupilId,
        term:
          submission.term,
        subject:
          submission.subject,
      }),

      pupilId:
        draft.pupilId,

      pupilName:
        pupil?.name ??
        draft.pupilName ??
        null,

      classId:
        submission.classId,

      className:
        submission.className ??
        null,

      teacherId:
        submission.teacherUid,

      teacherName:
        submission.teacherName ??
        null,

      subject:
        submission.subject,

      subjectId:
        draft.subjectId ??
        submission.subjectId ??
        null,

      session:
        submission.session,

      term:
        submission.term,

      caScore:
        draft.caScore,

      examScore:
        draft.examScore,

      total:
        calculation.total,

      percentage:
        calculation.percentage,

      grade:
        calculation.grade,

      gradePoint:
        calculation.gradePoint,

      remark:
        calculation.remark,

      status:
        "approved",

      approvedBy:
        adminUid,

      approvedAt:
        publishedAt,

      publishedAt,

      sourceDraftId:
        draft.id ?? null,

      createdAt:
        draft.createdAt ??
        publishedAt,

      updatedAt:
        publishedAt,
    }),
  );
}

function applyPositions(
  publishedResults,
) {
  if (!publishedResults.length) {
    return publishedResults;
  }

  const positions =
    calculatePositions(
      publishedResults.map(
        (result) => ({
          total:
            result.total,
        }),
      ),
    );

  return publishedResults.map(
    (result, index) => ({
      ...result,
      position:
        positions[index] ??
        null,
    }),
  );
}

function buildApprovalOperations({
  publishedResults,
  approvedSubmission,
  lock,
  submissionUpdateTime,
}) {
  const operations = [];

  for (
    const result of
    publishedResults
  ) {
    operations.push({
      type: "set",
      collection: "results",
      documentId: result.id,
      data: result,
      precondition: {
        exists: false,
      },
    });
  }

  operations.push({
    type: "set",
    collection:
      "result_submissions",
    documentId:
      approvedSubmission.id,
    data:
      approvedSubmission,
    precondition:
      submissionUpdateTime
        ? {
            updateTime:
              submissionUpdateTime,
          }
        : {
            exists: true,
          },
  });

  operations.push({
    type: "set",
    collection: "result_locks",
    documentId: lock.id,
    data: lock,
    precondition: {
      exists: false,
    },
  });

  return operations;
}

export async function approveSubmission(
  request,
  env,
  submissionId,
) {
  const admin =
    await requireAdmin(
      request,
      env,
    );

  if (!submissionId) {
    throw new ResultValidationError(
      "Submission ID is required.",
      "MISSING_SUBMISSION_ID",
    );
  }

  const snapshot =
    await loadSubmission(
      env,
      submissionId,
    );

  const submission =
    snapshot.document;

  const expectedId =
    makeSubmissionId({
      classId:
        submission.classId,
      session:
        submission.session,
      term:
        submission.term,
      subject:
        submission.subject,
    });

  if (
    String(expectedId) !==
    String(submissionId)
  ) {
    throw new ResultValidationError(
      "Submission identity does not match its stored data.",
      "SUBMISSION_ID_MISMATCH",
    );
  }

  if (
    submission.status !==
    "pending"
  ) {
    throw new ResultValidationError(
      `Only pending submissions can be approved. Current status: "${submission.status}".`,
      "INVALID_SUBMISSION_STATE",
    );
  }

  const {
    schoolClass,
    teacherUid,
  } =
    await validateSubmissionRoster(
      env,
      submission,
    );

  if (
    String(teacherUid) !==
    String(submission.teacherUid)
  ) {
    throw new ResultValidationError(
      "Submission teacher identity is inconsistent.",
      "TEACHER_ID_MISMATCH",
    );
  }

  const lockId =
    makeLockId({
      classId:
        submission.classId,
      session:
        submission.session,
      term:
        submission.term,
      subject:
        submission.subject,
    });

  const existingLock =
    await getDocument(
      env,
      "result_locks",
      lockId,
    );

  if (existingLock) {
    throw new ResultValidationError(
      "A result lock already exists for this submission.",
      "RESULT_LOCK_ALREADY_EXISTS",
    );
  }

  const drafts =
    await loadSubmissionDrafts(
      env,
      submission,
    );

  const validated =
    await validateDraftsForApproval(
      env,
      drafts,
      submission,
      schoolClass,
    );

  await assertNoPublishedResultCollision(
    env,
    validated,
    submission,
  );

  let publishedResults =
    buildPublishedResults(
      validated,
      submission,
      admin.uid,
    );

  publishedResults =
    applyPositions(
      publishedResults,
    );

  if (
    publishedResults.length + 2 >
    500
  ) {
    throw new ResultValidationError(
      "This submission contains too many pupil results to approve atomically.",
      "ATOMIC_APPROVAL_WRITE_LIMIT",
    );
  }

  const approvedAt =
    nowIso();

  const approvedSubmission = {
    ...submission,

    id:
      submissionId,

    status:
      "approved",

    approvedBy:
      admin.uid,

    approvedAt,

    publishedAt:
      approvedAt,

    publishedResultCount:
      publishedResults.length,

    updatedAt:
      approvedAt,
  };

  const lock = {
    id:
      lockId,

    classId:
      submission.classId,

    className:
      submission.className ??
      schoolClass.name ??
      null,

    term:
      submission.term,

    subject:
      submission.subject,

    subjectId:
      submission.subjectId ??
      null,

    session:
      submission.session,

    locked:
      true,

    lockedAt:
      approvedAt,

    lockedBy:
      admin.uid,

    reason:
      "Result submission approved and published.",

    createdAt:
      approvedAt,

    updatedAt:
      approvedAt,
  };

  await commitWrites(
    env,
    buildApprovalOperations({
      publishedResults,
      approvedSubmission,
      lock,
      submissionUpdateTime:
        snapshot.updateTime,
    }),
  );

  await audit(env, {
    action:
      "RESULT_APPROVED",
    actorUid:
      admin.uid,
    targetType:
      "result_submission",
    targetId:
      submissionId,
    metadata: {
      classId:
        submission.classId,
      session:
        submission.session,
      term:
        submission.term,
      subject:
        submission.subject,
      teacherUid:
        submission.teacherUid,
      pupilCount:
        publishedResults.length,
    },
  });

  await audit(env, {
    action:
      "RESULT_PUBLISHED",
    actorUid:
      admin.uid,
    targetType:
      "result_submission",
    targetId:
      submissionId,
    metadata: {
      classId:
        submission.classId,
      session:
        submission.session,
      term:
        submission.term,
      subject:
        submission.subject,
      resultCount:
        publishedResults.length,
    },
  });

  await audit(env, {
    action:
      "RESULT_LOCKED",
    actorUid:
      admin.uid,
    targetType:
      "result_lock",
    targetId:
      lockId,
    metadata: {
      classId:
        submission.classId,
      session:
        submission.session,
      term:
        submission.term,
      subject:
        submission.subject,
    },
  });

  return {
    approved: true,
    submission:
      approvedSubmission,
    lock,
    publishedResults,
  };
}

export async function rejectSubmission(
  request,
  env,
  submissionId,
  reason,
) {
  const admin =
    await requireAdmin(
      request,
      env,
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

  const snapshot =
    await loadSubmission(
      env,
      submissionId,
    );

  const submission =
    snapshot.document;

  if (
    submission.status !==
    "pending"
  ) {
    throw new ResultValidationError(
      `Only pending submissions can be rejected. Current status: "${submission.status}".`,
      "INVALID_SUBMISSION_STATE",
    );
  }

  await validateSubmissionRoster(
    env,
    submission,
  );

  const rejectedAt =
    nowIso();

  const rejectedSubmission = {
    ...submission,

    id:
      submissionId,

    status:
      "rejected",

    rejectedBy:
      admin.uid,

    rejectedAt,

    rejectionReason,

    updatedAt:
      rejectedAt,
  };

  await commitWrites(
    env,
    [
      {
        type: "set",

        collection:
          "result_submissions",

        documentId:
          submissionId,

        data:
          rejectedSubmission,

        precondition:
          snapshot.updateTime
            ? {
                updateTime:
                  snapshot.updateTime,
              }
            : {
                exists: true,
              },
      },
    ],
  );

  await audit(env, {
    action:
      "RESULT_REJECTED",
    actorUid:
      admin.uid,
    targetType:
      "result_submission",
    targetId:
      submissionId,
    metadata: {
      classId:
        submission.classId,
      session:
        submission.session,
      term:
        submission.term,
      subject:
        submission.subject,
      teacherUid:
        submission.teacherUid,
      rejectionReason,
    },
  });

  return {
    rejected: true,
    submission:
      rejectedSubmission,
  };
}

export {
  buildApprovalOperations,
};
