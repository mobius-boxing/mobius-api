export interface IBaseDAO<T> {
  create(item: T): Promise<T>;
  getById(id: number): Promise<T | null>;
  getByUuid(uuid: string): Promise<T | null>;
  update(id: number, item: Partial<T>): Promise<T | null>;
  delete(id: number): Promise<boolean>;
  getAll(page: number, limit: number): Promise<IDataPaginator<T>>;
}

export interface IDataPaginator<T> {
  success: boolean;
  data: T[];
  page: number;
  limit: number;
  count: number;
  totalCount: number;
  totalPages: number;
}
