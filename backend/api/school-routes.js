import {
  requireStaff,
} from "../auth/authorize.js";

import {
  getCurrentSettings,
  getClassHierarchy,
  getAllClasses,
  getClassById,
  getPupilById,
  getTeacherByUid,
} from "./school.js";

export async function handleSchoolRoute(
  request,
  env,
  path
) {
  const user =
    await requireStaff(
      request,
      env
    );

  if (
    request.method === "GET" &&
    path === "/api/school/settings"
  ) {
    const settings =
      await getCurrentSettings(env);

    return {
      status: 200,

      body: {
        ok: true,
        settings,
      },
    };
  }

  if (
    request.method === "GET" &&
    path === "/api/school/class-hierarchy"
  ) {
    const hierarchy =
      await getClassHierarchy(env);

    return {
      status: 200,

      body: {
        ok: true,
        hierarchy,
      },
    };
  }

  if (
    request.method === "GET" &&
    path === "/api/school/classes"
  ) {
    const classes =
      await getAllClasses(env);

    return {
      status: 200,

      body: {
        ok: true,
        classes,
      },
    };
  }

  const classMatch =
    path.match(
      /^\/api\/school\/classes\/([^/]+)$/
    );

  if (
    request.method === "GET" &&
    classMatch
  ) {
    const classId =
      decodeURIComponent(
        classMatch[1]
      );

    const schoolClass =
      await getClassById(
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
        class: {
          id: classId,
          ...schoolClass,
        },
      },
    };
  }

  const pupilMatch =
    path.match(
      /^\/api\/school\/pupils\/([^/]+)$/
    );

  if (
    request.method === "GET" &&
    pupilMatch
  ) {
    const pupilId =
      decodeURIComponent(
        pupilMatch[1]
      );

    const pupil =
      await getPupilById(
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

        pupil: {
          id: pupilId,
          ...pupil,
        },
      },
    };
  }

  const teacherMatch =
    path.match(
      /^\/api\/school\/teachers\/([^/]+)$/
    );

  if (
    request.method === "GET" &&
    teacherMatch
  ) {
    const uid =
      decodeURIComponent(
        teacherMatch[1]
      );

    const teacher =
      await getTeacherByUid(
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

        teacher: {
          uid,
          ...teacher,
        },
      },
    };
  }

  return null;
}
