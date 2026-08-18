import {
  CountdownCategoryDAO,
  CountdownSubcategoryDAO,
  ICountdownCategoryRow,
  ICountdownSubcategoryRow,
} from "../../dao/countdown/countdown-category.dao";
import { ICountdownCategory } from "../../interfaces/countdown/countdown.interfaces";

/**
 * A failure that already knows which HTTP answer it deserves. The countdown
 * services (rubros, grupos, documents) share it: the controllers translate it
 * into `req.statusCode = <status>; next(new Error(message))` and never have to
 * guess a status from a message.
 *
 * Messages are Spanish and shown verbatim — they were written for the people
 * using the screens, not for developers.
 */
export class CountdownServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CountdownServiceError";
  }
}

/** Plural agreement matters here — the message is shown verbatim to an admin. */
function inUse(
  count: number,
  what: "rubro" | "sub-rubro",
): CountdownServiceError {
  const documents = count === 1 ? "1 documento" : `${count} documentos`;
  return new CountdownServiceError(
    409,
    `No se puede eliminar: ${documents} ${count === 1 ? "usa" : "usan"} este ${what}`,
  );
}

export class CountdownCategoriesService {
  private categories = new CountdownCategoryDAO();
  private subcategories = new CountdownSubcategoryDAO();

  /**
   * Every lookup takes the caller's companyId: a uuid from another company
   * resolves to nothing and comes back as "no encontrado", so the API never
   * confirms that another tenant's rubro exists (L-009).
   */
  private async requireCategoryId(
    companyId: number,
    uuid: string,
  ): Promise<number> {
    const id = await this.categories.getIdByUuid(uuid, companyId);
    if (!id) throw new CountdownServiceError(404, "Rubro no encontrado");
    return id;
  }

  private async requireSubcategory(
    companyId: number,
    uuid: string,
  ): Promise<ICountdownSubcategoryRow> {
    const subcategory = await this.subcategories.findByUuid(uuid, companyId);
    if (!subcategory) {
      throw new CountdownServiceError(404, "Sub-rubro no encontrado");
    }
    return subcategory;
  }

  /** Readable by every module user: filing a document may name a rubro. */
  list(companyId: number): Promise<ICountdownCategory[]> {
    return this.categories.list(companyId);
  }

  async get(companyId: number, uuid: string): Promise<ICountdownCategory> {
    const category = (await this.categories.list(companyId)).find(
      (candidate) => candidate.uuid === uuid,
    );
    if (!category) throw new CountdownServiceError(404, "Rubro no encontrado");
    return category;
  }

  async create(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownCategory> {
    if (await this.categories.findByName(companyId, name)) {
      throw new CountdownServiceError(409, "Ya existe un rubro con ese nombre");
    }
    const created = await this.categories.create(companyId, uuid, name);
    return {
      uuid: created.uuid,
      name: created.name,
      subcategories: [],
      documentCount: 0,
      createdAt: created.createdAt,
    };
  }

  async rename(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownCategory> {
    const id = await this.requireCategoryId(companyId, uuid);
    const clash = await this.categories.findByName(companyId, name);
    if (clash && clash.id !== id) {
      throw new CountdownServiceError(409, "Ya existe un rubro con ese nombre");
    }
    await this.categories.rename(companyId, id, name);
    return this.get(companyId, uuid);
  }

  /**
   * Refused while anything still points at it, counting documents on its
   * sub-rubros too. Nulling them silently would throw away data an admin
   * deliberately entered, and the FKs are ON DELETE RESTRICT anyway — this only
   * turns a database error into a sentence.
   *
   * Returns the deleted row so the caller can audit what disappeared.
   */
  async remove(
    companyId: number,
    uuid: string,
  ): Promise<ICountdownCategoryRow> {
    const category = await this.categories.getByUuid(uuid, companyId);
    if (!category) throw new CountdownServiceError(404, "Rubro no encontrado");
    const count = await this.categories.countDocuments(companyId, category.id);
    if (count > 0) throw inUse(count, "rubro");
    await this.categories.delete(companyId, category.id);
    return category;
  }

  async createSubcategory(
    companyId: number,
    categoryUuid: string,
    uuid: string,
    name: string,
  ): Promise<ICountdownCategory> {
    const categoryId = await this.requireCategoryId(companyId, categoryUuid);
    if (await this.subcategories.findByName(categoryId, name)) {
      throw new CountdownServiceError(
        409,
        "Ya existe un sub-rubro con ese nombre",
      );
    }
    await this.subcategories.create(categoryId, uuid, name);
    return this.get(companyId, categoryUuid);
  }

  async renameSubcategory(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownCategory> {
    const subcategory = await this.requireSubcategory(companyId, uuid);

    const clash = await this.subcategories.findByName(
      subcategory.categoryId,
      name,
    );
    if (clash && clash.id !== subcategory.id) {
      throw new CountdownServiceError(
        409,
        "Ya existe un sub-rubro con ese nombre",
      );
    }

    await this.subcategories.rename(companyId, subcategory.id, name);

    // The screen edits sub-rubros inside their rubro, so it gets the whole
    // rubro back — including the counts the delete guard will quote.
    const category = (await this.categories.list(companyId)).find((candidate) =>
      candidate.subcategories.some((entry) => entry.uuid === uuid),
    );
    if (!category) throw new CountdownServiceError(404, "Rubro no encontrado");
    return category;
  }

  async removeSubcategory(
    companyId: number,
    uuid: string,
  ): Promise<ICountdownSubcategoryRow> {
    const subcategory = await this.requireSubcategory(companyId, uuid);
    const count = await this.subcategories.countDocuments(
      companyId,
      subcategory.id,
    );
    if (count > 0) throw inUse(count, "sub-rubro");
    await this.subcategories.delete(companyId, subcategory.id);
    return subcategory;
  }

  /**
   * Turn the uuids a client sends into the serial ids `countdown_documents`
   * stores, and refuse a sub-rubro that belongs to a different rubro —
   * otherwise a document could claim "Servicios / IVA" and no constraint would
   * notice.
   */
  async resolveForDocument(
    companyId: number,
    categoryUuid: string | undefined,
    subcategoryUuid: string | undefined,
  ): Promise<{ categoryId: number | null; subcategoryId: number | null }> {
    if (!categoryUuid) {
      if (subcategoryUuid) {
        throw new CountdownServiceError(
          400,
          "Elegí un rubro antes del sub-rubro",
        );
      }
      return { categoryId: null, subcategoryId: null };
    }

    const categoryId = await this.requireCategoryId(companyId, categoryUuid);
    if (!subcategoryUuid) return { categoryId, subcategoryId: null };

    const subcategory = await this.requireSubcategory(
      companyId,
      subcategoryUuid,
    );
    if (subcategory.categoryId !== categoryId) {
      throw new CountdownServiceError(
        400,
        "El sub-rubro no pertenece a ese rubro",
      );
    }

    return { categoryId, subcategoryId: subcategory.id };
  }
}
