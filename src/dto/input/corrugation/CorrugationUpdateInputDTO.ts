export class CorrugationUpdateInputDTO {
  code?: string;
  description?: string;
  theoreticalGrammage?: number;
  suggestedWidth?: number;
  caliper?: number;
  // SECURITY: Accept UUID from frontend, not numeric ID
  corrugationClassUuid?: string;
  // Capas — when present the whole stack is reconciled against what is stored
  // ([] clears it). `uuid` identifies which stored layer a row is, so an edit
  // updates that row instead of recreating it; it is an identity reference
  // only, never written (an unknown uuid becomes a new server-minted row).
  layers?: Array<{
    uuid?: string;
    position?: number;
    isLiner?: boolean;
    paperClassUuid?: string;
    fluteTypeUuid?: string;
  }>;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.theoreticalGrammage !== undefined) {
      this.theoreticalGrammage =
        typeof data.theoreticalGrammage === "string"
          ? parseFloat(data.theoreticalGrammage)
          : data.theoreticalGrammage;
    }
    if (data.suggestedWidth !== undefined) {
      this.suggestedWidth =
        typeof data.suggestedWidth === "string"
          ? parseFloat(data.suggestedWidth)
          : data.suggestedWidth;
    }
    if (data.caliper !== undefined) {
      this.caliper =
        typeof data.caliper === "string"
          ? parseFloat(data.caliper)
          : data.caliper;
    }
    if (data.corrugationClassUuid !== undefined) {
      this.corrugationClassUuid = data.corrugationClassUuid;
    }
    if (Array.isArray(data.layers)) {
      this.layers = data.layers.map((layer: any) => ({
        uuid: typeof layer?.uuid === "string" ? layer.uuid : undefined,
        position:
          typeof layer?.position === "string"
            ? parseInt(layer.position, 10)
            : layer?.position,
        isLiner: layer?.isLiner === true,
        paperClassUuid: layer?.paperClassUuid,
        fluteTypeUuid: layer?.fluteTypeUuid,
      }));
    }
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
