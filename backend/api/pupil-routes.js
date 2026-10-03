/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Pupil Profile & Results Routes
 */

import { requireUser, AuthorizationError } from "../auth/authorize.js";
import { getPupilProfile } from "../business/school/pupil-profile.js";
import {
  getAvailablePastSessions,
  getApprovedResultsForSession,
  isAlumniPupil,
} from "../business/results/pupil-results.js";
import { getCurrentSettings } from "./school.js";

/**
 * A pupil may only ever look up their own records. Staff
 * (admin/teacher) may pass ?pupilId= to look up any pupil.
 */
async function resolvePupilId(request, user) {
  const url = new URL(request.url);
  const requestedPupilId = url.searchParams.get("pupilId");

  if (!requestedPupilId || requestedPupilId === user.uid) {
    return user.uid;
  }

  if (user.role === "admin" || user.role === "teacher") {
    return requestedPupilId;
  }

  throw new AuthorizationError("You may only view your own records.");
}

export async function handlePupilRoute(request, env, path) {
  if (request.method !== "GET") {
    return null;
  }

  if (path === "/api/pupil/profile") {
    const user = await requireUser(request, env);
    const pupilId = await resolvePupilId(request, user);
    const profile = await getPupilProfile(env, pupilId);

    return { status: 200, body: { ok: true, profile } };
  }

  if (path === "/api/pupil/results/sessions") {
    const user = await requireUser(request, env);
    const pupilId = await resolvePupilId(request, user);

    const settings = await getCurrentSettings(env);
    const alumni = await isAlumniPupil(env, pupilId);
    const pastSessions = await getAvailablePastSessions(env, pupilId, settings.session, alumni);

    const sessions = alumni ? [] : ["current"];
    sessions.push(...pastSessions);

    return {
      status: 200,
      body: {
        ok: true,
        isAlumni: alumni,
        currentSession: settings.session,
        sessions,
      },
    };
  }

  if (path === "/api/pupil/results") {
    const user = await requireUser(request, env);
    const pupilId = await resolvePupilId(request, user);

    const url = new URL(request.url);
    const requestedSession = url.searchParams.get("session") || "current";

    let session = requestedSession;
    let displaySessionName;

    if (requestedSession === "current") {
      const settings = await getCurrentSettings(env);
      session = settings.session;
      displaySessionName = `Current Session (${settings.session})`;
    } else {
      displaySessionName = `${requestedSession} Session`;
    }

    const results = await getApprovedResultsForSession(env, pupilId, session);

    return {
      status: 200,
      body: {
        ok: true,
        session,
        displaySessionName,
        results,
      },
    };
  }

  return null;
}
