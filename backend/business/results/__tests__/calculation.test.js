import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateTotal,
  calculatePercentage,
  calculateGrade,
  calculateResult,
  calculatePositions,
  calculateAverage,
} from "./calculation.js";

test("calculateTotal adds CA and exam scores", () => {
  assert.equal(
    calculateTotal({
      caScore: 25,
      examScore: 60,
    }),
    85,
  );
});

test("calculateTotal handles missing CA or exam as zero", () => {
  assert.equal(
    calculateTotal({
      caScore: 30,
    }),
    30,
  );

  assert.equal(
    calculateTotal({
      examScore: 70,
    }),
    70,
  );
});

test("calculateTotal supports component-based results", () => {
  assert.equal(
    calculateTotal({
      components: {
        test: 20,
        assignment: 10,
        exam: 55,
      },
    }),
    85,
  );
});

test("calculatePercentage calculates percentage from configured maximum", () => {
  assert.equal(
    calculatePercentage(75, {
      maxTotal: 100,
    }),
    75,
  );

  assert.equal(
    calculatePercentage(45, {
      maxTotal: 60,
    }),
    75,
  );
});

test("calculatePercentage returns null without valid maximum", () => {
  assert.equal(
    calculatePercentage(75),
    null,
  );

  assert.equal(
    calculatePercentage(75, {
      maxTotal: 0,
    }),
    null,
  );
});

test("calculateGrade uses configured grade bands", () => {
  const rules = {
    gradeBands: [
      {
        min: 75,
        grade: "A1",
        gradePoint: 4,
        remark: "Excellent",
      },
      {
        min: 65,
        grade: "B2",
        gradePoint: 3,
        remark: "Very Good",
      },
      {
        min: 50,
        grade: "C",
        gradePoint: 2,
        remark: "Credit",
      },
      {
        min: 40,
        grade: "D",
        gradePoint: 1,
        remark: "Pass",
      },
    ],
  };

  assert.deepEqual(
    calculateGrade(80, rules),
    {
      grade: "A1",
      gradePoint: 4,
      remark: "Excellent",
    },
  );

  assert.deepEqual(
    calculateGrade(68, rules),
    {
      grade: "B2",
      gradePoint: 3,
      remark: "Very Good",
    },
  );

  assert.deepEqual(
    calculateGrade(52, rules),
    {
      grade: "C",
      gradePoint: 2,
      remark: "Credit",
    },
  );

  assert.deepEqual(
    calculateGrade(35, rules),
    {
      grade: null,
      gradePoint: null,
      remark: null,
    },
  );
});

test("calculateGrade does not invent grading rules", () => {
  assert.deepEqual(
    calculateGrade(85),
    {
      grade: null,
      gradePoint: null,
      remark: null,
    },
  );
});

test("calculateResult combines authoritative calculations", () => {
  const result = calculateResult(
    {
      caScore: 25,
      examScore: 55,
    },
    {
      maxTotal: 100,
      gradeBands: [
        {
          min: 75,
          grade: "A1",
          gradePoint: 4,
          remark: "Excellent",
        },
      ],
    },
  );

  assert.deepEqual(
    result,
    {
      total: 80,
      percentage: 80,
      grade: "A1",
      gradePoint: 4,
      remark: "Excellent",
    },
  );
});

test("calculatePositions preserves input order", () => {
  const positions =
    calculatePositions([
      { total: 60 },
      { total: 90 },
      { total: 75 },
    ]);

  assert.deepEqual(
    positions,
    [3, 1, 2],
  );
});

test("calculatePositions gives tied scores the same position", () => {
  const positions =
    calculatePositions([
      { total: 90 },
      { total: 80 },
      { total: 80 },
      { total: 70 },
    ]);

  assert.deepEqual(
    positions,
    [1, 2, 2, 4],
  );
});

test("calculatePositions supports ascending ranking", () => {
  const positions =
    calculatePositions(
      [
        { total: 80 },
        { total: 60 },
        { total: 70 },
      ],
      {
        descending: false,
      },
    );

  assert.deepEqual(
    positions,
    [3, 1, 2],
  );
});

test("calculatePositions returns empty array for invalid input", () => {
  assert.deepEqual(
    calculatePositions(null),
    [],
  );
});

test("calculateAverage calculates the average", () => {
  assert.equal(
    calculateAverage([
      70,
      80,
      90,
    ]),
    80,
  );

  assert.equal(
    calculateAverage([
      70,
      80,
    ]),
    75,
  );
});

test("calculateAverage ignores non-numeric values", () => {
  assert.equal(
    calculateAverage([
      70,
      "80",
      null,
      "invalid",
      undefined,
      90,
    ]),
    80,
  );
});

test("calculateAverage returns null for empty input", () => {
  assert.equal(
    calculateAverage([]),
    null,
  );

  assert.equal(
    calculateAverage(null),
    null,
  );
});
