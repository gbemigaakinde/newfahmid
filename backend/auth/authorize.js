import { getCurrentUser } from "../api/auth.js";
import { getUserByUid } from "../firebase/users.js";

export class AuthorizationError extends Error {
  constructor(
    message = "You are not authorized to perform this action."
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.status = 403;
  }
}

export async function requireUser(request, env) {
  const firebaseUser = await getCurrentUser(request);

  const userRecord = await getUserByUid(
    env,
    firebaseUser.uid
  );

  if (!userRecord) {
    throw new AuthorizationError(
      "Your account exists in Firebase Authentication, but no Fahmid user record was found."
    );
  }

  if (userRecord.active === false) {
    throw new AuthorizationError(
      "Your Fahmid account has been disabled."
    );
  }

  return {
    ...firebaseUser,
    userRecord,
    role: userRecord.role || null,
  };
}

export async function requireRole(
  request,
  env,
  allowedRoles
) {
  const user = await requireUser(request, env);

  const roles = Array.isArray(allowedRoles)
    ? allowedRoles
    : [allowedRoles];

  if (!roles.includes(user.role)) {
    throw new AuthorizationError(
      "You do not have permission to access this resource."
    );
  }

  return user;
}

export function requireAdmin(request, env) {
  return requireRole(
    request,
    env,
    ["admin"]
  );
}

export function requireTeacher(request, env) {
  return requireRole(
    request,
    env,
    ["teacher"]
  );
}

export function requirePupil(request, env) {
  return requireRole(
    request,
    env,
    ["pupil"]
  );
}

export function requireStaff(request, env) {
  return requireRole(
    request,
    env,
    ["admin", "teacher"]
  );
}
