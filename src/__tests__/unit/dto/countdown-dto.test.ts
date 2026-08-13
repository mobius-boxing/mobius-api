/**
 * Countdown input DTOs.
 *
 * The host's `inputValidator` only rejects an empty object, so `build()` is the
 * whole of this module's input validation: the database carries no CHECK
 * constraints (host rule), which means an invariant that is not asserted here is
 * not asserted anywhere. The messages are Spanish because they are shown
 * verbatim to the person who typed the value.
 *
 * No database, no mocks — construct the DTO, call `build()`, watch it throw.
 */
import { describe, it, expect } from "@jest/globals";
import {
  CountdownAssignmentsInputDTO,
  CountdownDocumentCreateInputDTO,
  CountdownDocumentStatusInputDTO,
  CountdownDocumentUpdateInputDTO,
} from "../../../dto/input/countdown";

const CATEGORY = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const USER = "11111111-2222-4333-8444-555555555555";

/** A payload that must always be accepted, so each case varies exactly one thing. */
const validDocument = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  title: "Factura",
  category: CATEGORY,
  dueDate: "2026-03-10",
  ...overrides,
});

const buildCreate = (overrides: Record<string, unknown> = {}) =>
  new CountdownDocumentCreateInputDTO(validDocument(overrides)).build();

describe("CountdownDocumentCreateInputDTO", () => {
  it("accepts a valid payload, trimming and defaulting as documented", () => {
    const dto = buildCreate({
      title: " Factura de luz ",
      amountCents: "1500",
      resolverUsers: USER,
    });

    expect(dto.title).toBe("Factura de luz");
    // The browser posts a single-option <select> as a bare value, not a list.
    expect(dto.resolverUsers).toEqual([USER]);
    expect(dto.amountCents).toBe(1500);
    expect(dto.currency).toBe("ARS");
  });

  it("requires a title", () => {
    expect(() =>
      new CountdownDocumentCreateInputDTO({
        category: CATEGORY,
        dueDate: "2026-03-10",
      }).build(),
    ).toThrow("El título es obligatorio");
  });

  it("requires a rubro — nothing is filed without one", () => {
    expect(() =>
      new CountdownDocumentCreateInputDTO({
        title: "Factura",
        dueDate: "2026-03-10",
      }).build(),
    ).toThrow("Elegí un rubro");
  });

  it("rejects a date the calendar does not have", () => {
    // `new Date()` would roll this into March: a due date that silently moves is
    // exactly what this module exists to prevent.
    expect(() => buildCreate({ dueDate: "2026-02-31" })).toThrow(
      "Fecha inexistente",
    );
  });

  it("rejects a date that is not ISO 'YYYY-MM-DD'", () => {
    expect(() => buildCreate({ dueDate: "10/03/2026" })).toThrow(
      "Formato de fecha inválido (YYYY-MM-DD)",
    );
  });

  it("rejects a negative amount", () => {
    expect(() => buildCreate({ amountCents: -1 })).toThrow(
      "El importe no puede ser negativo",
    );
  });

  it("rejects a fractional amount — money crosses the wire as integer cents", () => {
    expect(() => buildCreate({ amountCents: 15.9 })).toThrow(
      "El importe debe ser un número entero de centavos",
    );
  });

  it("rejects a recurrence count with no unit", () => {
    expect(() => buildCreate({ recurrenceCount: 2 })).toThrow(
      "Indicá cada cuántos días, meses o años se repite",
    );
  });

  it("rejects a recurrence unit with no count", () => {
    expect(() => buildCreate({ recurrenceUnit: "month" })).toThrow(
      "Indicá cada cuántos días, meses o años se repite",
    );
  });

  it("caps the recurrence count at 365", () => {
    expect(() =>
      buildCreate({ recurrenceCount: 400, recurrenceUnit: "day" }),
    ).toThrow("Máximo 365");
  });

  it("accepts a reminder threshold of 0 — 'avisar sólo desde el vencimiento'", () => {
    expect(buildCreate({ reminderDays: 0 }).reminderDays).toBe(0);
  });

  it("accepts a reminder threshold inside the bounds", () => {
    expect(buildCreate({ reminderDays: "20" }).reminderDays).toBe(20);
  });

  it("leaves an omitted reminder threshold to the column default", () => {
    // D-8: existing API callers and fixtures never mention the field and must
    // never start getting 400s — the column default (7) is the answer.
    expect(buildCreate().reminderDays).toBeUndefined();
    expect(buildCreate({ reminderDays: "" }).reminderDays).toBeUndefined();
    expect(buildCreate({ reminderDays: null }).reminderDays).toBeUndefined();
  });

  it("rejects a fractional or non-numeric reminder threshold", () => {
    for (const value of ["5.5", "abc", 5.5]) {
      expect(() => buildCreate({ reminderDays: value })).toThrow(
        "Los días de aviso deben ser un número entero",
      );
    }
  });

  it("rejects a negative reminder threshold", () => {
    expect(() => buildCreate({ reminderDays: -1 })).toThrow(
      "Mínimo 0 días de aviso",
    );
  });

  it("caps the reminder threshold at 365", () => {
    expect(() => buildCreate({ reminderDays: 366 })).toThrow(
      "Máximo 365 días de aviso",
    );
  });

  it("rejects an assignment target that is not a uuid", () => {
    expect(() => buildCreate({ resolverUsers: ["not-a-uuid"] })).toThrow(
      "Identificador inválido en resolverUsers",
    );
  });

  it("rejects more than 50 targets in a bucket", () => {
    expect(() =>
      buildCreate({ watcherGroups: new Array(51).fill(USER) }),
    ).toThrow("Máximo 50 destinatarios en watcherGroups");
  });
});

describe("CountdownDocumentUpdateInputDTO", () => {
  it("keeps only the fields actually sent — an empty string means 'not provided'", () => {
    const dto = new CountdownDocumentUpdateInputDTO({
      title: "Nuevo",
      issuer: "",
    }).build();

    expect(Object.keys(dto)).toEqual(["title"]);
  });

  it("refuses a patch with nothing in it", () => {
    expect(() => new CountdownDocumentUpdateInputDTO({}).build()).toThrow(
      "No hay cambios para aplicar",
    );
  });

  it("refuses a one-sided recurrence on the patch too", () => {
    expect(() =>
      new CountdownDocumentUpdateInputDTO({ recurrenceUnit: "month" }).build(),
    ).toThrow("Indicá cada cuántos días, meses o años se repite");

    expect(() =>
      new CountdownDocumentUpdateInputDTO({ recurrenceCount: 3 }).build(),
    ).toThrow("Indicá cada cuántos días, meses o años se repite");
  });

  it("takes the reminder threshold on its own — a one-field patch is a patch", () => {
    // The L-007 trap in miniature: if `reminderDays` were not carried here,
    // this build() would throw "No hay cambios para aplicar" instead.
    const dto = new CountdownDocumentUpdateInputDTO({
      reminderDays: 12,
    }).build();

    expect(Object.keys(dto)).toEqual(["reminderDays"]);
    expect(dto.reminderDays).toBe(12);
  });

  it("applies the same reminder-threshold bounds as the create DTO", () => {
    expect(() =>
      new CountdownDocumentUpdateInputDTO({ reminderDays: 366 }).build(),
    ).toThrow("Máximo 365 días de aviso");

    expect(() =>
      new CountdownDocumentUpdateInputDTO({ reminderDays: -1 }).build(),
    ).toThrow("Mínimo 0 días de aviso");
  });

  it("applies the same calendar and money rules as the create DTO", () => {
    expect(() =>
      new CountdownDocumentUpdateInputDTO({ dueDate: "2026-02-31" }).build(),
    ).toThrow("Fecha inexistente");

    expect(() =>
      new CountdownDocumentUpdateInputDTO({ amountCents: -5 }).build(),
    ).toThrow("El importe no puede ser negativo");
  });
});

describe("CountdownDocumentStatusInputDTO", () => {
  it("accepts resolving with a renewal", () => {
    const dto = new CountdownDocumentStatusInputDTO({
      status: "resolved",
      renew: true,
      nextDueDate: "2026-04-01",
    }).build();

    expect(dto.status).toBe("resolved");
    expect(dto.renew).toBe(true);
    expect(dto.nextDueDate).toBe("2026-04-01");
  });

  it("refuses to renew while reopening — that would leave two live copies", () => {
    expect(() =>
      new CountdownDocumentStatusInputDTO({
        status: "pending",
        renew: true,
      }).build(),
    ).toThrow("Sólo se puede renovar al resolver");
  });

  it("refuses a status outside the two the column carries", () => {
    expect(() =>
      new CountdownDocumentStatusInputDTO({ status: "cancelled" }).build(),
    ).toThrow("Estado inválido: usá pending o resolved");
  });
});

describe("CountdownAssignmentsInputDTO", () => {
  it("defaults every bucket to empty — the PUT replaces the whole set", () => {
    const dto = new CountdownAssignmentsInputDTO({}).build();

    expect(dto.resolverUsers).toEqual([]);
    expect(dto.resolverGroups).toEqual([]);
    expect(dto.watcherUsers).toEqual([]);
    expect(dto.watcherGroups).toEqual([]);
  });

  it("rejects a target that is not a uuid", () => {
    expect(
      () => new CountdownAssignmentsInputDTO({ watcherUsers: ["nope"] }),
    ).toThrow("Identificador inválido en watcherUsers");
  });
});
