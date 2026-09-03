import { describe, it, expect, vi } from 'vitest';

import { isDatabaseInitialized, SEED_STATE_ID, type SeedStateDb } from './seedStateService';

function makeDb(marker: unknown, datevConfig: unknown, schoolCount: number) {
  return {
    seedState: {
      findUnique: vi.fn().mockResolvedValue(marker),
      upsert: vi.fn().mockResolvedValue({ id: SEED_STATE_ID }),
    },
    datevExportConfig: { findFirst: vi.fn().mockResolvedValue(datevConfig) },
    school: { count: vi.fn().mockResolvedValue(schoolCount) },
  };
}

const run = (db: ReturnType<typeof makeDb>) => isDatabaseInitialized(db as unknown as SeedStateDb);

describe('seedStateService', () => {
  describe('isDatabaseInitialized', () => {
    it('erkennt eine frische Datenbank — Seed darf laufen', async () => {
      const db = makeDb(null, null, 0);

      expect(await run(db)).toBe(false);
      expect(db.seedState.upsert).not.toHaveBeenCalled();
    });

    it('ueberspringt den Seed, wenn der Marker existiert', async () => {
      const db = makeDb({ id: SEED_STATE_ID, seededAt: new Date() }, { id: 'default' }, 6);

      expect(await run(db)).toBe(true);
      expect(db.datevExportConfig.findFirst).not.toHaveBeenCalled();
      expect(db.seedState.upsert).not.toHaveBeenCalled();
    });

    // Regression zum Bug-Report: eine vor dem Fix geseedete Bestandsinstallation
    // darf beim naechsten Container-Start NICHT erneut geseedet werden, sonst
    // kehren geloeschte Konten zurueck.
    it('adoptiert eine vollstaendig geseedete Bestandsinstallation ohne Marker', async () => {
      const db = makeDb(null, { id: 'default' }, 6);

      expect(await run(db)).toBe(true);
      expect(db.seedState.upsert).toHaveBeenCalledWith({
        where: { id: SEED_STATE_ID },
        update: {},
        create: { id: SEED_STATE_ID },
      });
    });

    // Ein abgebrochener Erst-Seed darf nicht als "fertig" adoptiert werden,
    // sonst bliebe die Installation dauerhaft unvollstaendig.
    it('adoptiert eine halb geseedete Datenbank NICHT', async () => {
      const db = makeDb(null, null, 6);

      expect(await run(db)).toBe(false);
      expect(db.seedState.upsert).not.toHaveBeenCalled();
    });
  });
});
