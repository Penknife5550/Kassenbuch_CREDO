import { describe, it, expect } from 'vitest';

import {
  euroToCents,
  buildPositions,
  centsToDecimal,
  formatCents,
  betragInWorten,
} from './eigenbelegService';

describe('eigenbelegService.euroToCents', () => {
  it('rechnet glatte Betraege um', () => {
    expect(euroToCents(1)).toBe(100);
    expect(euroToCents(1.5)).toBe(150);
    expect(euroToCents(0.01)).toBe(1);
  });

  // 1.15 * 100 ergibt in Fliesskomma 114.99999999999999 — das ist Rauschen,
  // kein drittes Nachkomma.
  it('laesst sich von Fliesskomma-Rauschen nicht taeuschen', () => {
    expect(euroToCents(1.15)).toBe(115);
    expect(euroToCents(0.07)).toBe(7);
    expect(euroToCents(99999.99)).toBe(9999999);
  });

  it('weist ein echtes drittes Nachkomma ab', () => {
    expect(euroToCents(1.005)).toBeNull();
    expect(euroToCents(0.333)).toBeNull();
  });
});

describe('eigenbelegService.buildPositions', () => {
  it('rechnet den Einnahmebeleg der Gesamtschule auf den Cent genau', () => {
    const result = buildPositions([
      { label: 'Heft', unitPrice: 1, quantity: 28 },
      { label: 'Collegeblock', unitPrice: 1.5, quantity: 5 },
      { label: 'Schwimmpass', unitPrice: 1, quantity: 30 },
      { label: 'Schülerausweis', unitPrice: 5, quantity: 8 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalCents).toBe(10550);
    expect(result.positions.map((p) => p.amountCents)).toEqual([2800, 750, 3000, 4000]);
  });

  // Mit Fliesskomma waere 3 * 0.35 = 1.0499999999999998.
  it('summiert in ganzen Cent statt in Fliesskomma', () => {
    const result = buildPositions([
      { label: 'Kopie', unitPrice: 0.35, quantity: 3 },
      { label: 'Kopie farbig', unitPrice: 0.1, quantity: 3 },
    ]);

    expect(result.ok && result.totalCents).toBe(135);
  });

  it('nennt die Position, deren Preis zu viele Nachkommastellen hat', () => {
    const result = buildPositions([{ label: 'Heft', unitPrice: 1.005, quantity: 1 }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Heft');
  });

  it('weist einen Beleg ohne Betrag ab', () => {
    const result = buildPositions([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('mindestens eine Position');
  });

  // bookings.amount ist Decimal(12,2) — mehr passt nicht in die Buchung.
  it('weist eine Summe ab, die nicht mehr in die Buchung passt', () => {
    const teuer = { label: 'Sonderposten', unitPrice: 99999.99, quantity: 9999 };
    const result = buildPositions(Array.from({ length: 30 }, () => teuer));

    expect(result.ok).toBe(false);
  });
});

describe('eigenbelegService.centsToDecimal', () => {
  it('liefert den Buchungsbetrag ohne Rundungsfehler', () => {
    expect(centsToDecimal(10550).toString()).toBe('105.5');
    expect(centsToDecimal(1).toFixed(2)).toBe('0.01');
  });
});

describe('eigenbelegService.formatCents', () => {
  it('formatiert deutsch mit Tausenderpunkt und Komma', () => {
    expect(formatCents(10550)).toBe('105,50 €');
    expect(formatCents(1087325)).toBe('10.873,25 €');
    expect(formatCents(5)).toBe('0,05 €');
  });
});

describe('eigenbelegService.betragInWorten', () => {
  it.each([
    [10550, 'einhundertfünf Euro und fünfzig Cent'],
    [11400, 'einhundertvierzehn Euro'],
    [16800, 'einhundertachtundsechzig Euro'],
    [1500, 'fünfzehn Euro'],
    [100, 'ein Euro'],
    [101, 'ein Euro und ein Cent'],
    [50, 'fünfzig Cent'],
    [0, 'null Euro'],
    [2100, 'einundzwanzig Euro'],
    [3000, 'dreißig Euro'],
    [1600, 'sechzehn Euro'],
    [1700, 'siebzehn Euro'],
    [10100, 'einhundertein Euro'],
    [100000, 'eintausend Euro'],
    [234567, 'zweitausenddreihundertfünfundvierzig Euro und siebenundsechzig Cent'],
    [2100000, 'einundzwanzigtausend Euro'],
    [100000000, 'eine Million Euro'],
    [250000000, 'zwei Millionen fünfhunderttausend Euro'],
  ])('%i Cent → %s', (cents, expected) => {
    expect(betragInWorten(cents)).toBe(expected);
  });
});
