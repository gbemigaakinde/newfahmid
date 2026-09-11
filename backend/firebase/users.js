import {
  getDocument,
} from "./firestore.js";
export async function getUserByUid(env, uid) {
  if (!uid) {
    return null;
  }
  return getDocument(
    env,
    "users",
    uid
  );
}
export async function getUserRole(env, uid) {
  const user = await getUserByUid(
    env,
    uid
  );
  if (!user) {
    return null;
  }
  return user.role || null;
}
