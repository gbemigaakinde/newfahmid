import assert from "node:assert/strict";
import test from "node:test";
import {
  ResultRosterValidationError,
  getSubjectDefinitions,
  classHasSubject,
  getPupilClassId,
  assertTeacherOwnsClass,
  assertPupilBelongsToClass,
  assertValidResultRoster,
} from "../roster-validation.js";
const teacherUid =
  "teacher-001";
const classA = {
  id: "class-A",
  name: "Primary 5",
  teacherId:
    teacherUid,
  subjects: [
    "Mathematics",
    "English",
    {
      id: "basic-science",
      name: "Basic Science",
      code: "BSC",
    },
  ],
};
const pupilA = {
  id: "pupil-A",
  name: "Pupil A",
  class: {
    id: "class-A",
    name: "Primary 5",
  },
};
const pupilB = {
  id: "pupil-B",
  name: "Pupil B",
  class: {
    id: "class-B",
    name: "Primary 6",
  },
};
test(
  "subject definitions support string subjects",
  () => {
    const subjects =
      getSubjectDefinitions(
        {
          subjects: [
            "Mathematics",
            "English",
          ],
        }
      );
    assert.equal(
      subjects.length,
      2
    );
    assert.equal(
      subjects[0].name,
      "Mathematics"
    );
  }
);
test(
  "subject definitions support object subjects",
  () => {
    const subjects =
      getSubjectDefinitions(
        {
          subjects: [
            {
              id: "math",
              name: "Mathematics",
              code: "MATH",
            },
          ],
        }
      );
    assert.equal(
      subjects.length,
      1
    );
    assert.equal(
      subjects[0].id,
      "math"
    );
    assert.equal(
      subjects[0].code,
      "MATH"
    );
  }
);
test(
  "classHasSubject accepts a subject name",
  () => {
    assert.equal(
      classHasSubject(
        classA,
        "Mathematics"
      ),
      true
    );
  }
);
test(
  "classHasSubject is case-insensitive",
  () => {
    assert.equal(
      classHasSubject(
        classA,
        "mathematics"
      ),
      true
    );
  }
);
test(
  "classHasSubject accepts an object subject ID",
  () => {
    assert.equal(
      classHasSubject(
        classA,
        "Basic Science",
        "basic-science"
      ),
      true
    );
  }
);
test(
  "classHasSubject accepts a subject code",
  () => {
    assert.equal(
      classHasSubject(
        classA,
        "BSC"
      ),
      true
    );
  }
);
test(
  "unknown subject is rejected",
  () => {
    assert.equal(
      classHasSubject(
        classA,
        "Physics"
      ),
      false
    );
  }
);
test(
  "teacher assigned to class is accepted",
  () => {
    assert.doesNotThrow(
      () =>
        assertTeacherOwnsClass(
          classA,
          teacherUid
        )
    );
  }
);
test(
  "teacher not assigned to class is rejected",
  () => {
    assert.throws(
      () =>
        assertTeacherOwnsClass(
          classA,
          "another-teacher"
        ),
      (error) => {
        assert.ok(
          error instanceof
            ResultRosterValidationError
        );
        assert.equal(
          error.status,
          403
        );
        assert.equal(
          error.code,
          "CLASS_ACCESS_DENIED"
        );
        return true;
      }
    );
  }
);
test(
  "missing class is rejected",
  () => {
    assert.throws(
      () =>
        assertTeacherOwnsClass(
          null,
          teacherUid
        ),
      (error) => {
        assert.equal(
          error.status,
          404
        );
        assert.equal(
          error.code,
          "CLASS_NOT_FOUND"
        );
        return true;
      }
    );
  }
);
test(
  "pupil class can be read from class.id",
  () => {
    assert.equal(
      getPupilClassId(
        pupilA
      ),
      "class-A"
    );
  }
);
test(
  "pupil class can be read from classId",
  () => {
    assert.equal(
      getPupilClassId({
        id: "pupil-C",
        classId: "class-C",
      }),
      "class-C"
    );
  }
);
test(
  "pupil class can be read from class.classId",
  () => {
    assert.equal(
      getPupilClassId({
        id: "pupil-D",
        class: {
          classId: "class-D",
        },
      }),
      "class-D"
    );
  }
);
test(
  "pupil belonging to selected class is accepted",
  () => {
    assert.doesNotThrow(
      () =>
        assertPupilBelongsToClass(
          pupilA,
          "class-A"
        )
    );
  }
);
test(
  "pupil belonging to another class is rejected",
  () => {
    assert.throws(
      () =>
        assertPupilBelongsToClass(
          pupilB,
          "class-A"
        ),
      (error) => {
        assert.equal(
          error.status,
          403
        );
        assert.equal(
          error.code,
          "PUPIL_CLASS_MISMATCH"
        );
        return true;
      }
    );
  }
);
test(
  "pupil without class assignment is rejected",
  () => {
    assert.throws(
      () =>
        assertPupilBelongsToClass(
          {
            id: "pupil-X",
            name: "Unassigned",
          },
          "class-A"
        ),
      (error) => {
        assert.equal(
          error.status,
          400
        );
        assert.equal(
          error.code,
          "PUPIL_CLASS_MISSING"
        );
        return true;
      }
    );
  }
);
test(
  "missing pupil is rejected",
  () => {
    assert.throws(
      () =>
        assertPupilBelongsToClass(
          null,
          "class-A"
        ),
      (error) => {
        assert.equal(
          error.status,
          404
        );
        assert.equal(
          error.code,
          "PUPIL_NOT_FOUND"
        );
        return true;
      }
    );
  }
);
test(
  "complete valid result roster is accepted",
  () => {
    assert.equal(
      assertValidResultRoster({
        schoolClass:
          classA,
        pupil:
          pupilA,
        teacherUid:
          teacherUid,
        classId:
          "class-A",
        subject:
          "Mathematics",
      }),
      true
    );
  }
);
test(
  "complete roster validation rejects wrong teacher",
  () => {
    assert.throws(
      () =>
        assertValidResultRoster({
          schoolClass:
            classA,
          pupil:
            pupilA,
          teacherUid:
            "wrong-teacher",
          classId:
            "class-A",
          subject:
            "Mathematics",
        }),
      (error) => {
        assert.equal(
          error.code,
          "CLASS_ACCESS_DENIED"
        );
        return true;
      }
    );
  }
);
test(
  "complete roster validation rejects wrong subject",
  () => {
    assert.throws(
      () =>
        assertValidResultRoster({
          schoolClass:
            classA,
          pupil:
            pupilA,
          teacherUid:
            teacherUid,
          classId:
            "class-A",
          subject:
            "Physics",
        }),
      (error) => {
        assert.equal(
          error.code,
          "SUBJECT_NOT_IN_CLASS"
        );
        return true;
      }
    );
  }
);
test(
  "complete roster validation rejects pupil from another class",
  () => {
    assert.throws(
      () =>
        assertValidResultRoster({
          schoolClass:
            classA,
          pupil:
            pupilB,
          teacherUid:
            teacherUid,
          classId:
            "class-A",
          subject:
            "Mathematics",
        }),
      (error) => {
        assert.equal(
          error.code,
          "PUPIL_CLASS_MISMATCH"
        );
        return true;
      }
    );
  }
);
test(
  "complete roster validation accepts object subject ID",
  () => {
    assert.equal(
      assertValidResultRoster({
        schoolClass:
          classA,
        pupil:
          pupilA,
        teacherUid:
          teacherUid,
        classId:
          "class-A",
        subject:
          "Basic Science",
        subjectId:
          "basic-science",
      }),
      true
    );
  }
);
