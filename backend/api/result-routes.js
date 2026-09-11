/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Results API Routes
 */

import {
  requireTeacher,
  requireAdmin,
} from "../auth/authorize.js";

import {
  getDocument,
} from "../firebase/firestore.js";

import {
  getDraft,
  listDrafts,
  saveDraft,
  deleteDraft,
} from "../business/results/drafts.js";

import {
  getSubmission,
  getSubmissionById,
  listSubmissions,
  submitResults,
  rejectSubmission,
} from "../business/results/submissions.js";

import {
  approveSubmission,
} from "../business/results/approval.js";

import {
  requireString,
  requireId,
} from "../security/validation.js";

async function readJson(
  request
) {
  try {
    return await request.json();
  } catch {
    const error =
      new Error(
        "Request body must contain valid JSON."
      );

    error.status = 400;
    error.code =
      "INVALID_JSON";

    throw error;
  }
}

function result(
  status,
  body
) {
  return {
    status,
    body: {
      ok:
        status >= 200 &&
        status < 300,

      ...body,
    },
  };
}

/**
 * Teacher routes:
 *
 * GET
 * /api/teacher/results/drafts
 *
 * POST
 * /api/teacher/results/drafts
 *
 * GET
 * /api/teacher/results/drafts/:pupilId/:term/:subject
 *
 * DELETE
 * /api/teacher/results/drafts/:pupilId/:term/:subject
 *
 * POST
 * /api/teacher/results/submissions
 *
 * GET
 * /api/teacher/results/submissions/:id
 *
 * Admin routes:
 *
 * GET
 * /api/admin/results/submissions
 *
 * GET
 * /api/admin/results/submissions/:id
 *
 * POST
 * /api/admin/results/submissions/:id/approve
 *
 * POST
 * /api/admin/results/submissions/:id/reject
 */
export async function handleResultRoute(
  request,
  env,
  path
) {
  const method =
    request.method.toUpperCase();

  /*
   * ---------------------------------------------------------
   * TEACHER DRAFTS
   * ---------------------------------------------------------
   */

  if (
    path ===
      "/api/teacher/results/drafts"
  ) {
    if (
      method === "GET"
    ) {
      const user =
        await requireTeacher(
          request,
          env
        );

      const url =
        new URL(
          request.url
        );

      const classId =
        requireId(
          url.searchParams.get(
            "classId"
          ),
          "classId"
        );

      const session =
        requireString(
          url.searchParams.get(
            "session"
          ),
          "session",
          {
            maxLength: 50,
          }
        );

      const term =
        requireString(
          url.searchParams.get(
            "term"
          ),
          "term",
          {
            maxLength: 100,
          }
        );

      const subject =
        requireString(
          url.searchParams.get(
            "subject"
          ),
          "subject",
          {
            maxLength: 200,
          }
        );

      const drafts =
        await listDrafts(
          env,
          {
            classId,
            session,
            term,
            subject,
            teacherUid:
              user.uid,
          }
        );

      return result(
        200,
        {
          drafts,
        }
      );
    }

    if (
      method === "POST"
    ) {
      const body =
        await readJson(
          request
        );

      /*
       * Bulk save support.
       *
       * {
       *   "results": [...]
       * }
       *
       * A single draft object is also accepted.
       */
      if (
        Array.isArray(
          body?.results
        )
      ) {
        const saved =
          [];

        for (
          const draft of
            body.results
        ) {
          saved.push(
            await saveDraft(
              request,
              env,
              draft
            )
          );
        }

        return result(
          200,
          {
            drafts:
              saved,
          }
        );
      }

      const saved =
        await saveDraft(
          request,
          env,
          body
        );

      return result(
        200,
        {
          draft:
            saved,
        }
      );
    }
  }

  const teacherDraftMatch =
    path.match(
      /^\/api\/teacher\/results\/drafts\/([^/]+)\/([^/]+)\/([^/]+)$/
    );

  if (
    teacherDraftMatch
  ) {
    if (
      method === "GET"
    ) {
      await requireTeacher(
        request,
        env
      );

      const pupilId =
        decodeURIComponent(
          teacherDraftMatch[1]
        );

      const term =
        decodeURIComponent(
          teacherDraftMatch[2]
        );

      const subject =
        decodeURIComponent(
          teacherDraftMatch[3]
        );

      const draft =
        await getDraft(
          env,
          {
            pupilId,
            term,
            subject,
          }
        );

      if (!draft) {
        return result(
          404,
          {
            error: {
              code:
                "DRAFT_NOT_FOUND",

              message:
                "Result draft not found.",
            },
          }
        );
      }

      return result(
        200,
        {
          draft,
        }
      );
    }

    if (
      method === "DELETE"
    ) {
      const pupilId =
        decodeURIComponent(
          teacherDraftMatch[1]
        );

      const term =
        decodeURIComponent(
          teacherDraftMatch[2]
        );

      const subject =
        decodeURIComponent(
          teacherDraftMatch[3]
        );

      const deleted =
        await deleteDraft(
          request,
          env,
          {
            pupilId,
            term,
            subject,
          }
        );

      return result(
        200,
        {
          deleted,
        }
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * TEACHER SUBMISSIONS
   * ---------------------------------------------------------
   */

  if (
    path ===
      "/api/teacher/results/submissions"
  ) {
    if (
      method === "GET"
    ) {
      const user =
        await requireTeacher(
          request,
          env
        );

      const submissions =
        await listSubmissions(
          env,
          {
            teacherUid:
              user.uid,
          }
        );

      return result(
        200,
        {
          submissions,
        }
      );
    }

    if (
      method === "POST"
    ) {
      const body =
        await readJson(
          request
        );

      const classId =
        requireId(
          body.classId,
          "classId"
        );

      const session =
        requireString(
          body.session,
          "session",
          {
            maxLength: 50,
          }
        );

      const term =
        requireString(
          body.term,
          "term",
          {
            maxLength: 100,
          }
        );

      const subject =
        requireString(
          body.subject,
          "subject",
          {
            maxLength: 200,
          }
        );

      const submission =
        await submitResults(
          request,
          env,
          {
            classId,
            session,
            term,
            subject,
          }
        );

      return result(
        200,
        {
          submission,
        }
      );
    }
  }

  const teacherSubmissionMatch =
    path.match(
      /^\/api\/teacher\/results\/submissions\/([^/]+)$/
    );

  if (
    teacherSubmissionMatch &&
    method === "GET"
  ) {
    const user =
      await requireTeacher(
        request,
        env
      );

    const submissionId =
      decodeURIComponent(
        teacherSubmissionMatch[1]
      );

    const submission =
      await getSubmissionById(
        env,
        submissionId
      );

    if (!submission) {
      return result(
        404,
        {
          error: {
            code:
              "SUBMISSION_NOT_FOUND",

            message:
              "Result submission not found.",
          },
        }
      );
    }

    if (
      submission.teacherUid !==
        user.uid &&
      submission.teacherId !==
        user.uid
    ) {
      const error =
        new Error(
          "You do not have access to this result submission."
        );

      error.status = 403;
      error.code =
        "SUBMISSION_ACCESS_DENIED";

      throw error;
    }

    return result(
      200,
      {
        submission,
      }
    );
  }

  /*
   * ---------------------------------------------------------
   * ADMIN SUBMISSIONS
   * ---------------------------------------------------------
   */

  if (
    path ===
      "/api/admin/results/submissions"
  ) {
    if (
      method !== "GET"
    ) {
      return null;
    }

    await requireAdmin(
      request,
      env
    );

    const url =
      new URL(
        request.url
      );

    const status =
      url.searchParams.get(
        "status"
      );

    const submissions =
      await listSubmissions(
        env,
        {
          status:
            status ||
            null,
        }
      );

    return result(
      200,
      {
        submissions,
      }
    );
  }

  const adminSubmissionMatch =
    path.match(
      /^\/api\/admin\/results\/submissions\/([^/]+)$/
    );

  if (
    adminSubmissionMatch &&
    method === "GET"
  ) {
    await requireAdmin(
      request,
      env
    );

    const submissionId =
      decodeURIComponent(
        adminSubmissionMatch[1]
      );

    const submission =
      await getSubmissionById(
        env,
        submissionId
      );

    if (!submission) {
      return result(
        404,
        {
          error: {
            code:
              "SUBMISSION_NOT_FOUND",

            message:
              "Result submission not found.",
          },
        }
      );
    }

    return result(
      200,
      {
        submission,
      }
    );
  }

  const approveMatch =
    path.match(
      /^\/api\/admin\/results\/submissions\/([^/]+)\/approve$/
    );

  if (
    approveMatch &&
    method === "POST"
  ) {
    const submissionId =
      decodeURIComponent(
        approveMatch[1]
      );

    const approval =
      await approveSubmission(
        request,
        env,
        submissionId
      );

    return result(
      200,
      {
        message:
          approval.alreadyApproved
            ? "Result submission was already approved."
            : "Result submission approved and published.",

        ...approval,
      }
    );
  }

  const rejectMatch =
    path.match(
      /^\/api\/admin\/results\/submissions\/([^/]+)\/reject$/
    );

  if (
    rejectMatch &&
    method === "POST"
  ) {
    const body =
      await readJson(
        request
      );

    const reason =
      requireString(
        body.reason,
        "reason",
        {
          minLength: 3,
          maxLength: 1000,
        }
      );

    const submissionId =
      decodeURIComponent(
        rejectMatch[1]
      );

    const submission =
      await rejectSubmission(
        request,
        env,
        submissionId,
        reason
      );

    return result(
      200,
      {
        submission,
      }
    );
  }

  return null;
}
