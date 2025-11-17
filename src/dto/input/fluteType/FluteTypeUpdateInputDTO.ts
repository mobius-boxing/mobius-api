export class FluteTypeUpdateInputDTO {
  code?: string;
  description?: string;
  fluteFactor?: number;
  length?: number;
  width?: number;
  height?: number;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.fluteFactor !== undefined) {
      this.fluteFactor =
        typeof data.fluteFactor === "string"
          ? parseFloat(data.fluteFactor)
          : data.fluteFactor;
    }
    if (data.length !== undefined) {
      this.length =
        typeof data.length === "string"
          ? parseFloat(data.length)
          : data.length;
    }
    if (data.width !== undefined) {
      this.width =
        typeof data.width === "string"
          ? parseFloat(data.width)
          : data.width;
    }
    if (data.height !== undefined) {
      this.height =
        typeof data.height === "string"
          ? parseFloat(data.height)
          : data.height;
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
