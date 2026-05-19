import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import { decimalToNumber } from '../utils/decimal';

// Swiss-QR-Header gemäß BELEGE_PLAN.html §6.2 — Referenz-Layout.
// Hinweis: der QR wird hier ausschließlich für die DMS-Metadaten-Pipeline
// genutzt (n8n liest die unstructured-Zeile). Der Header bleibt fix; nur
// Name, Betrag und unstructured werden eingesetzt.
export function buildSpcPayload(params: {
  creditorName: string;
  amount: Prisma.Decimal | number | string;
  unstructured: string;
}): string {
  const amountNum = decimalToNumber(params.amount);
  const amountStr = amountNum.toFixed(2); // Swiss-QR: Punkt als Dezimaltrenner
  const name = sanitizeHeaderField(params.creditorName);

  const lines = [
    'SPC',          // 1  QRType
    '0200',         // 2  Version
    '1',            // 3  Coding (UTF-8)
    '',             // 4  IBAN (leer — kein Zahlungs-QR)
    'K',            // 5  Adress-Typ kombiniert
    name,           // 6  Creditor-Name
    '',             // 7  Adresszeile 1
    '',             // 8  Adresszeile 2
    '',             // 9  Postleitzahl
    'CH',           // 10 Country
    '',             // 11 Ultimate-Creditor-Typ
    '',             // 12
    '',             // 13
    '',             // 14
    amountStr,      // 15 Amount
    'EUR',          // 16 Currency
    '',             // 17 Ultimate-Debtor-Typ
    '',             // 18
    '',             // 19
    '',             // 20
    'NON',          // 21 Reference-Typ
    '',             // 22 Reference (leer bei NON)
    params.unstructured, // 23 Unstrukturierte Mitteilung (DMS-Payload)
    'EPD',          // 24 Trailer
  ];
  return lines.join('\n');
}

/**
 * Rendert einen QR-Code als PNG-Buffer.
 * Spezifikation aus BELEGE_PLAN.html §6: width 260, margin 0, EC-Level M.
 */
export async function renderQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    width: 260,
    margin: 0,
    errorCorrectionLevel: 'M',
  });
}

function sanitizeHeaderField(value: string): string {
  // Newlines im SPC-Header sind tödlich — ersetzen.
  return value.replace(/[\r\n]+/g, ' ').trim();
}
