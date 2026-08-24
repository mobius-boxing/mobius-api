import {
  IProductionOrderValidationContext,
  IProductionOrderValidationInput,
  VALIDATION_MESSAGES,
} from "../interfaces/production-order/production-order.interfaces";

/**
 * `OrdenDeProduccion.Problemas()` (DomainModel/OrdenDeProduccion.cs:332-360),
 * as a pure function: no database, no request, no clock. Every problem is
 * critical, all are collected, and the strings come from the interfaces file
 * verbatim.
 *
 * DIVERGENCE D-3: Procusto dereferences `Parte` unguarded at :339 and :351 and
 * throws a NullReferenceException when no part is set. Here V2/V4/V5 — the
 * three rules that need the part — are SKIPPED once V1 has fired, so a
 * part-less payload yields exactly one clean problem instead of a 500.
 * Reproducing the crash would not be parity worth having.
 *
 * V5 is create-only (`isNew`): deactivating a customer must not make every
 * later edit of an existing order impossible.
 */
export interface IProductionOrderValidation {
  problems: string[];
}

export function validateProductionOrder(
  order: IProductionOrderValidationInput,
  context: IProductionOrderValidationContext,
  options: { isNew: boolean },
): IProductionOrderValidation {
  const problems: string[] = [];

  const hasPart = order.partId !== null && order.partId !== undefined;
  if (!hasPart) problems.push(VALIDATION_MESSAGES.V1);

  // V2 — the effective route must have at least one stage. Part-dependent.
  if (hasPart && context.routeStageCount < 1) {
    problems.push(VALIDATION_MESSAGES.V2);
  }

  // V3 — quantity > 0. Independent of the part, so it always runs.
  const quantity = order.quantity ?? 0;
  if (!(quantity > 0)) problems.push(VALIDATION_MESSAGES.V3);

  // V4 — the part must be approved. Part-dependent.
  if (hasPart && !context.partApproved) {
    problems.push(VALIDATION_MESSAGES.V4);
  }

  // V5 — new orders only: the product's customer must be active.
  if (hasPart && options.isNew && !context.customerActive) {
    problems.push(VALIDATION_MESSAGES.V5);
  }

  // V6 — CantidadMaximaEnOrdenes ceiling; 0 (or less) disables the rule.
  if (context.maxQuantity > 0 && quantity > context.maxQuantity) {
    problems.push(VALIDATION_MESSAGES.V6(context.maxQuantity));
  }

  return { problems };
}
