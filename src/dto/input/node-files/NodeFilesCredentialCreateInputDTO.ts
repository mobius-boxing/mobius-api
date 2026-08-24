import {
  NODE_FILES_CREDENTIAL_TYPES,
  NodeFilesCredentialType,
} from "../../../interfaces/node-files/node-files.interfaces";
import { MAX_SECRET_LENGTH } from "../../../services/node-files/credential-crypto";
import { optionalText, requiredText } from "./NodeFilesFieldsInput";

/** RFC 7230 token — no spaces, no colon, and above all no CR/LF. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Creating a credential. The secret arrives here ONCE, in this payload, and is
 * never readable again through any endpoint: there is no update DTO on purpose
 * — rotating a credential is "create the new one, point the node at it, delete
 * the old one", which leaves a trail, instead of an in-place edit that does not.
 *
 * The secret is validated but never trimmed to a shorter form, never logged and
 * never echoed: `build()` returns the DTO, and the service hands the value
 * straight to `encryptSecret`.
 */
export class NodeFilesCredentialCreateInputDTO {
  name: string;
  type: NodeFilesCredentialType;
  headerName: string | null;
  secret: string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = typeof source.name === "string" ? source.name.trim() : "";
    const type = typeof source.type === "string" ? source.type.trim() : "bearer";
    if (
      !NODE_FILES_CREDENTIAL_TYPES.includes(type as NodeFilesCredentialType)
    ) {
      throw new Error(
        `Tipo de credencial inválido: usá ${NODE_FILES_CREDENTIAL_TYPES.join(", ")}`,
      );
    }
    this.type = type as NodeFilesCredentialType;
    this.headerName =
      optionalText(source.headerName, 100, "El nombre de la cabecera") ?? null;
    this.secret = typeof source.secret === "string" ? source.secret : "";
  }

  public build(): this {
    this.name = requiredText(this.name, 120, "El nombre");
    if (this.secret.trim() === "") {
      throw new Error("El secreto es obligatorio");
    }
    if (this.secret.length > MAX_SECRET_LENGTH) {
      throw new Error(
        `El secreto no puede superar los ${MAX_SECRET_LENGTH} caracteres`,
      );
    }

    if (this.type === "bearer") {
      // The header is fixed for a bearer token; accepting a name here would
      // suggest it does something.
      this.headerName = null;
      return this;
    }
    if (this.headerName === null || this.headerName === "") {
      throw new Error("Indicá el nombre de la cabecera");
    }
    if (!HEADER_NAME_PATTERN.test(this.headerName)) {
      throw new Error(`Nombre de cabecera inválido: "${this.headerName}"`);
    }
    return this;
  }
}
