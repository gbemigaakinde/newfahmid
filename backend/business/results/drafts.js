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
  requireTeacher,
} from "../../auth/authorize.js";

import {
  getClassById,
  getPupilById,
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

const DRAFT_COLLECTION = "results_draft";
const SUBMISSION_COLLECTION = "result_submissions";
const LOCK_COLLECTION = "result_locks";

function makeResultId({
  pupilId,
  term,
  subject,
}) {
  /*
   * Preserve the legacy Fahmid identity convention.
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

function getSubjectDefinitions(schoolClass) {
  if (!Array.isArray(schoolClass?.subjects)) {
    return [];
  }

  return schoolClass.subjects
    .map((subject) => {
      if (typeof subject === "string") {
        return {
          id: null,
          name: subject,
          code: null,
        };
      }

      if (
        subject &&
        typeof subject === "object"
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
    getSubjectDefinitions(
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
        String(item.name).toLowerCase() ===
          String(subject).toLowerCase()
      ) {
        return true;
      }

      if (
        item.code &&
        String(item.code).toLowerCase() ===
          String(subject).toLowerCase()
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
    const error = new Error(
      "Class not found."
    );

    error.status = 404;
    error.code = "CLASS_NOT_FOUND";

    throw error;
  }

  if (
    schoolClass.teacherId !==
    teacherUid
  ) {
    const error = new Error(
      "You are not the teacher assigned to this class."
    );

    error.status = 403;
    error.code = "CLASS_ACCESS_DENIED";

    throw error;
  }

  return schoolClass;
}

/**
 * Verify that a pupil belongs to the class supplied by the request.
 *
 * Supported pupil representations:
 *
 *   {
 *     classId: "class-1"
 *   }
 *
 * or:
 *
 *   {
 *     class: {
 *       id: "class-1"
 *     }
 *   }
 *
 * or:
 *
 *   {
 *     class: {
 *       classId: "class-1"
 *     }
 *   }
 *
 * We intentionally do not require the pupil to be active here.
 * Historical results may legitimately need to reference pupils
 * who are no longer active.
 */
async function assertPupilBelongsToClass(
  env,
  pupilId,
  classId
) {
  const pupil =
    await getPupilById(
      env,
      pupilId
    );

  if (!pupil) {
    const error = new Error(
      "Pupil not found."
    );

    error.status = 404;
    error.code = "PUPIL_NOT_FOUND";

    throw error;
  }

  const pupilClassId =
    pupil.classId ??
    pupil.class?.id ??
    pupil.class?.classId ??
    null;

  if (!pupilClassId) {
    const error = new Error(
      "This pupil is not assigned to a class."
    );

    error.status = 400;
    error.code = "PUPIL_CLASS_MISSING";

    throw error;
  }

  if (
    String(pupilClassId) !==
    String(classId)
  ) {
    const error = new Error(
      "This pupil does not belong to the selected class."
    );

    error.status = 403;
    error.code =
      "PUPIL_CLASS_MISMATCH";

    throw error;
  }

  return pupil;
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

  if (lock?.locked === true) {
    const error = new Error(
      "This result is locked and cannot be edited."
    );

    error.status = 403;
    error.code = "RESULT_LOCKED";

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
    submission?.status === "pending" ||
    submission?.status === "approved"
  ) {
    const error = new Error(
      "This result submission cannot be edited in its current state."
    );

    error.status = 409;
    error.code =
      "RESULT_SUBMISSION_NOT_EDITABLE";

    throw error;
  }

  return submission;
}

function parseDraftDocument(document) {
  if (!document) {
    return null;
  }

  return {
    ...document,

    calculated:
      calculateResult(
        document,
        document.calculationRules || {}
      ),
  };
}

/**
 * Teacher-readable single draft.
 *
 * Ownership and class/pupil consistency are enforced here.
 */
export async function getDraft(
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

  validatePupilId(pupilId);
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

  if (!draft) {
    return null;
  }

  if (
    draft.teacherId !== user.uid &&
    draft.teacherUid !== user.uid
  ) {
    const error = new Error(
      "You do not have access to this result draft."
    );

    error.status = 403;
    error.code =
      "DRAFT_ACCESS_DENIED";

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
    const error = new Error(
      "The subject on this result does not belong to the class."
    );

    error.status = 400;
    error.code =
      "SUBJECT_NOT_IN_CLASS";

    throw error;
  }

  await assertPupilBelongsToClass(
    env,
    draft.pupilId,
    draft.classId
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
  validateClassId(classId);
  validateSession(session);
  validateTerm(term);
  validateSubject(subject);

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
          stringValue: teacherUid,
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

  return drafts
    .map(parseDraftDocument)
    .filter(Boolean);
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
    const error = new Error(
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
    const error = new Error(
      "The selected subject does not belong to this class."
    );

    error.status = 400;
    error.code =
      "SUBJECT_NOT_IN_CLASS";

    throw error;
  }

  /*
   * SECURITY BOUNDARY:
   *
   * Never trust the class supplied by the browser.
   * Load the pupil from Firestore and verify its actual
   * class assignment.
   */
  await assertPupilBelongsToClass(
    env,
    draft.pupilId,
    draft.classId
  );

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

  /*
   * Extra protection against accidental cross-teacher
   * overwrites when the deterministic legacy ID already exists.
   */
  if (
    existing &&
    existing.teacherId !== user.uid &&
    existing.teacherUid !== user.uid
  ) {
    const error = new Error(
      "This result draft belongs to another teacher."
    );

    error.status = 403;
    error.code =
      "DRAFT_ACCESS_DENIED";

    throw error;
  }

  /*
   * If an existing draft somehow contains a stale class
   * assignment, do not silently allow the new request to
   * overwrite it.
   */
  if (
    existing &&
    existing.classId &&
    String(existing.classId) !==
      String(draft.classId)
  ) {
    const error = new Error(
      "The existing result draft belongs to a different class."
    );

    error.status = 409;
    error.code =
      "DRAFT_CLASS_CONFLICT";

    throw error;
  }

  const now =
    new Date().toISOString();

  const stored = {
    ...(existing || {}),
    ...draft,

    teacherId:
      user.uid,

    teacherUid:
      user.uid,

    updatedAt:
      now,

    createdAt:
      existing?.createdAt ??
      now,

    /*
     * Do not inherit stale calculated values.
     * They are always recomputed.
     */
    calculationRules:
      existing?.calculationRules ??
      null,
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
        saved.calculationRules || {}
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

  validatePupilId(pupilId);
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
    const error = new Error(
      "You do not own this result draft."
    );

    error.status = 403;
    error.code =
      "DRAFT_ACCESS_DENIED";

    throw error;
  }

  const schoolClass =
    await assertTeacherOwnsClass(
      env,
      user.uid,
      existing.classId
    );

  if (
    !classHasSubject(
      schoolClass,
      existing.subject,
      existing.subjectId
    )
  ) {
    const error = new Error(
      "The subject on this result does not belong to the class."
    );

    error.status = 400;
    error.code =
      "SUBJECT_NOT_IN_CLASS";

    throw error;
  }

  await assertPupilBelongsToClass(
    env,
    existing.pupilId,
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
