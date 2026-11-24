export type Product = "full" | "lite";

export const PRODUCTS: readonly Product[] = ["full", "lite"];

export const isProduct = (value: unknown): value is Product =>
  value === "full" || value === "lite";

export const PRODUCT_LABEL: Record<Product, string> = {
  full: "Mobius",
  lite: "Mobius Lite",
};

let cached: Product | undefined;

const parseProduct = (raw: string | undefined): Product => {
  if (raw === undefined || raw === "") return "full";
  if (isProduct(raw)) return raw;
  throw new Error(
    `MOBIUS_PRODUCT must be "full" or "lite" (got "${raw}"); refusing to start.`,
  );
};

/** The product this process serves. Read once: it never changes while running. */
export const currentProduct = (): Product => {
  cached ??= parseProduct(process.env.MOBIUS_PRODUCT);
  return cached;
};

/** Test-only: forget the cached product so the next call re-reads the env. */
export const resetProductForTest = (): void => {
  cached = undefined;
};

/** `null` only in local dev: boot refuses a production process without both URLs (C-6). */
export const productAppUrl = (product: Product): string | null => {
  const raw =
    product === "full" ? process.env.APP_URL_FULL : process.env.APP_URL_LITE;
  return raw ? raw.replace(/\/+$/, "") : null;
};

export const validateProductConfig = (): void => {
  cached = undefined;
  currentProduct();
  if (process.env.NODE_ENV !== "production") return;
  const missing = (["APP_URL_FULL", "APP_URL_LITE"] as const).filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} must be set in production (WRONG_PRODUCT hints and reset emails need them); refusing to start.`,
    );
  }
};

export const wrongProductBody = (product: Product) => ({
  success: false as const,
  code: "WRONG_PRODUCT" as const,
  message: `This company uses ${PRODUCT_LABEL[product]}`,
  data: { product, appUrl: productAppUrl(product) },
});

/** A request that reached the API of the other product; the error middleware answers 409. */
export class WrongProductError extends Error {
  constructor(readonly product: Product) {
    super(`This company uses ${PRODUCT_LABEL[product]}`);
    this.name = "WrongProductError";
  }
}

export const wrongProductError = (product: Product): WrongProductError =>
  new WrongProductError(product);
