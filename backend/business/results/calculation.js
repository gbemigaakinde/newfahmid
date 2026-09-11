/**
 * FAHMID SCHOOL MANAGEMENT SYSTEM
 * Results Calculation
 *
 * Pure, deterministic result calculations.
 *
 * No Firestore.
 * No authentication.
 * No HTTP.
 * No client trust.
 */

function toNumber(
  value,
  fallback = 0
) {
  const number =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Calculate total from known raw score fields.
 *
 * Legacy Fahmid results use:
 *   caScore
 *   examScore
 *
 * Therefore:
 *   total = CA + Exam
 *
 * Generic components are also supported.
 */
export function calculateTotal(
  result
) {
  const ca =
    result.caScore === null ||
    result.caScore === undefined
      ? null
      : toNumber(
          result.caScore
        );

  const exam =
    result.examScore === null ||
    result.examScore === undefined
      ? null
      : toNumber(
          result.examScore
        );

  if (
    ca !== null ||
    exam !== null
  ) {
    return (
      (ca || 0) +
      (exam || 0)
    );
  }

  if (
    result.components &&
    typeof result.components ===
      "object"
  ) {
    let total = 0;

    for (
      const value of Object.values(
        result.components
      )
    ) {
      if (
        value !== null &&
        value !== undefined
      ) {
        total += toNumber(
          value
        );
      }
    }

    return total;
  }

  return 0;
}

/**
 * Calculate percentage only when an authoritative maximum
 * has explicitly been supplied.
 *
 * Accepted maximums:
 *   rules.maxTotal
 *   rules.totalMax
 *
 * We do NOT assume that the historical exam was out of 100.
 */
export function calculatePercentage(
  total,
  rules = {}
) {
  const maxTotal =
    rules.maxTotal ??
    rules.totalMax ??
    null;

  if (
    maxTotal === null ||
    maxTotal === undefined
  ) {
    return null;
  }

  const maximum =
    toNumber(
      maxTotal,
      NaN
    );

  if (
    !Number.isFinite(maximum) ||
    maximum <= 0
  ) {
    return null;
  }

  return Number(
    (
      (total / maximum) *
      100
    ).toFixed(2)
  );
}

/**
 * Calculate a grade from explicitly configured grade bands.
 *
 * No default historical thresholds are embedded.
 */
export function calculateGrade(
  percentage,
  rules = {}
) {
  if (
    percentage === null ||
    percentage === undefined
  ) {
    return {
      grade: null,
      gradePoint: null,
      remark: null,
    };
  }

  const bands =
    Array.isArray(
      rules.gradeBands
    )
      ? rules.gradeBands
      : null;

  if (
    !bands ||
    bands.length === 0
  ) {
    return {
      grade: null,
      gradePoint: null,
      remark: null,
    };
  }

  const ordered =
    [...bands].sort(
      (a, b) =>
        Number(b.min) -
        Number(a.min)
    );

  const matched =
    ordered.find(
      (band) =>
        percentage >=
        Number(band.min)
    );

  if (!matched) {
    return {
      grade: null,
      gradePoint: null,
      remark: null,
    };
  }

  return {
    grade:
      matched.grade ??
      null,

    gradePoint:
      matched.gradePoint ??
      null,

    remark:
      matched.remark ??
      null,
  };
}

/**
 * Calculate one authoritative result.
 */
export function calculateResult(
  result,
  rules = {}
) {
  const total =
    calculateTotal(
      result
    );

  const percentage =
    calculatePercentage(
      total,
      rules
    );

  const gradeData =
    calculateGrade(
      percentage,
      rules
    );

  return {
    total,
    percentage,

    grade:
      gradeData.grade,

    gradePoint:
      gradeData.gradePoint,

    remark:
      gradeData.remark,
  };
}

/**
 * Calculate class positions.
 *
 * Standard competition ranking:
 *
 * 100 -> 1
 * 100 -> 1
 * 90  -> 3
 * 80  -> 4
 *
 * `items` can contain either:
 *   total
 *
 * or another numeric field supplied through scoreField.
 */
export function calculatePositions(
  items,
  {
    scoreField = "total",
    descending = true,
  } = {}
) {
  if (!Array.isArray(items)) {
    return [];
  }

  const ranked =
    items.map(
      (item, index) => ({
        item,
        index,
        score:
          toNumber(
            item?.[scoreField],
            0
          ),
      })
    );

  ranked.sort(
    (a, b) => {
      const difference =
        descending
          ? b.score - a.score
          : a.score - b.score;

      if (
        difference !== 0
      ) {
        return difference;
      }

      return (
        a.index - b.index
      );
    }
  );

  const positions =
    new Array(
      ranked.length
    );

  let previousScore = null;
  let previousPosition = 0;

  ranked.forEach(
    (entry, index) => {
      let position;

      if (
        previousScore !== null &&
        entry.score ===
          previousScore
      ) {
        position =
          previousPosition;
      } else {
        position =
          index + 1;
      }

      positions[
        entry.index
      ] = position;

      previousScore =
        entry.score;

      previousPosition =
        position;
    }
  );

  return positions;
}

/**
 * Calculate the arithmetic average of numeric values.
 */
export function calculateAverage(
  values
) {
  if (!Array.isArray(values)) {
    return null;
  }

  const numbers =
    values
      .map((value) =>
        toNumber(
          value,
          NaN
        )
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          )
      );

  if (
    numbers.length === 0
  ) {
    return null;
  }

  const total =
    numbers.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  return Number(
    (
      total /
      numbers.length
    ).toFixed(2)
  );
}
