import { sendModuleEmail } from "../../module-email.service";
import {
  configInput,
  INodeRunContext,
  INodeRunResult,
  INodeType,
  INodeValidationContext,
  NodeConfigError,
  NodeExecutionError,
  optionalConfigText,
  requiredConfigText,
} from "./node-type";
import { renderTemplate, templatePaths } from "./template";

/**
 * The Email node: templated text to a fixed list of recipients.
 *
 * **No attachments (brief D-3).** `sendModuleEmail` takes
 * `{ to, subject, body, idempotencyKey }` and supports no attachment of any
 * kind; adding one means changing a live service that countdown's reminder
 * digests share, for a flag nobody has asked for. The node sends text.
 *
 * Recipients are NOT templated on purpose. `{{...}}` in a `to:` turns an
 * extracted value — model output, from a document an outsider may have
 * uploaded — into a destination address, which is how a workflow becomes an
 * open relay. Subject and body are templated; the address list is a literal a
 * human typed.
 *
 * `sendModuleEmail` never throws and returns whether the provider ACCEPTED the
 * message: it answers `false` on a laptop (no key, non-production) exactly as it
 * does when Resend rejects the call. The node therefore records `delivered` in
 * its output and does not fail the run on `false` — a mail service the module
 * cannot distinguish from a dev environment is not evidence that the workflow
 * is broken, and the node run row carries the truth either way.
 */

const MAX_RECIPIENTS = 10;

/** Deliberately permissive, deliberately not an RFC parser. */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function parseRecipients(raw: string, label: string): string[] {
  const recipients = raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (recipients.length === 0) {
    throw new NodeConfigError(`${label} no puede estar vacío`);
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new NodeConfigError(
      `${label}: máximo ${MAX_RECIPIENTS} destinatarios`,
    );
  }
  for (const recipient of recipients) {
    if (!EMAIL_PATTERN.test(recipient)) {
      throw new NodeConfigError(`Dirección inválida en ${label}: ${recipient}`);
    }
  }
  return recipients;
}

/**
 * Every `{{path}}` in a template must resolve at save time against the shape
 * the run will have — otherwise the failure surfaces an hour later as a failed
 * run instead of now, in the editor, next to the typo.
 */
function assertTemplatePaths(
  text: string,
  ctx: INodeValidationContext,
  label: string,
): void {
  const declared = new Set(ctx.fields.map((field) => field.key));
  for (const path of templatePaths(text)) {
    const [root, second] = path.split(".");
    if (root === "fields") {
      if (second === undefined || !declared.has(second)) {
        throw new NodeConfigError(
          `${label}: el flujo no declara el campo "${second ?? ""}"`,
        );
      }
      continue;
    }
    if (root === "document" || root === "nodes") continue;
    throw new NodeConfigError(
      `${label}: "${path}" no existe (usá fields., document. o nodes.)`,
    );
  }
}

export const emailNode: INodeType = {
  type: "email",
  label: "Enviar email",
  description:
    "Envía un email de texto con los valores del documento. Sin adjuntos.",
  handles: ["out"],
  acceptsInput: true,
  configSchema: [
    configInput({
      key: "to",
      label: "Para",
      input: "text",
      required: true,
      placeholder: "compras@empresa.com, pagos@empresa.com",
      help: "Direcciones separadas por comas. No admite {{plantillas}}.",
    }),
    configInput({
      key: "cc",
      label: "CC",
      input: "text",
      required: false,
      help: "Opcional, direcciones separadas por comas.",
    }),
    configInput({
      key: "subject",
      label: "Asunto",
      input: "text",
      required: true,
      templated: true,
      placeholder: "Factura {{fields.numero}} recibida",
    }),
    configInput({
      key: "body",
      label: "Mensaje",
      input: "textarea",
      required: true,
      templated: true,
      placeholder: "Total: {{fields.total}}",
    }),
  ],

  validate(config: Record<string, unknown>, ctx: INodeValidationContext): void {
    parseRecipients(requiredConfigText(config, "to", "Para", 500), "Para");
    const cc = optionalConfigText(config, "cc", "CC", 500);
    if (cc !== null) parseRecipients(cc, "CC");

    const subject = requiredConfigText(config, "subject", "El asunto", 200);
    const body = requiredConfigText(config, "body", "El mensaje", 10_000);
    assertTemplatePaths(subject, ctx, "El asunto");
    assertTemplatePaths(body, ctx, "El mensaje");
  },

  credentialRefs(): string[] {
    return [];
  },

  async run(
    ctx: INodeRunContext,
    config: Record<string, unknown>,
  ): Promise<INodeRunResult> {
    const to = parseRecipients(String(config.to ?? ""), "Para");
    const ccRaw = typeof config.cc === "string" ? config.cc.trim() : "";
    const cc = ccRaw === "" ? [] : parseRecipients(ccRaw, "CC");

    const source = {
      document: ctx.document,
      fields: ctx.fields,
      nodes: ctx.nodes,
    };
    const subject = renderTemplate(String(config.subject ?? ""), source);
    const body = renderTemplate(String(config.body ?? ""), source);
    if (subject.trim() === "") {
      throw new NodeExecutionError(
        "El asunto quedó vacío tras reemplazar los valores",
      );
    }

    // One send per recipient: `sendModuleEmail` takes a single address, and a
    // per-recipient call is also what keeps one bad address from silently
    // dropping the whole list.
    const results: Array<{ to: string; delivered: boolean }> = [];
    for (const recipient of [...to, ...cc]) {
      const delivered = await sendModuleEmail({ to: recipient, subject, body });
      ctx.log(`email → ${recipient}: ${delivered ? "aceptado" : "no enviado"}`);
      results.push({ to: recipient, delivered });
    }

    return {
      output: {
        subject,
        recipients: results,
        delivered: results.every((entry) => entry.delivered),
      },
      handle: "out",
    };
  },
};
