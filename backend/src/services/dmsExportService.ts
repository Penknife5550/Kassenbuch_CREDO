import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { Prisma } from '@prisma/client';
import { absolutePathFor } from './uploadService';
import { config } from '../config';
import { decimalToNumber } from '../utils/decimal';
import {
  BookingForMapping,
  BuiltLine,
  buildPayloadLine,
  getMappingCached,
} from './dmsMappingService';
import { buildSpcPayload, renderQrPng } from './qrService';

// ─── CREDO-Stil (synchron zu pdfService.ts) ────────────────────────────────
const CREDO_PRIMARY = rgb(0x57 / 255, 0x57 / 255, 0x56 / 255);
const CREDO_GRAY = rgb(0x9d / 255, 0x9d / 255, 0x9c / 255);
const CREDO_YELLOW = rgb(0xff / 255, 0xd5 / 255, 0x00);
const BLACK = rgb(0, 0, 0);

// A4 in PDF-Points (72dpi)
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 40;

// ─── Eingabe-Shape ─────────────────────────────────────────────────────────
export interface ExportReceipt {
  id: string;
  originalName: string;
  mimeType: string;
  storagePath: string;
  sha256: string;
  uploadedAt: Date;
  uploadedByName: string;
  belegart: { code: string; label: string } | null;
}

export interface ExportBooking extends BookingForMapping {
  receipts: ExportReceipt[];
}

export interface ExportFilter {
  schoolIds: string[];
  dateFrom: Date;
  dateTo: Date;
  belegartIds: string[];
  includeWithoutReceipts: boolean;
}

export interface ExportOptions {
  bookings: ExportBooking[];
  filter: ExportFilter;
  schoolsById: Record<string, { name: string; code: string }>;
  generatedAt: Date;
  generatedByName: string;
  datevMandantenNr: string | null;
}

export interface ExportResult {
  buffer: Buffer;
  pdfSha256: string;
  bundleSha256: string;
  stats: { bookingsCount: number; receiptsCount: number; pages: number };
}

// ─── Public API ────────────────────────────────────────────────────────────
export async function buildDmsExportPdf(opts: ExportOptions): Promise<ExportResult> {
  const bundleSha256 = computeBundleSha(opts);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('CREDO Kassenbuch DMS-Export');
  pdfDoc.setAuthor('CREDO Verwaltung');
  pdfDoc.setCreator('Kassenbuch');
  pdfDoc.setCreationDate(opts.generatedAt);

  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvMono = await pdfDoc.embedFont(StandardFonts.Courier);

  await renderCover(pdfDoc, helv, helvBold, helvMono, opts, bundleSha256);

  let receiptsCount = 0;

  for (const booking of opts.bookings) {
    if (booking.receipts.length === 0 && !opts.filter.includeWithoutReceipts) continue;

    const mapping = await getMappingCached(booking.schoolId);
    const totalFiles = Math.max(1, booking.receipts.length);

    if (booking.receipts.length === 0) {
      // Buchung ohne Beleg: nur Trennseite, kein Beleg-Embed
      const line = buildPayloadLine(booking, mapping, 1, 1, opts.datevMandantenNr);
      const spc = buildSpcPayload({
        creditorName: booking.school.name,
        amount: booking.amount,
        unstructured: line.unstructured,
      });
      const qrPng = await renderQrPng(spc);
      const qrImg = await pdfDoc.embedPng(qrPng);
      await renderSeparatorPage(pdfDoc, helv, helvBold, helvMono, {
        booking,
        line,
        qrImg,
        fileIndex: 1,
        totalFiles: 1,
        receipt: null,
      });
      continue;
    }

    let fileIndex = 0;
    for (const receipt of booking.receipts) {
      fileIndex += 1;
      receiptsCount += 1;

      // belegartCode/Label pro Receipt — sonst trägt Beleg 2+ den
      // dokumentart-Wert des ersten Belegs im QR (Domain-Bug).
      booking.belegartCode = receipt.belegart?.code ?? null;
      booking.belegartLabel = receipt.belegart?.label ?? null;

      const line = buildPayloadLine(booking, mapping, fileIndex, totalFiles, opts.datevMandantenNr);
      const spc = buildSpcPayload({
        creditorName: booking.school.name,
        amount: booking.amount,
        unstructured: line.unstructured,
      });
      const qrPng = await renderQrPng(spc);
      const qrImg = await pdfDoc.embedPng(qrPng);

      await renderSeparatorPage(pdfDoc, helv, helvBold, helvMono, {
        booking,
        line,
        qrImg,
        fileIndex,
        totalFiles,
        receipt,
      });
      await embedReceipt(pdfDoc, receipt);
    }
  }

  const out = await pdfDoc.save();
  const buffer = Buffer.from(out);
  const pdfSha256 = createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    pdfSha256,
    bundleSha256,
    stats: {
      bookingsCount: opts.bookings.length,
      receiptsCount,
      pages: pdfDoc.getPageCount(),
    },
  };
}

// ─── Cover-Seite ───────────────────────────────────────────────────────────
async function renderCover(
  pdfDoc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  fontMono: PDFFont,
  opts: ExportOptions,
  bundleSha: string,
): Promise<void> {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  let y = A4_H - MARGIN;

  // Header-Streifen
  page.drawRectangle({ x: 0, y: y - 4, width: A4_W, height: 4, color: CREDO_YELLOW });

  await drawLogoIfAvailable(pdfDoc, page, MARGIN, y - 60);

  page.drawText('CREDO Kassenbuch — DMS-Export', {
    x: MARGIN + 80, y: y - 28, size: 16, font: fontBold, color: CREDO_PRIMARY,
  });

  const schoolList = opts.filter.schoolIds.length
    ? opts.filter.schoolIds.map(id => opts.schoolsById[id]?.name).filter(Boolean).join(', ')
    : 'Alle Mandanten';
  page.drawText(schoolList, {
    x: MARGIN + 80, y: y - 46, size: 10, font, color: CREDO_GRAY,
  });

  y -= 90;

  // Filter-Block
  drawSectionTitle(page, fontBold, 'Filter', MARGIN, y);
  y -= 18;
  const filterRows: Array<[string, string]> = [
    ['Zeitraum', `${formatDateDe(opts.filter.dateFrom)} – ${formatDateDe(opts.filter.dateTo)}`],
    ['Belegarten', opts.filter.belegartIds.length ? `${opts.filter.belegartIds.length} ausgewählt` : 'Alle'],
    ['Ohne Beleg einbeziehen', opts.filter.includeWithoutReceipts ? 'Ja' : 'Nein'],
  ];
  for (const [k, v] of filterRows) {
    page.drawText(k, { x: MARGIN, y, size: 9, font: fontBold, color: CREDO_PRIMARY });
    page.drawText(v, { x: MARGIN + 130, y, size: 9, font, color: BLACK });
    y -= 14;
  }

  y -= 10;

  // Zusammenfassung
  const totalReceipts = opts.bookings.reduce((s, b) => s + b.receipts.length, 0);
  drawSectionTitle(page, fontBold, 'Zusammenfassung', MARGIN, y);
  y -= 18;
  const sumRows: Array<[string, string]> = [
    ['Buchungen', String(opts.bookings.length)],
    ['Belege', String(totalReceipts)],
  ];
  for (const [k, v] of sumRows) {
    page.drawText(k, { x: MARGIN, y, size: 9, font: fontBold, color: CREDO_PRIMARY });
    page.drawText(v, { x: MARGIN + 130, y, size: 9, font, color: BLACK });
    y -= 14;
  }

  y -= 10;

  // Aufschlüsselung pro Konto (bei Multi-Mandant pro Schule gruppiert)
  drawSectionTitle(page, fontBold, 'Summen pro Konto', MARGIN, y);
  y -= 18;

  const grouped = groupBySchoolThenAccount(opts.bookings);
  const sortedSchoolIds = Object.keys(grouped).sort((a, b) =>
    (opts.schoolsById[a]?.code ?? '').localeCompare(opts.schoolsById[b]?.code ?? ''),
  );

  for (const schoolId of sortedSchoolIds) {
    if (y < MARGIN + 100) {
      // Wechsel auf neue Cover-Seite falls Summen-Block zu lang
      y = A4_H - MARGIN;
      pdfDoc.addPage([A4_W, A4_H]);
    }
    const school = opts.schoolsById[schoolId];
    if (sortedSchoolIds.length > 1 && school) {
      page.drawText(`${school.code}  ${school.name}`, {
        x: MARGIN, y, size: 10, font: fontBold, color: CREDO_PRIMARY,
      });
      y -= 14;
    }
    const accounts = grouped[schoolId];
    const sortedAccountKeys = Object.keys(accounts).sort();
    for (const acc of sortedAccountKeys) {
      const { name, soll, haben } = accounts[acc];
      page.drawText(`${acc}  ${truncateString(name, 30)}`, {
        x: MARGIN + 8, y, size: 9, font: fontMono, color: BLACK,
      });
      page.drawText(`Soll: ${formatAmountDe(soll)} EUR`, {
        x: MARGIN + 280, y, size: 9, font: fontMono, color: BLACK,
      });
      page.drawText(`Haben: ${formatAmountDe(haben)} EUR`, {
        x: MARGIN + 400, y, size: 9, font: fontMono, color: BLACK,
      });
      y -= 12;
    }
    y -= 6;
  }

  // Footer-Block
  const footerY = MARGIN + 30;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 14 },
    end: { x: A4_W - MARGIN, y: footerY + 14 },
    color: CREDO_GRAY,
    thickness: 0.5,
  });
  page.drawText(
    `Erstellt ${formatDateTimeDe(opts.generatedAt)} von ${opts.generatedByName}`,
    { x: MARGIN, y: footerY, size: 8, font, color: CREDO_GRAY },
  );
  page.drawText(`Bundle-SHA-256: ${bundleSha}`, {
    x: MARGIN, y: footerY - 12, size: 7, font: fontMono, color: CREDO_GRAY,
  });
}

// ─── Trennseite ────────────────────────────────────────────────────────────
async function renderSeparatorPage(
  pdfDoc: PDFDocument,
  font: PDFFont,
  fontBold: PDFFont,
  fontMono: PDFFont,
  args: {
    booking: ExportBooking;
    line: BuiltLine;
    qrImg: PDFImage;
    fileIndex: number;
    totalFiles: number;
    receipt: ExportReceipt | null;
  },
): Promise<void> {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  let y = A4_H - MARGIN;

  page.drawRectangle({ x: 0, y: y - 4, width: A4_W, height: 4, color: CREDO_YELLOW });

  page.drawText('CREDO', {
    x: MARGIN, y: y - 26, size: 14, font: fontBold, color: CREDO_PRIMARY,
  });
  page.drawText('KASSENBUCH BELEG', {
    x: A4_W - MARGIN - 150, y: y - 26, size: 12, font: fontBold, color: CREDO_PRIMARY,
  });

  y -= 50;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: A4_W - MARGIN, y },
    color: CREDO_GRAY, thickness: 0.5,
  });
  y -= 20;

  // QR rechts oben
  const qrSize = 180;
  const qrX = A4_W - MARGIN - qrSize;
  const qrY = y - qrSize;
  page.drawImage(args.qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  page.drawText('Swiss QR Code', {
    x: qrX, y: qrY - 12, size: 8, font, color: CREDO_GRAY,
  });

  // Linkspalte: Mapping-Felder (includeOnSeparator=true)
  const leftX = MARGIN;
  const labelW = 150;
  let leftY = y;
  const visibleFields = args.line.fields.filter(f => f.includeOnSeparator);
  for (const f of visibleFields) {
    page.drawText(`${f.dmsKey}:`, {
      x: leftX, y: leftY, size: 10, font: fontBold, color: CREDO_PRIMARY,
    });
    page.drawText(f.value || '—', {
      x: leftX + labelW, y: leftY, size: 10, font: fontMono, color: BLACK,
      maxWidth: qrX - leftX - labelW - 10,
    });
    leftY -= 16;
  }

  // Feste Zeilen: Datei + Hochgeladen
  const fixedY = Math.min(leftY, qrY - 30);
  let fy = fixedY - 10;
  page.drawLine({
    start: { x: MARGIN, y: fy + 14 }, end: { x: A4_W - MARGIN, y: fy + 14 },
    color: CREDO_GRAY, thickness: 0.3,
  });

  const fileLabel = args.receipt
    ? `${args.receipt.originalName}  (Beleg ${args.fileIndex} von ${args.totalFiles})`
    : '— keine Belegdatei —';
  page.drawText('Datei:', { x: leftX, y: fy, size: 10, font: fontBold, color: CREDO_PRIMARY });
  page.drawText(fileLabel, { x: leftX + labelW, y: fy, size: 10, font, color: BLACK });
  fy -= 16;

  if (args.receipt) {
    page.drawText('Hochgeladen:', { x: leftX, y: fy, size: 10, font: fontBold, color: CREDO_PRIMARY });
    page.drawText(
      `${formatDateTimeDe(args.receipt.uploadedAt)} · ${args.receipt.uploadedByName}`,
      { x: leftX + labelW, y: fy, size: 10, font, color: BLACK },
    );
    fy -= 16;
    page.drawText('SHA-256:', { x: leftX, y: fy, size: 10, font: fontBold, color: CREDO_PRIMARY });
    page.drawText(args.receipt.sha256.slice(0, 32) + '…', {
      x: leftX + labelW, y: fy, size: 8, font: fontMono, color: CREDO_GRAY,
    });
  }

  // Footer
  page.drawText(
    `Mandant ${args.booking.school.code}  ·  Beleg-Nr. ${args.booking.bookingDate.getFullYear()}-${String(args.booking.receiptNumber).padStart(5, '0')}`,
    { x: MARGIN, y: MARGIN, size: 8, font, color: CREDO_GRAY },
  );
}

// ─── Beleg einbetten ───────────────────────────────────────────────────────
async function embedReceipt(pdfDoc: PDFDocument, receipt: ExportReceipt): Promise<void> {
  const abs = path.resolve(absolutePathFor(receipt.storagePath));
  const uploadRoot = path.resolve(config.uploadDir);
  if (!abs.startsWith(uploadRoot + path.sep) && abs !== uploadRoot) {
    // storagePath kommt zwar aus der DB, wir härten trotzdem gegen
    // Path-Traversal (Defense-in-Depth bei kompromittierter DB).
    console.error(`[dmsExport] Verdächtiger Beleg-Pfad blockiert: receiptId=${receipt.id}`);
    drawErrorPage(pdfDoc, `Beleg-Pfad ungültig: ${receipt.originalName}`);
    return;
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    drawErrorPage(pdfDoc, `Beleg-Datei fehlt auf Disk: ${receipt.originalName}`);
    return;
  }

  if (receipt.mimeType === 'application/pdf') {
    let src: PDFDocument;
    try {
      // Kein ignoreEncryption — verschlüsselte PDFs landen im catch und
      // werden als Fehlerseite eingebettet statt unbrauchbar gemerged.
      src = await PDFDocument.load(buf);
    } catch (err) {
      drawErrorPage(pdfDoc, `PDF nicht lesbar (ggf. verschlüsselt): ${receipt.originalName}`);
      return;
    }
    const indices = src.getPageIndices();
    const copied = await pdfDoc.copyPages(src, indices);
    for (const p of copied) pdfDoc.addPage(p);
    return;
  }

  if (receipt.mimeType === 'image/jpeg' || receipt.mimeType === 'image/png') {
    const img = receipt.mimeType === 'image/jpeg'
      ? await pdfDoc.embedJpg(buf)
      : await pdfDoc.embedPng(buf);
    const page = pdfDoc.addPage([A4_W, A4_H]);
    const maxW = A4_W - 2 * MARGIN;
    const maxH = A4_H - 2 * MARGIN;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, {
      x: (A4_W - w) / 2,
      y: (A4_H - h) / 2,
      width: w,
      height: h,
    });
    return;
  }

  drawErrorPage(pdfDoc, `Unbekannter MIME-Typ: ${receipt.mimeType} (${receipt.originalName})`);
}

function drawErrorPage(pdfDoc: PDFDocument, message: string): void {
  const page = pdfDoc.addPage([A4_W, A4_H]);
  page.drawText('Beleg konnte nicht eingebettet werden', {
    x: MARGIN, y: A4_H - MARGIN - 40, size: 14,
  });
  page.drawText(message, {
    x: MARGIN, y: A4_H - MARGIN - 70, size: 10,
  });
}

// ─── Preview-Schätzung ─────────────────────────────────────────────────────
export interface PreviewResult {
  bookingsCount: number;
  receiptsCount: number;
  estimatedPages: number;
  estimatedMB: number;
}

export function estimatePreview(opts: {
  bookings: Array<{ receiptsCount: number; receiptsSizeBytes: number; receiptsPdfPages: number }>;
  includeWithoutReceipts: boolean;
}): PreviewResult {
  const relevant = opts.bookings.filter(b => b.receiptsCount > 0 || opts.includeWithoutReceipts);
  const receiptsCount = relevant.reduce((s, b) => s + b.receiptsCount, 0);
  const sizeBytes = relevant.reduce((s, b) => s + b.receiptsSizeBytes, 0);

  // Trennseiten: 1 pro Beleg (oder 1 falls Buchung ohne Beleg)
  const separatorPages = relevant.reduce((s, b) => s + Math.max(1, b.receiptsCount), 0);
  // Beleg-Seiten: PDF-pageCount summiert + 1 pro Bild-Beleg (approx als 1 wenn unbekannt)
  const receiptPages = relevant.reduce((s, b) => s + Math.max(b.receiptsCount, b.receiptsPdfPages), 0);

  const estimatedPages = 1 + separatorPages + receiptPages;
  const estimatedMB = Math.max(0.05, sizeBytes / (1024 * 1024) + 0.05);

  return {
    bookingsCount: relevant.length,
    receiptsCount,
    estimatedPages,
    estimatedMB: Math.round(estimatedMB * 10) / 10,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function drawSectionTitle(page: PDFPage, font: PDFFont, text: string, x: number, y: number): void {
  page.drawText(text, { x, y, size: 11, font, color: CREDO_PRIMARY });
  page.drawLine({
    start: { x, y: y - 3 },
    end: { x: x + 180, y: y - 3 },
    color: CREDO_YELLOW,
    thickness: 1.5,
  });
}

async function drawLogoIfAvailable(pdfDoc: PDFDocument, page: PDFPage, x: number, y: number): Promise<void> {
  const logoPath = path.join(__dirname, '../../assets/credo_logo.png');
  try {
    const buf = await fs.readFile(logoPath);
    const img = await pdfDoc.embedPng(buf);
    const w = 60;
    const h = (img.height / img.width) * w;
    page.drawImage(img, { x, y, width: w, height: h });
  } catch {
    // kein Logo — wird leer gelassen
  }
}

// Explizit Europe/Berlin — sonst zeigt der Container in UTC falsche Uhrzeit
// und bookingDate (DATE-Spalte, UTC-Midnight) könnte am Rand off-by-one
// dargestellt werden.
const BERLIN_TZ = 'Europe/Berlin';

const DATE_FMT = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DATETIME_FMT = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDateDe(d: Date): string {
  return DATE_FMT.format(d);
}

function formatDateTimeDe(d: Date): string {
  // Intl gibt "19.05.2026, 14:55" — Komma raus für unser Layout.
  return DATETIME_FMT.format(d).replace(', ', ' ');
}

function formatAmountDe(n: number): string {
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function truncateString(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function groupBySchoolThenAccount(bookings: ExportBooking[]): Record<
  string,
  Record<string, { name: string; soll: number; haben: number }>
> {
  const out: Record<string, Record<string, { name: string; soll: number; haben: number }>> = {};
  for (const b of bookings) {
    const sid = b.schoolId;
    if (!out[sid]) out[sid] = {};
    const key = b.account.accountNumber;
    const entry = out[sid][key] ?? { name: b.account.name, soll: 0, haben: 0 };
    const amount = decimalToNumber(b.amount);
    if (b.debitCredit === 'S') entry.soll += amount;
    else entry.haben += amount;
    out[sid][key] = entry;
  }
  return out;
}

function computeBundleSha(opts: ExportOptions): string {
  // Deterministisch aus Eingabe-Selektion — reproduzierbar.
  const payload = {
    schoolIds: [...opts.filter.schoolIds].sort(),
    dateFrom: opts.filter.dateFrom.toISOString().slice(0, 10),
    dateTo: opts.filter.dateTo.toISOString().slice(0, 10),
    belegartIds: [...opts.filter.belegartIds].sort(),
    includeWithoutReceipts: opts.filter.includeWithoutReceipts,
    bookingIds: opts.bookings.map(b => b.id).sort(),
    receiptHashes: opts.bookings.flatMap(b => b.receipts.map(r => r.sha256)).sort(),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
