/**
 * Entscheidet, was beim Entfernen eines Kontos passiert.
 *
 * Konten mit Buchungshistorie duerfen nicht verschwinden — Journal, DATEV-Export
 * und IKS-Report verweisen darauf. Sie werden deaktiviert: sie bleiben in der
 * Datenbank, tauchen aber in Buchungsmaske und Auswertungs-Dropdowns nicht mehr
 * auf. Nur Konten ohne jede Referenz werden echt geloescht.
 */
export type AccountRemoval =
  | { kind: 'blocked'; message: string }
  | { kind: 'deactivate'; message: string }
  | { kind: 'delete'; message: string }
  | { kind: 'noop'; message: string };

export interface AccountRemovalInput {
  /** Anzahl Buchungen, die das Konto als Konto oder Gegenkonto referenzieren. */
  bookingCount: number;
  /** Name der Schule, der das Konto als Kassen-/Anfangsbestands-/Kassendifferenzkonto zugewiesen ist. */
  assignedSchoolName?: string | null;
  /** Ist das Konto aktuell aktiv? */
  isActive: boolean;
}

export function resolveAccountRemoval(input: AccountRemovalInput): AccountRemoval {
  if (input.assignedSchoolName) {
    return {
      kind: 'blocked',
      message: `Konto kann nicht entfernt werden — es ist der Schule "${input.assignedSchoolName}" als Kassen-, Anfangsbestands- oder Kassendifferenzkonto zugewiesen. Bitte weisen Sie dort zuerst ein anderes Konto zu.`,
    };
  }

  if (input.bookingCount > 0) {
    if (!input.isActive) {
      // Nichts zu tun. Wichtig fuer den IKS-Audit-Trail: ein wiederholter
      // DELETE-Aufruf (Retry, Skript, n8n) darf keinen Deaktivierungs-Eintrag
      // fuer ein Ereignis schreiben, das nie stattgefunden hat.
      return { kind: 'noop', message: 'Konto ist bereits deaktiviert.' };
    }
    return {
      kind: 'deactivate',
      message: `Konto deaktiviert — ${input.bookingCount} Buchung(en) referenzieren es, daher bleibt es für Journal und Auswertungen erhalten. In der Buchungsmaske erscheint es nicht mehr.`,
    };
  }

  return { kind: 'delete', message: 'Konto gelöscht' };
}
