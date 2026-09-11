/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Result Approval & Publishing
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
  validateGradeBands,
} from "./validation.js";

import {
  calculateResult,
  calculatePositions,
} from "./calculation.js";

import {
  writeAuditLog,
} from "../../security/audit.js";

const RESULT_COLLECTION =
  "results";

const LOCK_COLLECTION =
  "result_locks";

const SUBMISSION_COLLECTION =
  "result_submissions";

function makeResultId({
  pupilId,
  term,
  subject,
}) {
  /*
   * Preserve legacy production result IDs.
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

function makeSubmissionId({
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
        String(
          name
        ).toLowerCase() ===
          String(
            subject
          ).toLowerCase()
      ) {
        return true;
      }

      if (
        code &&
        String(
          code
        ).toLowerCase() ===
          String(
            subject
          ).toLowerCase()
      ) {
        return true;
      }

      return false;
    }
  );
}

/**
 * Fetch result calculation rules.
 *
 * The rules can be supplied from settings later.
 *
 * For now we accept explicitly provided rules but do not
 * invent historical grade thresholds.
 */
async function getCalculationRules(
  env,
  submission
) {
  /*
   * A future settings document can provide these.
   *
   * The fallback is deliberately empty.
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
    rules.gradeBands
  ) {
    rules.gradeBands =
      validateGradeBands(
        rules.gradeBands
      );
  }

  return rules;
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

/**
 * Approve a pending submission.
 *
 * IMPORTANT:
 * This function intentionally uses deterministic IDs and an
 * approval-state guard so repeated approval requests are
 * idempotent at the application level.
 *
 * The current Firestore abstraction does not expose transactions
 * or batched writes, so true cross-document atomicity is not
 * available yet.
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

  if (
    submission.status ===
      "approved"
  ) {
    return {
      submission,
      alreadyApproved:
        true,
    };
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
      subject
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
    /*
     * If a previous approval completed the lock, make this
     * request idempotent rather than publishing a second time.
     */
    const alreadyApproved =
      submission.status ===
      "approved";

    if (
      alreadyApproved
    ) {
      return {
        submission,
        lock:
          existingLock,
        alreadyApproved:
          true,
      };
    }

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

  const rules =
    await getCalculationRules(
      env,
      submission
    );

  const calculatedResults =
    drafts.map(
      (draft) => ({
        draft,
        calculated:
          calculateResult(
            draft,
            {
              ...rules,

              /*
               * A draft's own rules are only considered if
               * explicitly stored by the backend.
               */
              ...(draft.calculationRules ||
                {}),
            }
          }),
      })
    );

  /*
   * Calculate positions across this submitted class/subject.
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

  const publishedResults =
    [];

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
      await getPublishedResult(
        env,
        resultId
      );

    /*
     * Preserve existing historical fields, while authoritative
     * calculated fields are overwritten by this approval.
     */
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
       * Preserve the legacy `score` field as an alias where
       * appropriate.
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

      classId:
        classId,

      className:
        className ??
        schoolClass.name ??
        null,

      session:
        session,

      term:
        term,

      subject:
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
   * Mark submission approved.
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
   * Finally create the immutable lock.
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

        submissionId:
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
  };
}
