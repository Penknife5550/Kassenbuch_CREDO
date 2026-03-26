import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Schuldefinitionen ───────────────────────────────────────────────────────
const SCHOOLS = [
  { code: 'BK',  name: 'Berufskolleg',              address: '', kasseNr: '1090' },
  { code: 'GES', name: 'Gesamtschule',              address: '', kasseNr: '1020' },
  { code: 'GSH', name: 'Grundschule Haddenhausen',  address: '', kasseNr: '1030' },
  { code: 'GSM', name: 'Grundschule Minderheide',   address: '', kasseNr: '1040' },
  { code: 'GSS', name: 'Grundschule Stemwede',      address: '', kasseNr: '1050' },
  { code: 'GYM', name: 'Gymnasium',                 address: '', kasseNr: '1060' },
];

// ─── Standard-Konten (SKR03) ─────────────────────────────────────────────────
const ACCOUNTS = [
  // Kassenkonten (je Schule ein eigenes)
  { accountNumber: '1020', name: 'Kasse Gesamtschule',            type: 'KASSE' as const },
  { accountNumber: '1030', name: 'Kasse Grundschule Haddenhausen', type: 'KASSE' as const },
  { accountNumber: '1040', name: 'Kasse Grundschule Minderheide',  type: 'KASSE' as const },
  { accountNumber: '1050', name: 'Kasse Grundschule Stemwede',     type: 'KASSE' as const },
  { accountNumber: '1060', name: 'Kasse Gymnasium',                type: 'KASSE' as const },
  { accountNumber: '1090', name: 'Kasse Berufskolleg',             type: 'KASSE' as const },

  // Transitkonten
  { accountNumber: '1360', name: 'Geldtransit',      type: 'TRANSIT' as const },
  { accountNumber: '1361', name: 'Geldtransit Bank',  type: 'TRANSIT' as const },

  // Gegenkonten (Aufwand / Erlös)
  { accountNumber: '4240', name: 'Gas, Strom, Wasser',              type: 'GEGENKONTO' as const },
  { accountNumber: '4250', name: 'Reinigung',                       type: 'GEGENKONTO' as const },
  { accountNumber: '4260', name: 'Instandhaltung betriebl. Räume',  type: 'GEGENKONTO' as const },
  { accountNumber: '4530', name: 'Laufende Kfz-Betriebskosten',     type: 'GEGENKONTO' as const },
  { accountNumber: '4600', name: 'Werbekosten',                     type: 'GEGENKONTO' as const },
  { accountNumber: '4640', name: 'Repräsentationskosten',           type: 'GEGENKONTO' as const },
  { accountNumber: '4651', name: 'Bewirtungskosten',                type: 'GEGENKONTO' as const },
  { accountNumber: '4710', name: 'Verpackungsmaterial',             type: 'GEGENKONTO' as const },
  { accountNumber: '4901', name: 'Getränke/Lebensmittel',           type: 'GEGENKONTO' as const },
  { accountNumber: '4910', name: 'Porto',                           type: 'GEGENKONTO' as const },
  { accountNumber: '4920', name: 'Telefon',                         type: 'GEGENKONTO' as const },
  { accountNumber: '4930', name: 'Bürobedarf',                      type: 'GEGENKONTO' as const },
  { accountNumber: '4945', name: 'Fortbildungskosten',              type: 'GEGENKONTO' as const },
  { accountNumber: '4980', name: 'Betriebsbedarf',                  type: 'GEGENKONTO' as const },
  { accountNumber: '8200', name: 'Erlöse steuerfrei',               type: 'GEGENKONTO' as const },
  { accountNumber: '8300', name: 'Erlöse 7% USt',                   type: 'GEGENKONTO' as const },
  { accountNumber: '8400', name: 'Erlöse 19% USt',                  type: 'GEGENKONTO' as const },

  // System-Gegenkonten
  { accountNumber: '0800', name: 'Anfangsbestand',    type: 'GEGENKONTO' as const },
  { accountNumber: '2370', name: 'Kassendifferenz',   type: 'GEGENKONTO' as const },
];

// ─── Kostenstellen ───────────────────────────────────────────────────────────
const COST_CENTERS = [
  { code: '10', name: 'Verwaltung' },
  { code: '20', name: 'Schule' },
  { code: '30', name: 'Mensa' },
  { code: '40', name: 'Betreuung' },
  { code: '50', name: 'Veranstaltungen' },
];

// ─── Hauptlogik ──────────────────────────────────────────────────────────────
async function main() {
  console.log('Seeding database...\n');

  // ── 1. Admin-Benutzer ────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('admin1234', 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminHash,
      displayName: 'Administrator',
      role: 'ADMIN',
    },
  });
  console.log(`Admin-Benutzer: ${admin.username}`);

  // ── 2. Konten anlegen ────────────────────────────────────────────────────
  for (const acc of ACCOUNTS) {
    await prisma.account.upsert({
      where: { accountNumber_type: { accountNumber: acc.accountNumber, type: acc.type } },
      update: { name: acc.name },
      create: acc,
    });
  }
  console.log(`${ACCOUNTS.length} Konten angelegt`);

  // System-Konten laden (für Zuweisung an Schulen)
  const anfangsbestandAccount = await prisma.account.findUnique({
    where: { accountNumber_type: { accountNumber: '0800', type: 'GEGENKONTO' } },
  });
  const kassendifferenzAccount = await prisma.account.findUnique({
    where: { accountNumber_type: { accountNumber: '2370', type: 'GEGENKONTO' } },
  });

  // ── 3. Schulen + Benutzer + Belegnummernkreise ───────────────────────────
  const defaultPassword = 'kasse1234';
  const defaultHash = await bcrypt.hash(defaultPassword, 12);

  console.log('');
  console.log('Schulen:');
  console.log('─'.repeat(72));
  console.log(
    'Kürzel'.padEnd(6) + ' | ' +
    'Name'.padEnd(30) + ' | ' +
    'Kassenkonto'.padEnd(12) + ' | ' +
    'Benutzer'
  );
  console.log('─'.repeat(72));

  for (const s of SCHOOLS) {
    // Kassenkonto für diese Schule finden
    const kasseAccount = await prisma.account.findUnique({
      where: { accountNumber_type: { accountNumber: s.kasseNr, type: 'KASSE' } },
    });

    // Schule anlegen
    const school = await prisma.school.upsert({
      where: { code: s.code },
      update: {
        name: s.name,
        kasseAccountId: kasseAccount?.id ?? undefined,
        anfangsbestandAccountId: anfangsbestandAccount?.id ?? undefined,
        kassendifferenzAccountId: kassendifferenzAccount?.id ?? undefined,
      },
      create: {
        name: s.name,
        code: s.code,
        address: s.address || undefined,
        kasseAccountId: kasseAccount?.id,
        anfangsbestandAccountId: anfangsbestandAccount?.id,
        kassendifferenzAccountId: kassendifferenzAccount?.id,
      },
    });

    // Belegnummernkreis
    await prisma.receiptSequence.upsert({
      where: { schoolId: school.id },
      update: {},
      create: { schoolId: school.id, lastNumber: 0 },
    });

    // Kassenbenutzer
    const username = `kasse.${s.code.toLowerCase()}`;
    const displayName = `Kasse ${s.name}`;
    await prisma.user.upsert({
      where: { username },
      update: { schoolId: school.id, displayName },
      create: {
        username,
        passwordHash: defaultHash,
        displayName,
        role: 'USER',
        schoolId: school.id,
      },
    });

    console.log(
      s.code.padEnd(6) + ' | ' +
      s.name.padEnd(30) + ' | ' +
      s.kasseNr.padEnd(12) + ' | ' +
      username
    );
  }

  // ── 4. Kostenstellen ─────────────────────────────────────────────────────
  for (const cc of COST_CENTERS) {
    await prisma.costCenter.upsert({
      where: { code: cc.code },
      update: { name: cc.name },
      create: cc,
    });
  }
  console.log(`\n${COST_CENTERS.length} Kostenstellen angelegt`);

  // ── 5. DATEV-Konfiguration ───────────────────────────────────────────────
  await prisma.datevExportConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      beraterNummer: '10000',
      mandantenNummer: '10001',
      wirtschaftsjahrBeginn: `${new Date().getFullYear()}0101`,
      sachkontenLaenge: 4,
    },
  });
  console.log('DATEV-Konfiguration angelegt');

  // ── Zusammenfassung ──────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('SEEDING ABGESCHLOSSEN');
  console.log('═'.repeat(72));
  console.log('');
  console.log('Login-Daten:');
  console.log('  Admin:       admin / admin1234');
  console.log('');
  console.log('  Kassenbenutzer (alle mit Passwort: kasse1234):');
  for (const s of SCHOOLS) {
    console.log(`    kasse.${s.code.toLowerCase()}`.padEnd(20) + ` → ${s.name} (Konto ${s.kasseNr})`);
  }
  console.log('');
  console.log('  Jeder Schule zugewiesen:');
  console.log('    Anfangsbestandkonto:   0800 Anfangsbestand');
  console.log('    Kassendifferenzkonto:  2370 Kassendifferenz');
  console.log('');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
