import {
  getDocument,
  setDocument,
  updateDocument,
  deleteDocument,
  runQuery,
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

/**
 * All teacher profiles, sorted by name — there was no list-all
 * endpoint for teachers before this phase; admin.js read the whole
 * `teachers` collection directly from the browser instead.
 */
export async function listTeachers(env) {
  const teachers = await runQuery(env, {
    from: [{ collectionId: "teachers" }],
  });

  return teachers
    .map((t) => ({ uid: t.id, ...t }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
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

  /*
   * The rest of these fields are all used by the real teacher
   * edit form (gender, dob, contact, address, employeeId,
   * dateJoined, roleTitle, status, qualification, specialization,
   * notes) but were never accepted here. Every one of them would
   * have been silently stripped out before this phase — a teacher
   * edit through the Worker would have quietly discarded most of
   * what the form actually submits.
   */

  if (data.gender !== undefined) {
    result.gender = optionalString(
      data.gender,
      "gender",
      { maxLength: 20 }
    );
  }

  if (data.dob !== undefined) {
    result.dob = optionalString(
      data.dob,
      "dob",
      { maxLength: 20 }
    );
  }

  if (data.contact !== undefined) {
    result.contact = optionalString(
      data.contact,
      "contact",
      { maxLength: 50 }
    );
  }

  if (data.address !== undefined) {
    result.address = optionalString(
      data.address,
      "address",
      { maxLength: 500 }
    );
  }

  if (data.employeeId !== undefined) {
    result.employeeId = optionalString(
      data.employeeId,
      "employeeId",
      { maxLength: 100 }
    );
  }

  if (data.dateJoined !== undefined) {
    result.dateJoined = optionalString(
      data.dateJoined,
      "dateJoined",
      { maxLength: 20 }
    );
  }

  if (data.roleTitle !== undefined) {
    result.roleTitle = optionalString(
      data.roleTitle,
      "roleTitle",
      { maxLength: 100 }
    );
  }

  if (data.status !== undefined) {
    result.status = requireString(
      data.status,
      "status",
      { maxLength: 50 }
    );
  }

  if (data.qualification !== undefined) {
    result.qualification = optionalString(
      data.qualification,
      "qualification",
      { maxLength: 200 }
    );
  }

  if (data.specialization !== undefined) {
    result.specialization = optionalString(
      data.specialization,
      "specialization",
      { maxLength: 200 }
    );
  }

  if (data.notes !== undefined) {
    result.notes = optionalString(
      data.notes,
      "notes",
      { maxLength: 2000 }
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

  // Server-stamped only (see the PATCH /api/admin/teachers/:uid
  // handler) — never taken verbatim from an arbitrary client
  // payload, but still needs to pass through validation here.
  if (data.directPublishUpdatedAt !== undefined) {
    result.directPublishUpdatedAt = optionalString(
      data.directPublishUpdatedAt,
      "directPublishUpdatedAt",
      { maxLength: 40 }
    );
  }

  if (data.directPublishUpdatedBy !== undefined) {
    result.directPublishUpdatedBy = optionalString(
      data.directPublishUpdatedBy,
      "directPublishUpdatedBy",
      { maxLength: 200 }
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
