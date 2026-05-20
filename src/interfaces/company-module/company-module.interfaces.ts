/**
 * Subscription state machine, enforced at the TS layer (no DB CHECK).
 * See modules.md §4 and Appendix C.
 */
export type SubscriptionStatus =
  | "comp" // complimentary; v1 default
  | "trial"
  | "active"
  | "past_due"
  | "canceled";

export interface ICompanyModule {
  id?: number;
  companyId: number;
  moduleId: number;

  enabled: boolean;
  enabledAt: Date;
  enabledBy?: number | null;
  disabledAt?: Date | null;
  disabledBy?: number | null;

  config: Record<string, unknown>;

  subscriptionStatus: SubscriptionStatus;
  trialStartsAt?: Date | null;
  trialEndsAt?: Date | null;
  currentPeriodStartsAt?: Date | null;
  currentPeriodEndsAt?: Date | null;
  canceledAt?: Date | null;
  externalSubscriptionId?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Returned by CompanyModuleDAO.getByCompany — every module joined with the
 * company's link row (LEFT JOIN, so non-enabled modules still appear).
 *
 * If no link row exists for a module, `enabled` is false and all subscription
 * fields are null. The `id` of ICompanyModule is also nullable in that case.
 */
export interface ICompanyModuleWithModule {
  // Module identity (always present, modules row is the driving table)
  moduleId: number;
  moduleUuid: string;
  slug: string;
  name: string;
  description: string | null;
  isCore: boolean;

  // Link state (null when no company_modules row exists for this module)
  companyModuleId: number | null;
  enabled: boolean;
  enabledAt: Date | null;
  enabledBy: number | null;
  disabledAt: Date | null;
  disabledBy: number | null;

  config: Record<string, unknown>;

  subscriptionStatus: SubscriptionStatus | null;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  canceledAt: Date | null;
  externalSubscriptionId: string | null;
}
