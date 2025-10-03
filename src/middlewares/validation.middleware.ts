import { Request, Response, NextFunction } from "express";
import { validate as classValidate, ValidationError } from "class-validator";
import { plainToClass } from "class-transformer";

/**
 * Validation error detail interface
 */
interface IValidationErrorDetail {
  field: string;
  errors: string[];
}

/**
 * Format class-validator errors into a readable format
 */
const formatValidationErrors = (
  errors: ValidationError[],
): IValidationErrorDetail[] => {
  const formatted: IValidationErrorDetail[] = [];

  errors.forEach((error) => {
    if (error.constraints) {
      formatted.push({
        field: error.property,
        errors: Object.values(error.constraints),
      });
    }

    // Handle nested validation errors
    if (error.children && error.children.length > 0) {
      const childErrors = formatValidationErrors(error.children);
      childErrors.forEach((childError) => {
        formatted.push({
          field: `${error.property}.${childError.field}`,
          errors: childError.errors,
        });
      });
    }
  });

  return formatted;
};

/**
 * Generic DTO validation middleware
 * Validates request body against a DTO class using class-validator
 *
 * @param DTOClass - The DTO class to validate against
 * @param source - The source of data to validate ('body', 'query', 'params')
 *
 * @example
 * router.post('/', validateDTO(CreateUserDTO), controller.create);
 */
export const validateDTO = <T extends object>(
  DTOClass: new () => T,
  source: "body" | "query" | "params" = "body",
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Get data from the specified source
      const data = req[source];

      // Transform plain object to class instance
      const dtoInstance = plainToClass(DTOClass, data);

      // Validate the DTO instance
      const errors = await classValidate(dtoInstance, {
        whitelist: true, // Strip properties that don't have decorators
        forbidNonWhitelisted: true, // Throw error if non-whitelisted properties exist
        skipMissingProperties: false,
      });

      if (errors.length > 0) {
        const formattedErrors = formatValidationErrors(errors);

        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: formattedErrors,
        });
        return;
      }

      // Replace the source data with the validated and transformed DTO
      req[source] = dtoInstance as any;

      next();
    } catch (error: any) {
      next(error);
    }
  };
};

/**
 * Simple validation middleware without class-validator
 * Useful for basic validation without DTO classes
 *
 * @param validationFn - Custom validation function that throws error if validation fails
 *
 * @example
 * router.get('/:id', validate((req) => {
 *   if (!req.params.id) throw new Error('ID is required');
 * }), controller.getById);
 */
export const validate = (
  validationFn: (req: Request) => void | Promise<void>,
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await validationFn(req);
      next();
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || "Validation failed",
      });
    }
  };
};

/**
 * Validate UUID parameter middleware
 * Ensures the UUID parameter is in valid UUID format
 */
export const validateUUID = (paramName: string = "uuid") => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const uuid = req.params[paramName];

    if (!uuid) {
      res.status(400).json({
        success: false,
        message: `${paramName} parameter is required`,
      });
      return;
    }

    // UUID v4 regex pattern
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(uuid)) {
      res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format. Expected UUID v4.`,
      });
      return;
    }

    next();
  };
};

/**
 * Validate pagination parameters middleware
 * Ensures page and limit are positive integers
 */
export const validatePagination = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { page, limit } = req.query;

  if (page) {
    const pageNum = parseInt(page as string, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      res.status(400).json({
        success: false,
        message: "Page must be a positive integer",
      });
      return;
    }
  }

  if (limit) {
    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      res.status(400).json({
        success: false,
        message: "Limit must be a positive integer between 1 and 100",
      });
      return;
    }
  }

  next();
};

/**
 * Validate required fields in request body
 * @param fields - Array of required field names
 */
export const validateRequiredFields = (fields: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const missingFields: string[] = [];

    fields.forEach((field) => {
      if (req.body[field] === undefined || req.body[field] === null) {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
      return;
    }

    next();
  };
};
