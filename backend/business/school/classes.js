import {
  getAllClasses,
  getClassById,
  getClassHierarchy,
} from "../../api/school.js";

import {
  ValidationError,
  requireArray,
  requireId,
  requireString,
  sanitizeStringArray,
} from "../../security/validation.js";

export async function getClassDetails(
  env,
  classId
) {
  requireId(classId, "classId");

  const schoolClass =
    await getClassById(
      env,
      classId
    );

  if (!schoolClass) {
    return null;
  }

  return {
    id: classId,
    ...schoolClass,
  };
}

export async function getOrderedClasses(
  env
) {
  const classes =
    await getAllClasses(env);

  const hierarchy =
    await getClassHierarchy(env);

  const orderedIds =
    Array.isArray(
      hierarchy.orderedClassIds
    )
      ? hierarchy.orderedClassIds
      : [];

  const classMap =
    new Map(
      classes.map(cls => [
        cls.id,
        {
          id: cls.id,
          ...cls,
        },
      ])
    );

  const ordered = [];

  for (const classId of orderedIds) {
    const schoolClass =
      classMap.get(classId);

    if (schoolClass) {
      ordered.push(schoolClass);
      classMap.delete(classId);
    }
  }

  /*
   * New classes not yet added to the
   * hierarchy are appended alphabetically.
   */
  const remaining =
    Array.from(
      classMap.values()
    ).sort((a, b) =>
      String(a.name || "")
        .localeCompare(
          String(b.name || "")
        )
    );

  return [
    ...ordered,
    ...remaining,
  ];
}

export async function getNextClass(
  env,
  currentClassId
) {
  requireId(
    currentClassId,
    "currentClassId"
  );

  const classes =
    await getOrderedClasses(env);

  const index =
    classes.findIndex(
      cls =>
        cls.id === currentClassId
    );

  if (index === -1) {
    throw new ValidationError(
      "Current class was not found in the class hierarchy."
    );
  }

  if (
    index === classes.length - 1
  ) {
    return null;
  }

  return classes[index + 1];
}

export function validateClassPayload(
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
      "Class data must be an object."
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
          maxLength: 150,
        }
      );
  }

  if (
    payload.teacherId !== undefined
  ) {
    result.teacherId =
      payload.teacherId === null ||
      payload.teacherId === ""
        ? null
        : requireId(
            payload.teacherId,
            "teacherId"
          );
  }

  if (
    payload.subjects !== undefined
  ) {
    result.subjects =
      sanitizeStringArray(
        payload.subjects,
        "subjects"
      );
  }

  return result;
}

export function validateClassHierarchy(
  orderedClassIds
) {
  const ids =
    sanitizeStringArray(
      orderedClassIds,
      "orderedClassIds",
      500
    );

  const unique =
    new Set(ids);

  if (
    unique.size !== ids.length
  ) {
    throw new ValidationError(
      "Class hierarchy contains duplicate class IDs."
    );
  }

  return ids;
}
