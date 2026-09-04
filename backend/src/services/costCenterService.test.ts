import { describe, it, expect, vi } from 'vitest';

import {
  resolveCostCenterRemoval,
  checkCostCentersUsable,
  isSeedDefaultCostCenter,
  DEFAULT_COST_CENTERS,
} from './costCenterService';

/** Eigene Kostenstelle ohne jede Referenz — der Normalfall in den Tests. */
const eigene = {
  bookingCount: 0,
  defaultForAccounts: [],
  isActive: true,
  isSeedDefault: false,
};

describe('costCenterService.resolveCostCenterRemoval', () => {
  it('loescht eine Kostenstelle ohne jede Referenz wirklich', () => {
    const result = resolveCostCenterRemoval(eigene);

    expect(result.kind).toBe('delete');
    expect(result.message).toContain('gel');
  });

  it('deaktiviert eine Kostenstelle mit Buchungshistorie statt sie zu loeschen', () => {
    const result = resolveCostCenterRemoval({ ...eigene, bookingCount: 37 });

    expect(result.kind).toBe('deactivate');
    expect(result.message).toContain('37');
  });

  it('blockiert eine Kostenstelle, die einem Konto als Standard zugewiesen ist', () => {
    const result = resolveCostCenterRemoval({
      ...eigene,
      defaultForAccounts: [{ label: '4600 – Werbekosten', isActive: true }],
    });

    expect(result.kind).toBe('blocked');
    expect(result.message).toContain('4600 – Werbekosten');
  });

  it('nennt alle blockierenden Konten in der Meldung', () => {
    const result = resolveCostCenterRemoval({
      ...eigene,
      defaultForAccounts: [
        { label: '4600 – Werbekosten', isActive: true },
        { label: '4651 – Bewirtungskosten', isActive: true },
      ],
    });

    expect(result.message).toContain('4600 – Werbekosten');
    expect(result.message).toContain('4651 – Bewirtungskosten');
  });

  // Ein deaktiviertes Konto steht nicht in der Standardansicht der
  // Konten-Verwaltung — ohne Hinweis sucht der Anwender vergeblich.
  it('weist auf deaktivierte blockierende Konten hin', () => {
    const result = resolveCostCenterRemoval({
      ...eigene,
      defaultForAccounts: [{ label: '4600 – Werbekosten', isActive: false }],
    });

    expect(result.message).toContain('(deaktiviert)');
    expect(result.message).toContain('Deaktivierte Konten anzeigen');
  });

  it('haengt den Hinweis nicht an, wenn alle blockierenden Konten aktiv sind', () => {
    const result = resolveCostCenterRemoval({
      ...eigene,
      defaultForAccounts: [{ label: '4600 – Werbekosten', isActive: true }],
    });

    expect(result.message).not.toContain('Deaktivierte Konten anzeigen');
  });

  it('die Konto-Zuweisung hat Vorrang vor der Buchungshistorie', () => {
    const result = resolveCostCenterRemoval({
      ...eigene,
      bookingCount: 12,
      defaultForAccounts: [{ label: '4600 – Werbekosten', isActive: true }],
    });

    expect(result.kind).toBe('blocked');
  });

  // Wiederholter DELETE-Aufruf darf keinen zweiten Audit-Eintrag ausloesen.
  it('meldet eine bereits deaktivierte Kostenstelle als noop', () => {
    const result = resolveCostCenterRemoval({ ...eigene, bookingCount: 7, isActive: false });

    expect(result.kind).toBe('noop');
    expect(result.message).toContain('bereits deaktiviert');
  });

  it('loescht eine deaktivierte eigene Kostenstelle ohne Buchungen', () => {
    const result = resolveCostCenterRemoval({ ...eigene, isActive: false });

    expect(result.kind).toBe('delete');
  });

  // Kern des Redeploy-Schutzes: hart geloescht kaeme eine Standard-Kostenstelle
  // durch FORCE_SEED=1 zurueck, und zwar aktiv. Deaktiviert nicht.
  it('deaktiviert eine Standard-Kostenstelle, statt sie zu loeschen', () => {
    const result = resolveCostCenterRemoval({ ...eigene, isSeedDefault: true });

    expect(result.kind).toBe('deactivate');
    expect(result.message).toContain('Redeploy');
  });

  it('meldet eine bereits deaktivierte Standard-Kostenstelle als noop', () => {
    const result = resolveCostCenterRemoval({ ...eigene, isSeedDefault: true, isActive: false });

    expect(result.kind).toBe('noop');
  });

  it('Buchungshistorie schlaegt bei Standard-Kostenstellen die Standard-Begruendung', () => {
    const result = resolveCostCenterRemoval({ ...eigene, isSeedDefault: true, bookingCount: 5 });

    expect(result.kind).toBe('deactivate');
    expect(result.message).toContain('5');
  });
});

describe('costCenterService.isSeedDefaultCostCenter', () => {
  it('kennt jedes Kuerzel aus DEFAULT_COST_CENTERS', () => {
    for (const cc of DEFAULT_COST_CENTERS) {
      expect(isSeedDefaultCostCenter(cc.code)).toBe(true);
    }
  });

  it('kennt selbst angelegte Kuerzel nicht', () => {
    expect(isSeedDefaultCostCenter('99')).toBe(false);
    expect(isSeedDefaultCostCenter('')).toBe(false);
  });
});

describe('costCenterService.checkCostCentersUsable', () => {
  const dbWith = (rows: Array<{ id: string; isActive: boolean }>) => ({
    costCenter: { findMany: vi.fn().mockResolvedValue(rows) },
  }) as unknown as Parameters<typeof checkCostCentersUsable>[0];

  it('laesst aktive Kostenstellen durch', async () => {
    const db = dbWith([{ id: 'a', isActive: true }, { id: 'b', isActive: true }]);

    await expect(checkCostCentersUsable(db, ['a', 'b'])).resolves.toEqual({ ok: true });
  });

  it('weist eine deaktivierte Kostenstelle ab', async () => {
    const result = await checkCostCentersUsable(dbWith([{ id: 'a', isActive: false }]), ['a']);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toContain('inaktiv');
  });

  it('weist eine unbekannte Kostenstelle ab', async () => {
    const result = await checkCostCentersUsable(dbWith([]), ['weg']);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toContain('nicht gefunden');
  });

  // Eine Buchung ohne Kostenstelle ist der Normalfall (das Feld ist freiwillig).
  it('fragt ohne Kostenstelle gar nicht erst die Datenbank', async () => {
    const db = dbWith([]);

    await expect(checkCostCentersUsable(db, [undefined, null])).resolves.toEqual({ ok: true });
    expect(db.costCenter.findMany).not.toHaveBeenCalled();
  });

  // Splittbuchung mit vielen Zeilen: eine Abfrage, nicht eine pro Zeile.
  it('braucht fuer mehrere Zeilen nur eine Abfrage', async () => {
    const db = dbWith([{ id: 'a', isActive: true }, { id: 'b', isActive: true }]);

    await checkCostCentersUsable(db, ['a', 'b', 'a', undefined, 'b']);

    expect(db.costCenter.findMany).toHaveBeenCalledTimes(1);
    expect(db.costCenter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['a', 'b'] } } }),
    );
  });
});
