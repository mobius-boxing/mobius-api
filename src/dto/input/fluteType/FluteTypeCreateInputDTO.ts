export class FluteTypeCreateInputDTO {
  code: string;
  description?: string;
  fluteFactor?: number;
  length?: number;
  width?: number;
  height?: number;

  constructor(data: any) {
    this.code = data.code;
    this.description = data.description;
    this.fluteFactor =
      data.fluteFactor !== undefined && data.fluteFactor !== null && data.fluteFactor !== ""
        ? typeof data.fluteFactor === "string"
          ? parseFloat(data.fluteFactor)
          : data.fluteFactor
        : undefined;
    this.length =
      data.length !== undefined && data.length !== null && data.length !== ""
        ? typeof data.length === "string"
          ? parseFloat(data.length)
          : data.length
        : undefined;
    this.width =
      data.width !== undefined && data.width !== null && data.width !== ""
        ? typeof data.width === "string"
          ? parseFloat(data.width)
          : data.width
        : undefined;
    this.height =
      data.height !== undefined && data.height !== null && data.height !== ""
        ? typeof data.height === "string"
          ? parseFloat(data.height)
          : data.height
        : undefined;
  }

  public build(): this {
    return this;
  }
}
