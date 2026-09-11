import {
  getDocument,
  setDocument,
  updateDocument,
  deleteDocument,
} from "../../firebase/firestore.js";

import {
  ValidationError,
  requireObject,
  requireString,
  optionalString,
  requireBoolean,
} from "../../security/validation.js";

export async function getPupilDetails(
  env,
  pupilId
) {
  if (!pupilId) {
    throw new ValidationError(
      "Pupil ID is required."
    );
  }

  return getDocument(
    env,
    "pupils",
    pupilId
  );
}

export function validatePupilPayload(
  payload,
  {
    partial = false,
  } = {}
) {
  const data = requireObject(
    payload,
    "Pupil data"
  );

  const result = {};

  if (!partial || data.name !== undefined) {
    result.name = requireString(
      data.name,
      "name",
      { maxLength: 200 }
    );
  }

  if (
    !partial ||
    data.admissionNo !== undefined
  ) {
    result.admissionNo =
      requireString(
        data.admissionNo,
        "admissionNo",
        { maxLength: 100 }
      );
  }

  if (data.email !== undefined) {
    result.email = optionalString(
      data.email,
      "email",
      { maxLength: 320 }
    );
  }

  if (data.class !== undefined) {
    if (
      data.class === null ||
      typeof data.class !== "object"
    ) {
      throw new ValidationError(
        "class must be an object."
      );
    }

    if (data.class.id !== undefined) {
      result.class = {
        id: requireString(
          data.class.id,
          "class.id",
          { maxLength: 100 }
        ),

        ...(data.class.name !== undefined
          ? {
              name: requireString(
                data.class.name,
                "class.name",
                { maxLength: 200 }
              ),
            }
          : {}),
      };
    }
  }

  if (data.status !== undefined) {
    result.status = requireString(
      data.status,
      "status",
      { maxLength: 50 }
    );
  }

  if (data.isActive !== undefined) {
    result.isActive = requireBoolean(
      data.isActive,
      "isActive"
    );
  }

  /*
   * Preserve the existing fee model.
   *
   * These values are raw inputs.
   * The Worker, not the browser, performs
   * the actual fee calculations.
   */
  if (
    data.feeAdjustmentPercent !==
    undefined
  ) {
    const value =
      Number(data.feeAdjustmentPercent);

    if (!Number.isFinite(value)) {
      throw new ValidationError(
        "feeAdjustmentPercent must be numeric."
      );
    }

    result.feeAdjustmentPercent =
      value;
  }

  if (
    data.feeAdjustmentAmount !==
    undefined
  ) {
    const value =
      Number(data.feeAdjustmentAmount);

    if (!Number.isFinite(value)) {
      throw new ValidationError(
        "feeAdjustmentAmount must be numeric."
      );
    }

    result.feeAdjustmentAmount =
      value;
  }

  if (data.admissionSession !== undefined) {
    result.admissionSession =
      requireString(
        data.admissionSession,
        "admissionSession",
        { maxLength: 50 }
      );
  }

  if (data.admissionTerm !== undefined) {
    result.admissionTerm =
      requireString(
        data.admissionTerm,
        "admissionTerm",
        { maxLength: 50 }
      );
  }

  if (data.exitTerm !== undefined) {
    result.exitTerm =
      requireString(
        data.exitTerm,
        "exitTerm",
        { maxLength: 50 }
      );
  }

  return result;
}

export async function createPupil(
  env,
  pupilId,
  payload
) {
  if (!pupilId) {
    throw new ValidationError(
      "Pupil ID is required."
    );
  }

  const existing =
    await getDocument(
      env,
      "pupils",
      pupilId
    );

  if (existing) {
    throw new ValidationError(
      "A pupil with this ID already exists."
    );
  }

  const data =
    validatePupilPayload(payload);

  await setDocument(
    env,
    "pupils",
    pupilId,
    data
  );

  return {
    id: pupilId,
    ...data,
  };
}

export async function updatePupil(
  env,
  pupilId,
  payload
) {
  if (!pupilId) {
    throw new ValidationError(
      "Pupil ID is required."
    );
  }

  const existing =
    await getDocument(
      env,
      "pupils",
      pupilId
    );

  if (!existing) {
    return null;
  }

  const changes =
    validatePupilPayload(
      payload,
      { partial: true }
    );

  if (
    Object.keys(changes).length === 0
  ) {
    throw new ValidationError(
      "No valid changes were supplied."
    );
  }

  await updateDocument(
    env,
    "pupils",
    pupilId,
    changes
  );

  return {
    id: pupilId,
    ...existing,
    ...changes,
  };
}

export async function deletePupil(
  env,
  pupilId
) {
  const existing =
    await getDocument(
      env,
      "pupils",
      pupilId
    );

  if (!existing) {
    return null;
  }

  /*
   * We intentionally don't cascade-delete
   * financial/results/attendance history here.
   *
   * That would be dangerous.
   */
  await deleteDocument(
    env,
    "pupils",
    pupilId
  );

  return {
    id: pupilId,
    ...existing,
  };
}
