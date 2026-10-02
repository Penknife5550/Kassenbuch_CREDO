import { prisma } from '../prismaClient';

/** Belegart, unter der im Kassenbuch erzeugte Eigenbelege abgelegt werden. */
export const EIGENBELEG_BELEGART = { code: 'EIGENBELEG', label: 'Eigenbeleg', sortOrder: 30 } as const;

export const DEFAULT_BELEGARTEN = [
  { code: 'QUITTUNG',    label: 'Quittung',     sortOrder: 10 },
  { code: 'RECHNUNG',    label: 'Rechnung',     sortOrder: 20 },
  EIGENBELEG_BELEGART,
  { code: 'KASSENBON',   label: 'Kassenbon',    sortOrder: 40 },
  { code: 'KONTOAUSZUG', label: 'Kontoauszug',  sortOrder: 50 },
  { code: 'SONSTIGES',   label: 'Sonstiges',    sortOrder: 60 },
] as const;

export async function createDefaultBelegartenForSchool(schoolId: string): Promise<void> {
  await prisma.belegart.createMany({
    data: DEFAULT_BELEGARTEN.map(b => ({ schoolId, ...b })),
    skipDuplicates: true,
  });
}
