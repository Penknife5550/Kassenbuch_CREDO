import type { PrismaClient } from '@prisma/client';

/** Die Tabelle receipt_issuer hat genau eine Zeile mit dieser id. */
export const RECEIPT_ISSUER_ID = 'default';

export const RECEIPT_ISSUER_MISSING =
  'Der Aussteller der Belege ist noch nicht hinterlegt. Bitte an die Verwaltung wenden.';

type ReceiptIssuerDb = Pick<PrismaClient, 'receiptIssuer'>;

/** Aussteller der Belege dieser Installation — null, solange er nicht eingetragen ist. */
export function getReceiptIssuer(db: ReceiptIssuerDb) {
  return db.receiptIssuer.findUnique({
    where: { id: RECEIPT_ISSUER_ID },
    select: { name: true, address: true },
  });
}
