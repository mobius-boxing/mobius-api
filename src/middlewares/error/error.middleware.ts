import { NextFunction, Response, Request } from "express";

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
  if (err.code) {
    if (err.code === "23505") {
      // unique_violation
      const field = extractFieldFromError(err);
      return res.status(409).json({
        success: false,
        message: field
          ? `${field} already exists. Please use a different value.`
          : "Duplicate entry. This record already exists.",
        code: "DUPLICATE_ENTRY",
        field,
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
      const field = err.column || "field";
      return res.status(400).json({
        success: false,
        message: `${field} is required and cannot be null.`,
        code: "NOT_NULL_VIOLATION",
        field,
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
        message: "Database table not found. Please contact support.",
        code: "UNDEFINED_TABLE",
      });
    }

    if (err.code === "42703") {
      // undefined_column
      return res.status(500).json({
        success: false,
        message: "Database column not found. Please contact support.",
        code: "UNDEFINED_COLUMN",
      });
    }
  }

  if (err.name === "ValidationError" || err.isValidationError) {
    return res.status(400).json({
      success: false,
      message: err.message || "Validation failed",
      code: "VALIDATION_ERROR",
      errors: err.errors || err.details,
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
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      details: err,
    }),
  });
};

/**
 * Pull the offending field name out of a PostgreSQL unique-violation.
 * Tries constraint name (e.g. "users_email_unique" -> "email"), falls back to
 * the detail string (e.g. "Key (email)=(...) already exists.").
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
