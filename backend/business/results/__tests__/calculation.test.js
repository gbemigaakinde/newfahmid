import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTotal,
  calculatePercentage,
  calculateGrade,
  calculateResult,
  calculatePositions,
  calculateAverage,
} from "../calculation.js";
test("calculateTotal adds CA and exam scores", () => {
  assert.equal(
    calculateTotal({
      caScore: 25,
      examScore: 60,
    }),
    85
  );
});
test("calculateTotal handles a missing CA score", () => {
  assert.equal(
    calculateTotal({
      examScore: 60,
    }),
    60
  );
});
test("calculateTotal handles a missing exam score", () => {
  assert.equal(
    calculateTotal({
      caScore: 25,
    }),
    25
  );
});
test("calculateTotal supports generic components", () => {
  assert.equal(
    calculateTotal({
      components: {
        ca: 20,
        exam: 55,
        project: 10,
      },
    }),
    85
  );
});
test("calculateTotal returns zero for an empty result", () => {
  assert.equal(
    calculateTotal({}),
    0
  );
});
test("calculatePercentage requires an explicit maximum", () => {
  assert.equal(
    calculatePercentage(75),
    null
  );
});
test("calculatePercentage uses maxTotal", () => {
  assert.equal(
    calculatePercentage(75, {
      maxTotal: 100,
    }),
    75
  );
});
test("calculatePercentage uses totalMax", () => {
  assert.equal(
    calculatePercentage(45, {
      totalMax: 60,
    }),
    75
  );
});
test("calculatePercentage rounds to two decimal places", () => {
  assert.equal(
    calculatePercentage(33, {
      maxTotal: 60,
    }),
    55
  );
  assert.equal(
    calculatePercentage(1, {
      maxTotal: 3,
    }),
    33.33
  );
});
test("calculateGrade does not invent grading bands", () => {
  assert.deepEqual(
    calculateGrade(80),
    {
      grade: null,
      gradePoint: null,
      remark: null,
    }
  );
});
test("calculateGrade selects the highest matching configured band", () => {
  const rules = {
    gradeBands: [
      {
        min: 75,
        grade: "A1",
        gradePoint: 4,
        remark: "Excellent",
      },
      {
        min: 70,
        grade: "B2",
        gradePoint: 3,
        remark: "Very Good",
      },
      {
        min: 60,
        grade: "B3",
        gradePoint: 2.5,
        remark: "Good",
      },
    ],
  };
  assert.deepEqual(
    calculateGrade(76, rules),
    {
      grade: "A1",
      gradePoint: 4,
      remark: "Excellent",
    }
  );
  assert.deepEqual(
    calculateGrade(72, rules),
    {
      grade: "B2",
      gradePoint: 3,
      remark: "Very Good",
    }
  );
  assert.deepEqual(
    calculateGrade(60, rules),
    {
      grade: "B3",
      gradePoint: 2.5,
      remark: "Good",
    }
  );
});
test("calculateGrade returns nulls below the lowest configured band", () => {
  const rules = {
    gradeBands: [
      {
        min: 50,
        grade: "C",
      },
    ],
  };
  assert.deepEqual(
    calculateGrade(49, rules),
    {
      grade: null,
      gradePoint: null,
      remark: null,
    }
  );
});
test("calculateResult combines total, percentage and grade", () => {
  const result = calculateResult(
    {
      caScore: 20,
      examScore: 60,
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
        {
          min: 50,
          grade: "C",
          gradePoint: 2,
          remark: "Pass",
        },
      ],
    }
  );
  assert.deepEqual(
    result,
    {
      total: 80,
      percentage: 80,
      grade: "A1",
      gradePoint: 4,
      remark: "Excellent",
    }
  );
});
test("calculatePositions uses standard competition ranking", () => {
  const positions = calculatePositions([
    { total: 100 },
    { total: 100 },
    { total: 90 },
    { total: 80 },
  ]);
  assert.deepEqual(
    positions,
    [1, 1, 3, 4]
  );
});
test("calculatePositions preserves original item order", () => {
  const positions = calculatePositions([
    { total: 80 },
    { total: 100 },
    { total: 90 },
  ]);
  assert.deepEqual(
    positions,
    [3, 1, 2]
  );
});
test("calculatePositions supports a custom score field", () => {
  const positions = calculatePositions(
    [
      { score: 60 },
      { score: 80 },
      { score: 70 },
    ],
    {
      scoreField: "score",
    }
  );
  assert.deepEqual(
    positions,
    [3, 1, 2]
  );
});
test("calculatePositions supports ascending ranking", () => {
  const positions = calculatePositions(
    [
      { score: 60 },
      { score: 80 },
      { score: 70 },
    ],
    {
      scoreField: "score",
      descending: false,
    }
  );
  assert.deepEqual(
    positions,
    [1, 3, 2]
  );
});
test("calculateAverage returns an arithmetic mean", () => {
  assert.equal(
    calculateAverage([
      70,
      80,
      90,
    ]),
    80
  );
});
test("calculateAverage rounds to two decimal places", () => {
  assert.equal(
    calculateAverage([
      70,
      80,
      81,
    ]),
    77
  );
  assert.equal(
    calculateAverage([
      10,
      11,
    ]),
    10.5
  );
});
test("calculateAverage ignores non-numeric values", () => {
  assert.equal(
    calculateAverage([
      70,
      "80",
      null,
      "not-a-number",
    ]),
    75
  );
});
test("calculateAverage returns null when no numeric values exist", () => {
  assert.equal(
    calculateAverage([
      null,
      undefined,
      "abc",
    ]),
    null
  );
});
