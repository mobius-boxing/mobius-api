export interface IPaperClass {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  name: string;
  // Paper-supply UUIDs (the interface always carried uuids despite the old
  // number[] annotation; storage is the paper_class_papers join).
  papers: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
