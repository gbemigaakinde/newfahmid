/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Teacher Portal Routes
 */

import { requireTeacher } from "../auth/authorize.js";
import { getTeacherRoster } from "../business/school/teacher-roster.js";
import {
  getPromotionOverview,
  submitPromotionRequest,
} from "../business/school/promotions.js";

export async function handleTeacherRoute(request, env, path) {
  if (request.method === "GET" && path === "/api/teacher/roster") {
    const user = await requireTeacher(request, env);
    const roster = await getTeacherRoster(env, user.uid);

    return { status: 200, body: { ok: true, ...roster } };
  }

  if (request.method === "GET" && path === "/api/teacher/promotion/overview") {
    const user = await requireTeacher(request, env);
    const overview = await getPromotionOverview(env, user.uid);

    return { status: 200, body: { ok: true, ...overview } };
  }

  if (request.method === "POST" && path === "/api/teacher/promotion/submit") {
    const user = await requireTeacher(request, env);
    const body = await request.json().catch(() => ({}));

    const promotion = await submitPromotionRequest(env, user.uid, {
      promotedPupilIds: body.promotedPupilIds,
      heldBackPupilIds: body.heldBackPupilIds,
    });

    return { status: 200, body: { ok: true, promotion } };
  }

  return null;
}
