import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApprovalOperations,
} from "./approval.js";

test("buildApprovalOperations creates result writes", () => {
  const operations =
    buildApprovalOperations({
      publishedResults: [
        {
          id: "pupil-1_term-1_Mathematics",
          pupilId: "pupil-1",
          total: 80,
        },
        {
          id: "pupil-2_term-1_Mathematics",
          pupilId: "pupil-2",
          total: 70,
        },
      ],
      approvedSubmission: {
        id: "class-1_2026-2027_term-1_Mathematics",
        status: "approved",
      },
      lock: {
        id: "class-1_2026-2027_term-1_Mathematics",
        locked: true,
      },
      submissionUpdateTime:
        "2026-09-11T10:00:00.000Z",
    });

  assert.equal(
    operations.length,
    4,
  );

  assert.equal(
    operations[0].type,
    "set",
  );

  assert.equal(
    operations[0].collection,
    "results",
  );

  assert.deepEqual(
    operations[0].precondition,
    {
      exists: false,
    },
  );

  assert.equal(
    operations[1].collection,
    "results",
  );

  assert.deepEqual(
    operations[1].precondition,
    {
      exists: false,
    },
  );
});

test("buildApprovalOperations protects submission with updateTime", () => {
  const operations =
    buildApprovalOperations({
      publishedResults: [],
      approvedSubmission: {
        id: "submission-1",
        status: "approved",
      },
      lock: {
        id: "lock-1",
        locked: true,
      },
      submissionUpdateTime:
        "2026-09-11T10:00:00.000Z",
    });

  const submissionOperation =
    operations.find(
      (operation) =>
        operation.collection ===
        "result_submissions",
    );

  assert.ok(
    submissionOperation,
  );

  assert.deepEqual(
    submissionOperation.precondition,
    {
      updateTime:
        "2026-09-11T10:00:00.000Z",
    },
  );
});

test("buildApprovalOperations falls back to exists precondition", () => {
  const operations =
    buildApprovalOperations({
      publishedResults: [],
      approvedSubmission: {
        id: "submission-1",
        status: "approved",
      },
      lock: {
        id: "lock-1",
        locked: true,
      },
      submissionUpdateTime: null,
    });

  const submissionOperation =
    operations.find(
      (operation) =>
        operation.collection ===
        "result_submissions",
    );

  assert.deepEqual(
    submissionOperation.precondition,
    {
      exists: true,
    },
  );
});

test("buildApprovalOperations creates a lock only if it does not already exist", () => {
  const operations =
    buildApprovalOperations({
      publishedResults: [],
      approvedSubmission: {
        id: "submission-1",
        status: "approved",
      },
      lock: {
        id: "lock-1",
        locked: true,
      },
      submissionUpdateTime:
        "2026-09-11T10:00:00.000Z",
    });

  const lockOperation =
    operations.find(
      (operation) =>
        operation.collection ===
        "result_locks",
    );

  assert.ok(
    lockOperation,
  );

  assert.equal(
    lockOperation.type,
    "set",
  );

  assert.equal(
    lockOperation.documentId,
    "lock-1",
  );

  assert.deepEqual(
    lockOperation.precondition,
    {
      exists: false,
    },
  );
});

test("buildApprovalOperations keeps all writes in one ordered operation list", () => {
  const operations =
    buildApprovalOperations({
      publishedResults: [
        {
          id: "result-1",
        },
        {
          id: "result-2",
        },
        {
          id: "result-3",
        },
      ],
      approvedSubmission: {
        id: "submission-1",
      },
      lock: {
        id: "lock-1",
      },
      submissionUpdateTime:
        "2026-09-11T10:00:00.000Z",
    });

  assert.deepEqual(
    operations.map(
      (operation) =>
        operation.collection,
    ),
    [
      "results",
      "results",
      "results",
      "result_submissions",
      "result_locks",
    ],
  );
});
