/**
 * The reminder schedule, the reminder window and the digest.
 *
 * `shouldRunAt` is pure precisely so this matrix can exist: the alternative is
 * waiting for 08:00 on a Tuesday to find out whether the batch fires. Buenos
 * Aires is UTC-3 year round (Argentina has not observed DST since 2009), so the
 * instants below convert by subtracting three hours.
 *
 * The weekend rows are the load-bearing ones: an offset that lands on a Saturday
 * is skipped, never deferred to Monday, because by Monday the offset has moved
 * and no longer matches. That is a product decision, not an oversight.
 *
 * `buildDigest` is pure for the same reason, and for one more: `sendModuleEmail`
 * deliberately never logs a body, so this file is the ONLY place the wording of
 * a digest can be verified at all — a local run proves nothing about it.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type {
  ICountdownDigestInput,
  ICountdownDueDocumentRow,
  ICountdownReminderRecipient,
} from "../../../dao/countdown/countdown-reminder.dao";
import type { IModuleEmail } from "../../../services/module-email.service";

const mockReminderDAO = {
  findDue: jest.fn<(today: string) => Promise<ICountdownDueDocumentRow[]>>(),
  findDigestedUserIds: jest.fn<(sendDate: string) => Promise<Set<number>>>(),
  findRecipients:
    jest.fn<(userIds: number[]) => Promise<ICountdownReminderRecipient[]>>(),
  recordDigest: jest.fn<(input: ICountdownDigestInput) => Promise<void>>(),
};

const mockAssignmentDAO = {
  effectiveUserIds:
    jest.fn<
      (documentIds: number[], kind: string) => Promise<Map<number, Set<number>>>
    >(),
};

const mockSendModuleEmail =
  jest.fn<(email: IModuleEmail) => Promise<boolean>>();

// Methods, never property initialisers: the service module constructs one
// instance of itself at import time, and a property initialiser would touch
// these bindings before they exist.
jest.mock("../../../dao/countdown/countdown-reminder.dao", () => ({
  CountdownReminderDAO: class {
    findDue(today: string) {
      return mockReminderDAO.findDue(today);
    }
    findDigestedUserIds(sendDate: string) {
      return mockReminderDAO.findDigestedUserIds(sendDate);
    }
    findRecipients(userIds: number[]) {
      return mockReminderDAO.findRecipients(userIds);
    }
    recordDigest(input: ICountdownDigestInput) {
      return mockReminderDAO.recordDigest(input);
    }
  },
}));

jest.mock("../../../dao/countdown/countdown-assignment.dao", () => ({
  CountdownAssignmentDAO: class {
    effectiveUserIds(documentIds: number[], kind: string) {
      return mockAssignmentDAO.effectiveUserIds(documentIds, kind);
    }
  },
}));

jest.mock("../../../services/module-email.service", () => ({
  sendModuleEmail: (email: IModuleEmail) => mockSendModuleEmail(email),
}));

import {
  shouldRunAt,
  SEND_HOUR,
  isInReminderWindow,
  buildDigest,
  CountdownRemindersService,
} from "../../../services/countdown/countdown-reminders.service";

describe("countdown reminder schedule — shouldRunAt", () => {
  it("stays quiet before 08:00 Buenos Aires on a weekday", () => {
    // 2026-08-11 is a Tuesday. 10:59Z = 07:59 BA.
    expect(shouldRunAt(new Date("2026-08-11T10:59:00Z"))).toBe(false);
  });

  it("fires from 08:00 Buenos Aires on a weekday", () => {
    // 11:00Z = 08:00 BA, the first eligible tick.
    expect(shouldRunAt(new Date("2026-08-11T11:00:00Z"))).toBe(true);
  });

  it("stays eligible for the rest of the weekday", () => {
    // The hourly tick keeps returning true; the daily claim in
    // countdown_reminder_runs is what stops a second batch, not this predicate.
    expect(shouldRunAt(new Date("2026-08-11T23:00:00Z"))).toBe(true); // 20:00 BA
  });

  it("never fires on Saturday or Sunday, whatever the hour", () => {
    // 2026-08-15 Saturday, 2026-08-16 Sunday, both at 12:00Z = 09:00 BA.
    expect(shouldRunAt(new Date("2026-08-15T12:00:00Z"))).toBe(false);
    expect(shouldRunAt(new Date("2026-08-16T12:00:00Z"))).toBe(false);
  });

  it("judges the weekend by the Buenos Aires day, not the UTC one", () => {
    // 2026-08-17T00:30Z is already Monday in UTC but still 21:30 on Sunday in
    // Buenos Aires — reading the server's day here would send on a Sunday night.
    expect(shouldRunAt(new Date("2026-08-17T00:30:00Z"))).toBe(false);
    // And the mirror case: Saturday 01:00Z is Friday 22:00 BA, a valid weekday.
    expect(shouldRunAt(new Date("2026-08-15T01:00:00Z"))).toBe(true);
  });
});

describe("countdown reminder window", () => {
  it("opens at the document's own threshold and never closes again", () => {
    // A document with a 10-day threshold: out at 11 days, in from 10, and still
    // in a month after it went overdue. The old exact-offset match answered
    // false everywhere except 7/3/1/0 — a missed weekday silenced it for good.
    expect(isInReminderWindow(11, 10)).toBe(false);
    expect(isInReminderWindow(10, 10)).toBe(true);
    expect(isInReminderWindow(5, 10)).toBe(true);
    expect(isInReminderWindow(1, 10)).toBe(true);
    expect(isInReminderWindow(0, 10)).toBe(true);
    expect(isInReminderWindow(-1, 10)).toBe(true);
    expect(isInReminderWindow(-30, 10)).toBe(true);
  });

  it("treats a threshold of 0 as 'only from the due date onward'", () => {
    expect(isInReminderWindow(1, 0)).toBe(false);
    expect(isInReminderWindow(0, 0)).toBe(true);
    expect(isInReminderWindow(-3, 0)).toBe(true);
  });

  it("runs the batch at 08:00 local time", () => {
    expect(SEND_HOUR).toBe(8);
  });
});

describe("countdown digest — buildDigest", () => {
  const TODAY = "2026-08-13";

  it("prints the worked example verbatim, both sections, in order", () => {
    // Deliberately unsorted input: the comparator is what puts the most overdue
    // first and the soonest first, in both sections.
    const { subject, body } = buildDigest(
      "Ana",
      [
        { title: "Certificado ISO", dueDate: "2026-08-23" },
        { title: "Póliza ART", dueDate: "2026-08-12" },
        { title: "Contrato alquiler", dueDate: "2026-08-13" },
        { title: "Habilitación municipal", dueDate: "2026-08-10" },
      ],
      TODAY,
    );

    expect(subject).toBe("Documentos vencidos y próximos a vencer (4)");
    expect(body).toBe(
      [
        "Hola Ana,",
        "",
        "Vencidos",
        "- Habilitación municipal — vencido hace 3 días",
        "- Póliza ART — vencido hace 1 día",
        "",
        "Próximos a vencer",
        "- Contrato alquiler — vence hoy",
        "- Certificado ISO — vence en 10 días",
      ].join("\n"),
    );
  });

  it("omits the Vencidos section — heading included — when nothing is overdue", () => {
    const { subject, body } = buildDigest(
      "Ana",
      [
        { title: "Contrato alquiler", dueDate: "2026-08-13" },
        { title: "Certificado ISO", dueDate: "2026-08-23" },
      ],
      TODAY,
    );

    expect(subject).toBe("Documentos próximos a vencer (2)");
    expect(body).toBe(
      [
        "Hola Ana,",
        "",
        "Próximos a vencer",
        "- Contrato alquiler — vence hoy",
        "- Certificado ISO — vence en 10 días",
      ].join("\n"),
    );
    expect(body).not.toContain("Vencidos");
  });

  it("still writes to a recipient whose documents are all overdue", () => {
    const { subject, body } = buildDigest(
      "Beto",
      [
        { title: "Póliza ART", dueDate: "2026-08-12" },
        { title: "Habilitación municipal", dueDate: "2026-07-14" },
      ],
      TODAY,
    );

    expect(subject).toBe("Documentos vencidos y próximos a vencer (2)");
    expect(body).toBe(
      [
        "Hola Beto,",
        "",
        "Vencidos",
        "- Habilitación municipal — vencido hace 30 días",
        "- Póliza ART — vencido hace 1 día",
      ].join("\n"),
    );
    expect(body).not.toContain("Próximos a vencer");
  });

  it("writes each of the five line shapes", () => {
    const { body } = buildDigest(
      "Ana",
      [
        { title: "Dos días", dueDate: "2026-08-15" },
        { title: "Mañana", dueDate: "2026-08-14" },
        { title: "Hoy", dueDate: "2026-08-13" },
        { title: "Ayer", dueDate: "2026-08-12" },
        { title: "Anteayer", dueDate: "2026-08-11" },
      ],
      TODAY,
    );

    expect(body).toContain("- Anteayer — vencido hace 2 días");
    expect(body).toContain("- Ayer — vencido hace 1 día");
    expect(body).toContain("- Hoy — vence hoy");
    expect(body).toContain("- Mañana — vence mañana");
    expect(body).toContain("- Dos días — vence en 2 días");
  });

  it("breaks a same-day tie on the title, in Spanish", () => {
    const { body } = buildDigest(
      "Ana",
      [
        { title: "Ñandú", dueDate: "2026-08-20" },
        { title: "Alquiler", dueDate: "2026-08-20" },
        { title: "Zapatería", dueDate: "2026-08-20" },
      ],
      TODAY,
    );

    expect(body.split("\n").slice(-3)).toEqual([
      "- Alquiler — vence en 7 días",
      "- Ñandú — vence en 7 días",
      "- Zapatería — vence en 7 días",
    ]);
  });

  it("adds the link block only when COUNTDOWN_APP_URL is set", () => {
    const previous = process.env.COUNTDOWN_APP_URL;
    delete process.env.COUNTDOWN_APP_URL;
    const withoutLink = buildDigest(
      "Ana",
      [{ title: "Contrato", dueDate: "2026-08-13" }],
      TODAY,
    );
    expect(withoutLink.body).not.toContain("Verlo en Countdown:");

    process.env.COUNTDOWN_APP_URL = "https://vencimientos.example";
    const withLink = buildDigest(
      "Ana",
      [{ title: "Contrato", dueDate: "2026-08-13" }],
      TODAY,
    );
    expect(withLink.body).toBe(
      [
        "Hola Ana,",
        "",
        "Próximos a vencer",
        "- Contrato — vence hoy",
        "",
        "Verlo en Countdown:",
        "https://vencimientos.example",
      ].join("\n"),
    );

    if (previous === undefined) delete process.env.COUNTDOWN_APP_URL;
    else process.env.COUNTDOWN_APP_URL = previous;
  });
});

describe("countdown reminder batch — run", () => {
  /** 15:00Z on 2026-08-13 is 12:00 in Buenos Aires: the same calendar day. */
  const NOW = new Date("2026-08-13T15:00:00Z");
  const TODAY = "2026-08-13";

  const dueRow = (
    overrides: Partial<ICountdownDueDocumentRow> = {},
  ): ICountdownDueDocumentRow => ({
    id: 1,
    title: "Contrato alquiler",
    dueDate: "2026-08-13",
    reminderDays: 7,
    offsetDays: 0,
    uploadedBy: 10,
    companyId: 100,
    ...overrides,
  });

  const recipient = (
    overrides: Partial<ICountdownReminderRecipient> = {},
  ): ICountdownReminderRecipient => ({
    id: 10,
    email: "ana@example.com",
    name: "Ana",
    isActive: true,
    companyId: 100,
    ...overrides,
  });

  beforeEach(() => {
    mockAssignmentDAO.effectiveUserIds.mockResolvedValue(
      new Map<number, Set<number>>(),
    );
    mockReminderDAO.findDigestedUserIds.mockResolvedValue(new Set<number>());
    mockReminderDAO.recordDigest.mockResolvedValue(undefined);
    mockSendModuleEmail.mockResolvedValue(true);
  });

  it("sends one digest for four in-scope documents, and records them all", async () => {
    mockReminderDAO.findDue.mockResolvedValue([
      dueRow({
        id: 1,
        title: "Habilitación",
        dueDate: "2026-08-10",
        offsetDays: -3,
      }),
      dueRow({ id: 2, title: "Póliza", dueDate: "2026-08-12", offsetDays: -1 }),
      dueRow({
        id: 3,
        title: "Alquiler",
        dueDate: "2026-08-13",
        offsetDays: 0,
      }),
      dueRow({ id: 4, title: "ISO", dueDate: "2026-08-20", offsetDays: 7 }),
    ]);
    mockReminderDAO.findRecipients.mockResolvedValue([recipient()]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail).toHaveBeenCalledTimes(1);
    const email = mockSendModuleEmail.mock.calls[0]?.[0];
    expect(email?.to).toBe("ana@example.com");
    expect(email?.subject).toBe("Documentos vencidos y próximos a vencer (4)");
    expect(email?.idempotencyKey).toBe(`countdown-digest-10-${TODAY}`);
    expect(outcome).toEqual({ sent: 1, failed: 0, skipped: 0 });

    // The per-document history keeps a signed offset: negative once overdue.
    expect(mockReminderDAO.recordDigest).toHaveBeenCalledWith({
      userId: 10,
      companyId: 100,
      sendDate: TODAY,
      documents: [
        { documentId: 1, offsetDays: -3 },
        { documentId: 2, offsetDays: -1 },
        { documentId: 3, offsetDays: 0 },
        { documentId: 4, offsetDays: 7 },
      ],
    });
  });

  it("never pairs a document with a recipient from another company", async () => {
    mockReminderDAO.findDue.mockResolvedValue([dueRow({ companyId: 100 })]);
    mockReminderDAO.findRecipients.mockResolvedValue([
      recipient({ companyId: 999 }),
    ]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });

  it("counts a skipped recipient once, however many documents they lost", async () => {
    // `skipped` is persisted to countdown_reminder_runs and is the signal for
    // whether the tenant rule stopped somebody's mail. Counting pairings would
    // make one external bookkeeper watching two documents read as 2, which is
    // indistinguishable from two deactivated accounts.
    mockReminderDAO.findDue.mockResolvedValue([
      dueRow({ id: 1, companyId: 100 }),
      dueRow({ id: 2, companyId: 100 }),
    ]);
    mockAssignmentDAO.effectiveUserIds.mockResolvedValue(
      new Map([
        [1, new Set([11])],
        [2, new Set([11])],
      ]),
    );
    mockReminderDAO.findRecipients.mockResolvedValue([
      recipient({ id: 11, companyId: 999 }),
    ]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });

  it("does not count a recipient as skipped when only some of their documents were foreign", async () => {
    // The case the reconciliation after the pairing loop exists for: user 11 is
    // same-tenant for document 1 and cross-tenant for document 2. They are
    // mailed, so they were not skipped — and the foreign document must not reach
    // the digest or the log.
    mockReminderDAO.findDue.mockResolvedValue([
      dueRow({ id: 1, companyId: 100, title: "Propio" }),
      dueRow({ id: 2, companyId: 999, title: "Ajeno" }),
    ]);
    mockAssignmentDAO.effectiveUserIds.mockResolvedValue(
      new Map([
        [1, new Set([11])],
        [2, new Set([11])],
      ]),
    );
    mockReminderDAO.findRecipients.mockResolvedValue([
      recipient({ id: 11, companyId: 100 }),
    ]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(outcome).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(mockSendModuleEmail.mock.calls[0][0].body).not.toContain("Ajeno");
    expect(mockReminderDAO.recordDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 11,
        companyId: 100,
        documents: [{ documentId: 1, offsetDays: 0 }],
      }),
    );
  });

  it("writes nothing to a recipient whose documents all fall outside the window", async () => {
    // The SQL cannot return this row; the service refuses it anyway, and this is
    // the assertion that says so with a spy rather than with a log line.
    mockReminderDAO.findDue.mockResolvedValue([
      dueRow({ offsetDays: 8, reminderDays: 7, dueDate: "2026-08-21" }),
    ]);
    mockReminderDAO.findRecipients.mockResolvedValue([recipient()]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail).not.toHaveBeenCalled();
    expect(mockReminderDAO.recordDigest).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("skips a deactivated recipient", async () => {
    mockReminderDAO.findDue.mockResolvedValue([dueRow()]);
    mockReminderDAO.findRecipients.mockResolvedValue([
      recipient({ isActive: false }),
    ]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });

  it("skips a recipient who already has today's digest", async () => {
    mockReminderDAO.findDue.mockResolvedValue([dueRow()]);
    mockReminderDAO.findRecipients.mockResolvedValue([recipient()]);
    mockReminderDAO.findDigestedUserIds.mockResolvedValue(new Set([10]));

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockReminderDAO.findDigestedUserIds).toHaveBeenCalledWith(TODAY);
    expect(mockSendModuleEmail).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 1 });
  });

  it("records nothing when the provider rejects the digest", async () => {
    // The crash rule, as far as it is testable: nothing recorded means the same
    // digest can be rebuilt later the same day, and the provider's idempotency
    // key is what stops a second delivery.
    mockReminderDAO.findDue.mockResolvedValue([dueRow()]);
    mockReminderDAO.findRecipients.mockResolvedValue([recipient()]);
    mockSendModuleEmail.mockResolvedValue(false);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockReminderDAO.recordDigest).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 1, skipped: 0 });
  });

  it("mails the watchers instead of the uploader once watchers are named", async () => {
    mockReminderDAO.findDue.mockResolvedValue([
      dueRow({ id: 1, uploadedBy: 10 }),
    ]);
    mockAssignmentDAO.effectiveUserIds.mockResolvedValue(
      new Map([[1, new Set([11, 12])]]),
    );
    mockReminderDAO.findRecipients.mockResolvedValue([
      recipient({ id: 11, email: "beto@example.com", name: "Beto" }),
      recipient({ id: 12, email: "carla@example.com", name: "Carla" }),
    ]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail).toHaveBeenCalledTimes(2);
    expect(mockSendModuleEmail.mock.calls.map((call) => call[0].to)).toEqual([
      "beto@example.com",
      "carla@example.com",
    ]);
    expect(outcome).toEqual({ sent: 2, failed: 0, skipped: 0 });
  });

  it("keeps mailing the rest of the batch when one recipient throws", async () => {
    // The day is already claimed by the time run() executes, so an escaping
    // throw meant everybody after the failure waited until the next weekday.
    mockReminderDAO.findDue.mockResolvedValue([
      dueRow({ id: 1, uploadedBy: 11 }),
      dueRow({ id: 2, uploadedBy: 12 }),
    ]);
    mockReminderDAO.findRecipients.mockResolvedValue([
      recipient({ id: 11, email: "beto@example.com", name: "Beto" }),
      recipient({ id: 12, email: "carla@example.com", name: "Carla" }),
    ]);
    mockReminderDAO.recordDigest.mockRejectedValueOnce(
      new Error("[CountdownReminderDAO] digest row could not be read"),
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockSendModuleEmail.mock.calls.map((call) => call[0].to)).toEqual([
      "beto@example.com",
      "carla@example.com",
    ]);
    expect(outcome).toEqual({ sent: 1, failed: 1, skipped: 0 });
  });

  it("does nothing at all when no document is in scope", async () => {
    mockReminderDAO.findDue.mockResolvedValue([]);

    const outcome = await new CountdownRemindersService().run(NOW);

    expect(mockReminderDAO.findRecipients).not.toHaveBeenCalled();
    expect(mockSendModuleEmail).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });
});
