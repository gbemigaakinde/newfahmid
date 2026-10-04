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

/**
 * `approval.js` and `drafts.js` both import and call `audit(env,
 * { action, actorUid, targetType, targetId, metadata })` — a
 * function that was never defined anywhere in this file (only
 * `writeAuditLog`, with a differently-shaped signature, exists).
 * Every approval and every draft save would have thrown
 * "audit is not a function" immediately after its Firestore writes
 * already committed — the data would be saved, but the API call
 * would still fail with a 500, silently.
 *
 * Rather than change either call site, this adapts the shape they
 * already use onto the real writeAuditLog().
 */
export async function audit(
  env,
  { action, actorUid, targetType, targetId, metadata = null },
) {
  return writeAuditLog(env, {
    user: actorUid ? { uid: actorUid } : null,
    action,
    collection: targetType,
    documentId: targetId ?? null,
    details: metadata,
  });
}
