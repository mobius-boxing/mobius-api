export interface IPaperClass {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  name: string;
  papers: number[]; // Array of paper supply IDs
  createdAt?: Date;
  updatedAt?: Date;
}
