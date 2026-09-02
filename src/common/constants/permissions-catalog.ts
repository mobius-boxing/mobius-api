/**
 * Permission catalogue — the 136 live permission concepts extracted from the
 * customer's Procusto instance (specs-refining/extracted/permissions.md,
 * 2026-06-26) with the stable Mobius codes proposed in
 * specs/replication/modules/02-identity-and-rbac/permissions-catalog.md.
 *
 * Each concept materializes as TWO permissions rows (read-write + read-only,
 * mirroring Procusto's SoloLectura pairing): the read-only variant's code is
 * `<code>.readonly`. The Spanish `name` is the legacy gate key — kept verbatim
 * for ETL matching; gate checks in Mobius use `code`.
 *
 * MOBIUS_ADDED_PERMISSIONS are enrichments (no Procusto source): fine-grained
 * Parts-approval gates per specs/parts/08-approvals.md (D9). Single RW rows —
 * a read-only variant of an action gate is meaningless.
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
  name: string; // Procusto Nombre (legacy gate key)
  description: string;
  forms?: string; // FormsAsociados (hyphen-delimited legacy screen names)
  area: PermissionArea;
  deprecated?: boolean;
}

export const PERMISSION_CONCEPTS: IPermissionConcept[] = [
  // ── A. Master data (maestros) ─────────────────────────────────────────────
  {
    code: "formulas.increments",
    name: "Aumentos en fórmulas",
    description: "Definición de aumentos en fórmulas",
    forms: "AumentosEnFormulasForm",
    area: "masters",
  },
  {
    code: "advanced.menu",
    name: "Avanzadas",
    description: "Menú de opciones avanzadas",
    forms: "DepositosForm-MaquinasForm-TiposDeMaquinasForm-UnidadesForm",
    area: "masters",
  },
  {
    code: "availability.calendars",
    name: "Calendarios de disponibilidades",
    description: "Edición de calendarios de disponibilidades",
    forms: "IntervalosForm",
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
    code: "paper.classes",
    name: "Clases de papeles",
    description: "Edición de clases de papeles",
    forms: "ClasesDePapelesForm",
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
    code: "colors.edit",
    name: "Colores",
    description: "Definición de colores",
    forms: "ColoresForm",
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
    code: "manufacturers.edit",
    name: "Fabricantes",
    description: "Edición del maestro de fabricantes",
    forms: "FabricantesForm",
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
    code: "models.edit",
    name: "Modelos de cajas",
    description: "Definición de modelos de cajas",
    forms: "ModelosForm",
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
    code: "stoppage-reasons.edit",
    name: "Motivos de detencion",
    description: "Definición de motivos de detención",
    forms: "MotivosDetencionForm",
    area: "masters",
  },
  {
    code: "quality.observations",
    name: "Observaciones de calidad",
    description: "Definición de tipos de problemas de calidad",
    forms: "ObsvervacionesDeCalidadForm",
    area: "masters",
  },
  {
    code: "production-orders.edit",
    name: "Ordenes de produccion",
    description: "Edición de órdenes de producción",
    forms: "OrdenesDeProduccionForm",
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
    code: "roles.edit",
    name: "Perfiles",
    description: "Definición de perfiles de usuario",
    forms: "PerfilesForm",
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
    code: "suppliers.edit",
    name: "Proveedores",
    description: "Edición del maestro de proveedores",
    forms: "ProveedoresForm",
    area: "masters",
  },
  {
    code: "contact-categories.edit",
    name: "Rubros de contacto",
    description: "Definición de rubros de contacto",
    forms: "RubrosDeContactoForm",
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
    code: "sectors.edit",
    name: "Sectores",
    description: "Definición de sectores",
    forms: "SectoresForm",
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
    code: "box-types.edit",
    name: "Tipos de cajas",
    description: "Edición de tipos de cajas",
    forms: "TiposDeCajasForm",
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
    code: "fsc-types.edit",
    name: "Tipos de FSC",
    description: "Definición de tipos de FSC",
    forms: "TiposDeFSCForm",
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
    code: "flute-types.edit",
    name: "Tipos de onda",
    description: "Definición de tipos de onda",
    forms: "TiposDeOndaForm",
    area: "masters",
  },
  {
    code: "pallet-types.edit",
    name: "Tipos de pallets",
    description: "Definición de tipos de pallets",
    forms: "TiposDePalletForm",
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
    code: "glue-types.edit",
    name: "Tipos de plegado",
    description: "Definición de tipos de plegado",
    forms: "TiposDePlegadoForm",
    area: "masters",
  },
  {
    code: "reel-problem-types.edit",
    name: "Tipos de problemas de bobinas",
    description: "Definición de tipos de problemas de bobinas",
    forms: "TiposDeProblemasDeBobinaForm",
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
    code: "carriers.edit",
    name: "Transportistas",
    description: "Definición de transportistas",
    forms: "TransportistasForm",
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
    code: "delivery-zones.edit",
    name: "Zonas de entrega",
    description: "Edición de zonas de entrega",
    forms: "ZonasDeEntregaForm",
    area: "masters",
  },

  // ── B. Production, scheduling & dispatch operations ───────────────────────
  {
    code: "dispatch.terminal",
    name: "Despacho",
    description: "Terminal de despacho",
    forms: "DespachoForm",
    area: "operations",
  },
  {
    code: "returns.edit",
    name: "Devoluciones",
    description: "Edición de devoluciones",
    forms: "DevolucionesForm",
    area: "operations",
  },
  {
    code: "reel-incidents.edit",
    name: "Incidencias de bobinas",
    description: "Edición de problemas en bobinas",
    forms: "IncidenciasBobinasForm",
    area: "operations",
  },
  {
    code: "scheduling.additional",
    name: "Programacion adicionales",
    description: "Programacion de tareas adicionales",
    forms: "ProgramacionAdicionalForm",
    area: "operations",
  },
  {
    code: "scheduling.corrugator",
    name: "Programacion corrugadora",
    description: "Programación de corrugadoras",
    forms: "ProgramacionCorrugadoraForm-ProgramacionCorrugadoraConCacheForm",
    area: "operations",
  },
  {
    code: "scheduling.machines",
    name: "Programacion maquinas",
    description: "Programación de máquinas",
    forms: "ProgramacionConversionForm-ProgramacionConversionFormConCacheForm",
    area: "operations",
  },
  {
    code: "scheduling.offline",
    name: "Programación de producción offline",
    description: "Programación de producción de interfaz online",
    forms: "ProgramasForm",
    area: "operations",
  },
  {
    code: "paper-needs.view",
    name: "Necesidades de papeles",
    description: "Consulta de necesidades de papeles",
    forms: "NecesidadDePapelesForm",
    area: "operations",
  },
  {
    code: "stock.terminal",
    name: "Stock de insumos",
    description: "Stock de insumos",
    forms: "StockForm",
    area: "operations",
  },
  {
    code: "corrugating.terminal",
    name: "Terminal de corrugado",
    description: "Seguimiento de corrugado",
    forms: "TerminalCorrugadoForm",
    area: "operations",
  },
  {
    code: "conversion.terminal",
    name: "Terminal de maquinas",
    description: "Seguimiento de máquinas",
    forms: "TerminalConversionForm",
    area: "operations",
  },

  // ── C. Consultas & reports ────────────────────────────────────────────────
  {
    code: "query.manufactured-supplies",
    name: "Consulta de insumos fabricados",
    description: "Consulta de insumos fabricados",
    forms: "ConsultaInsumosFabricadosForm",
    area: "queries",
  },
  {
    code: "query.orders-status",
    name: "Consulta de pedidos",
    description: "Consulta de status de pedidos",
    forms: "ConsultaPedidoForm",
    area: "queries",
  },
  {
    code: "query.dispatched-orders",
    name: "Consulta pedidos despachados",
    description: "Acceso a consulta de pedidos despachados",
    forms: "ConsultaPedidosDespachadosForm-PreciosPromedioForm-DespachosForm",
    area: "queries",
  },
  {
    code: "query.production",
    name: "Consulta de produccion",
    description: "Consulta de producción",
    forms: "ConsultaProduccionForm",
    area: "queries",
  },
  {
    code: "query.stock",
    name: "Consulta de stock",
    description: "Consulta de stock",
    forms: "StockDinamicoForm",
    area: "queries",
  },
  {
    code: "query.completed-tasks",
    name: "Consulta de tareas realizadas",
    description: "Consulta de tareas realizadas",
    forms: "ConsultaTareasRealizadasForm",
    area: "queries",
  },
  {
    code: "query.pending-scheduling",
    name: "Consulta pendientes de programación",
    description: "Consulta pendientes de programación",
    forms: "ConsultaPendientesDeProgramacionForm",
    area: "queries",
  },
  {
    code: "query.time-in-stock",
    name: "Consulta tiempo en stock",
    description: "Consulta tiempo en stock",
    forms: "ConsultaTiempoEnStock",
    area: "queries",
  },
  {
    code: "query.reel-consumption",
    name: "Consumo de bobinas",
    description: "Consulta de consumo de bobinas",
    forms: "UsosBobinasDinamicoForm",
    area: "queries",
  },
  {
    code: "query.production-estimates",
    name: "Estimaciones de produccion",
    description: "Consulta de estimaciones de produccion",
    forms: "ConsultarFinTareasProgramadasForm",
    area: "queries",
  },
  {
    code: "gantt.availability",
    name: "Gantt de disponibilidad",
    description: "Gantt de disponibilidad",
    forms: "GanttDisponibilidadForm",
    area: "queries",
  },
  {
    code: "gantt.production",
    name: "Gantt de produccion",
    description: "Gantt de producción",
    forms: "GanttProduccionForm",
    area: "queries",
  },
  {
    code: "gantt.scheduling",
    name: "Gantt de programacion",
    description: "Gantt de programación",
    forms: "GanttProgramacionForm",
    area: "queries",
  },
  {
    code: "query.price-indicators",
    name: "Indicadores de precios",
    description: "Indicadores de precios",
    forms: "ConsultaIndicadoresDePreciosForm",
    area: "queries",
  },
  {
    code: "query.task-inputs",
    name: "Insumos para tareas",
    description: "Consulta de insumos para tareas",
    forms: "ConsultaInputsDeTareasProgramadasForm",
    area: "queries",
  },
  {
    code: "query.stock-movements",
    name: "Movimientos de stock",
    description: "Consulta de movimientos de stock",
    forms: "MovimientosStockDinamicoForm",
    area: "queries",
  },
  {
    code: "query.supply-needs",
    name: "Necesidades de insumos",
    description: "Consulta de necesidades de insumos",
    forms: "ConsultaNecesidadesDeInsumosForm",
    area: "queries",
  },
  {
    code: "query.pending-orders",
    name: "Pedidos pendientes",
    description: "Consulta de pedidos pendientes",
    forms: "ConsultaPedidosPendientesForm",
    area: "queries",
  },
  {
    code: "report.daily",
    name: "Reporte diario",
    description: "Reporte diario",
    forms: "DiarioForm",
    area: "queries",
  },
  {
    code: "dashboard.control",
    name: "Tablero de control",
    description: "Tablero de control",
    forms: "ControlForm",
    area: "queries",
  },
  {
    code: "query.order-state",
    name: "Consulta estado de pedidos",
    description: "Acceso a consulta de estado de pedidos",
    forms: "EstadoPedidosForm",
    area: "queries",
  },

  // ── D. Action-level permissions (button/feature gates) ────────────────────
  {
    code: "parts.bulk-update-from-model",
    name: "Actualizar partes por modelo",
    description: "Actualización masiva de medidas de parte en base al modelo",
    area: "actions",
  },
  {
    code: "reel.edit-original-values",
    name: "BobinaForm - Edicion valores originales",
    description: "Bobinas - Editar peso/diámetro originales",
    area: "actions",
  },
  {
    code: "pandora.export",
    name: "Exportacion a Pandora",
    description: "Exportación de pedidos a Pandora",
    area: "actions",
  },
  {
    code: "pandora.export.manual-send",
    name: "ExportacionPandoraForm - Enviar manual",
    description: "Botón 'Enviar manual' export Pandora",
    area: "actions",
  },
  {
    code: "dispatch.select-no-stock-orders",
    name: "ItemDeCargaForm - Seleccionar pedidos sin stock",
    description: "Despacho - Seleccionar pedidos sin stock",
    area: "actions",
  },
  {
    code: "products.approve.technical",
    name: "ProductoForm - Aprobacion tecnica",
    description: "Botón de aprobación técnica de producto",
    area: "actions",
  },
  {
    code: "products.delete",
    name: "ProductosForm - Borrar",
    description: "Botón de borrado de productos",
    area: "actions",
  },
  {
    code: "scheduling.corrugator.manual-send",
    name: "ProgramacionCorrugadoraForm - Enviar manual",
    description: "'Tramo/Item manual' en programación corrugadora",
    area: "actions",
  },
  {
    code: "scheduling.machines.manual-send",
    name: "ProgramacionMaquinasForm - Enviar manual",
    description: "'Enviar manual' en programación de máquinas",
    area: "actions",
  },
  {
    code: "routes.delete",
    name: "RutasProduccionForm - Borrar",
    description: "Botón de borrado de rutas",
    area: "actions",
  },
  {
    code: "reel-stock.delete",
    name: "StockBobinasForm - Borrar",
    description: "Botón de borrado de stock de bobinas",
    area: "actions",
  },
  {
    code: "stock.delete",
    name: "StockForm - Borrado de stock",
    description: "Botón de borrado de stock",
    area: "actions",
  },
  {
    code: "stock.bulk-delete",
    name: "StockForm - Borrado masivo de stock",
    description: "Botón de borrado masivo de stock",
    area: "actions",
  },
  {
    code: "corrugating.edit-events",
    name: "TerminalCorrugadoForm - Editar eventos",
    description: "Edición de eventos de corrugado",
    area: "actions",
  },
  {
    code: "corrugating.mark-complete",
    name: "TerminalCorrugadoraForm - Cumplimiento",
    description: "Botón 'Dar por cumplido' corrugadora",
    area: "actions",
  },
  {
    code: "corrugating.report-incidents",
    name: "TerminalCorrugadoraForm - Reportar incidencias",
    description: "Reportar incidencias corrugadora",
    area: "actions",
  },
  {
    code: "corrugating.mount-reel",
    name: "TerminalCorrugadoraForm - Montar bobina",
    description: "Montado de bobinas",
    area: "actions",
  },
  {
    code: "corrugating.unmount-reel",
    name: "TerminalCorrugadoraForm - Desmontar bobina",
    description: "Desmontado de bobinas",
    area: "actions",
  },
  {
    code: "corrugating.mount-reel-barcode",
    name: "TerminalCorrugadoraForm - Montar bobinas codigo de barras",
    description: "Montado con código de barras",
    area: "actions",
  },
  {
    code: "conversion.change-machine",
    name: "TerminalMaquinaForm - Cambiar tarea de máquina",
    description: "Cambio de máquina de tarea",
    area: "actions",
  },
  {
    code: "conversion.edit-events",
    name: "TerminalMaquinaForm - Editar eventos",
    description: "Edición de eventos de máquinas",
    area: "actions",
  },
  {
    code: "conversion.mark-complete",
    name: "TerminalMaquinasForm - Cumplimiento",
    description: "Botón 'Dar por cumplido' máquinas",
    area: "actions",
  },
  {
    code: "conversion.report-incidents",
    name: "TerminalMaquinasForm - Reportar incidencias",
    description: "Reportar incidencias máquinas",
    area: "actions",
  },
  {
    code: "carriers.edit-name",
    name: "TransportistaForm - Edicion del nombre",
    description: "Edición del nombre del transportista",
    area: "actions",
  },
  {
    code: "prices.visible",
    name: "Visibilidad de precios",
    description: "Visibilidad de precios",
    area: "actions",
  },
  {
    code: "production-orders.generate",
    name: "Generar órdenes de producción",
    description: "Generación de órdenes de producción",
    area: "actions",
  },
  {
    code: "quotes.approve",
    name: "PCPlus - Aprobación de cotizaciones",
    description: "Aprobación de cotizaciones en PC+",
    area: "actions",
  },
  {
    code: "orders.edit-prices",
    name: "PCPlus-Editar precios",
    description: "Editar precios en pedidos",
    area: "actions",
  },
  {
    code: "orders.edit-delivery-date",
    name: "PedidoForm - Edicion fecha de entrega",
    description: "Edición de la fecha de entrega",
    area: "actions",
  },
  {
    code: "orders.approve.commercial",
    name: "PedidosForm - Aprobacion comercial",
    description: "Botón de aprobación comercial",
    area: "actions",
  },
  {
    code: "orders.approve.financial",
    name: "PedidosForm - Aprobacion financiera",
    description: "Botón de aprobación financiera",
    area: "actions",
  },
  {
    code: "orders.delete",
    name: "PedidosForm - Borrar",
    description: "Botón de borrado de pedidos",
    area: "actions",
  },
  {
    code: "orders.manual-fulfillment",
    name: "PedidosForm - Cumplimiento manual",
    description: "Botón de cumplimiento manual",
    area: "actions",
  },
  {
    code: "orders.enable-for-scheduling",
    name: "PedidosForm - Habilitacion",
    description: "Botón de habilitación para programa",
    area: "actions",
  },
  {
    code: "orders.view-sales-sector",
    name: "PedidosForm - Sector de ventas",
    description: "Visualización del campo sector de ventas",
    area: "actions",
  },

  // ── E. Sales / PLUS, PCC, Maintenance (PCM) ───────────────────────────────
  {
    code: "customer-categories.edit",
    name: "Categorias de clientes",
    description: "Edición de categorias de clientes",
    forms: "CategoriasDeClientesForm",
    area: "sales-plus",
  },
  {
    code: "payment-terms.edit",
    name: "Condiciones de pago",
    description: "Definición de condiciones de pago",
    forms: "CondicionesDePagoForm",
    area: "sales-plus",
  },
  {
    code: "brands.edit",
    name: "Marcas comerciales",
    description: "Definición de marcas comerciales",
    forms: "MarcasForm",
    area: "sales-plus",
  },
  {
    code: "currencies.edit",
    name: "Monedas",
    description: "Definiciones de monedas y su paridad",
    forms: "MonedasForm - ParidadesForm",
    area: "sales-plus",
  },
  {
    code: "orders.edit",
    name: "Pedidos",
    description: "Edición de pedidos",
    forms: "PedidosForm",
    area: "sales-plus",
  },
  {
    code: "plus.config",
    name: "PCPlus-Configuracion",
    description: "Edición de maestros y costos en PC+",
    forms:
      "TarifariosForm-AumentarTarifasForm-AumentosPorClienteForm-CategoriasDeTarifariosForm-TarifasForm-ConceptosForm-MotivosRecargoForm-MotivosRechazoForm-MotivosDescuentoForm-AdicionalesForm-LimitesCreditoForm-SituacionesDePagoForm-CotizacionesForm-CostosForm",
    area: "sales-plus",
  },
  {
    code: "pcp.orders",
    name: "PCP-Pedidos",
    description: "Registro de pedidos",
    forms: "PedidosForm",
    area: "sales-plus",
  },
  {
    code: "pcm.config",
    name: "Configuracion de mantenimiento",
    description: "Configuración de PCM",
    area: "maintenance",
  },
  {
    code: "pcm.masters",
    name: "Maestros de mantenimiento",
    description: "Edición de maestros de mantenimiento",
    forms:
      "TiposDeProblemasDeMantenimientoForm-PartesDeMaquinaForm-EquiposForm-SeccionesForm-RepuestosForm",
    area: "maintenance",
  },
  {
    code: "pcm.interventions",
    name: "Intervenciones",
    description: "Registro de intervenciones de mantenimiento",
    forms: "IntervencionesForm",
    area: "maintenance",
  },
  {
    code: "pcm.requests",
    name: "Solicitudes",
    description: "Edición de solicitudes de mantenimiento",
    forms: "SolicitudesForm",
    area: "maintenance",
  },
  {
    code: "pcc.config",
    name: "PCC-Configuracion",
    description: "Configuración de PCC",
    area: "sales-plus",
  },
  {
    code: "pcc.quotes",
    name: "PCC-Cotizaciones",
    description: "Registro de cotizaciones",
    area: "sales-plus",
  },
  {
    code: "pcc.masters",
    name: "PCC-Maestros",
    description: "Maestros de datos",
    area: "sales-plus",
  },
  {
    code: "pcc.prices",
    name: "PCC-Precios",
    description: "Registro de tarifarios",
    area: "sales-plus",
  },
  {
    code: "pcp.assign-salespeople",
    name: "PCP-Asignar vendedores",
    description: "Asignar vendedores a clientes",
    forms: "AsignacionVendedorAClientesForm",
    area: "sales-plus",
  },
  {
    code: "pcp.config",
    name: "PCP-Configuracion",
    description: "Configuración de PCP",
    area: "sales-plus",
  },

  // ── Live-only concepts (11 — version drift beyond the decompiled seeder;
  //    names verbatim from the live dump, codes coined here) ─────────────────
  {
    code: "scrap.edit",
    name: "Descarte",
    description: "Edición de descarte",
    area: "operations",
  },
  {
    code: "economic-groups.edit",
    name: "Grupos económicos",
    description: "Definición de grupos económicos",
    area: "masters",
  },
  {
    code: "gantt.production.legacy",
    name: "Gantt producción",
    description: "Gantt de producción (variante legada)",
    area: "queries",
    deprecated: true,
  },
  {
    code: "gantt.scheduling.legacy",
    name: "Gantt programación",
    description: "Gantt de programación (variante legada)",
    area: "queries",
    deprecated: true,
  },
  {
    code: "production-incidents.edit",
    name: "Incidencias de produccion",
    description: "Edición de incidencias de producción",
    forms: "IncidenciasProduccionForm",
    area: "operations",
  },
  {
    code: "query.order-indicators",
    name: "Indicadores de pedidos",
    description: "Indicadores de pedidos",
    area: "queries",
  },
  {
    code: "papers.edit",
    name: "Papeles",
    description: "Edición de papeles",
    forms: "PapelesForm",
    area: "masters",
  },
  {
    code: "scrap-points.edit",
    name: "Puntos de descarte",
    description: "Definición de puntos de descarte",
    area: "masters",
  },
  {
    code: "commercial-segments.edit",
    name: "Rubros comerciales",
    description: "Definición de rubros comerciales",
    area: "masters",
  },
  {
    code: "reel-stock.terminal",
    name: "Stock de bobinas",
    description: "Stock de bobinas",
    area: "operations",
  },
  {
    code: "incident-types.edit",
    name: "Tipos de incidencia",
    description: "Definición de tipos de incidencias de producción",
    forms: "TiposDeIncidenciaForm",
    area: "masters",
  },
];

/**
 * Mobius-added action gates (enrichment D9, specs/parts/08-approvals.md) —
 * single RW rows, no read-only variant.
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
  },
  {
    code: "audit.export",
    name: "Auditoría — exportar",
    description: "Exportación del registro de auditoría a CSV",
    area: "queries",
  },
];

/**
 * The 15 live Procusto profiles (extracted/permissions.md §B) — seeded per
 * company as starter roles ("copy all of them for now", 2026-07-18). Grants are
 * NOT seeded: the per-profile PerfilPermiso rows come from ETL at migration.
 * TipoDePerfil int → profileType per the authoritative 5-member Domain enum.
 */
export const PROFILE_TYPE_BY_LEGACY: Record<number, string> = {
  0: "director",
  1: "general",
  2: "productionManager",
  3: "qualityManager",
  4: "salesperson",
};

export const PROCUSTO_PROFILE_TEMPLATES: Array<{
  name: string;
  profileType: string;
  legacyId: number;
}> = [
  { name: "ADMINISTRADOR DE STOCK", profileType: "general", legacyId: 1 },
  { name: "CONTABILIDAD", profileType: "general", legacyId: 2 },
  { name: "CONTROL DE CALIDAD", profileType: "general", legacyId: 3 },
  { name: "CORRUGADORA", profileType: "general", legacyId: 4 },
  { name: "DESPACHO", profileType: "general", legacyId: 5 },
  { name: "FACTURACION", profileType: "general", legacyId: 6 },
  { name: "GERENTE DE VENTAS", profileType: "director", legacyId: 7 },
  { name: "IMPRESORA", profileType: "general", legacyId: 8 },
  { name: "PLANIFICACION", profileType: "general", legacyId: 9 },
  { name: "PRESIDENCIA", profileType: "general", legacyId: 10 },
  { name: "VENTAS", profileType: "salesperson", legacyId: 11 },
  {
    name: "RESPONSABLE DE PRODUCCION",
    profileType: "productionManager",
    legacyId: 12,
  },
  {
    name: "RESPONSABLE DE CALIDAD",
    profileType: "qualityManager",
    legacyId: 13,
  },
  { name: "VENDEDOR", profileType: "salesperson", legacyId: 1002 },
  { name: "prueba", profileType: "general", legacyId: 1003 },
];

/** Name of the protected all-permissions role seeded per company. */
export const ADMIN_ROLE_NAME = "Admin";
