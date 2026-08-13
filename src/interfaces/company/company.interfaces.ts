/**
 * Whitelabel identity of a client, shared by EVERY module that company has
 * (spec revision 2: branding is a property of the company, not of the
 * company↔module link). Stored in `companies.branding` jsonb.
 *
 * All four fields are nullable "unset" markers: the public endpoint falls back
 * to the company name and the default brand colour rather than inventing data.
 */
export interface ICompanyBranding {
  displayName: string | null;
  brandColor: string | null;
  logoFileUuid: string | null;
  loginMessage: string | null;
}

export interface ICompany {
  id?: number;
  uuid?: string;
  name: string;
  /**
   * Global DNS label for this client — the `{client}` in
   * `{client}.vencimientos.mobiusboxing.com`. NOT NULL and unique in the
   * database; optional here only because create-paths build the row before the
   * DAO derives it.
   */
  slug?: string;
  description?: string;
  isActive?: boolean;
  /**
   * The raw `companies.branding` blob as stored — `{}` for a company that never
   * set any branding (the DAO maps NULL to `{}` so consumers never have to
   * distinguish the two). Partial because the column carries no constraints:
   * anything that reads individual fields goes through `normalizeBranding`.
   */
  branding?: Partial<ICompanyBranding>;
  createdAt?: Date;
  updatedAt?: Date;
  // Stats (optional, for special methods)
  userCount?: number;
}
