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
} from "../../firebase/firestore.js";

import {
  requireAdmin,
} from "../../auth/authorize.js";

import {
  getClassById,
} from "../../api/school.js";

import {
  listDrafts,
} from "./drafts.js";

import {
  getSubmissionById,
} from "./submissions.js";

import {
  validateDraftInput,
  validateGradeBands,
} from "./validation.js";

import {
  calculateResult,
  calculatePositions,
} from "./calculation.js";

import {
  writeAuditLog,
} from "../../security/audit.js";

const RESULT_COLLECTION = "results";
const LOCK_COLLECTION = "result_locks";
const SUBMISSION_COLLECTION = "result_submissions";

function makeResultId({
  pupilId,
  term,
  subject,
}) {
  /*
   * Preserve the existing/legacy result identity convention.
   */
  return `${pupilId}_${term}_${subject}`;
}

function makeLockId({
  classId,
  session,
  term,
  subject,
}) {
  return `${classId}_${session}_${term}_${subject}`;
}

function classHasSubject(
  schoolClass,
  subject,
  subjectId = null
) {
  if (
    !Array.isArray(
      schoolClass?.subjects
    )
  ) {
    return false;
  }

  return schoolClass.subjects.some(
    (item) => {
      if (
        typeof item ===
        "string"
      ) {
        return (
          item.toLowerCase() ===
          String(
            subject
          ).toLowerCase()
        );
      }

      if (
        !item ||
        typeof item !==
          "object"
      ) {
        return false;
      }

      const id =
        item.id ??
        item.subjectId ??
        null;

      const name =
        item.name ??
        item.subject ??
        item.title ??
        null;

      const code =
        item.code ??
        null;

      if (
        subjectId &&
        id &&
        String(id) ===
          String(subjectId)
      ) {
        return true;
      }

      if (
        name &&
        String(name).toLowerCase() ===
          String(subject).toLowerCase()
      ) {
        return true;
      }

      if (
        code &&
        String(code).toLowerCase() ===
          String(subject).toLowerCase()
      ) {
        return true;
      }

      return false;
    }
  );
}

async function getCalculationRules(
  env,
  submission
) {
  /*
   * The settings document is optional.
   *
   * No historical grading thresholds are invented here.
   */
  const settings =
    await getDocument(
      env,
      "settings",
      "resultCalculation"
    );

  const configured =
    settings?.rules &&
    typeof settings.rules ===
      "object"
      ? settings.rules
      : {};

  const submissionRules =
    submission?.calculationRules &&
    typeof submission.calculationRules ===
      "object"
      ? submission.calculationRules
      : {};

  const rules = {
    ...configured,
    ...submissionRules,
  };

  if (
    rules.gradeBands !==
    undefined &&
    rules.gradeBands !==
    null
  ) {
    rules.gradeBands =
      validateGradeBands(
        rules.gradeBands
      );
  }

  return rules;
}

function createResultValidationError(
  message,
  code = "INVALID_RESULT_DRAFT"
) {
  const error =
    new Error(message);

  error.status = 409;
  error.code = code;

  return error;
}

function ensureDraftMatchesSubmission(
  draft,
  submission
) {
  if (
    draft.classId !==
    submission.classId
  ) {
    throw createResultValidationError(
      "A result draft belongs to a different class.",
      "RESULT_CLASS_MISMATCH"
    );
  }

  if (
    draft.session !==
    submission.session
  ) {
    throw createResultValidationError(
      "A result draft belongs to a different session.",
      "RESULT_SESSION_MISMATCH"
    );
  }

  if (
    draft.term !==
    submission.term
  ) {
    throw createResultValidationError(
      "A result draft belongs to a different term.",
      "RESULT_TERM_MISMATCH"
    );
  }

  if (
    String(draft.subject).toLowerCase() !==
    String(submission.subject).toLowerCase()
  ) {
    throw createResultValidationError(
      "A result draft belongs to a different subject.",
      "RESULT_SUBJECT_MISMATCH"
    );
  }

  const expectedTeacher =
    submission.teacherUid ||
    submission.teacherId;

  const actualTeacher =
    draft.teacherUid ||
    draft.teacherId;

  if (
    expectedTeacher &&
    actualTeacher !==
      expectedTeacher
  ) {
    throw createResultValidationError(
      "A result draft belongs to a different teacher.",
      "RESULT_TEACHER_MISMATCH"
    );
  }
}

function validateAndNormalizeDraft(
  draft
) {
  /*
   * Re-run server validation at approval time.
   *
   * This protects against malformed historical/manual documents.
   */
  const validated =
    validateDraftInput(
      draft
    );

  return {
    ...draft,

    ...validated,

    /*
     * Never allow the stored ID field to become part
     * of the authoritative result payload.
     */
    id: undefined,
  };
}

async function getPublishedResult(
  env,
  resultId
) {
  return getDocument(
    env,
    RESULT_COLLECTION,
    resultId
  );
}

async function ensureExistingPublishedResultIsCompatible(
  env,
  {
    resultId,
    draft,
    submission,
  }
) {
  const existing =
    await getPublishedResult(
      env,
      resultId
    );

  if (!existing) {
    return null;
  }

  /*
   * Never overwrite a result belonging to a different
   * class/session/teacher through an accidental legacy-ID
   * collision.
   */
  if (
    existing.classId &&
    existing.classId !==
      submission.classId
  ) {
    throw createResultValidationError(
      "An existing published result belongs to another class.",
      "RESULT_ID_COLLISION"
    );
  }

  if (
    existing.session &&
    existing.session !==
      submission.session
  ) {
    throw createResultValidationError(
      "An existing published result belongs to another session.",
      "RESULT_ID_COLLISION"
    );
  }

  if (
    existing.teacherId &&
    existing.teacherId !==
      (
        submission.teacherUid ||
        submission.teacherId
      )
  ) {
    throw createResultValidationError(
      "An existing published result belongs to another teacher.",
      "RESULT_ID_COLLISION"
    );
  }

  return existing;
}

/**
 * Recover a previously completed approval.
 *
 * This is deliberately separate from the normal approval path.
 *
 * If the submission says approved, we do not republish blindly.
 * We verify that the lock exists. If it does not, we recreate the
 * lock from the already-approved submission.
 */
async function recoverApprovedSubmission(
  request,
  env,
  admin,
  submission
) {
  const {
    classId,
    className,
    session,
    term,
    subject,
  } = submission;

  const lockId =
    makeLockId({
      classId,
      session,
      term,
      subject,
    });

  const existingLock =
    await getDocument(
      env,
      LOCK_COLLECTION,
      lockId
    );

  if (
    existingLock?.locked === true
  ) {
    return {
      submission,
      lock: existingLock,
      alreadyApproved: true,
      recovered: false,
    };
  }

  const now =
    new Date().toISOString();

  const lock = {
    ...(existingLock || {}),

    classId,

    className:
      className ??
      null,

    term,
    subject,
    session,

    locked: true,

    lockedAt:
      existingLock?.lockedAt ??
      now,

    lockedBy:
      existingLock?.lockedBy ??
      submission.approvedBy ??
      admin.uid,

    reason:
      existingLock?.reason ??
      "Result submission approved and published.",

    submissionId:
      submission.id ??
      null,

    createdAt:
      existingLock?.createdAt ??
      now,

    updatedAt:
      now,
  };

  delete lock.id;

  const savedLock =
    await setDocument(
      env,
      LOCK_COLLECTION,
      lockId,
      lock
    );

  await writeAuditLog(
    env,
    {
      user: admin,

      action:
        "RESULT_LOCK_RECOVERED",

      collection:
        LOCK_COLLECTION,

      documentId:
        lockId,

      changes: {
        locked:
          true,

        submissionId:
          submission.id ??
          null,
      },

      request,
    }
  );

  return {
    submission,
    lock: savedLock,
    alreadyApproved: true,
    recovered: true,
  };
}

/**
 * Approve and publish a pending result submission.
 */
export async function approveSubmission(
  request,
  env,
  submissionId
) {
  const admin =
    await requireAdmin(
      request,
      env
    );

  const submission =
    await getSubmissionById(
      env,
      submissionId
    );

  if (!submission) {
    const error =
      new Error(
        "Result submission not found."
      );

    error.status = 404;
    error.code =
      "SUBMISSION_NOT_FOUND";

    throw error;
  }

  /*
   * Recovery/idempotency guard.
   */
  if (
    submission.status ===
    "approved"
  ) {
    return recoverApprovedSubmission(
      request,
      env,
      admin,
      {
        ...submission,
        id:
          submission.id ??
          submissionId,
      }
    );
  }

  if (
    submission.status !==
    "pending"
  ) {
    const error =
      new Error(
        "Only pending result submissions can be approved."
      );

    error.status = 409;
    error.code =
      "INVALID_SUBMISSION_STATE";

    throw error;
  }

  const {
    classId,
    className,
    session,
    term,
    subject,
  } = submission;

  const schoolClass =
    await getClassById(
      env,
      classId
    );

  if (!schoolClass) {
    const error =
      new Error(
        "The class associated with this submission no longer exists."
      );

    error.status = 409;
    error.code =
      "CLASS_NOT_FOUND";

    throw error;
  }

  if (
    !classHasSubject(
      schoolClass,
      subject,
      submission.subjectId ??
        null
    )
  ) {
    const error =
      new Error(
        "The submitted subject is not configured for this class."
      );

    error.status = 409;
    error.code =
      "SUBJECT_NOT_IN_CLASS";

    throw error;
  }

  const lockId =
    makeLockId({
      classId,
      session,
      term,
      subject,
    });

  const existingLock =
    await getDocument(
      env,
      LOCK_COLLECTION,
      lockId
    );

  if (
    existingLock?.locked ===
    true
  ) {
    const error =
      new Error(
        "This result is already locked."
      );

    error.status = 409;
    error.code =
      "RESULT_LOCKED";

    throw error;
  }

  const drafts =
    await listDrafts(
      env,
      {
        classId,
        session,
        term,
        subject,

        teacherUid:
          submission.teacherUid ||
          submission.teacherId,
      }
    );

  if (
    drafts.length === 0
  ) {
    const error =
      new Error(
        "No result drafts were found for this submission."
      );

    error.status = 409;
    error.code =
      "NO_RESULT_DRAFTS";

    throw error;
  }

  /*
   * Revalidate every draft against the actual submission.
   */
  const validatedDrafts =
    drafts.map(
      (draft) => {
        ensureDraftMatchesSubmission(
          draft,
          submission
        );

        return validateAndNormalizeDraft(
          draft
        );
      }
    );

  const rules =
    await getCalculationRules(
      env,
      submission
    );

  const calculatedResults =
    validatedDrafts.map(
      (draft) => ({
        draft,

        calculated:
          calculateResult(
            draft,
            {
              ...rules,

              /*
               * Draft-level rules are only used if they
               * were previously stored by the backend.
               */
              ...(draft.calculationRules || {}),
            }
          }),
      })
    );

  /*
   * Standard competition ranking.
   *
   * The same ordering is used for the published result documents.
   */
  const positions =
    calculatePositions(
      calculatedResults.map(
        (entry) => ({
          pupilId:
            entry.draft.pupilId,

          total:
            entry.calculated.total,
        })
      )
    );

  const now =
    new Date().toISOString();

  /*
   * Validate all deterministic result identities BEFORE
   * writing any result documents.
   *
   * This minimizes partial writes caused by predictable
   * validation/collision errors.
   */
  const existingResults =
    [];

  for (
    const draft of
      validatedDrafts
  ) {
    const resultId =
      makeResultId({
        pupilId:
          draft.pupilId,

        term:
          draft.term,

        subject:
          draft.subject,
      });

    const existing =
      await ensureExistingPublishedResultIsCompatible(
        env,
        {
          resultId,
          draft,
          submission,
        }
      );

    existingResults.push({
      resultId,
      existing,
    });
  }

  const publishedResults =
    [];

  /*
   * Publish authoritative result documents.
   */
  for (
    let index = 0;
    index <
      calculatedResults.length;
    index += 1
  ) {
    const entry =
      calculatedResults[
        index
      ];

    const draft =
      entry.draft;

    const calculated =
      entry.calculated;

    const {
      resultId,
      existing,
    } =
      existingResults[
        index
      ];

    const published = {
      ...(existing || {}),

      ...draft,

      status:
        "approved",

      approvedBy:
        admin.uid,

      approvedAt:
        now,

      publishedAt:
        now,

      /*
       * Authoritative calculations.
       */
      total:
        calculated.total,

      /*
       * Legacy-compatible alias.
       */
      score:
        calculated.total,

      percentage:
        calculated.percentage,

      grade:
        calculated.grade,

      gradePoint:
        calculated.gradePoint,

      remark:
        calculated.remark,

      position:
        positions[index],

      classId,

      className:
        className ??
        schoolClass.name ??
        null,

      session,

      term,

      subject,

      teacherId:
        submission.teacherUid ||
        submission.teacherId,

      teacherUid:
        submission.teacherUid ||
        submission.teacherId,

      updatedAt:
        now,
    };

    delete published.id;

    const saved =
      await setDocument(
        env,
        RESULT_COLLECTION,
        resultId,
        published
      );

    publishedResults.push(
      saved
    );

    await writeAuditLog(
      env,
      {
        user: admin,

        action:
          "RESULT_PUBLISHED",

        collection:
          RESULT_COLLECTION,

        documentId:
          resultId,

        changes: {
          pupilId:
            draft.pupilId,

          total:
            calculated.total,

          percentage:
            calculated.percentage,

          grade:
            calculated.grade,

          position:
            positions[index],
        },

        request,
      }
    );
  }

  /*
   * Mark the submission approved.
   *
   * This happens only after all result documents have been
   * successfully written.
   */
  const updatedSubmission = {
    ...submission,

    status:
      "approved",

    approvedBy:
      admin.uid,

    approvedAt:
      now,

    updatedAt:
      now,

    publishedAt:
      now,
  };

  delete updatedSubmission.id;

  const savedSubmission =
    await setDocument(
      env,
      SUBMISSION_COLLECTION,
      submissionId,
      updatedSubmission
    );

  await writeAuditLog(
    env,
    {
      user: admin,

      action:
        "RESULT_APPROVED",

      collection:
        SUBMISSION_COLLECTION,

      documentId:
        submissionId,

      changes: {
        status:
          "approved",

        resultCount:
          publishedResults.length,
      },

      request,
    }
  );

  /*
   * Create the immutable lock LAST.
   */
  const lock = {
    classId,

    className:
      className ??
      schoolClass.name ??
      null,

    term,

    subject,

    session,

    locked:
      true,

    lockedAt:
      now,

    lockedBy:
      admin.uid,

    reason:
      "Result submission approved and published.",

    submissionId,

    createdAt:
      now,
  };

  const savedLock =
    await setDocument(
      env,
      LOCK_COLLECTION,
      lockId,
      lock
    );

  await writeAuditLog(
    env,
    {
      user: admin,

      action:
        "RESULT_LOCKED",

      collection:
        LOCK_COLLECTION,

      documentId:
        lockId,

      changes: {
        locked:
          true,

        submissionId,
      },

      request,
    }
  );

  return {
    submission:
      savedSubmission,

    lock:
      savedLock,

    results:
      publishedResults,

    alreadyApproved:
      false,

    recovered:
      false,
  };
}
