const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE =
  "https://www.googleapis.com/auth/datastore";
let cachedToken = null;
let cachedTokenExpiresAt = 0;
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function stringToBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  return base64UrlEncode(bytes);
}
function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
async function importPrivateKey(privateKeyPem) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}
async function createServiceAccountAssertion(
  clientEmail,
  privateKey
) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: clientEmail,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader =
    stringToBase64Url(JSON.stringify(header));
  const encodedPayload =
    stringToBase64Url(JSON.stringify(payload));
  const unsignedToken =
    `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );
  return `${unsignedToken}.${base64UrlEncode(
    new Uint8Array(signature)
  )}`;
}
function validateCredentials(env) {
  const clientEmail =
    env.FIREBASE_CLIENT_EMAIL;
  const privateKey =
    env.FIREBASE_PRIVATE_KEY;
  if (
    !clientEmail ||
    clientEmail.includes("PLACEHOLDER")
  ) {
    throw new Error(
      "Firebase service account email is not configured."
    );
  }
  if (
    !privateKey ||
    privateKey.includes("PLACEHOLDER")
  ) {
    throw new Error(
      "Firebase service account private key is not configured."
    );
  }
  return {
    clientEmail,
    privateKey,
  };
}
export async function getGoogleAccessToken(env) {
  const now = Date.now();
  if (
    cachedToken &&
    cachedTokenExpiresAt > now + 60_000
  ) {
    return cachedToken;
  }
  const {
    clientEmail,
    privateKey,
  } = validateCredentials(env);
  const assertion =
    await createServiceAccountAssertion(
      clientEmail,
      privateKey
    );
  const response = await fetch(
    GOOGLE_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data?.error_description ||
        data?.error ||
        "Unable to obtain Google access token."
    );
  }
  cachedToken = data.access_token;
  cachedTokenExpiresAt =
    now + (Number(data.expires_in || 3600) * 1000);
  return cachedToken;
}
