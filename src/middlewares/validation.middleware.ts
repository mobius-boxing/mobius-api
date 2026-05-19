import { Request, Response, NextFunction } from "express";
import { validate as classValidate, ValidationError } from "class-validator";
import { plainToClass } from "class-transformer";

interface IValidationErrorDetail {
  field: string;
  errors: string[];
}

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
      const data = req[source];

      const dtoInstance = plainToClass(DTOClass, data);

      // SECURITY: whitelist + forbidNonWhitelisted reject any property not declared on the DTO,
      // preventing mass-assignment attacks.
      const errors = await classValidate(dtoInstance, {
        whitelist: true,
        forbidNonWhitelisted: true,
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

      req[source] = dtoInstance as any;

      next();
    } catch (error: any) {
      next(error);
    }
  };
};

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

    // UUID v4 (RFC 4122 §4.4): version nibble = 4, variant nibble ∈ {8,9,a,b}.
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
