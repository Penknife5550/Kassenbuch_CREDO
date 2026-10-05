/**
 * Frühestes Buchungsdatum in den Datumsfeldern. Ein zweistellig getipptes
 * Jahr käme sonst als 0026 an; der Server weist es ebenfalls ab.
 */
export const MIN_BOOKING_DATE = '2000-01-01';

/**
 * Betrag aus einem Eingabefeld in ganze Cent — für alle Buchungsmasken.
 *
 * Versteht die deutsche Schreibweise mit und ohne Tausenderpunkt ("1.250,00",
 * "1250,00"), Leerzeichen als Tausendertrenner und den Dezimalpunkt ("12.50").
 * Drei Ziffern nach einem Punkt ("1.250") sind Tausender, keine Cent.
 *
 * null, wenn die Eingabe kein eindeutiger Betrag mit höchstens zwei
 * Nachkommastellen ist. Früher wurde "1.250,00" stillschweigend als 1,25 €
 * gebucht, weil nur das erste Komma ersetzt wurde und die Zahl am Punkt endete.
 */
export function parseAmountCents(input: string): number | null {
  // \s erfasst auch geschützte Leerzeichen (U+00A0, U+202F) aus kopierten Beträgen
  const text = input.replace(/\s/g, '');
  if (text === '') return null;

  let euros: string;
  let cents = '';
  if (text.includes(',')) {
    // Komma trennt die Nachkommastellen, Punkte gliedern Tausender
    const parts = text.split(',');
    if (parts.length !== 2) return null;
    const [whole, fraction] = parts;
    if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(whole) || !/^\d{1,2}$/.test(fraction)) return null;
    euros = whole.replace(/\./g, '');
    cents = fraction;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    euros = text.replace(/\./g, '');
  } else {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return null;
    euros = match[1];
    cents = match[2] ?? '';
  }

  // Mehr als neun Stellen vor dem Komma ist sicher ein Tippfehler
  if (euros.length > 9) return null;
  return parseInt(euros, 10) * 100 + parseInt(cents.padEnd(2, '0'), 10);
}

/** Cent als Euro-Betrag für die Schnittstelle, ohne Rundungsrest. */
export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100;
}

/** Cent als „1.250,00 €“. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
