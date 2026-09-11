/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Authentication API
 */

import {
  verifyFirebaseIdToken,
} from "../auth/verify-id-token.js";

export async function getCurrentUser(request) {
  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    throw new AuthError(
      "Missing Authorization header.",
      401
    );
  }

  const parts = authorization
    .trim()
    .split(/\s+/);

  const scheme = parts[0];
  const token = parts[1];

  if (
    scheme !== "Bearer" ||
    !token
  ) {
    throw new AuthError(
      "Invalid Authorization header.",
      401
    );
  }

  const verified =
    await verifyFirebaseIdToken(token);

  return {
    uid: verified.uid,

    claims: {
      email:
        verified.claims.email || null,

      emailVerified:
        verified.claims.email_verified === true,

      signInProvider:
        verified.claims.firebase
          ?.sign_in_provider || null,
    },
  };
}

export class AuthError extends Error {
  constructor(
    message = "Authentication failed.",
    status = 401
  ) {
    super(message);

    this.name = "AuthError";
    this.status = status;
  }
}
