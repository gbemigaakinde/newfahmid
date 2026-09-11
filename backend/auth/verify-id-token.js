/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Firebase ID Token Verification
 *
 * Runs inside Cloudflare Workers.
 *
 * This file verifies Firebase Authentication ID tokens without exposing
 * Firebase Admin credentials to the browser.
 */

const FIREBASE_PROJECT_ID = "fahmid-school";

const FIREBASE_ISSUER =
  `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

/*
 * Small clock tolerance for minor differences between clocks.
 */
const CLOCK_SKEW_SECONDS = 60;

/*
 * Cache Google signing certificates in the Worker isolate.
 *
 * Google tells us how long the certificates may be cached through the
 * Cache-Control header.
 */
let cachedCertificates = null;
let certificatesExpiresAt = 0;

/**
 * Convert a base64url string into bytes.
 */
function base64UrlToBytes(value) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padding = "=".repeat(
    (4 - (normalized.length % 4)) % 4,
  );

  const binary = atob(normalized + padding);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * Decode a base64url JSON segment.
 */
function decodeJsonSegment(segment) {
  const bytes = base64UrlToBytes(segment);

  const text = new TextDecoder().decode(bytes);

  return JSON.parse(text);
}

/**
 * Convert a PEM certificate into a CryptoKey.
 *
 * Google publishes X.509 certificates for Firebase token signing.
 */
async function importCertificatePublicKey(pem) {
  const pemBody = pem
    .replace("-----BEGIN CERTIFICATE-----", "")
    .replace("-----END CERTIFICATE-----", "")
    .replace(/\s/g, "");

  const der = base64UrlToBytes(
    pemBody
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, ""),
  );

  /*
   * Web Crypto's SPKI import expects a SubjectPublicKeyInfo.
   *
   * The Google endpoint returns certificates, so we first extract
   * the public key from the certificate using a lightweight parser.
   */
  return importRsaPublicKeyFromCertificate(der);
}

/**
 * Extract RSA public key from a DER-encoded X.509 certificate.
 *
 * This parser intentionally handles the certificate structure used by
 * Google's signing certificates rather than trying to be a complete
 * X.509 implementation.
 */
async function importRsaPublicKeyFromCertificate(der) {
  /*
   * Find the SubjectPublicKeyInfo structure.
   *
   * The certificate contains:
   *
   * Certificate
   *   └── tbsCertificate
   *       └── subjectPublicKeyInfo
   *
   * Rather than depending on a Node-only certificate library, we locate
   * the RSA SubjectPublicKeyInfo sequence and import it as SPKI.
   */

  const spki = extractSubjectPublicKeyInfo(der);

  return crypto.subtle.importKey(
    "spki",
    spki,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );
}

/**
 * Minimal DER reader.
 */
function readDerElement(bytes, offset) {
  if (offset >= bytes.length) {
    throw new Error("Invalid DER data.");
  }

  const tag = bytes[offset];

  let length = bytes[offset + 1];
  let headerLength = 2;

  if ((length & 0x80) !== 0) {
    const lengthBytes = length & 0x7f;

    if (lengthBytes === 0 || lengthBytes > 4) {
      throw new Error("Unsupported DER length.");
    }

    length = 0;

    for (let i = 0; i < lengthBytes; i += 1) {
      length = (length << 8) | bytes[offset + 2 + i];
    }

    headerLength += lengthBytes;
  }

  const start = offset;
  const contentStart = offset + headerLength;
  const end = contentStart + length;

  if (end > bytes.length) {
    throw new Error("Invalid DER bounds.");
  }

  return {
    tag,
    start,
    contentStart,
    end,
  };
}

/**
 * Extract SubjectPublicKeyInfo from an X.509 certificate.
 *
 * We recursively search for the SPKI sequence containing the RSA
 * algorithm identifier and BIT STRING public key.
 */
function extractSubjectPublicKeyInfo(cert) {
  const RSA_ENCRYPTION_OID = new Uint8Array([
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
  ]);

  function containsSequence(bytes, sequence) {
    outer:
    for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
      for (let j = 0; j < sequence.length; j += 1) {
        if (bytes[i + j] !== sequence[j]) {
          continue outer;
        }
      }

      return i;
    }

    return -1;
  }

  function findSpki(offset, end) {
    while (offset < end) {
      const element = readDerElement(cert, offset);

      if (element.end > end) {
        break;
      }

      /*
       * SubjectPublicKeyInfo is a SEQUENCE containing:
       *
       * SEQUENCE
       *   OBJECT IDENTIFIER rsaEncryption
       *   NULL
       * BIT STRING
       */
      if (element.tag === 0x30) {
        const content = cert.slice(
          element.contentStart,
          element.end,
        );

        const oidPosition = containsSequence(
          content,
          RSA_ENCRYPTION_OID,
        );

        if (oidPosition !== -1) {
          /*
           * Confirm that an immediate BIT STRING follows somewhere
           * after the RSA algorithm identifier.
           */
          const bitStringTag = 0x03;

          for (
            let i = oidPosition + RSA_ENCRYPTION_OID.length;
            i < content.length;
            i += 1
          ) {
            if (content[i] === bitStringTag) {
              /*
               * The containing SEQUENCE is our SPKI.
               */
              return cert.slice(
                element.start,
                element.end,
              );
            }
          }
        }

        const nested = findSpki(
          element.contentStart,
          element.end,
        );

        if (nested) {
          return nested;
        }
      }

      offset = element.end;
    }

    return null;
  }

  const result = findSpki(0, cert.length);

  if (!result) {
    throw new Error(
      "Unable to extract Firebase signing public key.",
    );
  }

  return result;
}

/**
 * Fetch Google's current Firebase signing certificates.
 */
async function getGoogleCertificates() {
  const now = Date.now();

  if (
    cachedCertificates &&
    now < certificatesExpiresAt
  ) {
    return cachedCertificates;
  }

  const response = await fetch(GOOGLE_CERTS_URL);

  if (!response.ok) {
    throw new Error(
      `Unable to retrieve Firebase signing certificates: ${response.status}`,
    );
  }

  const certificates = await response.json();

  const cacheControl =
    response.headers.get("Cache-Control") || "";

  const maxAgeMatch =
    cacheControl.match(/max-age=(\d+)/);

  const maxAgeSeconds = maxAgeMatch
    ? Number(maxAgeMatch[1])
    : 3600;

  cachedCertificates = certificates;

  /*
   * Refresh slightly before expiration.
   */
  certificatesExpiresAt =
    now +
    Math.max(
      60_000,
      (maxAgeSeconds - 60) * 1000,
    );

  return certificates;
}

/**
 * Parse Authorization header.
 */
function getBearerToken(request) {
  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] =
    authorization.trim().split(/\s+/);

  if (
    scheme?.toLowerCase() !== "bearer" ||
    !token
  ) {
    return null;
  }

  return token;
}

/**
 * Verify Firebase ID token.
 *
 * Returns decoded token claims when valid.
 *
 * Throws an error when invalid.
 */
export async function verifyFirebaseIdToken(request) {
  const token = getBearerToken(request);

  if (!token) {
    throw new AuthError(
      "AUTH_REQUIRED",
      "Authentication is required.",
      401,
    );
  }

  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid authentication token.",
      401,
    );
  }

  let header;
  let payload;

  try {
    header = decodeJsonSegment(parts[0]);
    payload = decodeJsonSegment(parts[1]);
  } catch {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid authentication token.",
      401,
    );
  }

  /*
   * Firebase ID tokens currently use RS256.
   */
  if (header.alg !== "RS256") {
    throw new AuthError(
      "INVALID_TOKEN",
      "Unsupported authentication algorithm.",
      401,
    );
  }

  if (!header.kid) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Authentication token is missing its key identifier.",
      401,
    );
  }

  /*
   * Validate issuer.
   */
  if (payload.iss !== FIREBASE_ISSUER) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid token issuer.",
      401,
    );
  }

  /*
   * Validate audience.
   */
  if (payload.aud !== FIREBASE_PROJECT_ID) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid token audience.",
      401,
    );
  }

  /*
   * Validate subject / Firebase UID.
   */
  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > 128
  ) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid user identity.",
      401,
    );
  }

  const nowSeconds =
    Math.floor(Date.now() / 1000);

  /*
   * Token must not be expired.
   */
  if (
    typeof payload.exp !== "number" ||
    payload.exp <
      nowSeconds - CLOCK_SKEW_SECONDS
  ) {
    throw new AuthError(
      "TOKEN_EXPIRED",
      "Your session has expired. Please sign in again.",
      401,
    );
  }

  /*
   * Token cannot be issued in the future.
   */
  if (
    typeof payload.iat !== "number" ||
    payload.iat >
      nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid authentication timestamp.",
      401,
    );
  }

  /*
   * auth_time must also be valid.
   */
  if (
    typeof payload.auth_time !== "number" ||
    payload.auth_time >
      nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Invalid authentication time.",
      401,
    );
  }

  const certificates =
    await getGoogleCertificates();

  const certificate =
    certificates[header.kid];

  if (!certificate) {
    /*
     * A key may have rotated between cache refreshes.
     * Force one immediate refresh.
     */
    cachedCertificates = null;
    certificatesExpiresAt = 0;

    const refreshedCertificates =
      await getGoogleCertificates();

    const refreshedCertificate =
      refreshedCertificates[header.kid];

    if (!refreshedCertificate) {
      throw new AuthError(
        "INVALID_TOKEN",
        "Authentication signing key is not recognized.",
        401,
      );
    }

    return verifySignatureAndReturnClaims(
      token,
      parts,
      refreshedCertificate,
      payload,
    );
  }

  return verifySignatureAndReturnClaims(
    token,
    parts,
    certificate,
    payload,
  );
}

/**
 * Verify cryptographic signature.
 */
async function verifySignatureAndReturnClaims(
  token,
  parts,
  certificate,
  payload,
) {
  let publicKey;

  try {
    publicKey =
      await importCertificatePublicKey(
        certificate,
      );
  } catch {
    throw new AuthError(
      "INVALID_TOKEN",
      "Unable to validate authentication signature.",
      401,
    );
  }

  const data = new TextEncoder().encode(
    `${parts[0]}.${parts[1]}`,
  );

  const signature =
    base64UrlToBytes(parts[2]);

  let valid = false;

  try {
    valid = await crypto.subtle.verify(
      {
        name: "RSASSA-PKCS1-v1_5",
      },
      publicKey,
      signature,
      data,
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    throw new AuthError(
      "INVALID_TOKEN",
      "Authentication token signature is invalid.",
      401,
    );
  }

  return {
    uid: payload.sub,
    claims: payload,
  };
}

/**
 * Structured authentication error.
 */
export class AuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);

    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}
