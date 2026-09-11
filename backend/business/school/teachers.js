import {
  getTeacherByUid,
} from "../../api/school.js";

import {
  ValidationError,
  requireId,
  requireString,
  optionalString,
  requireBoolean,
} from "../../security/validation.js";

export async function getTeacherDetails(
  env,
  uid
) {
  requireId(uid, "uid");

  const teacher =
    await getTeacherByUid(
      env,
      uid
    );

  if (!teacher) {
    return null;
  }

  return {
    uid,
    ...teacher,
  };
}

export function validateTeacherPayload(
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
      "Teacher data must be an object."
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
    payload.phone !== undefined
  ) {
    result.phone =
      optionalString(
        payload.phone,
        "phone",
        50
      );
  }

  if (
    payload.canDirectPublish !== undefined
  ) {
    result.canDirectPublish =
      requireBoolean(
        payload.canDirectPublish,
        "canDirectPublish"
      );
  }

  return result;
}
