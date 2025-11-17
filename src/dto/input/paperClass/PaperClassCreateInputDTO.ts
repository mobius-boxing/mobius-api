export class PaperClassCreateInputDTO {
  code: string;
  name: string;
  papers: any;

  constructor(data: any) {
    this.code = data.code;
    this.name = data.name;
    this.papers = data.papers;
  }

  public build(): this {
    return this;
  }
}
