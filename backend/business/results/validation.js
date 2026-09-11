/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Results Validation
 *
 * Validation for teacher result drafts and admin result processing.
 *
 * IMPORTANT:
 * Client-calculated values such as total, percentage, grade,
 * average and position are NEVER trusted.
 */

import {
  requireObject,
  requireString,
  optionalString,
  requireId,
} from "../../security/validation.js";

export class ResultValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResultValidationError";
    this.status = 400;
  }
}

function fail(message) {
  throw new ResultValidationError(message);
}

export function validateSession(session) {
  return requireString(session, "session", {
    minLength: 1,
    maxLength: 50,
  });
}

export function validateTerm(term) {
  return requireString(term, "term", {
    minLength: 1,
    maxLength: 100,
  });
}

export function validateClassId(classId) {
  return requireId(classId, "classId");
}

export function validatePupilId(pupilId) {
  return requireId(pupilId, "pupilId");
}

export function validateTeacherId(teacherId) {
  return requireId(teacherId, "teacherId");
}

export function validateSubject(subject) {
  return requireString(subject, "subject", {
    minLength: 1,
    maxLength: 200,
  });
}

export function validateSubjectId(subjectId) {
  return optionalString(
    subjectId,
    "subjectId",
    150
  );
}

export function validateScore(
  value,
  fieldName,
  {
    required = false,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
  } = {}
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    if (required) {
      fail(`${fieldName} is required.`);
    }

    return null;
  }

  const numeric =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(numeric)
  ) {
    fail(`${fieldName} must be a valid number.`);
  }

  if (numeric < min) {
    fail(
      `${fieldName} cannot be less than ${min}.`
    );
  }

  if (numeric > max) {
    fail(
      `${fieldName} cannot be greater than ${max}.`
    );
  }

  return numeric;
}

/**
 * Validate the identity fields required for a result.
 *
 * Supports the legacy result shape:
 *   pupilId
 *   classId
 *   subject
 *   session
 *   term
 *   teacherId
 */
export function validateResultIdentity(
  input
) {
  requireObject(
    input,
    "Result data must be an object."
  );

  const pupilId =
    validatePupilId(
      input.pupilId
    );

  const classId =
    validateClassId(
      input.classId
    );

  const session =
    validateSession(
      input.session
    );

  const term =
    validateTerm(
      input.term
    );

  const subject =
    validateSubject(
      input.subject
    );

  const subjectId =
    validateSubjectId(
      input.subjectId
    );

  const teacherId =
    validateTeacherId(
      input.teacherId ||
      input.teacherUid
    );

  return {
    pupilId,
    classId,
    session,
    term,
    subject,
    subjectId,
    teacherId,
  };
}

/**
 * Validate raw score components.
 *
 * Legacy system uses caScore and examScore.
 *
 * We intentionally do not invent grading rules or maximums here.
 */
export function validateRawScores(
  input
) {
  requireObject(
    input,
    "Result data must be an object."
  );

  const caScore =
    validateScore(
      input.caScore,
      "caScore"
    );

  const examScore =
    validateScore(
      input.examScore,
      "examScore"
    );

  /*
   * Optional generic components.
   *
   * This lets the backend remain compatible with future
   * scoring structures without trusting calculated fields.
   */
  let components = null;

  if (
    input.components !== undefined
  ) {
    if (
      !input.components ||
      typeof input.components !== "object" ||
      Array.isArray(input.components)
    ) {
      fail(
        "components must be an object."
      );
    }

    components = {};

    for (
      const [
        key,
        value,
      ] of Object.entries(
        input.components
      )
    ) {
      const safeKey =
        requireString(
          key,
          "component name",
          {
            minLength: 1,
            maxLength: 100,
          }
        );

      components[safeKey] =
        validateScore(
          value,
          `components.${safeKey}`
        );
    }
  }

  if (
    caScore === null &&
    examScore === null &&
    !components
  ) {
    /*
     * A completely empty result is permitted as a draft.
     *
     * This is useful while a teacher is entering results.
     */
  }

  return {
    caScore,
    examScore,
    components,
  };
}

/**
 * Remove fields that the browser is not allowed to authoritatively set.
 *
 * These values are recalculated by calculation.js.
 */
export function stripCalculatedFields(
  input
) {
  const cleaned = {
    ...input,
  };

  delete cleaned.total;
  delete cleaned.score;
  delete cleaned.percentage;
  delete cleaned.average;
  delete cleaned.grade;
  delete cleaned.gradePoint;
  delete cleaned.remark;
  delete cleaned.position;
  delete cleaned.rank;

  delete cleaned.approvedBy;
  delete cleaned.approvedAt;
  delete cleaned.publishedAt;
  delete cleaned.locked;
  delete cleaned.lockedAt;
  delete cleaned.lockedBy;

  delete cleaned.status;

  return cleaned;
}

/**
 * Validate a complete incoming draft.
 */
export function validateDraftInput(
  input
) {
  const sanitized =
    stripCalculatedFields(
      requireObject(
        input,
        "Result draft must be an object."
      )
    );

  const identity =
    validateResultIdentity(
      sanitized
    );

  const scores =
    validateRawScores(
      sanitized
    );

  return {
    ...identity,
    ...scores,
  };
}

/**
 * Validate grade-band configuration.
 *
 * We deliberately require explicit configuration.
 * Historical Fahmid thresholds are not invented here.
 *
 * Example:
 *
 * gradeBands: [
 *   { min: 75, grade: "A1" },
 *   { min: 70, grade: "B2" }
 * ]
 */
export function validateGradeBands(
  gradeBands
) {
  if (
    gradeBands === undefined ||
    gradeBands === null
  ) {
    return null;
  }

  if (!Array.isArray(gradeBands)) {
    fail(
      "gradeBands must be an array."
    );
  }

  const normalized =
    gradeBands.map(
      (band, index) => {
        requireObject(
          band,
          `gradeBands[${index}] must be an object.`
        );

        const min =
          validateScore(
            band.min,
            `gradeBands[${index}].min`,
            {
              required: true,
              min: 0,
            }
          );

        const grade =
          requireString(
            band.grade,
            `gradeBands[${index}].grade`,
            {
              minLength: 1,
              maxLength: 20,
            }
          );

        return {
          min,
          grade,
          remark:
            optionalString(
              band.remark,
              `gradeBands[${index}].remark`,
              200
            ),
          gradePoint:
            band.gradePoint ===
            undefined ||
            band.gradePoint === null
              ? null
              : validateScore(
                  band.gradePoint,
                  `gradeBands[${index}].gradePoint`,
                  {
                    min: 0,
                  }
                ),
        };
      }
    );

  normalized.sort(
    (a, b) =>
      b.min - a.min
  );

  return normalized;
}
