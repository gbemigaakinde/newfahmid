/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Firestore Server Client
 */

const FIRESTORE_BASE_URL =
  "https://firestore.googleapis.com/v1/projects/fahmid-school/databases/(default)/documents";

const MAX_ATOMIC_WRITES = 500;

function createFirestoreError(
  message,
  status = 500,
  details = null,
) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function encodeDocumentId(id) {
  return encodeURIComponent(String(id));
}

function documentUrl(collection, documentId) {
  return `${FIRESTORE_BASE_URL}/${collection}/${encodeDocumentId(documentId)}`;
}

function documentName(collection, documentId) {
  return `projects/fahmid-school/databases/(default)/documents/${collection}/${encodeDocumentId(documentId)}`;
}

function encodeFirestoreValue(value) {
  if (value === null) {
    return { nullValue: null };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { booleanValue: value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Firestore does not support non-finite numbers.",
      );
    }

    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }

    return { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(encodeFirestoreValue),
      },
    };
  }

  if (value instanceof Date) {
    return {
      timestampValue: value.toISOString(),
    };
  }

  if (typeof value === "object") {
    const fields = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      fields[key] = encodeFirestoreValue(nestedValue);
    }

    return {
      mapValue: {
        fields,
      },
    };
  }

  throw new TypeError(
    `Unsupported Firestore value type: ${typeof value}`,
  );
}

function encodeFirestoreFields(data = {}) {
  const fields = {};

  for (const [key, value] of Object.entries(data)) {
    fields[key] = encodeFirestoreValue(value);
  }

  return fields;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("nullValue" in value) {
    return null;
  }

  if ("stringValue" in value) {
    return value.stringValue;
  }

  if ("booleanValue" in value) {
    return value.booleanValue;
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  if ("doubleValue" in value) {
    return value.doubleValue;
  }

  if ("timestampValue" in value) {
    return value.timestampValue;
  }

  if ("referenceValue" in value) {
    return value.referenceValue;
  }

  if ("bytesValue" in value) {
    return value.bytesValue;
  }

  if ("geoPointValue" in value) {
    return value.geoPointValue;
  }

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(
      decodeFirestoreValue,
    );
  }

  if ("mapValue" in value) {
    return decodeFirestoreFields(
      value.mapValue.fields || {},
    );
  }

  return null;
}

function decodeFirestoreFields(fields = {}) {
  const result = {};

  for (const [key, value] of Object.entries(fields)) {
    result[key] = decodeFirestoreValue(value);
  }

  return result;
}

export function decodeFirestoreDocument(document) {
  if (!document) {
    return null;
  }

  return {
    id:
      document.name?.split("/").pop() ||
      null,
    ...decodeFirestoreFields(
      document.fields || {},
    ),
  };
}

async function firestoreRequest(
  env,
  path,
  options = {},
) {
  const {
    method = "GET",
    body,
  } = options;

  if (
    !env ||
    typeof env.__getGoogleAccessToken !==
      "function"
  ) {
    throw createFirestoreError(
      "Firestore access token provider is not configured.",
      500,
    );
  }

  const accessToken =
    await env.__getGoogleAccessToken();

  const response = await fetch(
    path.startsWith("https://")
      ? path
      : `${FIRESTORE_BASE_URL}/${path.replace(
          /^\/+/,
          "",
        )}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),
    },
  );

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw createFirestoreError(
      data?.error?.message ||
        `Firestore request failed with status ${response.status}`,
      response.status,
      data,
    );
  }

  return data;
}

export async function getDocument(
  env,
  collection,
  documentId,
) {
  const data =
    await firestoreRequest(
      env,
      documentUrl(
        collection,
        documentId,
      ),
    );

  return decodeFirestoreDocument(data);
}

export async function getDocumentSnapshot(
  env,
  collection,
  documentId,
) {
  try {
    const data =
      await firestoreRequest(
        env,
        documentUrl(
          collection,
          documentId,
        ),
      );

    if (!data) {
      return null;
    }

    return {
      document:
        decodeFirestoreDocument(data),
      updateTime:
        data.updateTime || null,
      createTime:
        data.createTime || null,
    };
  } catch (error) {
    if (error?.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function setDocument(
  env,
  collection,
  documentId,
  data,
  options = {},
) {
  const query =
    options.merge
      ? "?currentDocument.exists=true"
      : "";

  const response =
    await firestoreRequest(
      env,
      `${documentUrl(
        collection,
        documentId,
      )}${query}`,
      {
        method: "PATCH",
        body: {
          fields:
            encodeFirestoreFields(data),
        },
      },
    );

  return decodeFirestoreDocument(
    response,
  );
}

export async function deleteDocument(
  env,
  collection,
  documentId,
) {
  await firestoreRequest(
    env,
    documentUrl(
      collection,
      documentId,
    ),
    {
      method: "DELETE",
    },
  );

  return true;
}

export async function runQuery(
  env,
  structuredQuery,
) {
  const response =
    await firestoreRequest(
      env,
      `${FIRESTORE_BASE_URL}:runQuery`,
      {
        method: "POST",
        body: {
          structuredQuery,
        },
      },
    );

  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .filter(
      (item) => item.document,
    )
    .map(
      (item) =>
        decodeFirestoreDocument(
          item.document,
        ),
    );
}

export async function runQueryWithMetadata(
  env,
  structuredQuery,
) {
  const response =
    await firestoreRequest(
      env,
      `${FIRESTORE_BASE_URL}:runQuery`,
      {
        method: "POST",
        body: {
          structuredQuery,
        },
      },
    );

  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .filter(
      (item) => item.document,
    )
    .map((item) => ({
      document:
        decodeFirestoreDocument(
          item.document,
        ),
      updateTime:
        item.document.updateTime ||
        null,
      createTime:
        item.document.createTime ||
        null,
    }));
}

function encodePrecondition(
  precondition,
) {
  if (!precondition) {
    return undefined;
  }

  if (
    typeof precondition.exists ===
    "boolean"
  ) {
    return {
      exists:
        precondition.exists,
    };
  }

  if (
    precondition.updateTime
  ) {
    return {
      updateTime:
        precondition.updateTime,
    };
  }

  throw new TypeError(
    "Invalid Firestore write precondition.",
  );
}

function buildCommitWrite(
  operation,
) {
  if (
    !operation ||
    operation.type !== "set"
  ) {
    throw new TypeError(
      "Atomic Firestore currently supports only set operations.",
    );
  }

  const {
    collection,
    documentId,
    data,
    precondition,
  } = operation;

  if (!collection) {
    throw new TypeError(
      "Atomic write collection is required.",
    );
  }

  if (
    documentId === undefined ||
    documentId === null ||
    documentId === ""
  ) {
    throw new TypeError(
      "Atomic write documentId is required.",
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new TypeError(
      "Atomic write data must be an object.",
    );
  }

  const write = {
    update: {
      name: documentName(
        collection,
        documentId,
      ),
      fields:
        encodeFirestoreFields(data),
    },
  };

  const encodedPrecondition =
    encodePrecondition(
      precondition,
    );

  if (encodedPrecondition) {
    write.currentDocument =
      encodedPrecondition;
  }

  return write;
}

export async function commitWrites(
  env,
  operations = [],
) {
  if (!Array.isArray(operations)) {
    throw new TypeError(
      "Atomic Firestore operations must be an array.",
    );
  }

  if (operations.length === 0) {
    throw new TypeError(
      "At least one atomic Firestore operation is required.",
    );
  }

  if (
    operations.length >
    MAX_ATOMIC_WRITES
  ) {
    throw createFirestoreError(
      `Atomic Firestore commit cannot contain more than ${MAX_ATOMIC_WRITES} writes.`,
      400,
      {
        code:
          "ATOMIC_WRITE_LIMIT_EXCEEDED",
        count:
          operations.length,
        max:
          MAX_ATOMIC_WRITES,
      },
    );
  }

  const writes =
    operations.map(
      buildCommitWrite,
    );

  const response =
    await firestoreRequest(
      env,
      `${FIRESTORE_BASE_URL}:commit`,
      {
        method: "POST",
        body: {
          writes,
        },
      },
    );

  return {
    commitTime:
      response?.commitTime ||
      null,
    writeResults:
      response?.writeResults ||
      [],
  };
}

export {
  encodeFirestoreValue,
  encodeFirestoreFields,
  decodeFirestoreValue,
  decodeFirestoreFields,
  createFirestoreError,
  MAX_ATOMIC_WRITES,
};
