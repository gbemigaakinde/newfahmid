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
  getCurrentUser,
  AuthError,
} from "./backend/api/auth.js";

import {
  requireUser,
  AuthorizationError,
} from "./backend/auth/authorize.js";

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
    new Headers(response.headers);

  const corsHeaders =
    getCorsHeaders(
      request,
      env
    );

  for (
    const [key, value]
    of Object.entries(corsHeaders)
  ) {
    headers.set(key, value);
  }

  return new Response(
    response.body,
    {
      status: response.status,
      headers,
    }
  );
}


function normalizePath(request) {
  const url =
    new URL(request.url);

  const normalized =
    url.pathname
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");

  return normalized || "/";
}


async function handleRequest(
  request,
  env
) {
  /*
   * Provide the Firestore layer with
   * a Google access-token provider.
   *
   * The actual Firebase credentials remain
   * inside Cloudflare Worker secrets.
   */
  env.__getGoogleAccessToken =
    () => getGoogleAccessToken(env);


  const path =
    normalizePath(request);

  const method =
    request.method.toUpperCase();


  /*
   * CORS preflight
   */
  if (method === "OPTIONS") {
    return handleCorsPreflight(
      request,
      env
    );
  }


  /*
   * Public health check.
   *
   * This endpoint does not require
   * Firebase authentication.
   */
  if (
    method === "GET" &&
    path === "/api/health"
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
   * Authenticated user information.
   *
   * Flow:
   *
   * Firebase ID token
   *       ↓
   * Verify token
   *       ↓
   * Get Firebase UID
   *       ↓
   * Read users/{uid}
   *       ↓
   * Get Fahmid role
   */
  if (
    method === "GET" &&
    path === "/api/auth/me"
  ) {
    const user =
      await requireUser(
        request,
        env
      );

    return json({
      ok: true,

      user: {
        uid: user.uid,

        email:
          user.claims.email,

        emailVerified:
          user.claims.emailVerified,

        role:
          user.role,

        profile:
          user.userRecord,
      },
    });
  }

    const schoolResponse =
    await handleSchoolRoute(
      request,
      env,
      path
    );

  if (schoolResponse) {
    return json(
      schoolResponse.body,
      schoolResponse.status
    );
  }

  /*
   * All other API routes will be
   * implemented here through separate
   * backend modules.
   *
   * We intentionally do NOT expose a
   * generic Firestore endpoint.
   */
  return json(
    {
      ok: false,

      error: {
        code:
          "ENDPOINT_NOT_IMPLEMENTED",

        message:
          "This Fahmid API endpoint has not been implemented yet.",
      },
    },

    501
  );
}


export default {
  async fetch(request, env) {
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


      /*
       * Authentication errors.
       */
      if (
        error instanceof AuthError
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


      /*
       * Authorization errors.
       */
      if (
        error instanceof AuthorizationError
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


      /*
       * Never expose internal errors,
       * credentials, stack traces, or
       * Firestore implementation details
       * to the browser.
       */
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
