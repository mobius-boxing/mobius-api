export interface ICompany {
  id?: number;
  uuid?: string;
  name: string;
  description?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  // Stats (optional, for special methods)
  userCount?: number;
}
