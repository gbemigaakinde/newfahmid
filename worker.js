/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Cloudflare Worker
 *
 * API entry point.
 *
 * Architecture:
 *
 * Browser
 *    ↓
 * Firebase Authentication
 *    ↓
 * Firebase ID Token
 *    ↓
 * Cloudflare Worker
 *    ↓
 * Authentication / Authorization
 *    ↓
 * Business Logic
 *    ↓
 * Firebase
 */

import {
  requireUser,
  AuthorizationError,
} from "./backend/auth/authorize.js";

import {
  AuthError,
} from "./backend/api/auth.js";

import {
  ValidationError,
} from "./backend/security/validation.js";

import {
  getGoogleAccessToken,
} from "./backend/firebase/google-access-token.js";

import {
  getCorsHeaders,
  handleCorsPreflight,
} from "./backend/security/cors.js";

import {
  handleSchoolRoute,
} from "./backend/api/school-routes.js";

import {
  handleAdminRoute,
} from "./backend/api/admin-routes.js";

function json(
  data,
  status = 200,
  headers = {}
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...headers,
      },
    }
  );
}

function withCors(
  response,
  request,
  env
) {
  const headers =
    new Headers(
      response.headers
    );

  const corsHeaders =
    getCorsHeaders(
      request,
      env
    );

  for (
    const [key, value]
    of Object.entries(corsHeaders)
  ) {
    headers.set(
      key,
      value
    );
  }

  return new Response(
    response.body,
    {
      status:
        response.status,
      headers,
    }
  );
}

function normalizePath(
  request
) {
  const url =
    new URL(request.url);

  const normalized =
    url.pathname
      .replace(
        /\/+/g,
        "/"
      )
      .replace(
        /\/$/,
        ""
      );

  return normalized || "/";
}

async function handleRequest(
  request,
  env
) {
  /*
   * Attach the Google access-token
   * provider to the environment.
   *
   * Firestore uses this without exposing
   * service-account credentials to the browser.
   */
  env.__getGoogleAccessToken =
    () =>
      getGoogleAccessToken(
        env
      );

  const path =
    normalizePath(
      request
    );

  const method =
    request.method.toUpperCase();

  if (
    method === "OPTIONS"
  ) {
    return handleCorsPreflight(
      request,
      env
    );
  }

  /*
   * Public health endpoint.
   */
  if (
    method === "GET" &&
    path ===
      "/api/health"
  ) {
    return json({
      ok: true,
      service:
        "fahmid-management-api",
      timestamp:
        new Date().toISOString(),
    });
  }

  /*
   * Authenticated user profile.
   */
  if (
    method === "GET" &&
    path ===
      "/api/auth/me"
  ) {
    const user =
      await requireUser(
        request,
        env
      );

    return json({
      ok: true,
      user: {
        uid:
          user.uid,

        email:
          user.claims.email,

        emailVerified:
          user.claims
            .emailVerified,

        role:
          user.role,

        profile:
          user.userRecord,
      },
    });
  }

  /*
   * ADMIN API
   */
  if (
    path.startsWith(
      "/api/admin/"
    )
  ) {
    const result =
      await handleAdminRoute(
        request,
        env,
        path
      );

    if (result) {
      return json(
        result.body,
        result.status
      );
    }
  }

  /*
   * SCHOOL API
   */
  if (
    path.startsWith(
      "/api/school/"
    )
  ) {
    const result =
      await handleSchoolRoute(
        request,
        env,
        path
      );

    if (result) {
      return json(
        result.body,
        result.status
      );
    }
  }

  return json(
    {
      ok: false,
      error: {
        code:
          "ENDPOINT_NOT_FOUND",
        message:
          "Fahmid API endpoint not found.",
      },
    },
    404
  );
}

export default {
  async fetch(
    request,
    env
  ) {
    try {
      const response =
        await handleRequest(
          request,
          env
        );

      return withCors(
        response,
        request,
        env
      );
    } catch (error) {
      console.error(
        "Worker error:",
        error
      );

      if (
        error instanceof
        AuthError
      ) {
        return withCors(
          json(
            {
              ok: false,
              error: {
                code:
                  "UNAUTHORIZED",
                message:
                  error.message,
              },
            },
            error.status
          ),
          request,
          env
        );
      }

      if (
        error instanceof
        AuthorizationError
      ) {
        return withCors(
          json(
            {
              ok: false,
              error: {
                code:
                  "FORBIDDEN",
                message:
                  error.message,
              },
            },
            error.status
          ),
          request,
          env
        );
      }

      if (
        error instanceof
        ValidationError
      ) {
        return withCors(
          json(
            {
              ok: false,
              error: {
                code:
                  "VALIDATION_ERROR",
                message:
                  error.message,
              },
            },
            400
          ),
          request,
          env
        );
      }

      return withCors(
        json(
          {
            ok: false,
            error: {
              code:
                "INTERNAL_ERROR",
              message:
                "An unexpected server error occurred.",
            },
          },
          500
        ),
        request,
        env
      );
    }
  },
};
