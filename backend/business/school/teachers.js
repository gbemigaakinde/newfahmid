import {
  getDocument,
  setDocument,
  updateDocument,
  deleteDocument,
} from "../../firebase/firestore.js";

import {
  ValidationError,
  requireObject,
  requireString,
  optionalString,
  requireBoolean,
} from "../../security/validation.js";

export async function getTeacherDetails(
  env,
  uid
) {
  if (!uid) {
    throw new ValidationError(
      "Teacher UID is required."
    );
  }

  return getDocument(
    env,
    "teachers",
    uid
  );
}

export function validateTeacherPayload(
  payload,
  {
    partial = false,
  } = {}
) {
  const data = requireObject(
    payload,
    "Teacher data"
  );

  const result = {};

  if (!partial || data.name !== undefined) {
    result.name = requireString(
      data.name,
      "name",
      { maxLength: 200 }
    );
  }

  if (data.email !== undefined) {
    result.email = optionalString(
      data.email,
      "email",
      { maxLength: 320 }
    );
  }

  if (data.phone !== undefined) {
    result.phone = optionalString(
      data.phone,
      "phone",
      { maxLength: 50 }
    );
  }

  if (
    data.canDirectPublish !==
    undefined
  ) {
    result.canDirectPublish =
      requireBoolean(
        data.canDirectPublish,
        "canDirectPublish"
      );
  }

  if (data.active !== undefined) {
    result.active = requireBoolean(
      data.active,
      "active"
    );
  }

  return result;
}

export async function createTeacher(
  env,
  uid,
  payload
) {
  if (!uid) {
    throw new ValidationError(
      "Teacher UID is required."
    );
  }

  const existing =
    await getDocument(
      env,
      "teachers",
      uid
    );

  if (existing) {
    throw new ValidationError(
      "A teacher profile with this UID already exists."
    );
  }

  const data =
    validateTeacherPayload(payload);

  await setDocument(
    env,
    "teachers",
    uid,
    data
  );

  return {
    uid,
    ...data,
  };
}

export async function updateTeacher(
  env,
  uid,
  payload
) {
  const existing =
    await getDocument(
      env,
      "teachers",
      uid
    );

  if (!existing) {
    return null;
  }

  const changes =
    validateTeacherPayload(
      payload,
      { partial: true }
    );

  if (
    Object.keys(changes).length === 0
  ) {
    throw new ValidationError(
      "No valid changes were supplied."
    );
  }

  await updateDocument(
    env,
    "teachers",
    uid,
    changes
  );

  return {
    uid,
    ...existing,
    ...changes,
  };
}

export async function deleteTeacher(
  env,
  uid
) {
  const existing =
    await getDocument(
      env,
      "teachers",
      uid
    );

  if (!existing) {
    return null;
  }

  /*
   * This removes the teacher profile only.
   *
   * Firebase Authentication deletion is
   * deliberately NOT performed here.
   */
  await deleteDocument(
    env,
    "teachers",
    uid
  );

  return {
    uid,
    ...existing,
  };
}
