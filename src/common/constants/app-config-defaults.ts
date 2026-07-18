/**
 * Default configuration catalogue — the 82 live keys extracted from the customer's
 * Procusto `ItemsDeConfiguracion` dump (specs-refining/extracted/config-values.md,
 * 2026-06-26). Key names are kept VERBATIM (including Spanish accents) for parity
 * and ETL matching. Types per
 * specs/replication/modules/01-system-and-cross-cutting/configuration.md.
 *
 * A company without an app_config row for a key gets the default below — rows are
 * only written when a value is changed (divergence D3/D4: no null-row auto-insert).
 */

export type AppConfigValueType = "bool" | "int" | "double" | "short" | "string";

export interface IAppConfigDefault {
  key: string;
  valueType: AppConfigValueType;
  defaultValue: string;
}

const bool = (key: string, defaultValue: boolean): IAppConfigDefault => ({
  key,
  valueType: "bool",
  defaultValue: defaultValue ? "True" : "False",
});
const int = (key: string, defaultValue: number): IAppConfigDefault => ({
  key,
  valueType: "int",
  defaultValue: String(defaultValue),
});
const short = (key: string, defaultValue: number): IAppConfigDefault => ({
  key,
  valueType: "short",
  defaultValue: String(defaultValue),
});
const double = (key: string, defaultValue: number): IAppConfigDefault => ({
  key,
  valueType: "double",
  defaultValue: String(defaultValue),
});
const str = (key: string, defaultValue = ""): IAppConfigDefault => ({
  key,
  valueType: "string",
  defaultValue,
});

export const APP_CONFIG_DEFAULTS: IAppConfigDefault[] = [
  bool("ActivarChequeoPesoBobinasMontadas", true),
  bool("ActivarChequeosAlMontarBobinas", true),
  int("AdvertenciaCantidadRutas", 40),
  int("AdvertenciaConsumo", 10),
  bool("AdvertenciaStockPapeles", false),
  bool("AdvertenciaStockPedidosMismoProducto", true),
  ...Array.from({ length: 16 }, (_, i) => str(`AliasTr${i + 1}`)),
  int("AnticipacionCalendarios", 0),
  bool("AsignarCantidadProgramadaEtapaAnterior", false),
  short("CajasPorPaquetePorDefecto", 0),
  int("CantidadCopiasPlanillaDespacho", 0),
  double("CantidadMaximaEnOrdenes", 0),
  int("CantidadProductosCreadosAVisualizar", 0),
  double("ChapetonPorDefecto", 0),
  bool("CombinarConCorrugadoOriginal", false),
  bool("ConsiderarLosUltimosProductosCreados", false),
  bool("CopiarDatosDeBobinas", true),
  bool("DejarRestoEnOrigenAlReimputarStock", true),
  int("DetailVersion", 34),
  str("DirectorioImagenes"),
  bool("EstimacionesDeProduccion", false),
  bool("FechaDelServidor", true),
  str("FormulaRecalculoPeso"),
  bool("InvertirLargoAnchoNombramientoPlanchas", false),
  bool("LotesDeInsumos", false),
  int("MajorVersion", 2),
  bool("ManejoArchivos", true),
  bool("MarcasNoEditables", true),
  int("MinorVersion", 1),
  bool("MostrarProgramadoEnImpresion", true),
  bool("NoAgregarOrdenes", false),
  bool("NoDespacharDesfinanciados", true),
  bool("OcultarPedidosAsociadosEnDespacho", false),
  bool("OrdenesHabilitadasPorDefecto", false),
  short("PaquetesPorPalletPorDefecto", 0),
  bool("PedirLogin", false),
  bool("PermitirCualquierPlancha", false),
  bool("PermitirEdicionDeCodigoDePlanchas", false),
  bool("PermitirEdicionDePalletsParaItemsConPalletizado", false),
  // Accented key preserved verbatim from Procusto — do not normalize.
  bool("PermitirModificaciónDeNumeroDeOrdenDeProducción", false),
  bool("PesoEditableEnPartes", false),
  bool("PlanchasPermitenSimilares", true),
  short("PlanchasPorPalletPorDefecto", 0),
  bool("PrecargarPapeles", true),
  bool("PriorizarMedidasExternas", false),
  bool("ProgramacionAutomatica", false),
  int("ProximoRemito", 0),
  int("ProximoVale", 0),
  bool("SoloHabilitarAprobados", true),
  bool("SoloMostrarProgramables", true),
  bool("SugerirDepositoOutputs", true),
  double("SuperposicionAletasPorDefecto", 0),
  str("TamanoHoja"),
  double("ToleranciaAnchosBobinas", 0),
  double("ToleranciaCompletitudBobinas", 0),
  double("ToleranciaCorrugado", 10),
  double("ToleranciaCumplimiento", 100),
  double("ToleranciaGramajesSimilares", 490),
  double("ToleranciaProduccion", 10),
  double("ToleranciaProgramacion", 200),
  double("ToleranciaRelativaCumplimiento", 0),
  double("ToleranciaRelativaProgramacion", 0),
  double("ToleranciaStock", 10),
  bool("VerProductosAprobadosPorDefecto", false),
  int("VersionAjusteCodigo", 0),
  bool("VerSoloProductosTitulares", false),
  bool("VerUltimaRevisionPorDefecto", false),
];

export const APP_CONFIG_DEFAULTS_BY_KEY: Map<string, IAppConfigDefault> =
  new Map(APP_CONFIG_DEFAULTS.map((d) => [d.key, d]));
