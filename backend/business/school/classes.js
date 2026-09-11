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
  requireArray,
} from "../../security/validation.js";

export async function getClassDetails(
  env,
  classId
) {
  return getDocument(
    env,
    "classes",
    classId
  );
}

export async function getOrderedClasses(
  env
) {
  const hierarchy =
    await getDocument(
      env,
      "settings",
      "classHierarchy"
    );

  const classes =
    await runQuery(
      env,
      "classes",
      {
        orderBy: [
          {
            field: {
              fieldPath: "name",
            },
            direction: "ASCENDING",
          },
        ],
      }
    );

  const byId =
    new Map(
      classes.map(item => [
        item.id,
        item,
      ])
    );

  const ordered = [];

  for (
    const id of
    hierarchy?.orderedClassIds || []
  ) {
    if (byId.has(id)) {
      ordered.push(
        byId.get(id)
      );
      byId.delete(id);
    }
  }

  /*
   * Preserve classes that have not yet
   * been inserted into the hierarchy.
   */
  const remaining =
    [...byId.values()].sort(
      (a, b) =>
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
  classId
) {
  const hierarchy =
    await getDocument(
      env,
      "settings",
      "classHierarchy"
    );

  const ids =
    hierarchy?.orderedClassIds || [];

  const index =
    ids.indexOf(classId);

  if (
    index === -1 ||
    index >= ids.length - 1
  ) {
    return null;
  }

  const nextId =
    ids[index + 1];

  return getDocument(
    env,
    "classes",
    nextId
  );
}

export function validateClassPayload(
  payload,
  {
    partial = false,
  } = {}
) {
  const data = requireObject(
    payload,
    "Class data"
  );

  const result = {};

  if (!partial || data.name !== undefined) {
    result.name = requireString(
      data.name,
      "name",
      { maxLength: 200 }
    );
  }

  if (data.teacherId !== undefined) {
    result.teacherId =
      data.teacherId === null
        ? null
        : requireString(
            data.teacherId,
            "teacherId",
            { maxLength: 128 }
          );
  }

  if (data.subjects !== undefined) {
    const subjects =
      requireArray(
        data.subjects,
        "subjects"
      );

    result.subjects =
      subjects.map(
        (subject, index) => {
          if (
            typeof subject ===
            "string"
          ) {
            return subject.trim();
          }

          if (
            subject &&
            typeof subject ===
              "object"
          ) {
            return {
              ...subject,
            };
          }

          throw new ValidationError(
            `subjects[${index}] is invalid.`
          );
        }
      );
  }

  return result;
}

export function validateClassHierarchy(
  payload
) {
  const data = requireObject(
    payload,
    "Class hierarchy"
  );

  const ids =
    requireArray(
      data.orderedClassIds,
      "orderedClassIds"
    );

  const cleaned =
    ids.map(
      (id, index) =>
        requireString(
          id,
          `orderedClassIds[${index}]`,
          { maxLength: 100 }
        )
    );

  if (
    new Set(cleaned).size !==
    cleaned.length
  ) {
    throw new ValidationError(
      "Class hierarchy contains duplicate class IDs."
    );
  }

  return {
    orderedClassIds: cleaned,
  };
}

export async function createClass(
  env,
  classId,
  payload
) {
  if (!classId) {
    throw new ValidationError(
      "Class ID is required."
    );
  }

  const existing =
    await getDocument(
      env,
      "classes",
      classId
    );

  if (existing) {
    throw new ValidationError(
      "A class with this ID already exists."
    );
  }

  const data =
    validateClassPayload(payload);

  await setDocument(
    env,
    "classes",
    classId,
    data
  );

  return {
    id: classId,
    ...data,
  };
}

export async function updateClass(
  env,
  classId,
  payload
) {
  const existing =
    await getDocument(
      env,
      "classes",
      classId
    );

  if (!existing) {
    return null;
  }

  const changes =
    validateClassPayload(
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
    "classes",
    classId,
    changes
  );

  return {
    id: classId,
    ...existing,
    ...changes,
  };
}

export async function deleteClass(
  env,
  classId
) {
  const existing =
    await getDocument(
      env,
      "classes",
      classId
    );

  if (!existing) {
    return null;
  }

  await deleteDocument(
    env,
    "classes",
    classId
  );

  return {
    id: classId,
    ...existing,
  };
}
