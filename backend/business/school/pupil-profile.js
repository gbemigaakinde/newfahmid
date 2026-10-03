/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Pupil Profile Resolution
 *
 * Ported from the browser-side loadPupilProfile() in js/pupil.js.
 * The original used live Firestore onSnapshot listeners on the
 * pupil doc and class doc; the Worker has no equivalent push
 * mechanism, so the frontend now polls this endpoint every 30-60s
 * instead of subscribing to live updates.
 */

import { getDocument } from "../../firebase/firestore.js";
import { getClassDetails } from "./classes.js";
import { getTeacherByUid } from "../../api/school.js";

/**
 * Religion-based filtering of Christian/Islamic Religious Studies —
 * a pupil only sees the subject matching their own religion.
 */
export function filterSubjectsByReligion(subjects, religion) {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    return subjects || [];
  }

  const normalizedReligion = String(religion || "").trim().toLowerCase();

  const isChristianRS = (name) => {
    const n = String(name || "").toLowerCase();
    return (
      n.includes("christian religious") ||
      n === "crs" ||
      n === "crk" ||
      n.includes("bible knowledge")
    );
  };

  const isIslamicRS = (name) => {
    const n = String(name || "").toLowerCase();
    return (
      n.includes("islamic religious") ||
      n === "irs" ||
      n === "irk" ||
      n.includes("islamic studies")
    );
  };

  if (normalizedReligion === "muslim" || normalizedReligion === "islam") {
    return subjects.filter((s) => !isChristianRS(s));
  }

  if (normalizedReligion === "christian" || normalizedReligion === "christianity") {
    return subjects.filter((s) => !isIslamicRS(s));
  }

  return subjects;
}

function getClassIdFromPupilData(classData) {
  if (!classData) return null;
  if (typeof classData === "object" && classData.id) return classData.id;
  return null;
}

function getClassNameFromPupilData(classData) {
  if (!classData) return "Unknown";
  if (typeof classData === "object" && classData.name) return classData.name;
  if (typeof classData === "string") return classData;
  return "Unknown";
}

/**
 * Full profile for the pupil portal's summary cards: personal
 * details, current class, class teacher, and this pupil's
 * religion-filtered subject list.
 */
export async function getPupilProfile(env, pupilId) {
  const pupilData = await getDocument(env, "pupils", pupilId);

  if (!pupilData) {
    throw new Error("Pupil profile not found.");
  }

  const isAlumni = pupilData.status === "alumni" || pupilData.isActive === false;

  const base = {
    pupilId,
    name: pupilData.name || "-",
    dob: pupilData.dob || "-",
    admissionNo: pupilData.admissionNo || null,
    gender: pupilData.gender || "-",
    contact: pupilData.contact || pupilData.phone || "-",
    address: pupilData.address || "-",
    religion: pupilData.religion || null,
    isAlumni,
  };

  if (isAlumni) {
    return {
      ...base,
      class: getClassNameFromPupilData(pupilData.class),
      teacher: "-",
      subjects: [],
    };
  }

  const classId = getClassIdFromPupilData(pupilData.class);
  if (!classId) {
    return {
      ...base,
      class: getClassNameFromPupilData(pupilData.class),
      teacher: "-",
      subjects: [],
    };
  }

  const classDetails = await getClassDetails(env, classId);
  if (!classDetails) {
    return {
      ...base,
      class: getClassNameFromPupilData(pupilData.class),
      teacher: "-",
      subjects: [],
    };
  }

  let teacherName = "-";
  if (classDetails.teacherId) {
    const teacherData = await getTeacherByUid(env, classDetails.teacherId);
    if (teacherData?.name) teacherName = teacherData.name;
  }

  const rawSubjects = Array.isArray(classDetails.subjects)
    ? classDetails.subjects.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean)
    : [];

  const subjects = filterSubjectsByReligion(rawSubjects, pupilData.religion);

  return {
    ...base,
    class: classDetails.name || getClassNameFromPupilData(pupilData.class),
    teacher: teacherName,
    subjects,
  };
}
