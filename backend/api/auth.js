/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Authentication API
 */

import {
  verifyFirebaseIdToken,
} from "../auth/verify-id-token.js";

/**
 * Return the currently authenticated Firebase identity.
 *
 * IMPORTANT:
 * This endpoint does not yet determine the Fahmid application role.
 *
 * Role resolution will happen through the server-side user record.
 */
export async function getCurrentUser(
  request,
) {
  const identity =
    await verifyFirebaseIdToken(request);

  return Response.json({
    ok: true,

    user: {
      uid: identity.uid,

      /*
       * We deliberately do not return the entire Firebase token.
       */
      claims: {
        email:
          identity.claims.email || null,

        emailVerified:
          identity.claims.email_verified === true,

        signInProvider:
          identity.claims.firebase
            ?.sign_in_provider || null,
      },
    },
  });
}
