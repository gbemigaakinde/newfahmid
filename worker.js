/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Cloudflare Worker
 *
 * This file is the backend API entry point.
 *
 * IMPORTANT:
 * The frontend must NOT access privileged Firebase data directly.
 * Requests for protected operations must pass through this Worker.
 *
 * Business logic will live in /backend and be imported here as the
 * system is built.
 */

const API_PREFIX = "/api";

/**
 * Standard JSON response helper.
 */
function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/**
 * Basic CORS configuration.
 *
 * IMPORTANT:
 * This will be tightened to the actual Fahmid frontend domain before
 * production deployment.
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");

  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Handle CORS preflight requests.
 */
function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

/**
 * Health check.
 *
 * This is intentionally public and contains no school data.
 */
function healthCheck(request) {
  return json(
    {
      ok: true,
      service: "fahmid-management-api",
      status: "online",
    },
    200,
    getCorsHeaders(request),
  );
}

/**
 * Main Worker entry point.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /*
     * CORS preflight.
     */
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    /*
     * Only API requests belong to this Worker.
     */
    if (!url.pathname.startsWith(API_PREFIX)) {
      return json(
        {
          ok: false,
          error: "NOT_FOUND",
          message: "API endpoint not found.",
        },
        404,
        getCorsHeaders(request),
      );
    }

    /*
     * Public health endpoint.
     */
    if (url.pathname === "/api/health" && request.method === "GET") {
      return healthCheck(request);
    }

    /*
     * ------------------------------------------------------------------
     * BUSINESS API ROUTES
     * ------------------------------------------------------------------
     *
     * These will be connected as we build the system:
     *
     * /api/auth/*
     * /api/pupils/*
     * /api/teachers/*
     * /api/classes/*
     * /api/results/*
     * /api/attendance/*
     * /api/finance/*
     * /api/promotions/*
     * /api/cbt/*
     * /api/lesson-notes/*
     * /api/announcements/*
     * /api/calendar/*
     *
     * Critical calculations MUST happen behind these routes.
     */

    return json(
      {
        ok: false,
        error: "ENDPOINT_NOT_IMPLEMENTED",
        message: "This API endpoint has not been implemented yet.",
      },
      501,
      getCorsHeaders(request),
    );
  },
};
