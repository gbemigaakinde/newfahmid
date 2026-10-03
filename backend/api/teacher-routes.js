/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Teacher Portal Routes
 */

import { requireTeacher } from "../auth/authorize.js";
import { getTeacherRoster } from "../business/school/teacher-roster.js";

export async function handleTeacherRoute(request, env, path) {
  if (request.method === "GET" && path === "/api/teacher/roster") {
    const user = await requireTeacher(request, env);
    const roster = await getTeacherRoster(env, user.uid);

    return { status: 200, body: { ok: true, ...roster } };
  }

  return null;
}
