export class CorrugationCreateInputDTO {
  code: string;
  description?: string;
  theoreticalGrammage?: number;
  suggestedWidth?: number;
  caliper?: number;
  // SECURITY: Accept UUID from frontend, not numeric ID
  corrugationClassUuid?: string;

  constructor(data: any) {
    this.code = data.code;
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
  }

  public build(): this {
    return this;
  }
}
