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
 * throws a NullReferenceException when no product is set. Here V2/V4/V5 —
 * the three rules that need the product — are SKIPPED once V1 has fired, so a
 * product-less payload yields exactly one clean problem instead of a 500.
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

  const hasProduct = order.productId !== null && order.productId !== undefined;
  if (!hasProduct) problems.push(VALIDATION_MESSAGES.V1);

  // V2 — the effective route must have at least one stage. Product-dependent.
  if (hasProduct && context.routeStageCount < 1) {
    problems.push(VALIDATION_MESSAGES.V2);
  }

  // V3 — quantity > 0. Independent of the product, so it always runs.
  const quantity = order.quantity ?? 0;
  if (!(quantity > 0)) problems.push(VALIDATION_MESSAGES.V3);

  // V4 — the product must be approved. Product-dependent.
  if (hasProduct && !context.productApproved) {
    problems.push(VALIDATION_MESSAGES.V4);
  }

  // V5 — new orders only: the product's customer must be active.
  if (hasProduct && options.isNew && !context.customerActive) {
    problems.push(VALIDATION_MESSAGES.V5);
  }

  // V6 — CantidadMaximaEnOrdenes ceiling; 0 (or less) disables the rule.
  if (context.maxQuantity > 0 && quantity > context.maxQuantity) {
    problems.push(VALIDATION_MESSAGES.V6(context.maxQuantity));
  }

  return { problems };
}
