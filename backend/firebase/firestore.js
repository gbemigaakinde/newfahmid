/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Firestore Server Client
 *
 * This module is the single server-side interface between the
 * Cloudflare Worker and Firestore.
 *
 * IMPORTANT:
 * The actual Google authentication credentials are intentionally
 * placeholders until the Firebase service account is configured.
 */

const FIRESTORE_BASE_URL =
  "https://firestore.googleapis.com/v1/projects/fahmid-school/databases/(default)/documents";

/**
 * Check whether the Firebase server credentials have been configured.
 */
function assertFirebaseConfigured(env) {
  const clientEmail =
    env?.FIREBASE_CLIENT_EMAIL;

  const privateKey =
    env?.FIREBASE_PRIVATE_KEY;

  if (
    !clientEmail ||
    !privateKey
  ) {
    throw new Error(
      "Firebase server credentials have not been configured.",
    );
  }
}

/**
 * Build a Firestore document URL.
 */
function documentUrl(
  documentPath,
) {
  const cleanPath =
    String(documentPath)
      .replace(/^\/+/, "");

  return `${FIRESTORE_BASE_URL}/${cleanPath}`;
}

/**
 * Create a standard Firebase server error.
 */
function createFirestoreError(
  response,
  data,
) {
  const error =
    new Error(
      data?.error?.message ||
        `Firestore request failed with status ${response.status}.`,
    );

  error.status =
    response.status;

  error.code =
    data?.error?.status ||
    "FIRESTORE_ERROR";

  return error;
}

/**
 * Make a Firestore REST API request.
 *
 * Authentication will be connected once the Firebase service-account
 * credentials are configured.
 */
async function firestoreRequest(
  env,
  path,
  options = {},
) {
  assertFirebaseConfigured(
    env,
  );

  /*
   * TODO:
   *
   * Generate a Google OAuth 2.0 access token using the Firebase
   * service account.
   *
   * This will be implemented before this client is used against
   * production Firestore.
   */
  const accessToken =
    await getGoogleAccessToken(
      env,
    );

  const headers =
    new Headers(
      options.headers || {},
    );

  headers.set(
    "Authorization",
    `Bearer ${accessToken}`,
  );

  headers.set(
    "Content-Type",
    "application/json",
  );

  const response =
    await fetch(
      path,
      {
        ...options,
        headers,
      },
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw createFirestoreError(
      response,
      data,
    );
  }

  return data;
}

/**
 * Get a Firestore document.
 */
export async function getDocument(
  env,
  documentPath,
) {
  return firestoreRequest(
    env,
    documentUrl(
      documentPath,
    ),
    {
      method: "GET",
    },
  );
}

/**
 * Create or replace a Firestore document.
 */
export async function setDocument(
  env,
  documentPath,
  fields,
) {
  return firestoreRequest(
    env,
    documentUrl(
      documentPath,
    ),
    {
      method: "PATCH",
      body:
        JSON.stringify({
          fields,
        }),
    },
  );
}

/**
 * Update selected fields in a Firestore document.
 */
export async function updateDocument(
  env,
  documentPath,
  fields,
) {
  const url =
    new URL(
      documentUrl(
        documentPath,
      ),
    );

  const fieldPaths =
    Object.keys(fields);

  for (
    const fieldPath of fieldPaths
  ) {
    url.searchParams.append(
      "updateMask.fieldPaths",
      fieldPath,
    );
  }

  return firestoreRequest(
    env,
    url.toString(),
    {
      method: "PATCH",
      body:
        JSON.stringify({
          fields,
        }),
    },
  );
}

/**
 * Delete a Firestore document.
 */
export async function deleteDocument(
  env,
  documentPath,
) {
  return firestoreRequest(
    env,
    documentUrl(
      documentPath,
    ),
    {
      method: "DELETE",
    },
  );
}

/**
 * Query Firestore.
 *
 * This is deliberately kept generic because the actual query
 * structures will be defined by each business module.
 */
export async function runQuery(
  env,
  structuredQuery,
) {
  const url =
    `${FIRESTORE_BASE_URL}:runQuery`;

  return firestoreRequest(
    env,
    url,
    {
      method: "POST",
      body:
        JSON.stringify({
          structuredQuery,
        }),
    },
  );
}

/**
 * Google OAuth access-token generation.
 *
 * PLACEHOLDER FOR NOW.
 *
 * Before the Worker accesses real Firestore, this function will:
 *
 * 1. Read FIREBASE_CLIENT_EMAIL from Worker Secrets.
 * 2. Read FIREBASE_PRIVATE_KEY from Worker Secrets.
 * 3. Create a Google service-account JWT.
 * 4. Sign it using Web Crypto.
 * 5. Exchange it for a Google OAuth access token.
 * 6. Cache the token until shortly before expiration.
 */
async function getGoogleAccessToken(
  env,
) {
  /*
   * This intentionally stops execution until the real credentials
   * and OAuth implementation are installed.
   */

  if (
    env?.FIREBASE_CLIENT_EMAIL ===
      "PLACEHOLDER_FIREBASE_SERVICE_ACCOUNT_EMAIL"
  ) {
    throw new Error(
      "Firebase service account is still using placeholder credentials.",
    );
  }

  if (
    !env?.FIREBASE_CLIENT_EMAIL ||
    !env?.FIREBASE_PRIVATE_KEY
  ) {
    throw new Error(
      "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required.",
    );
  }

  /*
   * TODO:
   * Implement Google service-account OAuth JWT exchange.
   */
  throw new Error(
    "Google service-account authentication has not been configured yet.",
  );
}
