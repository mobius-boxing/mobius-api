/**
 * Permission catalogue — only codes an actual route or controller check
 * enforces are seeded; the other ~90 Procusto concepts nothing gates are gone
 * from here. The full 136-concept Procusto source list stays in
 * `repos/specs/replication/` for future wiring, not seeded until then.
 *
 * Each concept materializes as ONE `permissions` row (read-write) plus,
 * when `readonly: true`, a second `<code>.readonly` row (Procusto's
 * SoloLectura pairing) — routes gated with `{allowReadOnly: true}` accept
 * either. Kept Procusto concepts keep their Spanish `name` (the legacy gate
 * key, kept for ETL matching); new Mobius-native concepts use English names.
 */

export type PermissionArea =
  | "masters"
  | "operations"
  | "queries"
  | "actions"
  | "sales-plus"
  | "maintenance";

export interface IPermissionConcept {
  code: string;
  name: string; // Procusto Nombre (legacy gate key) or English name (Mobius-native)
  description: string;
  forms?: string; // FormsAsociados (hyphen-delimited legacy screen names)
  area: PermissionArea;
  deprecated?: boolean;
  /**
   * Whether a `<code>.readonly` sibling row is seeded. Defaults per array:
   * `true` in PERMISSION_CONCEPTS, `false` in MOBIUS_ADDED_PERMISSIONS —
   * override per-concept for the exceptions (e.g. `audit.read` gains a
   * readonly row; `production-orders.edit` and the `orders.*`/`products.*`
   * action gates do not, since a read-only variant of an action gate is
   * meaningless).
   */
  readonly?: boolean;
}

/** Kept Procusto concepts — name/description/forms/area unchanged from the source catalogue. */
export const PERMISSION_CONCEPTS: IPermissionConcept[] = [
  {
    code: "box-types.edit",
    name: "Tipos de cajas",
    description: "Edición de tipos de cajas",
    forms: "TiposDeCajasForm",
    area: "masters",
  },
  {
    code: "colors.edit",
    name: "Colores",
    description: "Definición de colores",
    forms: "ColoresForm",
    area: "masters",
  },
  {
    code: "color-types.edit",
    name: "Tipos de color",
    description: "Definición de tipos de colores",
    forms: "TiposDeColorForm",
    area: "masters",
  },
  {
    code: "complements.edit",
    name: "Complementos",
    description: "Definición de complementos",
    forms: "ComplementosForm",
    area: "masters",
  },
  {
    code: "corrugated.edit",
    name: "Corrugados",
    description: "Definición de corrugados",
    forms: "CorrugadosForm",
    area: "masters",
  },
  {
    code: "corrugated.classes",
    name: "Clases de corrugados",
    description: "Edición de clases de corrugados",
    forms: "ClasesDeCorrugadosForm",
    area: "masters",
  },
  {
    code: "customers.edit",
    name: "Clientes",
    description: "Edición de clientes",
    forms: "ClientesForm",
    area: "masters",
  },
  {
    code: "customer-categories.edit",
    name: "Categorias de clientes",
    description: "Edición de categorias de clientes",
    forms: "CategoriasDeClientesForm",
    area: "sales-plus",
  },
  {
    code: "delivery-zones.edit",
    name: "Zonas de entrega",
    description: "Edición de zonas de entrega",
    forms: "ZonasDeEntregaForm",
    area: "masters",
  },
  {
    code: "flap-types.edit",
    name: "Tipos de aletas",
    description: "Definición de tipos de aletas",
    forms: "TiposDeAletasForm",
    area: "masters",
  },
  {
    code: "flute-types.edit",
    name: "Tipos de onda",
    description: "Definición de tipos de onda",
    forms: "TiposDeOndaForm",
    area: "masters",
  },
  {
    code: "fsc-types.edit",
    name: "Tipos de FSC",
    description: "Definición de tipos de FSC",
    forms: "TiposDeFSCForm",
    area: "masters",
  },
  {
    code: "glue-types.edit",
    name: "Tipos de plegado",
    description: "Definición de tipos de plegado",
    forms: "TiposDePlegadoForm",
    area: "masters",
  },
  {
    code: "manufacturers.edit",
    name: "Fabricantes",
    description: "Edición del maestro de fabricantes",
    forms: "FabricantesForm",
    area: "masters",
  },
  {
    code: "paper.classes",
    name: "Clases de papeles",
    description: "Edición de clases de papeles",
    forms: "ClasesDePapelesForm",
    area: "masters",
  },
  {
    code: "paper-types.edit",
    name: "Tipos de papeles",
    description: "Definición de tipos de papel",
    forms: "TiposDePapelesForm",
    area: "masters",
  },
  {
    code: "papers.edit",
    name: "Papeles",
    description: "Edición de papeles",
    forms: "PapelesForm",
    area: "masters",
  },
  {
    code: "supplies.edit",
    name: "Insumos",
    description: "Edición de insumos",
    forms: "InsumosForm",
    area: "masters",
  },
  {
    code: "product-types.edit",
    name: "Tipos de productos",
    description: "Definición de tipos de productos",
    forms: "TiposDeProductoForm",
    area: "masters",
  },
  {
    code: "products.edit",
    name: "Productos",
    description: "Edición de productos",
    forms: "ProductosForm",
    area: "masters",
  },
  {
    code: "products.delete",
    name: "ProductosForm - Borrar",
    description: "Botón de borrado de productos",
    area: "actions",
    readonly: false,
  },
  {
    code: "score-types.edit",
    name: "Tipos de trazados",
    description: "Edición de tipos de trazados",
    forms: "TiposDeTrazadosForm",
    area: "masters",
  },
  {
    code: "strapping-types.edit",
    name: "Tipos de zunchado",
    description: "Definición de tipos de zunchado",
    forms: "TiposDeZunchadoForm",
    area: "masters",
  },
  {
    code: "suppliers.edit",
    name: "Proveedores",
    description: "Edición del maestro de proveedores",
    forms: "ProveedoresForm",
    area: "masters",
  },
  {
    code: "tooling-types.edit",
    name: "Tipos de herramentales",
    description: "Edición de tipos de herramentales",
    forms: "TiposDeHerramentalesForm",
    area: "masters",
  },
  {
    code: "consumable-types.edit",
    name: "Tipos de consumibles",
    description: "Definición de tipos de insumo",
    forms: "TiposDeConsumiblesForm",
    area: "masters",
  },
  {
    code: "machines.edit",
    name: "Maquinas",
    description: "Definición de máquinas",
    forms: "MaquinasForm",
    area: "masters",
  },
  {
    code: "models.edit",
    name: "Modelos de cajas",
    description: "Definición de modelos de cajas",
    forms: "ModelosForm",
    area: "masters",
  },
  {
    code: "palletizing.edit",
    name: "Palletizados",
    description: "Definición de tipos de palletizado",
    forms: "PalletizadosForm",
    area: "masters",
  },
  {
    code: "parts.edit",
    name: "Partes",
    description: "Edición de partes",
    forms: "PartesForm",
    area: "masters",
  },
  {
    code: "routes.edit",
    name: "Rutas de produccion",
    description: "Definición de rutas de producción",
    forms: "RutasProduccionForm",
    area: "masters",
  },
  {
    code: "routes.delete",
    name: "RutasProduccionForm - Borrar",
    description: "Botón de borrado de rutas",
    area: "actions",
    readonly: false,
  },
  {
    code: "production-orders.edit",
    name: "Ordenes de produccion",
    description: "Edición de órdenes de producción",
    forms: "OrdenesDeProduccionForm",
    area: "masters",
    readonly: false,
  },
  {
    code: "production-orders.generate",
    name: "Generar órdenes de producción",
    description: "Generación de órdenes de producción",
    area: "actions",
    readonly: false,
  },
  {
    code: "roles.edit",
    name: "Perfiles",
    description: "Definición de perfiles de usuario",
    forms: "PerfilesForm",
    area: "masters",
  },
  {
    code: "users.edit",
    name: "Usuarios",
    description: "Edición de usuarios",
    forms: "UsuariosForm",
    area: "masters",
  },
  {
    code: "orders.edit",
    name: "Pedidos",
    description: "Edición de pedidos",
    forms: "PedidosForm",
    area: "sales-plus",
    readonly: false,
  },
  {
    code: "orders.delete",
    name: "PedidosForm - Borrar",
    description: "Botón de borrado de pedidos",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.approve.commercial",
    name: "PedidosForm - Aprobacion comercial",
    description: "Botón de aprobación comercial",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.approve.financial",
    name: "PedidosForm - Aprobacion financiera",
    description: "Botón de aprobación financiera",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.manual-fulfillment",
    name: "PedidosForm - Cumplimiento manual",
    description: "Botón de cumplimiento manual",
    area: "actions",
    readonly: false,
  },
  {
    code: "products.approve.technical",
    name: "ProductoForm - Aprobacion tecnica",
    description: "Botón de aprobación técnica de producto",
    area: "actions",
    readonly: false,
  },
  // The codes the sales-order controller's `can()` checks resolve to.
  {
    code: "orders.edit-prices",
    name: "PCPlus-Editar precios",
    description: "Editar precios en pedidos",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.view-sales-sector",
    name: "PedidosForm - Sector de ventas",
    description: "Visualización del campo sector de ventas",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.edit-delivery-date",
    name: "PedidoForm - Edicion fecha de entrega",
    description: "Edición de la fecha de entrega",
    area: "actions",
    readonly: false,
  },

  // ── New Mobius-native concepts (English names) ────────────────────────────
  {
    code: "finished-goods.edit",
    name: "Finished goods",
    description: "Edit finished-goods master data",
    area: "masters",
  },
  {
    code: "paper-stock.edit",
    name: "Paper stock",
    description: "Edit paper stock",
    area: "masters",
  },
  {
    code: "sheet-stock.edit",
    name: "Sheet stock",
    description: "Edit sheet stock",
    area: "masters",
  },
  {
    code: "tooling.edit",
    name: "Tooling",
    description: "Edit tooling master data",
    area: "masters",
  },
  {
    code: "warehouses.edit",
    name: "Warehouses",
    description: "Edit warehouses and warehouse locations",
    area: "masters",
  },
  {
    code: "consumable-supplies.edit",
    name: "Consumable supplies",
    description: "Edit consumable supplies",
    area: "masters",
  },
  {
    code: "consumable-stock.edit",
    name: "Consumable stock",
    description: "Edit consumable stock",
    area: "masters",
  },
  {
    code: "tooling-stock.edit",
    name: "Tooling stock",
    description: "Edit tooling stock",
    area: "masters",
  },
  {
    code: "settings.edit",
    name: "Settings",
    description: "Edit company application settings",
    area: "actions",
    readonly: false,
  },
  {
    code: "files.manage",
    name: "Files",
    description: "Manage the admin-gated file operations",
    area: "actions",
    readonly: false,
  },
];

/**
 * Mobius-added action gates (enrichment D9, specs/parts/08-approvals.md) —
 * RW-only by default; `audit.read` is the one exception, so a role can be
 * granted read access to the audit log without export.
 */
export const MOBIUS_ADDED_PERMISSIONS: IPermissionConcept[] = [
  {
    code: "parts.approve.dimensions",
    name: "Partes - Aprobación de medidas",
    description: "Botón de aprobación de medidas de la parte",
    area: "actions",
  },
  {
    code: "parts.approve.technical",
    name: "Partes - Aprobación técnica",
    description: "Botón de aprobación técnica de la parte",
    area: "actions",
  },
  {
    code: "parts.approve.sketch",
    name: "Partes - Aprobación de boceto",
    description: "Botón de aprobación de boceto de la parte",
    area: "actions",
  },
  {
    code: "parts.approve.part",
    name: "Partes - Aprobación de parte",
    description: "Botón de aprobación final de la parte",
    area: "actions",
  },
  {
    code: "parts.approve.bulk",
    name: "Partes - Aprobación masiva",
    description: "Aprobación/desaprobación masiva de partes",
    area: "actions",
  },
  {
    code: "countdown.manage",
    name: "Countdown - Administración",
    description:
      "Administración del módulo Countdown: borrar documentos, asignar responsables y gestionar rubros y grupos",
    area: "actions",
  },
  {
    // The code carries the hyphenated module slug (`node-files`); only the
    // database key drops the hyphen (see src/database/keys.ts).
    code: "node-files.manage",
    name: "Node Files - Administración",
    description:
      "Administración del módulo Node Files: eliminar flujos de extracción de documentos",
    area: "actions",
  },
  {
    code: "audit.read",
    name: "Auditoría — ver",
    description:
      "Consulta del registro de auditoría: listado, detalle e historial de un registro",
    area: "queries",
    readonly: true,
  },
  {
    code: "audit.export",
    name: "Auditoría — exportar",
    description: "Exportación del registro de auditoría a CSV",
    area: "queries",
  },
  {
    // RW-only, like the other action gates above: a read-only variant of an
    // action gate is meaningless, and listing devices is part of approving them.
    code: "devices.approve",
    name: "Dispositivos - Aprobación",
    description: "Aprobar y revocar dispositivos de los usuarios de la empresa",
    area: "actions",
  },
];

/** Name of the protected all-permissions role seeded per company. */
export const ADMIN_ROLE_NAME = "Admin";

/** Name of the per-company baseline role seeded alongside Admin. */
export const MEMBER_ROLE_NAME = "Member";

/**
 * Codes granted to Member at seed time — preserves today's member reach: the
 * four stock/consumable concepts in full, and read-only customer/
 * customer-category access.
 */
export const MEMBER_BASELINE_CODES: readonly string[] = [
  "consumable-types.edit",
  "consumable-supplies.edit",
  "consumable-stock.edit",
  "tooling-stock.edit",
  "customers.edit.readonly",
  "customer-categories.edit.readonly",
];
