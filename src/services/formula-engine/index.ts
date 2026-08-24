/**
 * Formula engine barrel — the single owner of formula evaluation
 * (cross-cutting decision #9). Consumers (models controller, the future
 * Parts cascade) import ONLY from here.
 */
export {
  evaluate,
  evaluateList,
  validate,
  validateList,
  type ValidationResult,
  type ListValidationResult,
  type SegmentValidationResult,
} from "./formula-engine.service";
export {
  FORMULA_PARAMETERS,
  TESTEAR_FIXTURE,
  type FormulaParameter,
  type Scope,
} from "./parameters";
export {
  FORMULA_FUNCTIONS,
  FORMULA_OPERATORS,
  type FormulaFunctionReference,
  type FormulaOperatorReference,
} from "./functions";
