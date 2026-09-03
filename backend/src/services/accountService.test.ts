import { describe, it, expect } from 'vitest';

import { resolveAccountRemoval } from './accountService';

describe('accountService.resolveAccountRemoval', () => {
  it('loescht ein Konto ohne jede Referenz wirklich', () => {
    const result = resolveAccountRemoval({ bookingCount: 0, isActive: true });

    expect(result.kind).toBe('delete');
    expect(result.message).toContain('gel');
  });

  it('deaktiviert ein Konto mit Buchungshistorie statt es zu loeschen', () => {
    const result = resolveAccountRemoval({ bookingCount: 42, isActive: true });

    expect(result.kind).toBe('deactivate');
    expect(result.message).toContain('42');
  });

  it('blockiert ein Konto, das einer Schule zugewiesen ist', () => {
    const result = resolveAccountRemoval({
      bookingCount: 0,
      assignedSchoolName: 'Gymnasium',
      isActive: true,
    });

    expect(result.kind).toBe('blocked');
    expect(result.message).toContain('Gymnasium');
  });

  it('die Schul-Zuweisung hat Vorrang vor der Buchungshistorie', () => {
    const result = resolveAccountRemoval({
      bookingCount: 7,
      assignedSchoolName: 'Berufskolleg',
      isActive: true,
    });

    expect(result.kind).toBe('blocked');
  });

  // Wiederholter DELETE-Aufruf darf keinen zweiten Audit-Eintrag ausloesen.
  it('meldet ein bereits deaktiviertes Konto als noop', () => {
    const result = resolveAccountRemoval({ bookingCount: 7, isActive: false });

    expect(result.kind).toBe('noop');
    expect(result.message).toContain('bereits deaktiviert');
  });

  it('behandelt eine leere Schul-Zuweisung wie keine Zuweisung', () => {
    expect(resolveAccountRemoval({ bookingCount: 0, assignedSchoolName: null, isActive: true }).kind)
      .toBe('delete');
    expect(resolveAccountRemoval({ bookingCount: 0, assignedSchoolName: '', isActive: true }).kind)
      .toBe('delete');
  });
});
