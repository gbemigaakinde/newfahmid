/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * CORS Security
 */

const DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

/**
 * Check whether an origin is allowed.
 *
 * Production Vercel URL will be added through environment configuration.
 */
export function isAllowedOrigin(origin, env) {
  if (!origin) {
    return false;
  }

  if (DEVELOPMENT_ORIGINS.has(origin)) {
    return true;
  }

  const configuredOrigin =
    env?.FRONTEND_ORIGIN;

  if (
    configuredOrigin &&
    origin === configuredOrigin
  ) {
    return true;
  }

  return false;
}

/**
 * Return CORS headers for a request.
 */
export function getCorsHeaders(
  request,
  env,
) {
  const origin =
    request.headers.get("Origin");

  const allowed =
    isAllowedOrigin(origin, env);

  return {
    "Access-Control-Allow-Origin":
      allowed ? origin : "null",

    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With",

    "Access-Control-Max-Age":
      "86400",

    "Vary":
      "Origin",
  };
}

/**
 * Handle CORS preflight.
 */
export function handleCorsPreflight(
  request,
  env,
) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(
      request,
      env,
    ),
  });
}
