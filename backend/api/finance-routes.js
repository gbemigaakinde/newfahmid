/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Pupil-Facing Finance Routes
 */

import { requireUser, AuthorizationError } from "../auth/authorize.js";
import {
  calculateCurrentOutstanding,
  getPupilPaymentHistory,
} from "../business/finance/outstanding.js";
import { getCurrentSettings } from "./school.js";

/**
 * A pupil may only ever see their own fee/payment data. Staff
 * (admin/teacher) may look up any pupil by passing ?pupilId=.
 */
async function resolvePupilId(request, env, user) {
  const url = new URL(request.url);
  const requestedPupilId = url.searchParams.get("pupilId");

  if (!requestedPupilId || requestedPupilId === user.uid) {
    return user.uid;
  }

  if (user.role === "admin" || user.role === "teacher") {
    return requestedPupilId;
  }

  throw new AuthorizationError("You may only view your own fee information.");
}

export async function handleFinanceRoute(request, env, path) {
  if (request.method !== "GET") {
    return null;
  }

  if (path === "/api/pupil/fees") {
    const user = await requireUser(request, env);
    const pupilId = await resolvePupilId(request, env, user);

    const settings = await getCurrentSettings(env);
    const outstanding = await calculateCurrentOutstanding(
      env,
      pupilId,
      settings.session,
      settings.term
    );

    return {
      status: 200,
      body: {
        ok: true,
        fees: outstanding,
        settings,
      },
    };
  }

  if (path === "/api/pupil/payments") {
    const user = await requireUser(request, env);
    const pupilId = await resolvePupilId(request, env, user);

    const url = new URL(request.url);
    const session = url.searchParams.get("session") || null;
    const term = url.searchParams.get("term") || null;

    const transactions = await getPupilPaymentHistory(env, pupilId, session, term);

    return {
      status: 200,
      body: {
        ok: true,
        transactions,
      },
    };
  }

  return null;
}
