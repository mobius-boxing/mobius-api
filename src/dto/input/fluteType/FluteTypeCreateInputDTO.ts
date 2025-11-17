export class FluteTypeCreateInputDTO {
  code: string;
  description: string;
  fluteFactor: number;
  length: number;
  width: number;
  height: number;

  constructor(data: any) {
    this.code = data.code;
    this.description = data.description;
    this.fluteFactor =
      typeof data.fluteFactor === "string"
        ? parseFloat(data.fluteFactor)
        : data.fluteFactor;
    this.length =
      typeof data.length === "string"
        ? parseFloat(data.length)
        : data.length;
    this.width =
      typeof data.width === "string"
        ? parseFloat(data.width)
        : data.width;
    this.height =
      typeof data.height === "string"
        ? parseFloat(data.height)
        : data.height;
  }

  public build(): this {
    return this;
  }
}
