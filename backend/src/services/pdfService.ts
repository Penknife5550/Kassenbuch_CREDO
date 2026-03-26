import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

interface PdfBooking {
  receiptNumber: number;
  bookingDate: string | Date;
  description: string;
  account: { accountNumber: string; name: string };
  counterAccount: { accountNumber: string; name: string };
  costCenter: { code: string; name: string } | null;
  amount: string;
  debitCredit: 'S' | 'H';
  isStorno: boolean;
}

interface PdfOptions {
  bookings: PdfBooking[];
  schoolName: string;
  schoolCode: string;
  dateFrom: Date;
  dateTo: Date;
  openingBalance: string;
}

const CREDO_PRIMARY = '#575756';
const CREDO_GRAY = '#9D9D9C';
const CREDO_YELLOW = '#FFD500';
const CREDO_GREEN = '#6BAA24';
const CREDO_RED = '#E2001A';
const CREDO_BLUE = '#009FE3';

const COL_X = [28, 68, 118, 260, 315, 370, 400, 468, 536];
const COL_WIDTHS = [38, 48, 140, 52, 52, 28, 66, 66, 66];
const HEADERS = ['Beleg', 'Datum', 'Buchungstext', 'Konto', 'Gegen', 'KSt', 'Einnahme', 'Ausgabe', 'Saldo'];

export function generateKassenbuchPdf(options: PdfOptions) {
  const { bookings, schoolName, schoolCode, dateFrom, dateTo, openingBalance } = options;

  const logoPath = path.join(__dirname, '../../assets/credo_logo.png');
  const hasLogo = fs.existsSync(logoPath);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 50, left: 28, right: 28 },
    info: {
      Title: `Kassenbuch ${schoolName}`,
      Author: 'CREDO Verwaltung',
      Subject: `Kassenbuch ${formatDateDE(dateFrom)} - ${formatDateDE(dateTo)}`,
    },
  });

  let pageNum = 0;

  const drawHeader = () => {
    pageNum++;
    const pageWidth = doc.page.width;
    const marginLeft = doc.page.margins.left;
    const marginRight = doc.page.margins.right;
    const contentWidth = pageWidth - marginLeft - marginRight;

    // Logo (small, left-aligned)
    const logoWidth = hasLogo ? 60 : 0;
    if (hasLogo) {
      doc.image(logoPath, marginLeft, 22, { width: 55 });
    }

    // Title right of logo
    const titleX = marginLeft + logoWidth + 8;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(CREDO_PRIMARY);
    doc.text('Kassenbuch', titleX, 24);

    // School + Date range below title
    doc.font('Helvetica').fontSize(9).fillColor(CREDO_GRAY);
    doc.text(`${schoolName} (${schoolCode})  |  Zeitraum: ${formatDateDE(dateFrom)} – ${formatDateDE(dateTo)}`, titleX, 40);

    // Page number right-aligned
    doc.text(`Seite ${pageNum}`, pageWidth - marginRight - 80, 24, { width: 80, align: 'right' });

    // Table header
    const headerY = 58;
    doc.rect(marginLeft, headerY, contentWidth, 16).fill('#F0F0F0');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(CREDO_PRIMARY);
    for (let i = 0; i < HEADERS.length; i++) {
      const align = i >= 6 ? 'right' : 'left';
      doc.text(HEADERS[i], COL_X[i], headerY + 4, { width: COL_WIDTHS[i], align });
    }

    return headerY + 18;
  };

  const drawFooter = () => {
    const pageWidth = doc.page.width;
    const marginLeft = doc.page.margins.left;
    const contentWidth = pageWidth - marginLeft - doc.page.margins.right;
    const footerY = doc.page.height - 30;

    // CREDO line
    const lineY = footerY - 8;
    const totalParts = 7;
    const partWidth = contentWidth / totalParts;

    doc.rect(marginLeft, lineY, partWidth * 4, 3).fill(CREDO_GRAY);
    doc.rect(marginLeft + partWidth * 4, lineY, partWidth, 3).fill(CREDO_YELLOW);
    doc.rect(marginLeft + partWidth * 5, lineY, partWidth, 3).fill(CREDO_GREEN);
    doc.rect(marginLeft + partWidth * 6, lineY, partWidth, 3).fill(CREDO_RED);

    doc.font('Helvetica').fontSize(6).fillColor(CREDO_GRAY);
    doc.text('CREDO Verwaltung – Kassenbuch', marginLeft, footerY, { width: contentWidth, align: 'center' });
  };

  // First page
  let y = drawHeader();

  // Opening balance row
  doc.font('Helvetica-Bold').fontSize(7).fillColor(CREDO_PRIMARY);
  doc.text('Anfangsbestand', COL_X[2], y + 2, { width: COL_WIDTHS[2] });
  doc.text(formatCurrency(openingBalance), COL_X[8], y + 2, { width: COL_WIDTHS[8], align: 'right' });
  y += 14;
  doc.moveTo(COL_X[0], y).lineTo(COL_X[8] + COL_WIDTHS[8], y).lineWidth(0.5).strokeColor('#E0E0E0').stroke();
  y += 2;

  // Running balance
  let runningBalance = parseFloat(openingBalance);

  // Bookings
  doc.font('Helvetica').fontSize(7).fillColor(CREDO_PRIMARY);
  const maxY = doc.page.height - doc.page.margins.bottom - 40;

  for (const b of bookings) {
    if (y > maxY) {
      drawFooter();
      doc.addPage();
      y = drawHeader();
    }

    // Update running balance
    if (b.debitCredit === 'S') {
      runningBalance += parseFloat(b.amount);
    } else {
      runningBalance -= parseFloat(b.amount);
    }

    const rowColor = b.isStorno ? '#999999' : CREDO_PRIMARY;
    doc.fillColor(rowColor);

    // Alternating row background
    if (bookings.indexOf(b) % 2 === 0) {
      doc.rect(COL_X[0], y - 1, COL_X[8] + COL_WIDTHS[8] - COL_X[0], 12).fill('#FAFAFA');
      doc.fillColor(rowColor);
    }

    doc.text(String(b.receiptNumber), COL_X[0], y + 1, { width: COL_WIDTHS[0] });
    doc.text(formatDateDE(new Date(b.bookingDate)), COL_X[1], y + 1, { width: COL_WIDTHS[1] });

    const desc = b.isStorno ? `[S] ${b.description}` : b.description;
    doc.text(desc, COL_X[2], y + 1, { width: COL_WIDTHS[2], ellipsis: true, height: 10 });

    doc.text(b.account.accountNumber, COL_X[3], y + 1, { width: COL_WIDTHS[3] });
    doc.text(b.counterAccount.accountNumber, COL_X[4], y + 1, { width: COL_WIDTHS[4] });
    doc.text(b.costCenter?.code || '', COL_X[5], y + 1, { width: COL_WIDTHS[5] });

    // Einnahme / Ausgabe
    if (b.debitCredit === 'S') {
      doc.fillColor(b.isStorno ? '#999999' : '#2E7D32');
      doc.text(formatCurrency(b.amount), COL_X[6], y + 1, { width: COL_WIDTHS[6], align: 'right' });
      doc.text('', COL_X[7], y + 1, { width: COL_WIDTHS[7], align: 'right' });
    } else {
      doc.fillColor(b.isStorno ? '#999999' : CREDO_RED);
      doc.text('', COL_X[6], y + 1, { width: COL_WIDTHS[6], align: 'right' });
      doc.text(formatCurrency(b.amount), COL_X[7], y + 1, { width: COL_WIDTHS[7], align: 'right' });
    }

    // Saldo
    doc.fillColor(runningBalance >= 0 ? '#2E7D32' : CREDO_RED);
    doc.text(formatCurrency(String(runningBalance.toFixed(2))), COL_X[8], y + 1, { width: COL_WIDTHS[8], align: 'right' });

    doc.fillColor(rowColor);
    y += 13;
  }

  // Closing balance
  y += 4;
  doc.moveTo(COL_X[0], y).lineTo(COL_X[8] + COL_WIDTHS[8], y).lineWidth(1).strokeColor(CREDO_PRIMARY).stroke();
  y += 4;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(CREDO_PRIMARY);
  doc.text('Endbestand', COL_X[2], y + 1, { width: COL_WIDTHS[2] });

  // Sum Einnahmen / Ausgaben
  let totalEinnahmen = 0;
  let totalAusgaben = 0;
  for (const b of bookings) {
    const amt = parseFloat(b.amount);
    if (b.debitCredit === 'S') totalEinnahmen += amt;
    else totalAusgaben += amt;
  }

  doc.fillColor('#2E7D32');
  doc.text(formatCurrency(totalEinnahmen.toFixed(2)), COL_X[6], y + 1, { width: COL_WIDTHS[6], align: 'right' });
  doc.fillColor(CREDO_RED);
  doc.text(formatCurrency(totalAusgaben.toFixed(2)), COL_X[7], y + 1, { width: COL_WIDTHS[7], align: 'right' });
  doc.fillColor(runningBalance >= 0 ? '#2E7D32' : CREDO_RED);
  doc.text(formatCurrency(runningBalance.toFixed(2)), COL_X[8], y + 1, { width: COL_WIDTHS[8], align: 'right' });

  drawFooter();
  doc.end();

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eigenbeleg PDF
// ─────────────────────────────────────────────────────────────────────────────

const DENOMINATION_DEFS = [
  { key: 'n500', label: '500,00 €', centValue: 50000 },
  { key: 'n200', label: '200,00 €', centValue: 20000 },
  { key: 'n100', label: '100,00 €', centValue: 10000 },
  { key: 'n50',  label:  '50,00 €', centValue:  5000 },
  { key: 'n20',  label:  '20,00 €', centValue:  2000 },
  { key: 'n10',  label:  '10,00 €', centValue:  1000 },
  { key: 'n5',   label:   '5,00 €', centValue:   500 },
  { key: 'c200', label:   '2,00 €', centValue:   200 },
  { key: 'c100', label:   '1,00 €', centValue:   100 },
  { key: 'c50',  label:   '0,50 €', centValue:    50 },
  { key: 'c20',  label:   '0,20 €', centValue:    20 },
  { key: 'c10',  label:   '0,10 €', centValue:    10 },
  { key: 'c5',   label:   '0,05 €', centValue:     5 },
  { key: 'c2',   label:   '0,02 €', centValue:     2 },
  { key: 'c1',   label:   '0,01 €', centValue:     1 },
];

export interface EigenbelegOptions {
  schoolName: string;
  schoolCode: string;
  closingDate: Date;
  expectedBalance: string;
  actualBalance: string;
  difference: string;
  comment?: string;
  denominationCounts?: Record<string, number>;
  correctionBooking?: {
    receiptNumber: number;
    amount: string;
    debitCredit: 'S' | 'H';
    description: string;
    account: { accountNumber: string; name: string };
    counterAccount: { accountNumber: string; name: string };
  };
  closedByName: string;
}

export function generateEigenbelegPdf(options: EigenbelegOptions) {
  const {
    schoolName, schoolCode, closingDate, expectedBalance,
    actualBalance, difference, comment, denominationCounts,
    correctionBooking, closedByName,
  } = options;

  const logoPath = path.join(__dirname, '../../assets/credo_logo.png');
  const hasLogo = fs.existsSync(logoPath);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 40, bottom: 50, left: 50, right: 50 },
    info: {
      Title: `Eigenbeleg ${schoolName} ${closingDate.toISOString().slice(0, 10)}`,
      Author: 'CREDO Verwaltung',
    },
  });

  const marginLeft = 50;
  const contentWidth = doc.page.width - marginLeft - 50;
  const diff = parseFloat(difference);

  // ── Header ─────────────────────────────────────────────────────────────────
  if (hasLogo) {
    doc.image(logoPath, marginLeft, 30, { width: 50 });
  }
  const titleX = marginLeft + (hasLogo ? 58 : 0);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(CREDO_PRIMARY);
  doc.text('KASSENSTURZ-EIGENBELEG', titleX, 33);
  doc.font('Helvetica').fontSize(9).fillColor(CREDO_GRAY);
  doc.text(`${schoolName} (${schoolCode})  |  Datum: ${formatDateDE(closingDate)}`, titleX, 52);
  doc.text(`Durchgeführt von: ${closedByName}`, titleX, 64);

  // Horizontal line
  let y = 88;
  doc.moveTo(marginLeft, y).lineTo(marginLeft + contentWidth, y).lineWidth(1).strokeColor(CREDO_PRIMARY).stroke();
  y += 16;

  // ── Soll / Ist / Differenz ─────────────────────────────────────────────────
  const colW = contentWidth / 3;
  const summaryItems = [
    { label: 'Sollbestand (Buchhaltung)', value: expectedBalance, color: CREDO_PRIMARY },
    { label: 'Istbestand (gezählt)', value: actualBalance, color: CREDO_PRIMARY },
    {
      label: diff > 0 ? 'Differenz (Überschuss)' : diff < 0 ? 'Differenz (Fehlbetrag)' : 'Differenz',
      value: difference,
      color: diff === 0 ? CREDO_GREEN : CREDO_RED,
    },
  ];

  summaryItems.forEach((item, i) => {
    const x = marginLeft + i * colW;
    doc.font('Helvetica').fontSize(8).fillColor(CREDO_GRAY);
    doc.text(item.label, x, y, { width: colW - 8 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor(item.color);
    doc.text(formatCurrency(item.value), x, y + 13, { width: colW - 8 });
  });

  y += 44;
  doc.moveTo(marginLeft, y).lineTo(marginLeft + contentWidth, y).lineWidth(0.5).strokeColor('#E0E0E0').stroke();
  y += 14;

  // ── Zählprotokoll ──────────────────────────────────────────────────────────
  if (denominationCounts && Object.keys(denominationCounts).length > 0) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(CREDO_PRIMARY);
    doc.text('Zählprotokoll', marginLeft, y);
    y += 16;

    // Table header
    doc.rect(marginLeft, y, contentWidth, 14).fill('#F0F0F0');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(CREDO_PRIMARY);
    doc.text('Stückelung', marginLeft + 4, y + 3, { width: 100 });
    doc.text('Anzahl', marginLeft + 120, y + 3, { width: 60, align: 'right' });
    doc.text('Betrag', marginLeft + 200, y + 3, { width: 80, align: 'right' });
    y += 16;

    let grandTotalCents = 0;
    let rowIndex = 0;
    for (const denom of DENOMINATION_DEFS) {
      const count = denominationCounts[denom.key] ?? 0;
      if (count === 0) continue;
      const lineCents = count * denom.centValue;
      grandTotalCents += lineCents;

      if (rowIndex % 2 === 0) {
        doc.rect(marginLeft, y - 1, contentWidth, 13).fill('#FAFAFA');
      }
      doc.font('Helvetica').fontSize(8).fillColor(CREDO_PRIMARY);
      doc.text(denom.label, marginLeft + 4, y + 2, { width: 100 });
      doc.text(String(count), marginLeft + 120, y + 2, { width: 60, align: 'right' });
      doc.text(formatCurrency((lineCents / 100).toFixed(2)), marginLeft + 200, y + 2, { width: 80, align: 'right' });
      y += 13;
      rowIndex++;
    }

    // Total row
    doc.moveTo(marginLeft, y).lineTo(marginLeft + 290, y).lineWidth(0.5).strokeColor(CREDO_PRIMARY).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(CREDO_PRIMARY);
    doc.text('Gesamt (gezählt)', marginLeft + 4, y + 2, { width: 100 });
    doc.text(formatCurrency((grandTotalCents / 100).toFixed(2)), marginLeft + 200, y + 2, { width: 80, align: 'right' });
    y += 20;
  }

  // ── Kommentar ──────────────────────────────────────────────────────────────
  if (comment) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(CREDO_PRIMARY);
    doc.text('Begründung', marginLeft, y);
    y += 14;

    doc.rect(marginLeft, y, contentWidth, 2).fill(diff > 0 ? CREDO_GREEN : CREDO_RED);
    y += 8;
    doc.font('Helvetica').fontSize(9).fillColor(CREDO_PRIMARY);
    const commentHeight = doc.heightOfString(comment, { width: contentWidth - 8 });
    doc.rect(marginLeft, y, contentWidth, commentHeight + 12).fill('#FFF8F8');
    doc.text(comment, marginLeft + 4, y + 6, { width: contentWidth - 8 });
    y += commentHeight + 20;
  }

  // ── Korrekturbuchung ───────────────────────────────────────────────────────
  if (correctionBooking) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(CREDO_PRIMARY);
    doc.text('Erstellte Korrekturbuchung', marginLeft, y);
    y += 14;

    doc.rect(marginLeft, y, contentWidth, 14).fill('#F0F0F0');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(CREDO_PRIMARY);
    doc.text('Belegnr.', marginLeft + 4, y + 3, { width: 50 });
    doc.text('Art', marginLeft + 60, y + 3, { width: 60 });
    doc.text('Betrag', marginLeft + 130, y + 3, { width: 70, align: 'right' });
    doc.text('Konto', marginLeft + 210, y + 3, { width: 80 });
    doc.text('Gegenkonto', marginLeft + 300, y + 3, { width: 90 });
    y += 16;

    const debitCreditLabel = correctionBooking.debitCredit === 'S' ? 'Einnahme (S)' : 'Ausgabe (H)';
    doc.font('Helvetica').fontSize(8).fillColor(CREDO_PRIMARY);
    doc.text(String(correctionBooking.receiptNumber), marginLeft + 4, y + 2, { width: 50 });
    doc.text(debitCreditLabel, marginLeft + 60, y + 2, { width: 60 });
    doc.fillColor(correctionBooking.debitCredit === 'S' ? CREDO_GREEN : CREDO_RED);
    doc.text(formatCurrency(correctionBooking.amount), marginLeft + 130, y + 2, { width: 70, align: 'right' });
    doc.fillColor(CREDO_PRIMARY);
    doc.text(`${correctionBooking.account.accountNumber} ${correctionBooking.account.name}`, marginLeft + 210, y + 2, { width: 80, ellipsis: true });
    doc.text(`${correctionBooking.counterAccount.accountNumber} ${correctionBooking.counterAccount.name}`, marginLeft + 300, y + 2, { width: 90, ellipsis: true });
    y += 18;

    doc.font('Helvetica').fontSize(7).fillColor(CREDO_GRAY);
    doc.text(`Buchungstext: ${correctionBooking.description}`, marginLeft + 4, y, { width: contentWidth });
    y += 20;
  }

  // ── Unterschrift ───────────────────────────────────────────────────────────
  const signY = Math.max(y + 20, doc.page.height - doc.page.margins.bottom - 80);

  doc.moveTo(marginLeft, signY).lineTo(marginLeft + contentWidth, signY).lineWidth(0.5).strokeColor('#CCCCCC').stroke();
  signY + 6;

  doc.font('Helvetica').fontSize(8).fillColor(CREDO_GRAY);
  doc.text('Ort, Datum', marginLeft + 4, signY + 8, { width: 200 });
  doc.text('Unterschrift (Kassierer)', marginLeft + contentWidth - 200, signY + 8, { width: 196, align: 'right' });

  doc.moveTo(marginLeft, signY + 40).lineTo(marginLeft + 160, signY + 40).lineWidth(0.5).strokeColor(CREDO_GRAY).stroke();
  doc.moveTo(marginLeft + contentWidth - 160, signY + 40).lineTo(marginLeft + contentWidth, signY + 40).lineWidth(0.5).strokeColor(CREDO_GRAY).stroke();

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 30;
  const lineY = footerY - 8;
  const totalParts = 7;
  const partWidth = contentWidth / totalParts;
  doc.rect(marginLeft, lineY, partWidth * 4, 3).fill(CREDO_GRAY);
  doc.rect(marginLeft + partWidth * 4, lineY, partWidth, 3).fill(CREDO_YELLOW);
  doc.rect(marginLeft + partWidth * 5, lineY, partWidth, 3).fill(CREDO_GREEN);
  doc.rect(marginLeft + partWidth * 6, lineY, partWidth, 3).fill(CREDO_RED);
  doc.font('Helvetica').fontSize(6).fillColor(CREDO_GRAY);
  doc.text('CREDO Verwaltung – Kassenbuch', marginLeft, footerY, { width: contentWidth, align: 'center' });

  doc.end();
  return doc;
}

function formatDateDE(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()}`;
}

function formatCurrency(amount: string): string {
  const num = parseFloat(amount);
  return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
