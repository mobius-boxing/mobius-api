import ExcelJS from "exceljs";
import {
  CountdownDocumentStatus,
  ICountdownDocument,
} from "../../interfaces/countdown/countdown.interfaces";
import { todayInBuenosAires } from "../../utils/buenosAiresDay";
import { describeRecurrence } from "./countdown-recurrence";

const STATUS_LABEL: Record<CountdownDocumentStatus, string> = {
  pending: "Pendiente",
  resolved: "Resuelto",
};

/**
 * A due date is a calendar date, and Excel stores dates as offsets from an
 * epoch in whatever timezone the writer assumed. Anchoring at midday UTC is what
 * keeps "vence el 5" from arriving as the 4th on a machine west of Greenwich —
 * the same off-by-one the DATE column exists to prevent.
 */
function calendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Assigned resolvers, groups first, as one printable cell. */
function people(document: ICountdownDocument): string {
  const names = [
    ...document.resolvers.groups.map((group) => group.name),
    ...document.resolvers.users.map((user) => user.name),
  ];
  return names.join(", ");
}

export class CountdownExportService {
  /**
   * One sheet, one row per document, in the order the screen shows them.
   *
   * Dates go in as real dates and money as a real number, so the columns sort
   * and sum in Excel. A spreadsheet whose amounts are strings is a screenshot
   * with extra steps.
   */
  async build(documents: ICountdownDocument[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Countdown";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Vencimientos", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Título", key: "title", width: 38 },
      { header: "Emisor", key: "issuer", width: 22 },
      { header: "Nº de referencia", key: "reference", width: 18 },
      { header: "Rubro", key: "category", width: 18 },
      { header: "Sub-rubro", key: "subcategory", width: 18 },
      {
        header: "Vence",
        key: "dueDate",
        width: 12,
        style: { numFmt: "dd/mm/yyyy" },
      },
      { header: "Días", key: "days", width: 8 },
      { header: "Estado", key: "status", width: 12 },
      { header: "Repetición", key: "recurrence", width: 14 },
      { header: "Asignado a", key: "assigned", width: 24 },
      { header: "Resuelto por", key: "resolvedBy", width: 18 },
      {
        header: "Resuelto el",
        key: "resolvedAt",
        width: 16,
        style: { numFmt: "dd/mm/yyyy hh:mm" },
      },
      {
        header: "Importe",
        key: "amount",
        width: 14,
        style: { numFmt: "#,##0.00" },
      },
      { header: "Moneda", key: "currency", width: 9 },
      { header: "Creado por", key: "createdBy", width: 18 },
      {
        header: "Creado el",
        key: "createdAt",
        width: 16,
        style: { numFmt: "dd/mm/yyyy hh:mm" },
      },
    ];

    for (const document of documents) {
      sheet.addRow({
        title: document.title,
        issuer: document.issuer ?? "",
        reference: document.referenceNumber ?? "",
        category: document.category?.name ?? "",
        subcategory: document.subcategory?.name ?? "",
        dueDate: calendarDate(document.dueDate),
        days: document.daysUntilDue,
        status: STATUS_LABEL[document.status],
        recurrence: document.recurrence
          ? describeRecurrence(
              document.recurrence.count,
              document.recurrence.unit,
            )
          : "",
        assigned: people(document),
        resolvedBy: document.resolvedByName ?? "",
        resolvedAt: document.resolvedAt ?? "",
        amount: document.amountCents === null ? "" : document.amountCents / 100,
        currency: document.currency,
        createdBy: document.uploadedBy?.name ?? "",
        createdAt: document.createdAt,
      });
    }

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };

    // exceljs types the return as ExcelJS.Buffer (an ArrayBuffer-alike).
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /**
   * `vencimientos-2026-08-07.xlsx` — sortable, and unambiguous in any locale.
   *
   * Built in Buenos Aires time, not UTC. `toISOString()` would name the file
   * after tomorrow for the three hours between 21:00 and midnight local, which
   * is the same off-by-one day this module polices everywhere else.
   */
  fileName(now: Date = new Date()): string {
    return `vencimientos-${todayInBuenosAires(now)}.xlsx`;
  }
}
