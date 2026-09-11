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
} from "./backend/api/auth.js";

import {
  AuthError,
} from "./backend/auth/verify-id-token.js";

import {
  getCorsHeaders,
  handleCorsPreflight,
} from "./backend/security/cors.js";

const API_PREFIX = "/api";

/**
 * Standard JSON response.
 */
function json(
  data,
  status = 200,
  headers = {},
) {
  return Response.json(
    data,
    {
      status,
      headers: {
        "Cache-Control":
          "no-store",

        ...headers,
      },
    },
  );
}

/**
 * Public health check.
 */
function healthCheck(
  request,
  env,
) {
  return json(
    {
      ok: true,
      service:
        "fahmid-management-api",
      status: "online",
    },
    200,
    getCorsHeaders(
      request,
      env,
    ),
  );
}

/**
 * Route authenticated API requests.
 */
async function routeRequest(
  request,
  env,
) {
  const url =
    new URL(request.url);

  /*
   * Public health endpoint.
   */
  if (
    url.pathname ===
      "/api/health" &&
    request.method === "GET"
  ) {
    return healthCheck(
      request,
      env,
    );
  }

  /*
   * Authentication endpoint.
   */
  if (
    url.pathname ===
      "/api/auth/me" &&
    request.method === "GET"
  ) {
    const response =
      await getCurrentUser(
        request,
      );

    return addCorsHeaders(
      response,
      request,
      env,
    );
  }

  /*
   * Everything else is not implemented yet.
   */
  return json(
    {
      ok: false,
      error:
        "ENDPOINT_NOT_IMPLEMENTED",
      message:
        "This API endpoint has not been implemented yet.",
    },
    501,
    getCorsHeaders(
      request,
      env,
    ),
  );
}

/**
 * Add CORS headers to an existing response.
 */
function addCorsHeaders(
  response,
  request,
  env,
) {
  const headers =
    new Headers(
      response.headers,
    );

  const corsHeaders =
    getCorsHeaders(
      request,
      env,
    );

  for (
    const [
      key,
      value,
    ] of Object.entries(
      corsHeaders,
    )
  ) {
    headers.set(
      key,
      value,
    );
  }

  return new Response(
    response.body,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers,
    },
  );
}

/**
 * Main Worker entry point.
 */
export default {
  async fetch(
    request,
    env,
    ctx,
  ) {
    try {
      const url =
        new URL(
          request.url,
        );

      /*
       * CORS preflight.
       */
      if (
        request.method ===
        "OPTIONS"
      ) {
        return handleCorsPreflight(
          request,
          env,
        );
      }

      /*
       * Only /api routes belong here.
       */
      if (
        !url.pathname.startsWith(
          API_PREFIX,
        )
      ) {
        return json(
          {
            ok: false,
            error:
              "NOT_FOUND",
            message:
              "API endpoint not found.",
          },
          404,
          getCorsHeaders(
            request,
            env,
          ),
        );
      }

      return await routeRequest(
        request,
        env,
      );
    } catch (error) {
      /*
       * Expected authentication errors.
       */
      if (
        error instanceof AuthError
      ) {
        return json(
          {
            ok: false,
            error:
              error.code,
            message:
              error.message,
          },
          error.status,
          getCorsHeaders(
            request,
            env,
          ),
        );
      }

      /*
       * Unexpected errors.
       *
       * Do not expose internal error details
       * to the browser.
       */
      console.error(
        "Worker request error:",
        error,
      );

      return json(
        {
          ok: false,
          error:
            "INTERNAL_SERVER_ERROR",
          message:
            "An unexpected server error occurred.",
        },
        500,
        getCorsHeaders(
          request,
          env,
        ),
      );
    }
  },
};
