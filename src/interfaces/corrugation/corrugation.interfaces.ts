import { ICorrugationClass } from "../corrugation-class/corrugation-class.interfaces";

/**
 * One Capa of a Corrugado (corrugation_layers). External shape: FK targets are
 * exposed as nested {uuid, ...} objects, never numeric ids.
 */
export interface ICorrugationLayer {
  id?: number;
  uuid?: string;
  position: number;
  isLiner: boolean;
  paperClassId?: number | null;
  fluteTypeId?: number | null;
  // Related entities (populated by DAO joins)
  paperClass?: { uuid: string; code?: string; description?: string } | null;
  fluteType?: { uuid: string; code?: string; description?: string } | null;
}

export interface ICorrugation {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  description?: string;
  theoreticalGrammage?: number;
  suggestedWidth?: number;
  caliper?: number;
  corrugationClassId?: number;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  corrugationClass?: ICorrugationClass;
  layers?: ICorrugationLayer[];
}
