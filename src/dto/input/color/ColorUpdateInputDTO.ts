export class ColorUpdateInputDTO {
  code?: string;
  name?: string;
  description?: string;
  observations?: string;
  tonality?: number | null;
  // SECURITY: Accept UUID from frontend, not numeric ID
  colorTypeUuid?: string | null;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
    if (data.description !== undefined) this.description = data.description;
    if (data.observations !== undefined) this.observations = data.observations;
    if (data.tonality !== undefined) {
      this.tonality =
        typeof data.tonality === "string"
          ? parseInt(data.tonality, 10)
          : data.tonality;
    }
    if (data.colorTypeUuid !== undefined) this.colorTypeUuid = data.colorTypeUuid;
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
