import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApprovalOperations,
} from "../approval.js";

test(
  "buildApprovalOperations creates an atomic approval write set",
  () => {
    const publishedResults = [
      {
        id:
          "pupil-1_First_English",
        pupilId:
          "pupil-1",
        classId:
          "class-1",
        subject:
          "English",
        session:
          "2026/2027",
        term:
          "First",
        caScore:
          25,
        examScore:
          60,
        total:
          85,
        percentage:
          85,
        grade:
          "A1",
        remark:
          "Excellent",
        status:
          "approved",
      },
    ];

    const approvedSubmission = {
      id:
        "class-1_2026/2027_First_English",
      classId:
        "class-1",
      session:
        "2026/2027",
      term:
        "First",
      subject:
        "English",
      teacherUid:
        "teacher-1",
      status:
        "approved",
      approvedBy:
        "admin-1",
    };

    const lock = {
      id:
        "class-1_2026/2027_First_English",
      classId:
        "class-1",
      session:
        "2026/2027",
      term:
        "First",
      subject:
        "English",
      locked:
        true,
      lockedBy:
        "admin-1",
    };

    const operations =
      buildApprovalOperations({
        publishedResults,
        approvedSubmission,
        lock,
        submissionUpdateTime:
          "2026-09-11T12:00:00.123456Z",
      });

    assert.equal(
      operations.length,
      3,
    );

    const resultWrite =
      operations[0];

    assert.equal(
      resultWrite.type,
      "set",
    );

    assert.equal(
      resultWrite.collection,
      "results",
    );

    assert.equal(
      resultWrite.documentId,
      "pupil-1_First_English",
    );

    assert.deepEqual(
      resultWrite.precondition,
      {
        exists:
          false,
      },
    );

    const submissionWrite =
      operations[1];

    assert.equal(
      submissionWrite.collection,
      "result_submissions",
    );

    assert.deepEqual(
      submissionWrite.precondition,
      {
        updateTime:
          "2026-09-11T12:00:00.123456Z",
      },
    );

    const lockWrite =
      operations[2];

    assert.equal(
      lockWrite.collection,
      "result_locks",
    );

    assert.deepEqual(
      lockWrite.precondition,
      {
        exists:
          false,
      },
    );
  },
);

test(
  "every published result receives an exists=false precondition",
  () => {
    const publishedResults = [
      {
        id:
          "pupil-1_First_Maths",
        pupilId:
          "pupil-1",
      },
      {
        id:
          "pupil-2_First_Maths",
        pupilId:
          "pupil-2",
      },
      {
        id:
          "pupil-3_First_Maths",
        pupilId:
          "pupil-3",
      },
    ];

    const operations =
      buildApprovalOperations({
        publishedResults,

        approvedSubmission: {
          id:
            "class-1_session_First_Maths",
          status:
            "approved",
        },

        lock: {
          id:
            "class-1_session_First_Maths",
          locked:
            true,
        },

        submissionUpdateTime:
          "2026-09-11T12:00:00.123456Z",
      });

    assert.equal(
      operations.length,
      5,
    );

    for (
      const operation of
      operations.slice(0, 3)
    ) {
      assert.deepEqual(
        operation.precondition,
        {
          exists:
            false,
        },
      );
    }
  },
);

test(
  "submission write falls back to exists=true when updateTime is unavailable",
  () => {
    const operations =
      buildApprovalOperations({
        publishedResults: [
          {
            id:
              "pupil-1_First_Maths",
          },
        ],

        approvedSubmission: {
          id:
            "class-1_session_First_Maths",
        },

        lock: {
          id:
            "class-1_session_First_Maths",
        },

        submissionUpdateTime:
          null,
      });

    assert.deepEqual(
      operations[1]
        .precondition,
      {
        exists:
          true,
      },
    );
  },
);

test(
  "approval operation ordering is results, submission, then lock",
  () => {
    const operations =
      buildApprovalOperations({
        publishedResults: [
          {
            id:
              "result-1",
          },
          {
            id:
              "result-2",
          },
        ],

        approvedSubmission: {
          id:
            "submission-1",
        },

        lock: {
          id:
            "lock-1",
        },

        submissionUpdateTime:
          "2026-09-11T12:00:00.123456Z",
      });

    assert.deepEqual(
      operations.map(
        (operation) =>
          operation.collection,
      ),
      [
        "results",
        "results",
        "result_submissions",
        "result_locks",
      ],
    );
  },
);
