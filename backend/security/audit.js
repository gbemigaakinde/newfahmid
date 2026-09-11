import { setDocument } from "../firebase/firestore.js";

function makeAuditId() {
  return `audit_${Date.now()}_${crypto.randomUUID()}`;
}

export async function writeAuditLog(
  env,
  {
    user,
    action,
    collection,
    documentId = null,
    changes = null,
    deletedData = null,
    details = null,
    request = null,
  }
) {
  const auditId = makeAuditId();

  const record = {
    action,
    collection,
    documentId,

    performedBy: user?.uid || null,
    performedByEmail:
      user?.claims?.email || null,

    changes,
    deletedData,
    details,

    userAgent:
      request?.headers?.get("User-Agent") || null,

    timestamp: new Date().toISOString(),
  };

  await setDocument(
    env,
    "audit_log",
    auditId,
    record
  );

  return {
    id: auditId,
    ...record,
  };
}
