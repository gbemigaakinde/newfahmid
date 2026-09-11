import {
  requireAdmin,
} from "../auth/authorize.js";

import {
  getOrderedClasses,
  getNextClass,
  getClassDetails,
  validateClassHierarchy,
  validateClassPayload,
} from "../business/school/classes.js";

import {
  getPupilDetails,
  validatePupilPayload,
} from "../business/school/pupils.js";

import {
  getTeacherDetails,
  validateTeacherPayload,
} from "../business/school/teachers.js";

import {
  ValidationError,
  requireId,
} from "../security/validation.js";

export async function handleAdminRoute(
  request,
  env,
  path
) {
  /*
   * Everything in this module is admin-only.
   */
  await requireAdmin(
    request,
    env
  );

  /*
   * ------------------------------------------------
   * GET /api/admin/classes
   * ------------------------------------------------
   */
  if (
    request.method === "GET" &&
    path === "/api/admin/classes"
  ) {
    const classes =
      await getOrderedClasses(env);

    return {
      status: 200,

      body: {
        ok: true,
        classes,
      },
    };
  }

  /*
   * ------------------------------------------------
   * GET /api/admin/classes/:id
   * ------------------------------------------------
   */
  let match =
    path.match(
      /^\/api\/admin\/classes\/([^/]+)$/
    );

  if (
    request.method === "GET" &&
    match
  ) {
    const classId =
      decodeURIComponent(
        match[1]
      );

    const schoolClass =
      await getClassDetails(
        env,
        classId
      );

    if (!schoolClass) {
      return {
        status: 404,

        body: {
          ok: false,

          error: {
            code: "CLASS_NOT_FOUND",
            message: "Class not found.",
          },
        },
      };
    }

    return {
      status: 200,

      body: {
        ok: true,
        class: schoolClass,
      },
    };
  }

  /*
   * ------------------------------------------------
   * GET /api/admin/classes/:id/next
   * ------------------------------------------------
   */
  match =
    path.match(
      /^\/api\/admin\/classes\/([^/]+)\/next$/
    );

  if (
    request.method === "GET" &&
    match
  ) {
    const classId =
      decodeURIComponent(
        match[1]
      );

    const nextClass =
      await getNextClass(
        env,
        classId
      );

    return {
      status: 200,

      body: {
        ok: true,

        nextClass:
          nextClass || null,
      },
    };
  }

  /*
   * ------------------------------------------------
   * POST /api/admin/classes/validate
   * ------------------------------------------------
   *
   * This currently validates class data only.
   *
   * Actual Firestore writes will be added after
   * we finish extracting the exact old admin schema.
   */
  if (
    request.method === "POST" &&
    path === "/api/admin/classes/validate"
  ) {
    const payload =
      await request.json();

    const validated =
      validateClassPayload(
        payload
      );

    return {
      status: 200,

      body: {
        ok: true,
        data: validated,
      },
    };
  }

  /*
   * ------------------------------------------------
   * POST /api/admin/class-hierarchy/validate
   * ------------------------------------------------
   */
  if (
    request.method === "POST" &&
    path ===
      "/api/admin/class-hierarchy/validate"
  ) {
    const payload =
      await request.json();

    const orderedClassIds =
      validateClassHierarchy(
        payload?.orderedClassIds
      );

    return {
      status: 200,

      body: {
        ok: true,
        orderedClassIds,
      },
    };
  }

  /*
   * ------------------------------------------------
   * GET /api/admin/pupils/:id
   * ------------------------------------------------
   */
  match =
    path.match(
      /^\/api\/admin\/pupils\/([^/]+)$/
    );

  if (
    request.method === "GET" &&
    match
  ) {
    const pupilId =
      decodeURIComponent(
        match[1]
      );

    const pupil =
      await getPupilDetails(
        env,
        pupilId
      );

    if (!pupil) {
      return {
        status: 404,

        body: {
          ok: false,

          error: {
            code: "PUPIL_NOT_FOUND",
            message: "Pupil not found.",
          },
        },
      };
    }

    return {
      status: 200,

      body: {
        ok: true,
        pupil,
      },
    };
  }

  /*
   * ------------------------------------------------
   * GET /api/admin/teachers/:uid
   * ------------------------------------------------
   */
  match =
    path.match(
      /^\/api\/admin\/teachers\/([^/]+)$/
    );

  if (
    request.method === "GET" &&
    match
  ) {
    const uid =
      decodeURIComponent(
        match[1]
      );

    const teacher =
      await getTeacherDetails(
        env,
        uid
      );

    if (!teacher) {
      return {
        status: 404,

        body: {
          ok: false,

          error: {
            code: "TEACHER_NOT_FOUND",
            message: "Teacher not found.",
          },
        },
      };
    }

    return {
      status: 200,

      body: {
        ok: true,
        teacher,
      },
    };
  }

  /*
   * ------------------------------------------------
   * POST /api/admin/pupils/validate
   * ------------------------------------------------
   */
  if (
    request.method === "POST" &&
    path ===
      "/api/admin/pupils/validate"
  ) {
    const payload =
      await request.json();

    const validated =
      validatePupilPayload(
        payload
      );

    return {
      status: 200,

      body: {
        ok: true,
        data: validated,
      },
    };
  }

  /*
   * ------------------------------------------------
   * POST /api/admin/teachers/validate
   * ------------------------------------------------
   */
  if (
    request.method === "POST" &&
    path ===
      "/api/admin/teachers/validate"
  ) {
    const payload =
      await request.json();

    const validated =
      validateTeacherPayload(
        payload
      );

    return {
      status: 200,

      body: {
        ok: true,
        data: validated,
      },
    };
  }

  return null;
}
