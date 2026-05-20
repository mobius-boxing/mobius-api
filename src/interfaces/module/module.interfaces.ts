export interface IModule {
  id?: number;
  uuid: string;
  slug: string;
  name: string;
  description?: string | null;
  isCore: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
