import { ICustomer } from "../customer/customer.interfaces";
import { IProductType } from "../product-type/product-type.interfaces";
import { IBoxType } from "../box-type/box-type.interfaces";

export interface IProduct {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  clientCode?: string;
  description?: string;
  customerId?: number;
  revision?: number;
  vip?: boolean;
  productTypeId?: number | null;
  boxTypeId?: number | null;
  // File refs (Ficha/Plano/Boceto/Imagen → files.uuid)
  technicalSheetFileUuid?: string | null;
  blueprintFileUuid?: string | null;
  sketchFileUuid?: string | null;
  imageFileUuid?: string | null;
  // Approval pair (AprobacionProducto/CancelacionProducto; user = username snapshot)
  productApprovalAt?: Date | null;
  productApprovalBy?: string | null;
  productCancellationAt?: Date | null;
  productCancellationBy?: string | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  // Joined data
  customer?: ICustomer;
  productType?: IProductType;
  boxType?: IBoxType;
}
