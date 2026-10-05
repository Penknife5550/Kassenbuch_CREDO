import PDFDocument from 'pdfkit';
import { drawCredoLogo } from './credoLogo';
import { CREDO_PRIMARY, CREDO_RED, drawCredoFooter, formatDateDE } from './pdfService';
import { EigenbelegPosition, betragInWorten, formatCents } from './eigenbelegService';
import { toPdfText } from './pdfText';

export interface EigenbelegPdfData {
  issuer: { name: string; address: string };
  schoolName: string;
  schoolCode: string;
  /** null = Entwurf: noch nicht gebucht, deshalb ohne Belegnummer */
  receiptNumber: number | null;
  bookingDate: Date;
  debitCredit: 'S' | 'H';
  counterparty: string;
  positions: EigenbelegPosition[];
  totalCents: number;
  reason: string;
  account: { accountNumber: string; name: string };
  counterAccount: { accountNumber: string; name: string };
  costCenter: { code: string; name: string } | null;
  description: string;
  /** Zeile "Betrag erhalten" fuer die Unterschrift des Empfaengers drucken */
  payeeSigns: boolean;
  createdByName: string;
  createdAt: Date;
}

export interface RenderedPdf {
  buffer: Buffer;
  pageCount: number;
}

type Doc = PDFKit.PDFDocument;

const INK = '#222222';
const LABEL = '#8A8A88';
const SOFT = '#7A7A78';
const RULE = '#D0D0CE';
const ROW_RULE = '#E4E4E2';
const TINT = '#F2F2F0';

const MARGIN_X = 50;
const TOP = 40;
/** Abstand vom unteren Blattrand, ab dem kein Inhalt mehr beginnt. */
const CONTENT_BOTTOM_GAP = 70;
/** Oberkante der CREDO-Linie liegt 38pt ueber dem Blattrand; der Abschlussblock endet knapp darueber. */
const SIGN_OFF_BOTTOM_GAP = 46;

// Explizit Europe/Berlin — der Container laeuft in UTC, "erstellt um" laege
// sonst ein bis zwei Stunden daneben (gleiche Regel wie dmsExportService.ts).
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Erzeugt den Eigenbeleg als PDF im Speicher. Der Aufrufer legt den Buffer ab
 * und bildet die Pruefsumme — deshalb kein Stream wie bei den Druck-PDFs.
 */
export function renderEigenbelegPdf(data: EigenbelegPdfData): Promise<RenderedPdf> {
  return new Promise<RenderedPdf>((resolve, reject) => {
    const draft = data.receiptNumber === null;
    const doc = new PDFDocument({
      size: 'A4',
      // Unterer Rand bewusst klein: den Seitenumbruch steuert dieses Layout
      // selbst, pdfkit soll nicht von sich aus eine Seite anfangen.
      margins: { top: TOP, bottom: 20, left: MARGIN_X, right: MARGIN_X },
      bufferPages: true,
      info: {
        Title: draft ? 'Eigenbeleg (Entwurf)' : `Eigenbeleg ${data.schoolCode} ${data.receiptNumber}`,
        Author: 'CREDO Verwaltung',
        CreationDate: data.createdAt,
      },
    });

    // Listener VOR doc.end() anhaengen, sonst gehen Daten oder das Ende verloren.
    const chunks: Buffer[] = [];
    let pageCount = 1;
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageCount }));
    doc.on('error', reject);

    try {
      drawDocument(doc, data, draft);
      pageCount = doc.bufferedPageRange().count;
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawDocument(doc: Doc, data: EigenbelegPdfData, draft: boolean): void {
  const left = MARGIN_X;
  const width = doc.page.width - 2 * MARGIN_X;

  let y = drawHeader(doc, data, left, width);
  y = drawMeta(doc, data, left, width, y, draft);
  y = drawAmount(doc, data, left, width, y);
  y = drawCounterparty(doc, data, left, width, y);
  y = drawPositions(doc, data, left, width, y);
  y = drawReason(doc, data, left, width, y);
  y = drawBooking(doc, data, left, width, y);
  drawSignOff(doc, data, left, width, y, draft);

  // Fusszeile und Entwurfs-Vermerk auf jeder Seite
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (draft) drawDraftMark(doc);
    drawCredoFooter(doc, left, width);
  }
}

function label(doc: Doc, text: string, x: number, y: number): void {
  doc.font('Helvetica').fontSize(6.5).fillColor(LABEL)
    .text(text.toUpperCase(), x, y, { characterSpacing: 0.5, lineBreak: false });
}

/**
 * Einzeiliger Wert in einer Spalte fester Breite. Was nicht hineinpasst, wird
 * kleiner gesetzt. Bewusst ohne `width`: pdfkit bricht sonst trotz
 * `lineBreak: false` um, und die zweite Zeile liefe in den naechsten Block.
 */
function fitted(doc: Doc, text: string, x: number, y: number, maxWidth: number, size: number): void {
  let fontSize = size;
  doc.fontSize(fontSize);
  while (fontSize > 6 && doc.widthOfString(text) > maxWidth) {
    fontSize -= 0.5;
    doc.fontSize(fontSize);
  }
  doc.text(text, x, y, { lineBreak: false });
}

function contentBottom(doc: Doc): number {
  return doc.page.height - CONTENT_BOTTOM_GAP;
}

function receiptNumberText(data: EigenbelegPdfData): string {
  return data.receiptNumber === null ? 'Entwurf' : String(data.receiptNumber);
}

function continueOnNewPage(doc: Doc, data: EigenbelegPdfData, left: number, width: number): number {
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(CREDO_PRIMARY)
    .text(`Eigenbeleg ${receiptNumberText(data)} – Fortsetzung`, left, TOP, { lineBreak: false });
  const ruleY = TOP + 16;
  doc.moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(0.5).strokeColor(RULE).stroke();
  return ruleY + 12;
}

// ─── Kopf: Aussteller, Mandant, Titel ───────────────────────────────────────
function drawHeader(doc: Doc, data: EigenbelegPdfData, left: number, width: number): number {
  drawCredoLogo(doc, left, TOP + 2, 64, CREDO_PRIMARY);
  const textX = left + 76;

  const titleW = 170;
  const issuerW = width - (textX - left) - titleW - 10;

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(CREDO_PRIMARY)
    .text(toPdfText(data.issuer.name), textX, TOP, { width: issuerW });
  doc.font('Helvetica').fontSize(8).fillColor(SOFT)
    .text(toPdfText(data.issuer.address), textX, doc.y + 1, { width: issuerW });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
    .text(toPdfText(data.schoolName), textX, doc.y + 3, { width: issuerW });
  const issuerBottom = doc.y;

  const titleX = left + width - titleW;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(CREDO_PRIMARY)
    .text('EIGENBELEG', titleX, TOP - 2, { width: titleW, align: 'right' });

  const kind = data.debitCredit === 'S' ? 'EINNAHME' : 'AUSGABE';
  doc.font('Helvetica-Bold').fontSize(7.5);
  const kindW = doc.widthOfString(kind, { characterSpacing: 1 }) + 14;
  const kindX = left + width - kindW;
  const kindY = TOP + 24;
  doc.lineWidth(0.8).strokeColor(CREDO_PRIMARY).rect(kindX, kindY, kindW, 13).stroke();
  doc.fillColor(CREDO_PRIMARY)
    .text(kind, kindX + 7, kindY + 3.5, { characterSpacing: 1, lineBreak: false });

  const ruleY = Math.max(issuerBottom, kindY + 13) + 10;
  doc.moveTo(left, ruleY).lineTo(left + width, ruleY).lineWidth(1).strokeColor(CREDO_PRIMARY).stroke();
  return ruleY + 11;
}

// ─── Belegnummer, Datum, Mandant, Kasse ─────────────────────────────────────
function drawMeta(doc: Doc, data: EigenbelegPdfData, left: number, width: number, y: number, draft: boolean): number {
  const colW = width / 4;
  const cells: Array<[string, string]> = [
    ['Beleg-Nr.', receiptNumberText(data)],
    ['Belegdatum', formatDateDE(data.bookingDate)],
    ['Mandant', toPdfText(data.schoolCode)],
    ['Kasse', toPdfText(data.account.accountNumber)],
  ];
  cells.forEach(([name, value], i) => {
    const x = left + i * colW;
    label(doc, name, x, y);
    doc.font('Helvetica-Bold').fillColor(draft && i === 0 ? CREDO_RED : INK);
    fitted(doc, value, x, y + 10, colW - 8, 10);
  });
  return y + 32;
}

// ─── Betrag, gross und in Worten ────────────────────────────────────────────
function drawAmount(doc: Doc, data: EigenbelegPdfData, left: number, width: number, y: number): number {
  const valueX = left + 82;
  const valueW = width - 94;
  const words = betragInWorten(data.totalCents);

  doc.font('Helvetica').fontSize(9);
  const wordsH = doc.heightOfString(words, { width: valueW });
  const boxH = 36 + wordsH + 8;

  doc.rect(left, y, width, boxH).fill(TINT);
  label(doc, 'Betrag', left + 12, y + 15);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK)
    .text(formatCents(data.totalCents), valueX, y + 9, { lineBreak: false });
  label(doc, 'in Worten', left + 12, y + 38);
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(words, valueX, y + 36, { width: valueW });
  return y + boxH + 12;
}

// ─── Gegenpartei ────────────────────────────────────────────────────────────
function drawCounterparty(doc: Doc, data: EigenbelegPdfData, left: number, width: number, y: number): number {
  const valueX = left + 118;
  const valueW = width - 118;
  const text = toPdfText(data.counterparty);

  label(doc, data.debitCredit === 'S' ? 'Eingenommen von' : 'Ausgezahlt an', left, y + 2);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(text, valueX, y, { width: valueW });
  return doc.y + 10;
}

// ─── Positionen ─────────────────────────────────────────────────────────────
function drawPositions(doc: Doc, data: EigenbelegPdfData, left: number, width: number, startY: number): number {
  const right = left + width;
  const amountW = 76;
  const qtyW = 44;
  const priceW = 70;
  const amountX = right - 6 - amountW;
  const qtyX = amountX - 8 - qtyW;
  const priceX = qtyX - 8 - priceW;
  const labelX = left + 34;
  const labelW = priceX - 8 - labelX;

  const drawHead = (y: number): number => {
    doc.rect(left, y, width, 16).fill(TINT);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(CREDO_PRIMARY);
    doc.text('POS.', left + 6, y + 5, { characterSpacing: 0.4, lineBreak: false });
    doc.text('BEZEICHNUNG', labelX, y + 5, { characterSpacing: 0.4, lineBreak: false });
    doc.text('EINZELPREIS', priceX, y + 5, { width: priceW, align: 'right', characterSpacing: 0.4 });
    doc.text('ANZAHL', qtyX, y + 5, { width: qtyW, align: 'right', characterSpacing: 0.4 });
    doc.text('BETRAG', amountX, y + 5, { width: amountW, align: 'right', characterSpacing: 0.4 });
    return y + 16;
  };

  let y = drawHead(startY);
  const sumH = 24;

  data.positions.forEach((position, index) => {
    const text = toPdfText(position.label);
    doc.font('Helvetica').fontSize(9.5);
    const rowH = Math.max(16, doc.heightOfString(text, { width: labelW }) + 7);
    // Die letzte Position nimmt die Summe mit, beide stehen immer auf derselben Seite
    const reserve = index === data.positions.length - 1 ? sumH : 0;

    if (y + rowH + reserve > contentBottom(doc)) {
      y = drawHead(continueOnNewPage(doc, data, left, width));
    }

    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    doc.text(String(index + 1), left + 6, y + 4, { lineBreak: false });
    doc.text(text, labelX, y + 4, { width: labelW });
    doc.text(formatCents(position.unitPriceCents), priceX, y + 4, { width: priceW, align: 'right' });
    doc.text(String(position.quantity), qtyX, y + 4, { width: qtyW, align: 'right' });
    doc.text(formatCents(position.amountCents), amountX, y + 4, { width: amountW, align: 'right' });

    y += rowH;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(ROW_RULE).stroke();
  });

  // Summe — der Platz dafuer ist mit der letzten Position reserviert
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1.2).strokeColor(CREDO_PRIMARY).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
  doc.text('Summe', labelX, y + 7, { lineBreak: false });
  doc.text(formatCents(data.totalCents), amountX - 40, y + 7, { width: amountW + 40, align: 'right' });
  return y + 32;
}

// ─── Grund fuer den Eigenbeleg ──────────────────────────────────────────────
function drawReason(doc: Doc, data: EigenbelegPdfData, left: number, width: number, startY: number): number {
  const text = toPdfText(data.reason);
  doc.font('Helvetica').fontSize(9.5);
  const boxH = doc.heightOfString(text, { width: width - 20 }) + 28;

  const y = startY + boxH > contentBottom(doc) ? continueOnNewPage(doc, data, left, width) : startY;
  doc.lineWidth(0.6).strokeColor(RULE).rect(left, y, width, boxH).stroke();
  label(doc, 'Grund für den Eigenbeleg', left + 10, y + 8);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(text, left + 10, y + 19, { width: width - 20 });
  return y + boxH + 10;
}

// ─── Kontierung ─────────────────────────────────────────────────────────────
function drawBooking(doc: Doc, data: EigenbelegPdfData, left: number, width: number, startY: number): number {
  const innerW = width - 20;
  const colW = innerW / 3;
  const cells: Array<[string, string]> = [
    ['Konto', toPdfText(`${data.account.accountNumber} ${data.account.name}`)],
    ['Gegenkonto', toPdfText(`${data.counterAccount.accountNumber} ${data.counterAccount.name}`)],
    ['Kostenstelle', data.costCenter ? toPdfText(`${data.costCenter.code} ${data.costCenter.name}`) : '–'],
  ];
  const description = toPdfText(data.description);

  doc.font('Helvetica').fontSize(9.5);
  const cellH = Math.max(...cells.map(([, value]) => doc.heightOfString(value, { width: colW - 8 })));
  const descriptionH = doc.heightOfString(description, { width: innerW });
  const boxH = 30 + cellH + 20 + descriptionH + 10;

  const y = startY + boxH > contentBottom(doc) ? continueOnNewPage(doc, data, left, width) : startY;
  doc.lineWidth(0.6).strokeColor(RULE).rect(left, y, width, boxH).stroke();
  label(doc, 'Buchung', left + 10, y + 8);

  cells.forEach(([name, value], i) => {
    const x = left + 10 + i * colW;
    label(doc, name, x, y + 21);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(value, x, y + 30, { width: colW - 8 });
  });

  const descriptionY = y + 30 + cellH + 8;
  label(doc, 'Buchungstext', left + 10, descriptionY);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text(description, left + 10, descriptionY + 9, { width: innerW });
  return y + boxH + 10;
}

// ─── Freigabe, Empfangsbestaetigung, Vermerk ────────────────────────────────
function drawSignOff(
  doc: Doc, data: EigenbelegPdfData, left: number, width: number, contentEnd: number, draft: boolean,
): void {
  const half = width / 2;
  const creator = toPdfText(data.createdByName);
  // Der Name ersetzt die Unterschrift und wird deshalb nie gekuerzt. Ein langer
  // Anzeigename bricht um; die Zeile waechst mit, statt in die Trennlinie zu laufen.
  doc.font('Helvetica-Bold').fontSize(9.5);
  const creatorH = Math.max(30, 18 + doc.heightOfString(creator, { width: half - 10 }));
  const signH = data.payeeSigns ? 46 : 0;
  const blockH = creatorH + signH + 28;
  const top = doc.page.height - SIGN_OFF_BOTTOM_GAP - blockH;

  // Der Block steht immer unten auf der letzten Seite. Reicht der Platz nicht,
  // wandert er als Ganzes auf eine neue Seite.
  if (contentEnd > top - 6) {
    continueOnNewPage(doc, data, left, width);
  }

  const right = left + width;
  doc.moveTo(left, top).lineTo(right, top).lineWidth(0.6).strokeColor(RULE).stroke();
  doc.moveTo(left, top + creatorH).lineTo(right, top + creatorH).lineWidth(0.6).strokeColor(RULE).stroke();

  label(doc, 'Erstellt und freigegeben von', left, top + 7);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(creator, left, top + 16, { width: half - 10 });
  label(doc, 'Zeitpunkt', left + half, top + 7);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
    .text(`${TIMESTAMP_FORMAT.format(data.createdAt)} Uhr`, left + half, top + 16, { lineBreak: false });

  let cursor = top + creatorH;
  if (data.payeeSigns) {
    const lineX = left + half;
    const lineY = cursor + 34;
    doc.moveTo(lineX, lineY).lineTo(right, lineY).lineWidth(0.6).strokeColor(CREDO_PRIMARY).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(SOFT)
      .text(`Betrag von ${formatCents(data.totalCents)} erhalten: Datum, Unterschrift`, lineX, lineY + 3, { lineBreak: false });
    cursor = lineY + 12;
  }

  doc.font('Helvetica').fontSize(7.5).fillColor(SOFT).text(signOffNote(data, draft), left, cursor + 8, { width });
}

function signOffNote(data: EigenbelegPdfData, draft: boolean): string {
  if (draft) return 'Entwurf. Dieser Beleg ist noch nicht gebucht und hat keine Belegnummer.';
  const booked = `Gebucht unter Beleg-Nr. ${data.receiptNumber}.`;
  // "Ohne Unterschrift gueltig" waere falsch, sobald eine Unterschrift vorgesehen ist.
  return data.payeeSigns
    ? `Im Kassenbuch CREDO elektronisch erstellt. ${booked}`
    : `Dieser Beleg wurde im Kassenbuch CREDO elektronisch erstellt und ist ohne Unterschrift gültig. ${booked}`;
}

function drawDraftMark(doc: Doc): void {
  const text = 'ENTWURF';
  doc.save();
  doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font('Helvetica-Bold').fontSize(96).fillColor(CREDO_RED).opacity(0.1);
  const x = (doc.page.width - doc.widthOfString(text)) / 2;
  doc.text(text, x, doc.page.height / 2 - 48, { lineBreak: false });
  doc.restore();
}
