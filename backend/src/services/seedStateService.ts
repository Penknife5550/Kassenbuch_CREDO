import type { PrismaClient } from '@prisma/client';

export const SEED_STATE_ID = 'default';

/** Nur der Ausschnitt des Prisma-Clients, den der Guard braucht — macht ihn testbar. */
export type SeedStateDb = Pick<PrismaClient, 'seedState' | 'school' | 'datevExportConfig'>;

/**
 * Liefert true, wenn diese Datenbank bereits initialisiert ist und der Seed
 * NICHT erneut laufen darf.
 *
 * Zwei Faelle gelten als initialisiert:
 *  1) Marker-Zeile vorhanden — Regelfall nach einem erfolgreichen Erst-Seed.
 *  2) Kein Marker, aber ein VOLLSTAENDIG geseedeter Datenbestand — Bestands-
 *     installation aus der Zeit vor dem Marker. Sie wird hier einmalig adoptiert.
 *     Auf Produktionsservern uebernimmt das schon die Migration; dieser Zweig
 *     greift fuer Entwicklungsmaschinen, auf denen `prisma db push` laeuft und
 *     die Migration deshalb nie ausgefuehrt wird.
 *
 * Als Nachweis dient bewusst die DATEV-Konfiguration und nicht etwa der Admin-
 * Benutzer: Letzteren legt der Seed als ERSTEN Schritt an, die DATEV-Konfiguration
 * als letzten. Ein mittendrin abgebrochener Erst-Seed wird dadurch NICHT adoptiert,
 * sondern beim naechsten Start ergaenzt — der Seed legt nur an und ueberschreibt
 * nichts, das Nachholen ist also gefahrlos.
 */
export async function isDatabaseInitialized(db: SeedStateDb): Promise<boolean> {
  const marker = await db.seedState.findUnique({ where: { id: SEED_STATE_ID } });
  if (marker) return true;

  // Die DATEV-Konfiguration ist der letzte Datensatz, den der Seed anlegt.
  // Existiert sie, war ein Seed-Lauf vollstaendig — auch ohne Marker.
  const datevConfig = await db.datevExportConfig.findFirst({ select: { id: true } });
  if (datevConfig) {
    await markDatabaseInitialized(db);
    console.log('Bestehende Datenbank erkannt — als initialisiert markiert, Seed wird uebersprungen.');
    return true;
  }

  // Daten vorhanden, aber der Seed lief nie durch: der naechste Lauf ergaenzt,
  // was fehlt. Gefahrlos, weil der Seed nur anlegt und nichts ueberschreibt.
  const schoolCount = await db.school.count();
  if (schoolCount > 0) {
    console.log('Unvollstaendig geseedete Datenbank erkannt — fehlende Standard-Stammdaten werden ergaenzt.');
  }

  return false;
}

/** Setzt den Marker. Idempotent, damit ein wiederholter Erst-Seed nicht scheitert. */
export async function markDatabaseInitialized(db: SeedStateDb): Promise<void> {
  await db.seedState.upsert({
    where: { id: SEED_STATE_ID },
    update: {},
    create: { id: SEED_STATE_ID },
  });
}
