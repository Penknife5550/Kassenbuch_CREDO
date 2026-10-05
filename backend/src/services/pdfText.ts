import * as iconv from 'iconv-lite';

/**
 * Text fuer die PDF-Standardschriften (Helvetica, Courier) aufbereiten.
 *
 * Diese Schriften kennen nur den westeuropaeischen Zeichensatz (WinAnsi,
 * Codepage 1252). Was darueber hinausgeht, druckt pdfkit als Zeichensalat,
 * und pdf-lib bricht den ganzen DMS-Export ab. Deshalb gilt fuer alle drei
 * PDFs — Eigenbeleg, Kassensturz-Beleg und DMS-Export — dieselbe Regel.
 */

/** Alle Zeichen, die Codepage 1252 darstellen kann. */
const WIN1252 = new Set(
  iconv.decode(Buffer.from(Array.from({ length: 256 }, (_, i) => i)), 'win1252').replace(/\uFFFD/g, ''),
);

/**
 * Buchstaben, die Unicode nicht in Grundbuchstabe und Akzent zerlegt. Ohne
 * diese Liste stuende aus "Paweł" oder "Yılmaz" ein "?" im Beleg.
 */
const LATIN_FALLBACK: Record<string, string> = {
  ł: 'l', Ł: 'L', ı: 'i', đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ŀ: 'l', Ŀ: 'L', ŧ: 't', Ŧ: 'T', ĸ: 'k', ŉ: "'n",
};

/** Ein Zeichen in den Zeichensatz bringen: so lassen, Akzent abnehmen, Ersatzbuchstabe oder "?". */
function toWin1252Char(ch: string): string {
  if (WIN1252.has(ch)) return ch;
  // "ş" wird zu "s", "\uFB01" zu "fi" — aber nur, wenn das Ergebnis darstellbar ist
  const stripped = ch.normalize('NFKD').replace(/\p{M}/gu, '');
  if (stripped && [...stripped].every((c) => WIN1252.has(c))) return stripped;
  return LATIN_FALLBACK[ch] ?? '?';
}

/**
 * Bringt Eingaben auf den Zeichensatz der PDF-Standardschriften und in eine
 * Zeile. Vorher wird geglaettet, was beim Kopieren aus Word, Excel oder
 * PDF-Listen mitkommt: zerlegte Umlaute (u + Trema), unsichtbare Zeichen,
 * weiche Trennstriche, Sonder-Leerzeichen, Tabulatoren und Bindestrich-Varianten.
 *
 * Buchstaben ausserhalb des Zeichensatzes verlieren ihren Akzent ("Ayşe Yılmaz"
 * wird "Ayse Yilmaz"); nur was sich gar nicht umschreiben laesst — Emoji,
 * kyrillische Schrift — wird "?".
 */
export function toPdfText(text: string): string {
  const singleLine = text
    .normalize('NFC')
    .replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/[\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2010-\u2012\u2212]/g, '-')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim();
  return [...singleLine].map(toWin1252Char).join('');
}

/** true, wenn nach dem Aufbereiten noch sichtbarer Text bleibt — fuer Pflichtfelder. */
export function hasPrintableText(text: string, minLength = 1): boolean {
  return toPdfText(text).length >= minLength;
}
