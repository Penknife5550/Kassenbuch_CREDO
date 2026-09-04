import type { PrismaClient } from '@prisma/client';

/**
 * Standard-Kostenstellen, die prisma/seed.ts bei einer frischen Datenbank anlegt.
 *
 * Liegt hier und nicht im Seed, weil resolveCostCenterRemoval sie kennen muss:
 * Der Seed legt sie per upsert an. Waere eine davon HART geloescht, brachte ein
 * Lauf mit FORCE_SEED=1 sie zurueck — und zwar aktiv. Deaktiviert ueberleben
 * sie jeden Seed-Lauf, weil der Upsert mit "update: {}" kein Feld schreibt.
 * Gleiches Muster wie DEFAULT_BELEGARTEN und DEFAULT_DMS_MAPPING.
 */
export const DEFAULT_COST_CENTERS = [
  { code: '10', name: 'Verwaltung' },
  { code: '20', name: 'Schule' },
  { code: '30', name: 'Mensa' },
  { code: '40', name: 'Betreuung' },
  { code: '50', name: 'Veranstaltungen' },
];

const DEFAULT_COST_CENTER_CODES = new Set(DEFAULT_COST_CENTERS.map((cc) => cc.code));

export function isSeedDefaultCostCenter(code: string): boolean {
  return DEFAULT_COST_CENTER_CODES.has(code);
}

/**
 * Entscheidet, was beim Entfernen einer Kostenstelle passiert.
 *
 * Kostenstellen mit Buchungshistorie duerfen nicht verschwinden — Journal,
 * DATEV-Export (KOST1) und DMS-Trennseite (projektnr1) verweisen darauf. Sie
 * werden deaktiviert: sie bleiben in der Datenbank, tauchen aber in
 * Buchungsmaske und Auswertungs-Dropdowns nicht mehr auf. Nur Kostenstellen
 * ohne jede Referenz werden echt geloescht.
 *
 * Zwillingsstueck zu accountService.resolveAccountRemoval — bewusst dieselbe
 * Form, damit beide Stammdaten-Verwaltungen sich gleich verhalten.
 */
export type CostCenterRemoval =
  | { kind: 'blocked'; message: string }
  | { kind: 'deactivate'; message: string }
  | { kind: 'delete'; message: string }
  | { kind: 'noop'; message: string };

/** Ein Konto, das die Kostenstelle als Standard-Kostenstelle hinterlegt hat. */
export interface BlockingAccount {
  /** Anzeigeform, z.B. '4600 – Werbekosten'. */
  label: string;
  isActive: boolean;
}

export interface CostCenterRemovalInput {
  /** Anzahl Buchungen, die die Kostenstelle referenzieren (inkl. Split-Zeilen). */
  bookingCount: number;
  /** Konten, die die Kostenstelle als Standard-Kostenstelle hinterlegt haben. */
  defaultForAccounts: BlockingAccount[];
  /** Ist die Kostenstelle aktuell aktiv? */
  isActive: boolean;
  /** Gehoert das Kuerzel zu den Standard-Kostenstellen aus dem Seed? */
  isSeedDefault: boolean;
}

export function resolveCostCenterRemoval(input: CostCenterRemovalInput): CostCenterRemoval {
  // Die Standard-Zuordnung eines Kontos ist eine bewusste Konfiguration. Sie
  // wird nicht still aufgeloest, sondern blockiert das Entfernen — die Meldung
  // sagt, wo aufzuraeumen ist. Auch deaktivierte Konten blockieren: sonst
  // entstuende der Zustand "Konto zeigt auf inaktive Kostenstelle", den
  // routes/accounts.ts beim naechsten Speichern verweigert.
  if (input.defaultForAccounts.length > 0) {
    const labels = input.defaultForAccounts
      .map((a) => (a.isActive ? a.label : `${a.label} (deaktiviert)`))
      .join(', ');
    // Ein deaktiviertes Konto steht nicht in der Standardansicht der
    // Konten-Verwaltung. Ohne diesen Hinweis sucht der Anwender vergeblich.
    const hint = input.defaultForAccounts.some((a) => !a.isActive)
      ? ' Deaktivierte Konten blenden Sie in der Konten-Verwaltung über „Deaktivierte Konten anzeigen" ein.'
      : '';

    return {
      kind: 'blocked',
      message:
        'Kostenstelle kann nicht entfernt werden — sie ist bei folgenden Konten als Standard-Kostenstelle ' +
        `hinterlegt: ${labels}. Bitte heben Sie dort zuerst die Zuordnung auf.${hint}`,
    };
  }

  if (input.bookingCount > 0) {
    if (!input.isActive) {
      // Nichts zu tun. Wichtig fuer den IKS-Audit-Trail: ein wiederholter
      // DELETE-Aufruf (Retry, Skript, n8n) darf keinen Deaktivierungs-Eintrag
      // fuer ein Ereignis schreiben, das nie stattgefunden hat.
      return { kind: 'noop', message: 'Kostenstelle ist bereits deaktiviert.' };
    }
    return {
      kind: 'deactivate',
      message: `Kostenstelle deaktiviert — ${input.bookingCount} Buchung(en) referenzieren sie, daher bleibt sie für Journal und Auswertungen erhalten. In der Buchungsmaske erscheint sie nicht mehr.`,
    };
  }

  // Standard-Kostenstellen werden nie hart geloescht: der Seed legt sie per
  // upsert an, ein Lauf mit FORCE_SEED=1 brachte sie sonst zurueck. Deaktiviert
  // ueberstehen sie jeden Seed-Lauf.
  if (input.isSeedDefault) {
    if (!input.isActive) {
      return { kind: 'noop', message: 'Kostenstelle ist bereits deaktiviert.' };
    }
    return {
      kind: 'deactivate',
      message:
        'Kostenstelle deaktiviert — Standard-Kostenstellen werden nicht gelöscht, damit sie nach einem ' +
        'Redeploy nicht zurückkehren. In der Buchungsmaske erscheint sie nicht mehr.',
    };
  }

  return { kind: 'delete', message: 'Kostenstelle gelöscht' };
}

/** Nur der Ausschnitt des Prisma-Clients, den die Pruefung braucht — macht sie testbar. */
export type CostCenterDb = Pick<PrismaClient, 'costCenter'>;

export type CostCenterCheck = { ok: true } | { ok: false; message: string };

/**
 * Prueft, ob alle angegebenen Kostenstellen benutzt werden duerfen.
 *
 * Deaktivierte Kostenstellen verschwinden aus GET /cost-centers und damit aus
 * der Buchungsmaske. Ein vor der Deaktivierung geoeffneter Browser-Tab kennt
 * sie aber weiterhin — ohne diese Pruefung koennte er darauf buchen und die
 * Kostenstelle damit zurueck in Journal, DATEV-KOST1 und DMS-Trennseite holen.
 *
 * Nimmt bewusst eine Liste: eine Splittbuchung hat je Zeile eine eigene
 * Kostenstelle und braucht trotzdem nur eine Abfrage.
 */
export async function checkCostCentersUsable(
  db: CostCenterDb,
  ids: Array<string | null | undefined>,
): Promise<CostCenterCheck> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return { ok: true };

  const found = await db.costCenter.findMany({
    where: { id: { in: unique } },
    select: { id: true, isActive: true },
  });
  const byId = new Map(found.map((cc) => [cc.id, cc]));

  for (const id of unique) {
    const cc = byId.get(id);
    if (!cc) return { ok: false, message: 'Kostenstelle nicht gefunden' };
    if (!cc.isActive) return { ok: false, message: 'Kostenstelle ist inaktiv' };
  }

  return { ok: true };
}
