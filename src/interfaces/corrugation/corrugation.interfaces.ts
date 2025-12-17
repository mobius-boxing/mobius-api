import { ICorrugationClass } from "../corrugation-class/corrugation-class.interfaces";

export interface ICorrugation {
  id?: number;
  uuid?: string;
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
}
