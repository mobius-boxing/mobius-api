import { NextFunction, Response, Request } from "express";

/**
 * Enhanced error middleware with support for:
 * - JWT errors (TokenExpiredError, JsonWebTokenError)
 * - Database errors (unique constraint, foreign key, etc.)
 * - Validation errors
 * - Generic errors
 */
export const errorMiddleware = (
  err: any,
  req: Request | any,
  res: Response,
  _next: NextFunction,
) => {
  console.error("Error:", err);

  // JWT Errors
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

  // Database Errors (PostgreSQL)
  if (err.code) {
    // Unique constraint violation
    if (err.code === "23505") {
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

    // Foreign key constraint violation
    if (err.code === "23503") {
      return res.status(400).json({
        success: false,
        message: "Referenced record does not exist or cannot be deleted because it is referenced by other records.",
        code: "FOREIGN_KEY_VIOLATION",
      });
    }

    // Not null constraint violation
    if (err.code === "23502") {
      const field = err.column || "field";
      return res.status(400).json({
        success: false,
        message: `${field} is required and cannot be null.`,
        code: "NOT_NULL_VIOLATION",
        field,
      });
    }

    // Check constraint violation
    if (err.code === "23514") {
      return res.status(400).json({
        success: false,
        message: "Data violates database constraints.",
        code: "CHECK_VIOLATION",
      });
    }

    // Invalid text representation (type mismatch)
    if (err.code === "22P02") {
      return res.status(400).json({
        success: false,
        message: "Invalid data type provided.",
        code: "INVALID_DATA_TYPE",
      });
    }

    // Undefined table
    if (err.code === "42P01") {
      return res.status(500).json({
        success: false,
        message: "Database table not found. Please contact support.",
        code: "UNDEFINED_TABLE",
      });
    }

    // Undefined column
    if (err.code === "42703") {
      return res.status(500).json({
        success: false,
        message: "Database column not found. Please contact support.",
        code: "UNDEFINED_COLUMN",
      });
    }
  }

  // Validation Errors (from validation middleware)
  if (err.name === "ValidationError" || err.isValidationError) {
    return res.status(400).json({
      success: false,
      message: err.message || "Validation failed",
      code: "VALIDATION_ERROR",
      errors: err.errors || err.details,
    });
  }

  // Multer file upload errors
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

  // Default error handling
  const statusError: number =
    err.statusError ||
    err.statusCode ||
    err.status ||
    req.statusCode ||
    req.statusError ||
    500;

  const message =
    err.message ||
    "An unexpected error occurred. Please try again later.";

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
 * Extract field name from PostgreSQL error message
 * Helps identify which field caused the unique constraint violation
 */
function extractFieldFromError(err: any): string | null {
  if (err.constraint) {
    // Extract field name from constraint name (e.g., "users_email_unique" -> "email")
    const match = err.constraint.match(/_([a-zA-Z]+)_/);
    if (match && match[1]) {
      return match[1];
    }
  }

  if (err.detail) {
    // Extract field from detail message (e.g., "Key (email)=(test@example.com) already exists.")
    const match = err.detail.match(/Key \(([^)]+)\)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
