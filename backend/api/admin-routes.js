import {
  requireAdmin,
} from "../auth/authorize.js";

import {
  ValidationError,
} from "../security/validation.js";

import {
  getDocument,
  updateDocument,
} from "../firebase/firestore.js";

import {
  getClassDetails,
  getNextClass,
  getOrderedClasses,
  validateClassPayload,
  validateClassHierarchy,
  createClass,
  updateClass,
  deleteClass,
} from "../business/school/classes.js";

import {
  getPupilDetails,
  validatePupilPayload,
  createPupil,
  updatePupil,
  deletePupil,
} from "../business/school/pupils.js";

import {
  getTeacherDetails,
  validateTeacherPayload,
  createTeacher,
  updateTeacher,
  deleteTeacher,
} from "../business/school/teachers.js";

import {
  writeAuditLog,
} from "../security/audit.js";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError(
      "Request body must contain valid JSON."
    );
  }
}

function response(
  body,
  status = 200
) {
  return {
    body,
    status,
  };
}

export async function handleAdminRoute(
  request,
  env,
  path
) {
  if (
    !path.startsWith("/api/admin/")
  ) {
    return null;
  }

  const admin =
    await requireAdmin(
      request,
      env
    );

  const method =
    request.method.toUpperCase();

  /*
   * ----------------------------
   * CLASSES
   * ----------------------------
   */

  if (
    method === "GET" &&
    path === "/api/admin/classes"
  ) {
    return response({
      ok: true,
      classes:
        await getOrderedClasses(env),
    });
  }

  const classMatch =
    path.match(
      /^\/api\/admin\/classes\/([^/]+)$/
    );

  if (
    classMatch &&
    method === "GET"
  ) {
    const classId =
      decodeURIComponent(
        classMatch[1]
      );

    const data =
      await getClassDetails(
        env,
        classId
      );

    if (!data) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Class not found.",
          },
        },
        404
      );
    }

    return response({
      ok: true,
      class: {
        id: classId,
        ...data,
      },
    });
  }

  if (
    classMatch &&
    method === "POST"
  ) {
    const classId =
      decodeURIComponent(
        classMatch[1]
      );

    const payload =
      await readJson(request);

    const created =
      await createClass(
        env,
        classId,
        payload
      );

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "create_item",
        collection: "classes",
        documentId: classId,
        changes: created,
        request,
      }
    );

    return response(
      {
        ok: true,
        class: created,
      },
      201
    );
  }

  if (
    classMatch &&
    method === "PATCH"
  ) {
    const classId =
      decodeURIComponent(
        classMatch[1]
      );

    const payload =
      await readJson(request);

    const updated =
      await updateClass(
        env,
        classId,
        payload
      );

    if (!updated) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Class not found.",
          },
        },
        404
      );
    }

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "update_item",
        collection: "classes",
        documentId: classId,
        changes: payload,
        request,
      }
    );

    return response({
      ok: true,
      class: updated,
    });
  }

  if (
    classMatch &&
    method === "DELETE"
  ) {
    const classId =
      decodeURIComponent(
        classMatch[1]
      );

    const deleted =
      await deleteClass(
        env,
        classId
      );

    if (!deleted) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Class not found.",
          },
        },
        404
      );
    }

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "delete_item",
        collection: "classes",
        documentId: classId,
        deletedData: deleted,
        request,
      }
    );

    return response({
      ok: true,
      deleted: true,
    });
  }

  /*
   * NEXT CLASS
   */

  const nextClassMatch =
    path.match(
      /^\/api\/admin\/classes\/([^/]+)\/next$/
    );

  if (
    nextClassMatch &&
    method === "GET"
  ) {
    const classId =
      decodeURIComponent(
        nextClassMatch[1]
      );

    return response({
      ok: true,
      nextClass:
        await getNextClass(
          env,
          classId
        ),
    });
  }

  /*
   * ASSIGN TEACHER
   */

  const assignTeacherMatch =
    path.match(
      /^\/api\/admin\/classes\/([^/]+)\/assign-teacher$/
    );

  if (
    assignTeacherMatch &&
    method === "POST"
  ) {
    const classId =
      decodeURIComponent(
        assignTeacherMatch[1]
      );

    const payload =
      await readJson(request);

    const teacherId =
      payload?.teacherId;

    if (
      teacherId !== null &&
      typeof teacherId !==
        "string"
    ) {
      throw new ValidationError(
        "teacherId must be a string or null."
      );
    }

    const classData =
      await getDocument(
        env,
        "classes",
        classId
      );

    if (!classData) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Class not found.",
          },
        },
        404
      );
    }

    if (teacherId) {
      const teacher =
        await getDocument(
          env,
          "teachers",
          teacherId
        );

      if (!teacher) {
        return response(
          {
            ok: false,
            error: {
              code: "NOT_FOUND",
              message:
                "Teacher not found.",
            },
          },
          404
        );
      }
    }

    await updateDocument(
      env,
      "classes",
      classId,
      {
        teacherId:
          teacherId || null,
      }
    );

    /*
     * Keep the pupil class representation
     * synchronized with the class name.
     *
     * We deliberately do not modify every
     * pupil's unrelated fields.
     */
    const updatedClass = {
      ...classData,
      teacherId:
        teacherId || null,
    };

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "assign_teacher",
        collection: "classes",
        documentId: classId,
        changes: {
          teacherId:
            teacherId || null,
        },
        request,
      }
    );

    return response({
      ok: true,
      class: {
        id: classId,
        ...updatedClass,
      },
    });
  }

  /*
   * SUBJECTS
   */

  const subjectsMatch =
    path.match(
      /^\/api\/admin\/classes\/([^/]+)\/subjects$/
    );

  if (
    subjectsMatch &&
    method === "POST"
  ) {
    const classId =
      decodeURIComponent(
        subjectsMatch[1]
      );

    const payload =
      await readJson(request);

    const subjects =
      payload?.subjects;

    if (!Array.isArray(subjects)) {
      throw new ValidationError(
        "subjects must be an array."
      );
    }

    const cleaned =
      subjects.map(
        subject => {
          if (
            typeof subject ===
            "string"
          ) {
            const value =
              subject.trim();

            if (!value) {
              throw new ValidationError(
                "Subjects cannot contain empty values."
              );
            }

            return value;
          }

          if (
            subject &&
            typeof subject ===
              "object"
          ) {
            return subject;
          }

          throw new ValidationError(
            "Invalid subject."
          );
        }
      );

    const existing =
      await getDocument(
        env,
        "classes",
        classId
      );

    if (!existing) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Class not found.",
          },
        },
        404
      );
    }

    await updateDocument(
      env,
      "classes",
      classId,
      {
        subjects: cleaned,
      }
    );

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "update_subjects",
        collection: "classes",
        documentId: classId,
        changes: {
          subjects: cleaned,
        },
        request,
      }
    );

    return response({
      ok: true,
      subjects: cleaned,
    });
  }

  /*
   * CLASS HIERARCHY
   */

  if (
    path ===
      "/api/admin/class-hierarchy" &&
    method === "PUT"
  ) {
    const payload =
      await readJson(request);

    const hierarchy =
      validateClassHierarchy(
        payload
      );

    const existing =
      await getDocument(
        env,
        "settings",
        "classHierarchy"
      );

    const record = {
      ...(existing || {}),
      orderedClassIds:
        hierarchy.orderedClassIds,
      lastUpdated:
        new Date().toISOString(),
      updatedBy:
        admin.uid,
      version:
        Number(
          existing?.version || 0
        ) + 1,
    };

    await updateDocument(
      env,
      "settings",
      "classHierarchy",
      record
    );

    await writeAuditLog(
      env,
      {
        user: admin,
        action:
          "update_class_hierarchy",
        collection: "settings",
        documentId:
          "classHierarchy",
        changes: record,
        request,
      }
    );

    return response({
      ok: true,
      hierarchy: record,
    });
  }

  /*
   * PUPILS
   */

  const pupilMatch =
    path.match(
      /^\/api\/admin\/pupils\/([^/]+)$/
    );

  if (
    pupilMatch &&
    method === "GET"
  ) {
    const pupilId =
      decodeURIComponent(
        pupilMatch[1]
      );

    const pupil =
      await getPupilDetails(
        env,
        pupilId
      );

    if (!pupil) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Pupil not found.",
          },
        },
        404
      );
    }

    return response({
      ok: true,
      pupil: {
        id: pupilId,
        ...pupil,
      },
    });
  }

  if (
    pupilMatch &&
    method === "PATCH"
  ) {
    const pupilId =
      decodeURIComponent(
        pupilMatch[1]
      );

    const payload =
      await readJson(request);

    const updated =
      await updatePupil(
        env,
        pupilId,
        payload
      );

    if (!updated) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Pupil not found.",
          },
        },
        404
      );
    }

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "update_item",
        collection: "pupils",
        documentId: pupilId,
        changes: payload,
        request,
      }
    );

    return response({
      ok: true,
      pupil: updated,
    });
  }

  if (
    pupilMatch &&
    method === "DELETE"
  ) {
    const pupilId =
      decodeURIComponent(
        pupilMatch[1]
      );

    const deleted =
      await deletePupil(
        env,
        pupilId
      );

    if (!deleted) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Pupil not found.",
          },
        },
        404
      );
    }

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "delete_item",
        collection: "pupils",
        documentId: pupilId,
        deletedData: deleted,
        request,
      }
    );

    return response({
      ok: true,
      deleted: true,
    });
  }

  /*
   * CREATE PUPIL
   *
   * The document ID is supplied explicitly.
   * Firebase Auth provisioning is separate.
   */

  if (
    path === "/api/admin/pupils" &&
    method === "POST"
  ) {
    const payload =
      await readJson(request);

    const pupilId =
      payload?.id ||
      payload?.pupilId;

    if (
      typeof pupilId !==
      "string" ||
      !pupilId.trim()
    ) {
      throw new ValidationError(
        "A pupil ID is required."
      );
    }

    const {
      id,
      pupilId: ignoredPupilId,
      ...pupilPayload
    } = payload;

    const created =
      await createPupil(
        env,
        pupilId.trim(),
        pupilPayload
      );

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "create_user",
        collection: "pupils",
        documentId:
          pupilId.trim(),
        changes: created,
        request,
      }
    );

    return response(
      {
        ok: true,
        pupil: created,
      },
      201
    );
  }

  /*
   * TEACHERS
   */

  const teacherMatch =
    path.match(
      /^\/api\/admin\/teachers\/([^/]+)$/
    );

  if (
    teacherMatch &&
    method === "GET"
  ) {
    const uid =
      decodeURIComponent(
        teacherMatch[1]
      );

    const teacher =
      await getTeacherDetails(
        env,
        uid
      );

    if (!teacher) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Teacher not found.",
          },
        },
        404
      );
    }

    return response({
      ok: true,
      teacher: {
        uid,
        ...teacher,
      },
    });
  }

  if (
    teacherMatch &&
    method === "PATCH"
  ) {
    const uid =
      decodeURIComponent(
        teacherMatch[1]
      );

    const payload =
      await readJson(request);

    const updated =
      await updateTeacher(
        env,
        uid,
        payload
      );

    if (!updated) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Teacher not found.",
          },
        },
        404
      );
    }

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "update_item",
        collection: "teachers",
        documentId: uid,
        changes: payload,
        request,
      }
    );

    return response({
      ok: true,
      teacher: updated,
    });
  }

  if (
    teacherMatch &&
    method === "DELETE"
  ) {
    const uid =
      decodeURIComponent(
        teacherMatch[1]
      );

    const deleted =
      await deleteTeacher(
        env,
        uid
      );

    if (!deleted) {
      return response(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message:
              "Teacher not found.",
          },
        },
        404
      );
    }

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "delete_item",
        collection: "teachers",
        documentId: uid,
        deletedData: deleted,
        request,
      }
    );

    return response({
      ok: true,
      deleted: true,
    });
  }

  /*
   * CREATE TEACHER PROFILE
   */

  if (
    path === "/api/admin/teachers" &&
    method === "POST"
  ) {
    const payload =
      await readJson(request);

    const uid =
      payload?.uid;

    if (
      typeof uid !== "string" ||
      !uid.trim()
    ) {
      throw new ValidationError(
        "Teacher Firebase UID is required."
      );
    }

    const {
      uid: ignoredUid,
      ...teacherPayload
    } = payload;

    const created =
      await createTeacher(
        env,
        uid.trim(),
        teacherPayload
      );

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "create_user",
        collection: "teachers",
        documentId: uid.trim(),
        changes: created,
        request,
      }
    );

    return response(
      {
        ok: true,
        teacher: created,
      },
      201
    );
  }

  /*
   * SETTINGS
   */

  if (
    path === "/api/admin/settings" &&
    method === "GET"
  ) {
    const settings =
      await getDocument(
        env,
        "settings",
        "current"
      );

    return response({
      ok: true,
      settings:
        settings || null,
    });
  }

  if (
    path === "/api/admin/settings" &&
    method === "PUT"
  ) {
    const payload =
      await readJson(request);

    if (
      !payload ||
      typeof payload !==
        "object" ||
      Array.isArray(payload)
    ) {
      throw new ValidationError(
        "Settings must be an object."
      );
    }

    const existing =
      await getDocument(
        env,
        "settings",
        "current"
      );

    /*
     * Do not allow the client to control
     * audit metadata.
     */
    const {
      updatedBy,
      updatedAt,
      ...changes
    } = payload;

    const updated = {
      ...(existing || {}),
      ...changes,
      updatedBy:
        admin.uid,
      updatedAt:
        new Date().toISOString(),
    };

    await updateDocument(
      env,
      "settings",
      "current",
      updated
    );

    await writeAuditLog(
      env,
      {
        user: admin,
        action: "update_settings",
        collection: "settings",
        documentId: "current",
        changes,
        request,
      }
    );

    return response({
      ok: true,
      settings: updated,
    });
  }

  /*
   * AUDIT LOG
   *
   * The initial implementation intentionally
   * supports a bounded recent-history query
   * through Firestore's existing query helper
   * once its pagination support is wired.
   */

  if (
    path === "/api/admin/audit" &&
    method === "GET"
  ) {
    const logs =
      await getDocument(
        env,
        "audit_log",
        "index"
      );

    return response({
      ok: true,
      note:
        "Audit records are stored individually in audit_log. A paginated query endpoint will be added with the reporting layer.",
      index: logs || null,
    });
  }

  /*
   * VALIDATION ENDPOINTS
   */

  if (
    path ===
      "/api/admin/pupils/validate" &&
    method === "POST"
  ) {
    const payload =
      await readJson(request);

    return response({
      ok: true,
      data:
        validatePupilPayload(
          payload
        ),
    });
  }

  if (
    path ===
      "/api/admin/teachers/validate" &&
    method === "POST"
  ) {
    const payload =
      await readJson(request);

    return response({
      ok: true,
      data:
        validateTeacherPayload(
          payload
        ),
    });
  }

  if (
    path ===
      "/api/admin/classes/validate" &&
    method === "POST"
  ) {
    const payload =
      await readJson(request);

    return response({
      ok: true,
      data:
        validateClassPayload(
          payload
        ),
    });
  }

  if (
    path ===
      "/api/admin/class-hierarchy/validate" &&
    method === "POST"
  ) {
    const payload =
      await readJson(request);

    return response({
      ok: true,
      data:
        validateClassHierarchy(
          payload
        ),
    });
  }

  return response(
    {
      ok: false,
      error: {
        code:
          "ENDPOINT_NOT_FOUND",
        message:
          "Admin endpoint not found.",
      },
    },
    404
  );
}
