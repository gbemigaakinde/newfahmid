const TERM_ORDER = {
  "First Term": 1,
  "Second Term": 2,
  "Third Term": 3,
};

function normalizeTerm(term) {
  return String(term || "").trim();
}

export function calculateAdjustedFee(
  pupilData,
  baseFee,
  currentTerm
) {
  const term =
    normalizeTerm(currentTerm);

  const currentOrder =
    TERM_ORDER[term] || 1;

  const admissionTerm =
    normalizeTerm(
      pupilData?.admissionTerm ||
      "First Term"
    );

  const exitTerm =
    normalizeTerm(
      pupilData?.exitTerm ||
      "Third Term"
    );

  const admissionOrder =
    TERM_ORDER[admissionTerm] || 1;

  const exitOrder =
    TERM_ORDER[exitTerm] || 3;

  if (
    currentOrder <
      admissionOrder ||
    currentOrder >
      exitOrder
  ) {
    return 0;
  }

  const base =
    Math.round(
      Number(baseFee) || 0
    );

  const percentAdjustment =
    Number(
      pupilData?.feeAdjustmentPercent
    ) || 0;

  const amountAdjustment =
    Number(
      pupilData?.feeAdjustmentAmount
    ) || 0;

  const percentAdjustmentAmount =
    Math.round(
      base *
        (percentAdjustment / 100)
    );

  const adjustedFee =
    Math.round(
      base +
        percentAdjustmentAmount +
        amountAdjustment
    );

  return Math.max(
    0,
    adjustedFee
  );
}

export function getPreviousSession(
  session
) {
  const value =
    String(session || "").trim();

  const match =
    value.match(
      /^(\d{4})\/(\d{4})$/
    );

  if (!match) {
    return null;
  }

  const start =
    Number(match[1]) - 1;

  const end =
    Number(match[2]) - 1;

  return `${start}/${end}`;
}

export function getPreviousTerm(
  session,
  term
) {
  const normalized =
    normalizeTerm(term);

  if (
    normalized === "Second Term"
  ) {
    return {
      session,
      term: "First Term",
    };
  }

  if (
    normalized === "Third Term"
  ) {
    return {
      session,
      term: "Second Term",
    };
  }

  if (
    normalized === "First Term"
  ) {
    const previousSession =
      getPreviousSession(
        session
      );

    if (!previousSession) {
      return null;
    }

    return {
      session: previousSession,
      term: "Third Term",
    };
  }

  return null;
}

export function makePaymentDocumentId(
  pupilId,
  session,
  term
) {
  const encodedSession =
    String(session || "")
      .replace(
        /\//g,
        "-"
      );

  return `${pupilId}_${encodedSession}_${term}`;
}
