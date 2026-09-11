/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Result Submissions
 */

import {
  getDocument,
  setDocument,
  runQuery,
} from "../../firebase/firestore.js";

import {
  requireTeacher,
  requireAdmin,
} from "../../auth/authorize.js";

import {
  getClassById,
} from "../../api/school.js";

import {
  listDrafts,
} from "./drafts.js";

import {
  validateClassId,
  validateSession,
  validateTerm,
  validateSubject,
} from "./validation.js";

import {
  writeAuditLog,
} from "../../security/audit.js";

const COLLECTION =
  "result_submissions";

const LOCK_COLLECTION =
  "result_locks";

function makeSubmissionId({
  classId,
  session,
  term,
  subject,
}) {
  return `${classId}_${session}_${term}_${subject}`;
}

function makeLockId({
  classId,
  session,
  term,
  subject,
}) {
  return `${classId}_${session}_${term}_${subject}`;
}

async function assertTeacherOwnsClass(
  env,
  teacherUid,
  classId
) {
  const schoolClass =
    await getClassById(
      env,
      classId
    );

  if (!schoolClass) {
    const error =
      new Error(
        "Class not found."
      );

    error.status = 404;
    error.code =
      "CLASS_NOT_FOUND";

    throw error;
  }

  if (
    schoolClass.teacherId !==
    teacherUid
  ) {
    const error =
      new Error(
        "You are not the teacher assigned to this class."
      );

    error.status = 403;
    error.code =
      "CLASS_ACCESS_DENIED";

    throw error;
  }

  return schoolClass;
}

export async function getSubmission(
  env,
  {
    classId,
    session,
    term,
    subject,
  }
) {
  validateClassId(
    classId
  );

  validateSession(
    session
  );

  validateTerm(
    term
  );

  validateSubject(
    subject
  );

  const id =
    makeSubmissionId({
      classId,
      session,
      term,
      subject,
    });

  return getDocument(
    env,
    COLLECTION,
    id
  );
}

export async function getSubmissionById(
  env,
  submissionId
) {
  return getDocument(
    env,
    COLLECTION,
    submissionId
  );
}

export async function listSubmissions(
  env,
  {
    status = null,
    teacherUid = null,
  } = {}
) {
  const filters = [];

  if (status) {
    filters.push({
      fieldFilter: {
        field: {
          fieldPath: "status",
        },

        op: "EQUAL",

        value: {
          stringValue:
            status,
        },
      },
    });
  }

  if (teacherUid) {
    filters.push({
      fieldFilter: {
        field: {
          fieldPath:
            "teacherUid",
        },

        op: "EQUAL",

        value: {
          stringValue:
            teacherUid,
        },
      },
    });
  }

  const structuredQuery = {
    from: [
      {
        collectionId:
          COLLECTION,
      },
    ],
  };

  if (
    filters.length === 1
  ) {
    structuredQuery.where =
      filters[0];
  } else if (
    filters.length > 1
  ) {
    structuredQuery.where = {
      compositeFilter: {
        op: "AND",
        filters,
      },
    };
  }

  structuredQuery.orderBy = [
    {
      field: {
        fieldPath:
          "updatedAt",
      },

      direction:
        "DESCENDING",
    },
  ];

  return runQuery(
    env,
    structuredQuery
  );
}

export async function submitResults(
  request,
  env,
  {
    classId,
    session,
    term,
    subject,
  }
) {
  const user =
    await requireTeacher(
      request,
      env
    );

  validateClassId(
    classId
  );

  validateSession(
    session
  );

  validateTerm(
    term
  );

  validateSubject(
    subject
  );

  const schoolClass =
    await assertTeacherOwnsClass(
      env,
      user.uid,
      classId
    );

  const submissionId =
    makeSubmissionId({
      classId,
      session,
      term,
      subject,
    });

  const lockId =
    makeLockId({
      classId,
      session,
      term,
      subject,
    });

  const lock =
    await getDocument(
      env,
      LOCK_COLLECTION,
      lockId
    );

  if (
    lock?.locked === true
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

  const existing =
    await getDocument(
      env,
      COLLECTION,
      submissionId
    );

  if (
    existing?.status ===
      "pending"
  ) {
    const error =
      new Error(
        "This result submission is already pending review."
      );

    error.status = 409;
    error.code =
      "SUBMISSION_ALREADY_PENDING";

    throw error;
  }

  if (
    existing?.status ===
      "approved"
  ) {
    const error =
      new Error(
        "This result submission has already been approved."
      );

    error.status = 409;
    error.code =
      "SUBMISSION_ALREADY_APPROVED";

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
          user.uid,
      }
    );

  const pupilIds =
    new Set();

  for (
    const draft of drafts
  ) {
    if (
      draft.pupilId
    ) {
      pupilIds.add(
        draft.pupilId
      );
    }
  }

  const now =
    new Date().toISOString();

  const submission = {
    ...(existing || {}),

    classId,
    className:
      schoolClass.name ??
      null,

    session,
    term,
    subject,

    teacherUid:
      user.uid,

    teacherId:
      user.uid,

    teacherName:
      user.userRecord?.name ??
      user.userRecord?.displayName ??
      user.claims?.name ??
      null,

    status:
      "pending",

    pupilCount:
      pupilIds.size,

    submittedAt:
      now,

    updatedAt:
      now,

    /*
     * Preserve rejection history where present.
     */
    rejectionReason:
      existing?.rejectionReason ??
      null,
  };

  const saved =
    await setDocument(
      env,
      COLLECTION,
      submissionId,
      submission
    );

  await writeAuditLog(
    env,
    {
      user,

      action:
        "RESULT_SUBMITTED",

      collection:
        COLLECTION,

      documentId:
        submissionId,

      changes: {
        status:
          "pending",

        pupilCount:
          pupilIds.size,
      },

      request,
    }
  );

  return saved;
}

export async function rejectSubmission(
  request,
  env,
  submissionId,
  reason
) {
  const user =
    await requireAdmin(
      request,
      env
    );

  const submission =
    await getDocument(
      env,
      COLLECTION,
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
    submission.status !==
      "pending"
  ) {
    const error =
      new Error(
        "Only pending result submissions can be rejected."
      );

    error.status = 409;
    error.code =
      "INVALID_SUBMISSION_STATE";

    throw error;
  }

  const now =
    new Date().toISOString();

  const updated = {
    ...submission,

    status:
      "rejected",

    rejectedBy:
      user.uid,

    rejectedAt:
      now,

    rejectionReason:
      reason,

    updatedAt:
      now,
  };

  const saved =
    await setDocument(
      env,
      COLLECTION,
      submissionId,
      updated
    );

  await writeAuditLog(
    env,
    {
      user,

      action:
        "RESULT_REJECTED",

      collection:
        COLLECTION,

      documentId:
        submissionId,

      changes: {
        status:
          "rejected",

        rejectionReason:
          reason,
      },

      request,
    }
  );

  return saved;
}
