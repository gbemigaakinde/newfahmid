export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

export function requireObject(value, message = "Invalid request body.") {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new ValidationError(message);
  }

  return value;
}

export function requireString(
  value,
  fieldName,
  {
    minLength = 1,
    maxLength = 500,
  } = {}
) {
  if (typeof value !== "string") {
    throw new ValidationError(
      `${fieldName} must be a string.`
    );
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength) {
    throw new ValidationError(
      `${fieldName} is required.`
    );
  }

  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `${fieldName} is too long.`
    );
  }

  return trimmed;
}

export function optionalString(
  value,
  fieldName,
  maxLength = 500
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return requireString(
    value,
    fieldName,
    {
      minLength: 1,
      maxLength,
    }
  );
}

export function requireArray(
  value,
  fieldName
) {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an array.`
    );
  }

  return value;
}

export function requireBoolean(
  value,
  fieldName
) {
  if (typeof value !== "boolean") {
    throw new ValidationError(
      `${fieldName} must be true or false.`
    );
  }

  return value;
}

export function requireId(
  value,
  fieldName = "ID"
) {
  return requireString(
    value,
    fieldName,
    {
      minLength: 1,
      maxLength: 150,
    }
  );
}

export function sanitizeStringArray(
  values,
  fieldName,
  maxItems = 100
) {
  requireArray(values, fieldName);

  if (values.length > maxItems) {
    throw new ValidationError(
      `${fieldName} contains too many items.`
    );
  }

  return values.map((value, index) =>
    requireString(
      value,
      `${fieldName}[${index}]`,
      {
        minLength: 1,
        maxLength: 200,
      }
    )
  );
}
