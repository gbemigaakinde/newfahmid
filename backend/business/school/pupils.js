import {
  getPupilById,
} from "../../api/school.js";

import {
  ValidationError,
  requireId,
  requireString,
  optionalString,
} from "../../security/validation.js";

export async function getPupilDetails(
  env,
  pupilId
) {
  requireId(
    pupilId,
    "pupilId"
  );

  const pupil =
    await getPupilById(
      env,
      pupilId
    );

  if (!pupil) {
    return null;
  }

  return {
    id: pupilId,
    ...pupil,
  };
}

export function validatePupilPayload(
  payload,
  {
    partial = false,
  } = {}
) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new ValidationError(
      "Pupil data must be an object."
    );
  }

  const result = {};

  if (
    !partial ||
    payload.name !== undefined
  ) {
    result.name =
      requireString(
        payload.name,
        "name",
        {
          minLength: 1,
          maxLength: 200,
        }
      );
  }

  if (
    !partial ||
    payload.admissionNo !== undefined
  ) {
    result.admissionNo =
      requireString(
        payload.admissionNo,
        "admissionNo",
        {
          minLength: 1,
          maxLength: 100,
        }
      );
  }

  if (
    payload.email !== undefined
  ) {
    result.email =
      optionalString(
        payload.email,
        "email",
        254
      );
  }

  if (
    payload.class !== undefined
  ) {
    if (
      payload.class === null
    ) {
      result.class = null;
    } else if (
      typeof payload.class !== "object" ||
      Array.isArray(payload.class)
    ) {
      throw new ValidationError(
        "class must be an object."
      );
    } else {
      result.class = {
        ...payload.class,
      };

      if (
        payload.class.id !== undefined
      ) {
        result.class.id =
          requireId(
            payload.class.id,
            "class.id"
          );
      }

      if (
        payload.class.name !== undefined
      ) {
        result.class.name =
          requireString(
            payload.class.name,
            "class.name",
            {
              minLength: 1,
              maxLength: 150,
            }
          );
      }
    }
  }

  if (
    payload.status !== undefined
  ) {
    result.status =
      requireString(
        payload.status,
        "status",
        {
          minLength: 1,
          maxLength: 50,
        }
      );
  }

  return result;
}
