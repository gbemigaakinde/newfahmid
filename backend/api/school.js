import {
  getDocument,
  runQuery,
} from "../firebase/firestore.js";

const DEFAULT_SETTINGS = {
  term: "First Term",
  session: "2025/2026",

  currentSession: {
    name: "2025/2026",
    startYear: 2025,
    endYear: 2026,
    startDate: null,
    endDate: null,
  },

  resumptionDate: null,
  promotionPeriodActive: false,
};

export async function getCurrentSettings(env) {
  const settings = await getDocument(
    env,
    "settings",
    "current"
  );

  if (!settings) {
    return DEFAULT_SETTINGS;
  }

  const currentSession =
    settings.currentSession &&
    typeof settings.currentSession === "object"
      ? settings.currentSession
      : null;

  let sessionName =
    settings.session ||
    DEFAULT_SETTINGS.session;

  let sessionData =
    DEFAULT_SETTINGS.currentSession;

  if (currentSession) {
    sessionName =
      currentSession.name ||
      `${currentSession.startYear}/${currentSession.endYear}`;

    sessionData = {
      name: sessionName,

      startYear:
        currentSession.startYear ??
        DEFAULT_SETTINGS.currentSession.startYear,

      endYear:
        currentSession.endYear ??
        DEFAULT_SETTINGS.currentSession.endYear,

      startDate:
        currentSession.startDate ?? null,

      endDate:
        currentSession.endDate ?? null,
    };
  }

  return {
    term:
      settings.term ||
      DEFAULT_SETTINGS.term,

    session: sessionName,

    currentSession: sessionData,

    resumptionDate:
      settings.resumptionDate ?? null,

    promotionPeriodActive:
      Boolean(settings.promotionPeriodActive),
  };
}

export async function getClassHierarchy(env) {
  const hierarchy = await getDocument(
    env,
    "settings",
    "classHierarchy"
  );

  if (!hierarchy) {
    return {
      orderedClassIds: [],
      lastUpdated: null,
    };
  }

  return {
    ...hierarchy,

    orderedClassIds:
      Array.isArray(hierarchy.orderedClassIds)
        ? hierarchy.orderedClassIds
        : [],
  };
}

export async function getClassById(
  env,
  classId
) {
  if (!classId) {
    return null;
  }

  return getDocument(
    env,
    "classes",
    classId
  );
}

export async function getAllClasses(env) {
  return runQuery(
    env,
    "classes",
    {
      orderBy: [
        {
          field: {
            fieldPath: "name",
          },
          direction: "ASCENDING",
        },
      ],
    }
  );
}

export async function getPupilById(
  env,
  pupilId
) {
  if (!pupilId) {
    return null;
  }

  return getDocument(
    env,
    "pupils",
    pupilId
  );
}

export async function getTeacherByUid(
  env,
  uid
) {
  if (!uid) {
    return null;
  }

  return getDocument(
    env,
    "teachers",
    uid
  );
}
