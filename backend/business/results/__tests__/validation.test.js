import test from "node:test";
import assert from "node:assert/strict";
import {
  ResultValidationError,
  validateSession,
  validateTerm,
  validateClassId,
  validatePupilId,
  validateTeacherId,
  validateSubject,
  validateSubjectId,
  validateScore,
  validateResultIdentity,
  validateRawScores,
  stripCalculatedFields,
  validateDraftInput,
  validateGradeBands,
} from "../validation.js";
test("validateSession accepts a normal session", () => {
  assert.equal(
    validateSession("2026/2027"),
    "2026/2027"
  );
});
test("validateSession rejects missing values", () => {
  assert.throws(
    () => validateSession(""),
    ResultValidationError
  );
});
test("validateTerm accepts a normal term", () => {
  assert.equal(
    validateTerm("First Term"),
    "First Term"
  );
});
test("validateClassId accepts an ID", () => {
  assert.equal(
    validateClassId("class-001"),
    "class-001"
  );
});
test("validatePupilId accepts an ID", () => {
  assert.equal(
    validatePupilId("pupil-001"),
    "pupil-001"
  );
});
test("validateTeacherId accepts an ID", () => {
  assert.equal(
    validateTeacherId("teacher-001"),
    "teacher-001"
  );
});
test("validateSubject accepts a subject name", () => {
  assert.equal(
    validateSubject("Mathematics"),
    "Mathematics"
  );
});
test("validateSubjectId accepts a subject ID", () => {
  assert.equal(
    validateSubjectId("math"),
    "math"
  );
});
test("validateScore accepts numeric strings", () => {
  assert.equal(
    validateScore("25", "caScore"),
    25
  );
});
test("validateScore rejects NaN", () => {
  assert.throws(
    () =>
      validateScore(
        "abc",
        "caScore"
      ),
    ResultValidationError
  );
});
test("validateScore rejects negative scores", () => {
  assert.throws(
    () =>
      validateScore(
        -1,
        "caScore"
      ),
    ResultValidationError
  );
});
test("validateScore rejects values above configured maximum", () => {
  assert.throws(
    () =>
      validateScore(
        101,
        "score",
        {
          max: 100,
        }
      ),
    ResultValidationError
  );
});
test("optional score fields can be omitted", () => {
  assert.equal(
    validateScore(
      undefined,
      "examScore"
    ),
    null
  );
});
test("required score fields cannot be omitted", () => {
  assert.throws(
    () =>
      validateScore(
        undefined,
        "examScore",
        {
          required: true,
        }
      ),
    ResultValidationError
  );
});
test("validateResultIdentity returns normalized identity", () => {
  const result =
    validateResultIdentity({
      pupilId: "pupil-1",
      classId: "class-1",
      subject: "Mathematics",
      subjectId: "math",
      session: "2026/2027",
      term: "First Term",
      teacherId: "teacher-1",
    });
  assert.deepEqual(
    result,
    {
      pupilId: "pupil-1",
      classId: "class-1",
      subject: "Mathematics",
      subjectId: "math",
      session: "2026/2027",
      term: "First Term",
      teacherId: "teacher-1",
    }
  );
});
test("validateResultIdentity accepts legacy teacherUid", () => {
  const result =
    validateResultIdentity({
      pupilId: "pupil-1",
      classId: "class-1",
      subject: "Mathematics",
      session: "2026/2027",
      term: "First Term",
      teacherUid: "teacher-1",
    });
  assert.equal(
    result.teacherId,
    "teacher-1"
  );
});
test("validateRawScores normalizes score strings", () => {
  const result =
    validateRawScores({
      caScore: "20",
      examScore: "60",
    });
  assert.deepEqual(
    result,
    {
      caScore: 20,
      examScore: 60,
      components: null,
    }
  );
});
test("validateRawScores supports components", () => {
  const result =
    validateRawScores({
      components: {
        test: "20",
        exam: 60,
      },
    });
  assert.deepEqual(
    result,
    {
      caScore: null,
      examScore: null,
      components: {
        test: 20,
        exam: 60,
      },
    }
  );
});
test("validateRawScores rejects component arrays", () => {
  assert.throws(
    () =>
      validateRawScores({
        components: [20, 60],
      }),
    ResultValidationError
  );
});
test("stripCalculatedFields removes client-controlled calculated values", () => {
  const cleaned =
    stripCalculatedFields({
      pupilId: "pupil-1",
      classId: "class-1",
      subject: "Mathematics",
      session: "2026/2027",
      term: "First Term",
      teacherId: "teacher-1",
      caScore: 20,
      examScore: 60,
      total: 999,
      score: 999,
      percentage: 100,
      average: 100,
      grade: "A1",
      gradePoint: 4,
      remark: "Excellent",
      position: 1,
      rank: 1,
      approvedBy: "attacker",
      approvedAt: "fake",
      publishedAt: "fake",
      locked: true,
      lockedAt: "fake",
      lockedBy: "attacker",
      status: "approved",
    });
  assert.equal(
    cleaned.total,
    undefined
  );
  assert.equal(
    cleaned.score,
    undefined
  );
  assert.equal(
    cleaned.percentage,
    undefined
  );
  assert.equal(
    cleaned.grade,
    undefined
  );
  assert.equal(
    cleaned.position,
    undefined
  );
  assert.equal(
    cleaned.approvedBy,
    undefined
  );
  assert.equal(
    cleaned.locked,
    undefined
  );
  assert.equal(
    cleaned.status,
    undefined
  );
  assert.equal(
    cleaned.caScore,
    20
  );
  assert.equal(
    cleaned.examScore,
    60
  );
});
test("validateDraftInput rejects an invalid result object", () => {
  assert.throws(
    () =>
      validateDraftInput({
        pupilId: "pupil-1",
        classId: "class-1",
        subject: "Mathematics",
        session: "2026/2027",
        term: "First Term",
      }),
    ResultValidationError
  );
});
test("validateDraftInput returns normalized raw result data", () => {
  const result =
    validateDraftInput({
      pupilId: "pupil-1",
      classId: "class-1",
      subject: "Mathematics",
      session: "2026/2027",
      term: "First Term",
      teacherId: "teacher-1",
      caScore: "25",
      examScore: "60",
      total: 999,
      grade: "A1",
      position: 1,
    });
  assert.deepEqual(
    result,
    {
      pupilId: "pupil-1",
      classId: "class-1",
      session: "2026/2027",
      term: "First Term",
      subject: "Mathematics",
      subjectId: null,
      teacherId: "teacher-1",
      caScore: 25,
      examScore: 60,
      components: null,
    }
  );
});
test("validateGradeBands accepts explicit configuration", () => {
  const bands =
    validateGradeBands([
      {
        min: 50,
        grade: "C",
      },
      {
        min: 75,
        grade: "A1",
        gradePoint: 4,
        remark: "Excellent",
      },
    ]);
  assert.deepEqual(
    bands,
    [
      {
        min: 75,
        grade: "A1",
        gradePoint: 4,
        remark: "Excellent",
      },
      {
        min: 50,
        grade: "C",
        gradePoint: null,
        remark: null,
      },
    ]
  );
});
test("validateGradeBands rejects invalid configuration", () => {
  assert.throws(
    () =>
      validateGradeBands([
        {
          min: -10,
          grade: "A1",
        },
      ]),
    ResultValidationError
  );
});
test("validateGradeBands rejects a missing grade", () => {
  assert.throws(
    () =>
      validateGradeBands([
        {
          min: 75,
        },
      ]),
    ResultValidationError
  );
});
