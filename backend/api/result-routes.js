/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Results API Routes
 */

import {
  requireTeacher,
  requireAdmin,
} from "../auth/authorize.js";

import {
  getDraft,
  listDrafts,
  saveDraft,
  deleteDraft,
} from "../business/results/drafts.js";

import {
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

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error(
      "Request body must contain valid JSON.",
    );

    error.status = 400;
    error.code = "INVALID_JSON";

    throw error;
  }
}

function result(status, body) {
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

export async function handleResultRoute(
  request,
  env,
  path,
) {
  const method =
    request.method.toUpperCase();

  /*
   * -------------------------------------------------------------------------
   * Teacher drafts
   * -------------------------------------------------------------------------
   */

  if (
    path ===
    "/api/teacher/results/drafts"
  ) {
    if (method === "GET") {
      const user =
        await requireTeacher(
          request,
          env,
        );

      const url =
        new URL(request.url);

      const classId =
        requireId(
          url.searchParams.get(
            "classId",
          ),
          "classId",
        );

      const session =
        requireString(
          url.searchParams.get(
            "session",
          ),
          "session",
          { maxLength: 50 },
        );

      const term =
        requireString(
          url.searchParams.get(
            "term",
          ),
          "term",
          { maxLength: 100 },
        );

      const subject =
        requireString(
          url.searchParams.get(
            "subject",
          ),
          "subject",
          { maxLength: 200 },
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
          },
        );

      return result(200, {
        drafts,
      });
    }

    if (method === "POST") {
      const body =
        await readJson(request);

      if (
        Array.isArray(
          body?.results,
        )
      ) {
        const saved = [];

        for (
          const draft of
          body.results
        ) {
          saved.push(
            await saveDraft(
              request,
              env,
              draft,
            ),
          );
        }

        return result(200, {
          drafts: saved,
        });
      }

      const saved =
        await saveDraft(
          request,
          env,
          body,
        );

      return result(200, {
        draft: saved,
      });
    }

    return null;
  }

  /*
   * -------------------------------------------------------------------------
   * Teacher single draft
   * -------------------------------------------------------------------------
   */

  const teacherDraftMatch =
    path.match(
      /^\/api\/teacher\/results\/drafts\/([^/]+)\/([^/]+)\/([^/]+)$/,
    );

  if (teacherDraftMatch) {
    if (method === "GET") {
      await requireTeacher(
        request,
        env,
      );

      const draft =
        await getDraft(
          env,
          {
            pupilId:
              decodeURIComponent(
                teacherDraftMatch[1],
              ),
            term:
              decodeURIComponent(
                teacherDraftMatch[2],
              ),
            subject:
              decodeURIComponent(
                teacherDraftMatch[3],
              ),
          },
        );

      if (!draft) {
        return result(404, {
          error: {
            code:
              "DRAFT_NOT_FOUND",
            message:
              "Result draft not found.",
          },
        });
      }

      return result(200, {
        draft,
      });
    }

    if (method === "DELETE") {
      const deleted =
        await deleteDraft(
          request,
          env,
          {
            pupilId:
              decodeURIComponent(
                teacherDraftMatch[1],
              ),
            term:
              decodeURIComponent(
                teacherDraftMatch[2],
              ),
            subject:
              decodeURIComponent(
                teacherDraftMatch[3],
              ),
          },
        );

      return result(200, {
        deleted,
      });
    }

    return null;
  }

  /*
   * -------------------------------------------------------------------------
   * Teacher submissions
   * -------------------------------------------------------------------------
   */

  if (
    path ===
    "/api/teacher/results/submissions"
  ) {
    if (method === "GET") {
      const user =
        await requireTeacher(
          request,
          env,
        );

      const submissions =
        await listSubmissions(
          env,
          {
            teacherUid:
              user.uid,
          },
        );

      return result(200, {
        submissions,
      });
    }

    if (method === "POST") {
      const body =
        await readJson(request);

      const submission =
        await submitResults(
          request,
          env,
          {
            classId:
              requireId(
                body.classId,
                "classId",
              ),

            session:
              requireString(
                body.session,
                "session",
                { maxLength: 50 },
              ),

            term:
              requireString(
                body.term,
                "term",
                { maxLength: 100 },
              ),

            subject:
              requireString(
                body.subject,
                "subject",
                { maxLength: 200 },
              ),
          },
        );

      return result(200, {
        submission,
      });
    }

    return null;
  }

  const teacherSubmissionMatch =
    path.match(
      /^\/api\/teacher\/results\/submissions\/([^/]+)$/,
    );

  if (
    teacherSubmissionMatch &&
    method === "GET"
  ) {
    const user =
      await requireTeacher(
        request,
        env,
      );

    const submission =
      await getSubmissionById(
        env,
        decodeURIComponent(
          teacherSubmissionMatch[1],
        ),
      );

    if (!submission) {
      return result(404, {
        error: {
          code:
            "SUBMISSION_NOT_FOUND",
          message:
            "Result submission not found.",
        },
      });
    }

    if (
      submission.teacherUid !==
        user.uid &&
      submission.teacherId !==
        user.uid
    ) {
      const error = new Error(
        "You do not have access to this result submission.",
      );

      error.status = 403;
      error.code =
        "SUBMISSION_ACCESS_DENIED";

      throw error;
    }

    return result(200, {
      submission,
    });
  }

  /*
   * -------------------------------------------------------------------------
   * Admin submissions
   * -------------------------------------------------------------------------
   */

  if (
    path ===
    "/api/admin/results/submissions"
  ) {
    if (method !== "GET") {
      return null;
    }

    await requireAdmin(
      request,
      env,
    );

    const url =
      new URL(request.url);

    const status =
      url.searchParams.get(
        "status",
      );

    const submissions =
      await listSubmissions(
        env,
        {
          status:
            status || null,
        },
      );

    return result(200, {
      submissions,
    });
  }

  const adminSubmissionMatch =
    path.match(
      /^\/api\/admin\/results\/submissions\/([^/]+)$/,
    );

  if (
    adminSubmissionMatch &&
    method === "GET"
  ) {
    await requireAdmin(
      request,
      env,
    );

    const submission =
      await getSubmissionById(
        env,
        decodeURIComponent(
          adminSubmissionMatch[1],
        ),
      );

    if (!submission) {
      return result(404, {
        error: {
          code:
            "SUBMISSION_NOT_FOUND",
          message:
            "Result submission not found.",
        },
      });
    }

    return result(200, {
      submission,
    });
  }

  /*
   * -------------------------------------------------------------------------
   * Admin approval
   * -------------------------------------------------------------------------
   */

  const approveMatch =
    path.match(
      /^\/api\/admin\/results\/submissions\/([^/]+)\/approve$/,
    );

  if (
    approveMatch &&
    method === "POST"
  ) {
    const approval =
      await approveSubmission(
        request,
        env,
        decodeURIComponent(
          approveMatch[1],
        ),
      );

    return result(200, {
      message:
        "Result submission approved and published.",

      ...approval,
    });
  }

  /*
   * -------------------------------------------------------------------------
   * Admin rejection
   * -------------------------------------------------------------------------
   */

  const rejectMatch =
    path.match(
      /^\/api\/admin\/results\/submissions\/([^/]+)\/reject$/,
    );

  if (
    rejectMatch &&
    method === "POST"
  ) {
    const body =
      await readJson(request);

    const reason =
      requireString(
        body.reason,
        "reason",
        {
          minLength: 3,
          maxLength: 1000,
        },
      );

    const submission =
      await rejectSubmission(
        request,
        env,
        decodeURIComponent(
          rejectMatch[1],
        ),
        reason,
      );

    return result(200, {
      submission,
    });
  }

  return null;
}
