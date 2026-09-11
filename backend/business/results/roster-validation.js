/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Results Roster Validation
 *
 * Pure validation helpers for result ownership and roster integrity.
 *
 * These functions do not access Firestore themselves.
 * They receive already-loaded records and verify that
 * the records are internally consistent.
 */
export class ResultRosterValidationError extends Error {
  constructor(
    message,
    {
      status = 400,
      code = "RESULT_ROSTER_VALIDATION_ERROR",
    } = {}
  ) {
    super(message);
    this.name =
      "ResultRosterValidationError";
    this.status = status;
    this.code = code;
  }
}
/**
 * Extract normalized subject definitions from a class.
 *
 * Supported class subject formats:
 *
 * [
 *   "Mathematics",
 *   "English"
 * ]
 *
 * or:
 *
 * [
 *   {
 *     id: "math",
 *     name: "Mathematics",
 *     code: "MATH"
 *   }
 * ]
 */
export function getSubjectDefinitions(
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
/**
 * Check whether a subject belongs to a class.
 */
export function classHasSubject(
  schoolClass,
  subject,
  subjectId = null
) {
  const definitions =
    getSubjectDefinitions(
      schoolClass
    );
  return definitions.some(
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
        String(item.name)
          .toLowerCase() ===
          String(subject)
            .toLowerCase()
      ) {
        return true;
      }
      if (
        item.code &&
        String(item.code)
          .toLowerCase() ===
          String(subject)
            .toLowerCase()
      ) {
        return true;
      }
      return false;
    }
  );
}
/**
 * Assert that a teacher owns a class.
 */
export function assertTeacherOwnsClass(
  schoolClass,
  teacherUid
) {
  if (!schoolClass) {
    throw new ResultRosterValidationError(
      "Class not found.",
      {
        status: 404,
        code:
          "CLASS_NOT_FOUND",
      }
    );
  }
  if (
    schoolClass.teacherId !==
    teacherUid
  ) {
    throw new ResultRosterValidationError(
      "You are not the teacher assigned to this class.",
      {
        status: 403,
        code:
          "CLASS_ACCESS_DENIED",
      }
    );
  }
  return schoolClass;
}
/**
 * Extract the class ID from a pupil.
 *
 * Supported historical/current shapes:
 *
 *   pupil.classId
 *
 *   pupil.class.id
 *
 *   pupil.class.classId
 */
export function getPupilClassId(
  pupil
) {
  if (!pupil) {
    return null;
  }
  return (
    pupil.classId ??
    pupil.class?.id ??
    pupil.class?.classId ??
    null
  );
}
/**
 * Assert that a pupil belongs to a class.
 */
export function assertPupilBelongsToClass(
  pupil,
  classId
) {
  if (!pupil) {
    throw new ResultRosterValidationError(
      "Pupil not found.",
      {
        status: 404,
        code:
          "PUPIL_NOT_FOUND",
      }
    );
  }
  const pupilClassId =
    getPupilClassId(
      pupil
    );
  if (!pupilClassId) {
    throw new ResultRosterValidationError(
      "This pupil is not assigned to a class.",
      {
        status: 400,
        code:
          "PUPIL_CLASS_MISSING",
      }
    );
  }
  if (
    String(pupilClassId) !==
    String(classId)
  ) {
    throw new ResultRosterValidationError(
      "This pupil does not belong to the selected class.",
      {
        status: 403,
        code:
          "PUPIL_CLASS_MISMATCH",
      }
    );
  }
  return pupil;
}
/**
 * Perform the complete result roster check using
 * already-loaded records.
 *
 * This deliberately does not check whether a pupil is active.
 * Historical results may legitimately reference pupils
 * who are no longer active.
 */
export function assertValidResultRoster(
  {
    schoolClass,
    pupil,
    teacherUid,
    classId,
    subject,
    subjectId = null,
  }
) {
  assertTeacherOwnsClass(
    schoolClass,
    teacherUid
  );
  if (
    String(schoolClass.id ?? classId) !==
    String(classId)
  ) {
    throw new ResultRosterValidationError(
      "The selected class record does not match the requested class.",
      {
        status: 409,
        code:
          "CLASS_RECORD_MISMATCH",
      }
    );
  }
  if (
    !classHasSubject(
      schoolClass,
      subject,
      subjectId
    )
  ) {
    throw new ResultRosterValidationError(
      "The selected subject does not belong to this class.",
      {
        status: 400,
        code:
          "SUBJECT_NOT_IN_CLASS",
      }
    );
  }
  assertPupilBelongsToClass(
    pupil,
    classId
  );
  return true;
}
