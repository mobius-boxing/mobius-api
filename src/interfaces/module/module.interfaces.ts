export interface IModule {
  id?: number;
  uuid: string;
  slug: string;
  name: string;
  description?: string | null;
  isCore: boolean;
  /**
   * Hostname label of this module's customer-facing app —
   * `{company.slug}.{publicDomainLabel}.{PUBLIC_MODULE_DOMAIN}`. NOT the slug:
   * `countdown` is served from `vencimientos`. null for modules with no public
   * surface (`core`, `store`), which show no URL at all.
   */
  publicDomainLabel?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
