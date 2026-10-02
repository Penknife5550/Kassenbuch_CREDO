import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { renderEigenbelegPdf, toPdfText, type EigenbelegPdfData } from './eigenbelegPdf';
import { EIGENBELEG_LIMITS, buildPositions } from './eigenbelegService';

function positions(count: number) {
  const built = buildPositions(
    Array.from({ length: count }, (_, i) => ({ label: `Artikel ${i + 1}`, unitPrice: 1.5, quantity: i + 1 })),
  );
  if (!built.ok) throw new Error(built.error);
  return built;
}

function beleg(overrides: Partial<EigenbelegPdfData> = {}): EigenbelegPdfData {
  const built = positions(4);
  return {
    issuer: { name: 'Christlicher Schulförderverein Minden e.V.', address: 'Kingsleyallee 6, 32425 Minden' },
    schoolName: 'Gesamtschule',
    schoolCode: 'GES',
    receiptNumber: 214,
    bookingDate: new Date(2026, 9, 2),
    debitCredit: 'S',
    counterparty: 'Schülerinnen und Schülern',
    positions: built.positions,
    totalCents: built.totalCents,
    reason: 'Sammel-Einnahme, keine Einzelquittungen ausgestellt',
    account: { accountNumber: '1020', name: 'Kasse Gesamtschule' },
    counterAccount: { accountNumber: '8200', name: 'Erlöse steuerfrei' },
    costCenter: { code: '20', name: 'Schule' },
    description: 'Verkauf Schulmaterial',
    payeeSigns: false,
    createdByName: 'Maria Beispiel',
    createdAt: new Date('2026-10-02T08:42:00Z'),
    ...overrides,
  };
}

describe('eigenbelegPdf.renderEigenbelegPdf', () => {
  it('erzeugt ein einseitiges PDF', async () => {
    const pdf = await renderEigenbelegPdf(beleg());

    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.pageCount).toBe(1);
    expect((await PDFDocument.load(pdf.buffer)).getPageCount()).toBe(1);
  });

  // Regression: Text unterhalb des unteren Seitenrands laesst pdfkit eine neue
  // Seite anfangen. Fusszeile und Abschlussblock duerfen das nicht ausloesen —
  // auch nicht mit der zusaetzlichen Zeile fuer die Empfangsbestaetigung.
  it('bleibt auch mit Empfangsbestaetigung einseitig', async () => {
    const pdf = await renderEigenbelegPdf(beleg({ debitCredit: 'H', payeeSigns: true }));

    expect((await PDFDocument.load(pdf.buffer)).getPageCount()).toBe(1);
  });

  it('bricht bei vielen Positionen auf eine zweite Seite um', async () => {
    const built = positions(30);
    const pdf = await renderEigenbelegPdf(beleg({ positions: built.positions, totalCents: built.totalCents }));

    expect(pdf.pageCount).toBe(2);
    expect((await PDFDocument.load(pdf.buffer)).getPageCount()).toBe(2);
  });

  it('rendert einen Entwurf ohne Belegnummer', async () => {
    const pdf = await renderEigenbelegPdf(beleg({ receiptNumber: null }));

    expect(pdf.pageCount).toBe(1);
  });

  // Der Beleg wird mit Pruefsumme abgelegt. Gleiche Angaben muessen dieselbe
  // Datei ergeben, sonst liesse sich ein Beleg nie nachvollziehbar neu erzeugen.
  it('ist fuer gleiche Angaben bytegleich', async () => {
    const [a, b] = await Promise.all([renderEigenbelegPdf(beleg()), renderEigenbelegPdf(beleg())]);

    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  it('haelt ein Emoji in der Eingabe aus', async () => {
    const pdf = await renderEigenbelegPdf(beleg({ counterparty: 'Klasse 3b 😀', description: 'Жетон' }));

    expect(pdf.pageCount).toBe(1);
  });

  // Alles auf Anschlag und ohne Leerzeichen: das Layout darf weder haengen noch
  // Seiten erzeugen, auf denen nur die Fusszeile steht.
  it('uebersteht Eingaben in voller Laenge ohne Leerzeichen', async () => {
    const long = (length: number) => 'W'.repeat(length);
    const built = buildPositions(
      Array.from({ length: EIGENBELEG_LIMITS.maxPositions }, () => ({
        label: long(EIGENBELEG_LIMITS.maxLabelLength), unitPrice: 99.99, quantity: EIGENBELEG_LIMITS.maxQuantity,
      })),
    );
    if (!built.ok) throw new Error(built.error);

    const pdf = await renderEigenbelegPdf(beleg({
      debitCredit: 'H',
      payeeSigns: true,
      schoolCode: long(20),
      counterparty: long(EIGENBELEG_LIMITS.maxCounterpartyLength),
      positions: built.positions,
      totalCents: built.totalCents,
      reason: long(EIGENBELEG_LIMITS.maxReasonLength),
      description: long(500),
      createdByName: long(100),
    }));

    expect(pdf.pageCount).toBe(4);
    expect((await PDFDocument.load(pdf.buffer)).getPageCount()).toBe(4);
  });
});

describe('eigenbelegPdf.toPdfText', () => {
  it('laesst Umlaute, ß, Euro und typografische Zeichen stehen', () => {
    expect(toPdfText('Schülerausweis für 5,00 € – „groß“')).toBe('Schülerausweis für 5,00 € – „groß“');
  });

  it('ersetzt, was die PDF-Schrift nicht kennt', () => {
    expect(toPdfText('Жетон')).toBe('?????');
  });

  it('macht aus Zeilenumbruechen Leerzeichen', () => {
    expect(toPdfText(' Zeile 1\r\nZeile 2\t')).toBe('Zeile 1 Zeile 2');
  });

  // Aus PDF-Listen kopierte Namen kommen oft als "u" + Trema an. Ohne
  // Zusammensetzen stuende "Mu?ller" unveraenderlich im Beleg.
  it('setzt zerlegte Umlaute zusammen', () => {
    expect(toPdfText('Müller, Schön, Ärzte')).toBe('Müller, Schön, Ärzte');
  });

  it('glaettet Zeichen, die beim Kopieren aus Word mitkommen', () => {
    expect(toPdfText('Klasse 5‑a')).toBe('Klasse 5-a');
    expect(toPdfText('Heft​﻿')).toBe('Heft');
    expect(toPdfText('z. B. 3 Stück')).toBe('z. B. 3 Stück');
    expect(toPdfText('5 − 2')).toBe('5 - 2');
  });
});
