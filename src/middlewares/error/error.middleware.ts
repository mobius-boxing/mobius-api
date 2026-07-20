import { NextFunction, Response, Request } from "express";

// SECURITY (M2): verbose error detail is gated on an EXPLICIT opt-in flag, not on NODE_ENV.
// When off (the default), responses are generic and never leak DB column/constraint names,
// stack traces, or raw error objects.
const debugErrors = (): boolean => process.env.DEBUG_ERRORS === "true";

export const errorMiddleware = (
  err: any,
  req: Request | any,
  res: Response,
  _next: NextFunction,
) => {
  console.error("Error:", err);

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token has expired. Please login again.",
      code: "TOKEN_EXPIRED",
    });
  }

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token. Please login again.",
      code: "INVALID_TOKEN",
    });
  }

  if (err.name === "NotBeforeError") {
    return res.status(401).json({
      success: false,
      message: "Token not active yet.",
      code: "TOKEN_NOT_ACTIVE",
    });
  }

  // PostgreSQL error codes — see https://www.postgresql.org/docs/current/errcodes-appendix.html
  // SECURITY (M2): by default we return generic messages and omit the offending field/column.
  // The specific field is only revealed when DEBUG_ERRORS is explicitly enabled.
  if (err.code) {
    if (err.code === "23505") {
      // unique_violation
      const field = debugErrors() ? extractFieldFromError(err) : null;
      return res.status(409).json({
        success: false,
        message:
          field && debugErrors()
            ? `${field} already exists. Please use a different value.`
            : "Duplicate entry. This record already exists.",
        code: "DUPLICATE_ENTRY",
        ...(field && debugErrors() ? { field } : {}),
      });
    }

    if (err.code === "23503") {
      // foreign_key_violation
      return res.status(400).json({
        success: false,
        message:
          "Referenced record does not exist or cannot be deleted because it is referenced by other records.",
        code: "FOREIGN_KEY_VIOLATION",
      });
    }

    if (err.code === "23502") {
      // not_null_violation
      const field = debugErrors() ? err.column || "field" : null;
      return res.status(400).json({
        success: false,
        message:
          field && debugErrors()
            ? `${field} is required and cannot be null.`
            : "A required field is missing.",
        code: "NOT_NULL_VIOLATION",
        ...(field && debugErrors() ? { field } : {}),
      });
    }

    if (err.code === "23514") {
      // check_violation
      return res.status(400).json({
        success: false,
        message: "Data violates database constraints.",
        code: "CHECK_VIOLATION",
      });
    }

    if (err.code === "22P02") {
      // invalid_text_representation (e.g., non-numeric value for an integer column)
      return res.status(400).json({
        success: false,
        message: "Invalid data type provided.",
        code: "INVALID_DATA_TYPE",
      });
    }

    if (err.code === "42P01") {
      // undefined_table
      return res.status(500).json({
        success: false,
        message: "An unexpected error occurred. Please contact support.",
        code: "UNDEFINED_TABLE",
      });
    }

    if (err.code === "42703") {
      // undefined_column
      return res.status(500).json({
        success: false,
        message: "An unexpected error occurred. Please contact support.",
        code: "UNDEFINED_COLUMN",
      });
    }
  }

  if (err.name === "ValidationError" || err.isValidationError) {
    return res.status(400).json({
      success: false,
      message: err.message || "Validation failed",
      code: "VALIDATION_ERROR",
      // SECURITY (M2): only echo detailed validation errors when explicitly debugging.
      ...(debugErrors() ? { errors: err.errors || err.details } : {}),
    });
  }

  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File size exceeds the allowed limit.",
        code: "FILE_TOO_LARGE",
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files uploaded.",
        code: "TOO_MANY_FILES",
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error.",
      code: "FILE_UPLOAD_ERROR",
    });
  }

  const statusError: number =
    err.statusError ||
    err.statusCode ||
    err.status ||
    req.statusCode ||
    req.statusError ||
    500;

  const message =
    err.message || "An unexpected error occurred. Please try again later.";

  res.status(statusError).json({
    success: false,
    message,
    // SECURITY (M2): stack + raw error object only when DEBUG_ERRORS=true.
    ...(debugErrors() && {
      stack: err.stack,
      details: err,
    }),
  });
};

/**
 * Pull the offending field name out of a PostgreSQL unique-violation.
 * Tries constraint name (e.g. "users_email_unique" -> "email"), falls back to
 * the detail string (e.g. "Key (email)=(...) already exists.").
 * Only invoked when DEBUG_ERRORS is enabled (see callers).
 */
function extractFieldFromError(err: any): string | null {
  if (err.constraint) {
    const match = err.constraint.match(/_([a-zA-Z]+)_/);
    if (match && match[1]) {
      return match[1];
    }
  }

  if (err.detail) {
    const match = err.detail.match(/Key \(([^)]+)\)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
