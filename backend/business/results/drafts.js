/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Result Drafts
 */

import {
  getDocument,
  setDocument,
  deleteDocument,
  runQuery,
} from "../../firebase/firestore.js";

import {
  requireTeacher,
} from "../../auth/authorize.js";

import {
  getClassById,
} from "../../api/school.js";

import {
  validateDraftInput,
  validateClassId,
  validatePupilId,
  validateSession,
  validateTerm,
  validateSubject,
} from "./validation.js";

import {
  writeAuditLog,
} from "../../security/audit.js";

import {
  calculateResult,
} from "./calculation.js";

const DRAFT_COLLECTION =
  "results_draft";

const SUBMISSION_COLLECTION =
  "result_submissions";

const LOCK_COLLECTION =
  "result_locks";

function makeResultId({
  pupilId,
  term,
  subject,
}) {
  /*
   * Preserve the legacy result/draft identity convention.
   *
   * Legacy:
   *   `${pupil.id}_${term}_${subject}`
   */
  return `${pupilId}_${term}_${subject}`;
}

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

function getSubjectNames(
  schoolClass
) {
  if (
    !Array.isArray(
      schoolClass?.subjects
    )
  ) {
    return [];
  }

  return schoolClass.subjects
    .map((subject) => {
      if (
        typeof subject ===
        "string"
      ) {
        return {
          id: null,
          name: subject,
          code: null,
        };
      }

      if (
        subject &&
        typeof subject ===
          "object"
      ) {
        return {
          id:
            subject.id ??
            subject.subjectId ??
            null,

          name:
            subject.name ??
            subject.subject ??
            subject.title ??
            null,

          code:
            subject.code ??
            null,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function classHasSubject(
  schoolClass,
  subject,
  subjectId = null
) {
  const subjects =
    getSubjectNames(
      schoolClass
    );

  return subjects.some(
    (item) => {
      if (
        subjectId &&
        item.id &&
        String(item.id) ===
          String(subjectId)
      ) {
        return true;
      }

      if (
        item.name &&
        String(
          item.name
        ).toLowerCase() ===
          String(
            subject
          ).toLowerCase()
      ) {
        return true;
      }

      if (
        item.code &&
        String(
          item.code
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

async function assertUnlockedAndEditable(
  env,
  {
    classId,
    session,
    term,
    subject,
  }
) {
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
        "This result is locked and cannot be edited."
      );

    error.status = 403;
    error.code =
      "RESULT_LOCKED";

    throw error;
  }

  const submissionId =
    makeSubmissionId({
      classId,
      session,
      term,
      subject,
    });

  const submission =
    await getDocument(
      env,
      SUBMISSION_COLLECTION,
      submissionId
    );

  if (
    submission?.status ===
      "pending" ||
    submission?.status ===
      "approved"
  ) {
    const error =
      new Error(
        "This result submission cannot be edited in its current state."
      );

    error.status = 409;
    error.code =
      "RESULT_SUBMISSION_NOT_EDITABLE";

    throw error;
  }

  return submission;
}

async function parseDraftDocument(
  document
) {
  if (!document) {
    return null;
  }

  return {
    ...document,
    calculated:
      calculateResult(
        document,
        document.calculationRules ||
          {}
      ),
  };
}

export async function getDraft(
  env,
  {
    pupilId,
    term,
    subject,
  }
) {
  validatePupilId(
    pupilId
  );

  validateTerm(term);

  validateSubject(subject);

  const draftId =
    makeResultId({
      pupilId,
      term,
      subject,
    });

  const draft =
    await getDocument(
      env,
      DRAFT_COLLECTION,
      draftId
    );

  return parseDraftDocument(
    draft
  );
}

export async function listDrafts(
  env,
  {
    classId,
    session,
    term,
    subject,
    teacherUid,
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
  ];

  if (teacherUid) {
    filters.push({
      fieldFilter: {
        field: {
          fieldPath: "teacherId",
        },
        op: "EQUAL",
        value: {
          stringValue:
            teacherUid,
        },
      },
    });
  }

  const drafts =
    await runQuery(
      env,
      {
        from: [
          {
            collectionId:
              DRAFT_COLLECTION,
          },
        ],

        where: {
          compositeFilter: {
            op: "AND",
            filters,
          },
        },
      }
    );

  return drafts.map(
    parseDraftDocument
  );
}

export async function saveDraft(
  request,
  env,
  input
) {
  const user =
    await requireTeacher(
      request,
      env
    );

  const draft =
    validateDraftInput(
      input
    );

  if (
    draft.teacherId !==
    user.uid
  ) {
    const error =
      new Error(
        "teacherId does not match the authenticated teacher."
      );

    error.status = 403;
    error.code =
      "TEACHER_ID_MISMATCH";

    throw error;
  }

  const schoolClass =
    await assertTeacherOwnsClass(
      env,
      user.uid,
      draft.classId
    );

  if (
    !classHasSubject(
      schoolClass,
      draft.subject,
      draft.subjectId
    )
  ) {
    const error =
      new Error(
        "The selected subject does not belong to this class."
      );

    error.status = 400;
    error.code =
      "SUBJECT_NOT_IN_CLASS";

    throw error;
  }

  await assertUnlockedAndEditable(
    env,
    {
      classId:
        draft.classId,

      session:
        draft.session,

      term:
        draft.term,

      subject:
        draft.subject,
    }
  );

  const draftId =
    makeResultId({
      pupilId:
        draft.pupilId,

      term:
        draft.term,

      subject:
        draft.subject,
    });

  const existing =
    await getDocument(
      env,
      DRAFT_COLLECTION,
      draftId
    );

  const now =
    new Date().toISOString();

  const calculationRules =
    existing?.calculationRules ??
    null;

  /*
   * Preserve unknown existing fields.
   * This is important because setDocument's "merge" option
   * in the current Firestore helper is not a field-mask merge.
   */
  const stored = {
    ...(existing || {}),

    ...draft,

    id:
      undefined,

    teacherId:
      user.uid,

    teacherUid:
      user.uid,

    updatedAt:
      now,

    createdAt:
      existing?.createdAt ??
      now,

    calculationRules,
  };

  delete stored.id;

  const saved =
    await setDocument(
      env,
      DRAFT_COLLECTION,
      draftId,
      stored
    );

  await writeAuditLog(
    env,
    {
      user,
      action:
        existing
          ? "RESULT_DRAFT_UPDATED"
          : "RESULT_DRAFT_CREATED",

      collection:
        DRAFT_COLLECTION,

      documentId:
        draftId,

      changes: {
        pupilId:
          draft.pupilId,

        classId:
          draft.classId,

        subject:
          draft.subject,

        term:
          draft.term,

        session:
          draft.session,
      },

      request,
    }
  );

  return {
    ...saved,

    calculated:
      calculateResult(
        saved,
        saved.calculationRules ||
          {}
      ),
  };
}

export async function deleteDraft(
  request,
  env,
  {
    pupilId,
    term,
    subject,
  }
) {
  const user =
    await requireTeacher(
      request,
      env
    );

  validatePupilId(
    pupilId
  );

  validateTerm(term);

  validateSubject(subject);

  const draftId =
    makeResultId({
      pupilId,
      term,
      subject,
    });

  const existing =
    await getDocument(
      env,
      DRAFT_COLLECTION,
      draftId
    );

  if (!existing) {
    return false;
  }

  if (
    existing.teacherId !==
      user.uid &&
    existing.teacherUid !==
      user.uid
  ) {
    const error =
      new Error(
        "You do not own this result draft."
      );

    error.status = 403;
    error.code =
      "DRAFT_ACCESS_DENIED";

    throw error;
  }

  await assertTeacherOwnsClass(
    env,
    user.uid,
    existing.classId
  );

  await assertUnlockedAndEditable(
    env,
    {
      classId:
        existing.classId,

      session:
        existing.session,

      term:
        existing.term,

      subject:
        existing.subject,
    }
  );

  await deleteDocument(
    env,
    DRAFT_COLLECTION,
    draftId
  );

  await writeAuditLog(
    env,
    {
      user,

      action:
        "RESULT_DRAFT_DELETED",

      collection:
        DRAFT_COLLECTION,

      documentId:
        draftId,

      deletedData:
        existing,

      request,
    }
  );

  return true;
}
