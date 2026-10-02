import { Prisma } from '@prisma/client';

/**
 * Grenzen fuer die Eingaben eines Eigenbelegs. An einer Stelle, damit
 * Validierung und PDF-Layout dieselben Werte benutzen.
 */
export const EIGENBELEG_LIMITS = {
  maxPositions: 30,
  maxLabelLength: 80,
  maxQuantity: 9999,
  /** 99.999,99 EUR je Stueck */
  maxUnitPrice: 99999.99,
  maxCounterpartyLength: 200,
  maxReasonLength: 300,
} as const;

/** Groesster Betrag, den bookings.amount (Decimal(12,2)) aufnehmen kann, in Cent. */
const MAX_TOTAL_CENTS = 999_999_999_999;

export interface PositionInput {
  label: string;
  /** Einzelpreis in Euro, hoechstens zwei Nachkommastellen */
  unitPrice: number;
  quantity: number;
}

/**
 * Eine Position, wie sie gespeichert und gedruckt wird. Betraege in ganzen Cent.
 * Als type statt interface, damit Prisma sie ohne Umweg als JSON annimmt.
 */
export type EigenbelegPosition = {
  label: string;
  unitPriceCents: number;
  quantity: number;
  amountCents: number;
};

export type PositionsResult =
  | { ok: true; positions: EigenbelegPosition[]; totalCents: number }
  | { ok: false; error: string };

/**
 * Euro-Betrag in ganze Cent. Liefert null, wenn der Betrag mehr als zwei
 * Nachkommastellen hat. Die Toleranz faengt nur Fliesskomma-Rauschen ab
 * (1.15 * 100 = 114.99999999999999), kein echtes drittes Nachkomma.
 */
export function euroToCents(value: number): number | null {
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return null;
  return cents;
}

/**
 * Rechnet die Positionen eines Eigenbelegs in ganzen Cent. Die Summe ist der
 * Buchungsbetrag — der Browser liefert bewusst keine eigene Summe mit, damit
 * Beleg und Buchung nicht auseinanderlaufen koennen.
 */
export function buildPositions(inputs: PositionInput[]): PositionsResult {
  const positions: EigenbelegPosition[] = [];
  let totalCents = 0;

  for (const input of inputs) {
    const unitPriceCents = euroToCents(input.unitPrice);
    if (unitPriceCents === null) {
      return { ok: false, error: `Der Einzelpreis bei „${input.label}“ hat mehr als zwei Nachkommastellen.` };
    }
    const amountCents = unitPriceCents * input.quantity;
    positions.push({ label: input.label, unitPriceCents, quantity: input.quantity, amountCents });
    totalCents += amountCents;
  }

  if (totalCents <= 0) {
    return { ok: false, error: 'Bitte mindestens eine Position mit Betrag erfassen.' };
  }
  if (totalCents > MAX_TOTAL_CENTS) {
    return { ok: false, error: 'Die Summe der Positionen ist zu groß.' };
  }
  return { ok: true, positions, totalCents };
}

export function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

const MONEY_FORMAT = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 10550 → "105,50 €" */
export function formatCents(cents: number): string {
  return `${MONEY_FORMAT.format(cents / 100)} €`;
}

// ─── Betrag in Worten ───────────────────────────────────────────────────────

const BIS_NEUNZEHN = [
  'null', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn',
  'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn',
];
const ZEHNER = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

/** 1 bis 999. "ein" statt "eins", weil immer ein Hauptwort folgt (Euro, Cent, -tausend). */
function unterTausend(n: number): string {
  const hunderter = Math.floor(n / 100);
  const rest = n % 100;
  const anfang = hunderter > 0 ? `${BIS_NEUNZEHN[hunderter]}hundert` : '';
  if (rest === 0) return anfang;
  if (rest < 20) return anfang + BIS_NEUNZEHN[rest];
  const einer = rest % 10;
  return anfang + (einer > 0 ? `${BIS_NEUNZEHN[einer]}und` : '') + ZEHNER[Math.floor(rest / 10)];
}

function zahlInWorten(n: number): string {
  if (n === 0) return 'null';
  const milliarden = Math.floor(n / 1_000_000_000);
  const millionen = Math.floor((n % 1_000_000_000) / 1_000_000);
  const tausender = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const teile: string[] = [];
  if (milliarden > 0) teile.push(milliarden === 1 ? 'eine Milliarde' : `${unterTausend(milliarden)} Milliarden`);
  if (millionen > 0) teile.push(millionen === 1 ? 'eine Million' : `${unterTausend(millionen)} Millionen`);
  const klein = (tausender > 0 ? `${unterTausend(tausender)}tausend` : '') + (rest > 0 ? unterTausend(rest) : '');
  if (klein) teile.push(klein);
  return teile.join(' ');
}

/**
 * Betrag in Worten, wie auf den bisherigen Vordrucken — dort aber ohne Cent
 * ("Cent wie oben"). 10550 → "einhundertfünf Euro und fünfzig Cent".
 */
export function betragInWorten(totalCents: number): string {
  const euro = Math.floor(totalCents / 100);
  const cent = totalCents % 100;
  const euroText = `${zahlInWorten(euro)} Euro`;
  if (cent === 0) return euroText;
  const centText = `${zahlInWorten(cent)} Cent`;
  return euro === 0 ? centText : `${euroText} und ${centText}`;
}
