/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Teacher Roster Resolution
 *
 * Ported from loadAssignedClasses() / loadSubjects() in the old
 * js/teacher.js. This was the very first thing the teacher portal
 * did on load — a direct Firestore query for "which classes is
 * this teacher assigned to", then every pupil in those classes,
 * then every subject across them. It's the foundation almost every
 * other teacher-portal feature (results, attendance, remarks,
 * traits) builds on, so it moves first.
 */

import { getDocument, runQuery } from "../../firebase/firestore.js";

function inFilter(field, values) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: "IN",
      value: {
        arrayValue: {
          values: values.map((v) => ({ stringValue: v })),
        },
      },
    },
  };
}

function equalsFilter(field, value) {
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: "EQUAL",
      value: { stringValue: value },
    },
  };
}

/**
 * Firestore's "IN" operator caps at 10 values, so class IDs are
 * queried in batches of 10 — same batching the browser code did.
 */
async function getPupilsForClasses(env, classIds) {
  if (classIds.length === 0) return [];

  const allPupils = [];

  for (let i = 0; i < classIds.length; i += 10) {
    const batch = classIds.slice(i, i + 10);

    const batchPupils = await runQuery(env, {
      from: [{ collectionId: "pupils" }],
      where: inFilter("class.id", batch),
    });

    allPupils.push(...batchPupils.filter((p) => p.status !== "alumni"));
  }

  return allPupils.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function getTeacherRoster(env, teacherUid) {
  const teacherData = await getDocument(env, "teachers", teacherUid);
  const teacherName = teacherData?.name || null;

  const rawClasses = await runQuery(env, {
    from: [{ collectionId: "classes" }],
    where: equalsFilter("teacherId", teacherUid),
  });

  const assignedClasses = rawClasses
    .map((doc) => ({
      id: doc.id,
      name: doc.name || "Unnamed Class",
      subjects: Array.isArray(doc.subjects) ? doc.subjects : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (assignedClasses.length === 0) {
    return {
      teacherName,
      classes: [],
      pupils: [],
      subjects: [],
    };
  }

  const subjectSet = new Set();
  assignedClasses.forEach((cls) => {
    cls.subjects.forEach((subject) => {
      // Subjects can be stored as plain strings or {name, ...} objects.
      const name = typeof subject === "string" ? subject : subject?.name;
      if (name) subjectSet.add(name);
    });
  });

  const classIds = assignedClasses.map((c) => c.id);
  const pupils = await getPupilsForClasses(env, classIds);

  return {
    teacherName,
    classes: assignedClasses,
    pupils,
    subjects: Array.from(subjectSet).sort(),
  };
}
