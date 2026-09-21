/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Public Auth-Support Routes
 *
 * These two lookups used to run as direct Firestore queries in the
 * browser (login.html querying window.db.collection('pupils')...).
 * That meant the pupils/teachers/users collections were reachable
 * from client code. They now run here, server-side, and only ever
 * return the minimum needed to let someone sign in — never full
 * pupil/teacher/user records.
 *
 * Both endpoints are intentionally public (no Authorization header):
 * you can't be logged in yet if you're trying to log in.
 */

import { runQuery } from "../firebase/firestore.js";
import { ValidationError } from "../security/validation.js";

function equalsFilter(collectionId, field, value, limit = 1) {
  return {
    from: [{ collectionId }],
    where: {
      fieldFilter: {
        field: { fieldPath: field },
        op: "EQUAL",
        value: { stringValue: value },
      },
    },
    limit,
  };
}

/**
 * POST /api/auth/resolve-identifier
 * body: { identifier: string }
 *
 * If the identifier looks like an email, it's returned unchanged
 * (the browser then calls Firebase Auth directly with it). If it's
 * an admission number, we look up the matching pupil's email.
 */
export async function resolveIdentifier(request, env) {
  const body = await request.json().catch(() => ({}));
  const identifier = String(body.identifier || "").trim();

  if (!identifier) {
    throw new ValidationError("An email or admission number is required.");
  }

  if (identifier.includes("@")) {
    return { status: 200, body: { ok: true, email: identifier } };
  }

  const results = await runQuery(
    env,
    equalsFilter("pupils", "admissionNo", identifier)
  );

  if (!results.length || !results[0].email) {
    // Deliberately vague: don't reveal whether the admission number
    // exists, just that this route can't produce a usable email.
    return {
      status: 404,
      body: {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "No account found with this admission number.",
        },
      },
    };
  }

  return { status: 200, body: { ok: true, email: results[0].email } };
}

/**
 * POST /api/auth/check-email
 * body: { email: string }
 *
 * Used by the "forgot password" flow to confirm an email belongs to
 * a pupil, teacher, or admin user before sending a reset link.
 */
export async function checkEmailExists(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    throw new ValidationError("A valid email address is required.");
  }

  const [pupils, teachers, users] = await Promise.all([
    runQuery(env, equalsFilter("pupils", "email", email)),
    runQuery(env, equalsFilter("teachers", "email", email)),
    runQuery(env, equalsFilter("users", "email", email)),
  ]);

  const exists = pupils.length > 0 || teachers.length > 0 || users.length > 0;

  return { status: 200, body: { ok: true, exists } };
}

/**
 * Router entry point, called from worker.js for any /api/auth/*
 * path that isn't already handled (e.g. /api/auth/me).
 */
export async function handlePublicAuthRoute(request, env, path) {
  if (request.method === "POST" && path === "/api/auth/resolve-identifier") {
    return resolveIdentifier(request, env);
  }

  if (request.method === "POST" && path === "/api/auth/check-email") {
    return checkEmailExists(request, env);
  }

  return null;
}
