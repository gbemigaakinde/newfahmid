import { getUserByUid } from "../firebase/users.js";

export async function getAuthenticatedUserProfile(env, uid) {
  if (!uid) {
    throw new Error("A Firebase UID is required.");
  }

  const user = await getUserByUid(env, uid);

  if (!user) {
    return null;
  }

  return {
    uid,
    ...user,
  };
}
