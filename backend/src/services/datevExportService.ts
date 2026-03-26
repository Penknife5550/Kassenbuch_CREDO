import { Prisma } from '@prisma/client';
import { prisma } from '../prismaClient';

interface DatevConfig {
  beraterNummer: string;
  mandantenNummer: string;
  wirtschaftsjahrBeginn: string;
  sachkontenLaenge: number;
}

interface BookingForExport {
  amount: Prisma.Decimal;
  debitCredit: string;
  account: { accountNumber: string };
  counterAccount: { accountNumber: string };
  bookingDate: Date;
  receiptNumber: number;
  description: string;
  taxKey: string | null;
  costCenter: { code: string } | null;
  isFinalized: boolean;
  isStorno: boolean;
}

export function formatDatevDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  return d + m;
}

export function formatTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear().toString();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const h = now.getHours().toString().padStart(2, '0');
  const min = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${y}${m}${d}${h}${min}${s}${ms}`;
}

export function escapeField(value: string): string {
  if (value.includes('"') || value.includes(';')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `"${value}"`;
}

export function formatAmount(amount: Prisma.Decimal): string {
  return amount.toFixed(2).replace('.', ',');
}

export async function generateDatevExport(
  schoolId: string,
  dateFrom: Date,
  dateTo: Date,
  config: DatevConfig,
): Promise<string> {
  const bookings = await prisma.booking.findMany({
    where: {
      schoolId,
      bookingDate: { gte: dateFrom, lte: dateTo },
    },
    include: {
      account: { select: { accountNumber: true } },
      counterAccount: { select: { accountNumber: true } },
      costCenter: { select: { code: true } },
    },
    orderBy: { receiptNumber: 'asc' },
  });

  const wjBeginn = config.wirtschaftsjahrBeginn;
  const dfStr = `${dateFrom.getFullYear()}${(dateFrom.getMonth() + 1).toString().padStart(2, '0')}${dateFrom.getDate().toString().padStart(2, '0')}`;
  const dtStr = `${dateTo.getFullYear()}${(dateTo.getMonth() + 1).toString().padStart(2, '0')}${dateTo.getDate().toString().padStart(2, '0')}`;

  const headerFields = [
    '"EXTF"', '510', '21', '"Buchungsstapel"', '7',
    formatTimestamp(), '', '"SV"', '"Kassenbuch"', '""',
    config.beraterNummer, config.mandantenNummer,
    wjBeginn, config.sachkontenLaenge.toString(),
    dfStr, dtStr,
    '"Kasse"', '""', '1', '0', '0', '"EUR"', '""', '""', '""', '""', '""', '""', '""', '""',
  ];
  const headerLine = headerFields.join(';');

  const columnNames = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen',
    'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz',
    'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel',
    'Belegdatum', 'Belegfeld 1', 'Belegfeld 2',
    'Skonto', 'Buchungstext', 'Postensperre',
    'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt',
    'Zinssperre', 'Beleglink',
    'Beleginfo - Art 1', 'Beleginfo - Inhalt 1',
    'Beleginfo - Art 2', 'Beleginfo - Inhalt 2',
    'Beleginfo - Art 3', 'Beleginfo - Inhalt 3',
    'Beleginfo - Art 4', 'Beleginfo - Inhalt 4',
    'Beleginfo - Art 5', 'Beleginfo - Inhalt 5',
    'Beleginfo - Art 6', 'Beleginfo - Inhalt 6',
    'Beleginfo - Art 7', 'Beleginfo - Inhalt 7',
    'Beleginfo - Art 8', 'Beleginfo - Inhalt 8',
    'KOST1 - Kostenstelle', 'KOST2 - Kostenstelle',
    'Kost-Menge', 'EU-Land u. UStID', 'EU-Steuersatz',
    'Abw. Versteuerungsart', 'Sachverhalt L+L', 'Funktionsergänzung L+L',
    'BU 49 Hauptfunktionstyp', 'BU 49 Hauptfunktionsnummer', 'BU 49 Funktionsergänzung',
    'Zusatzinformation - Art 1', 'Zusatzinformation- Inhalt 1',
    'Zusatzinformation - Art 2', 'Zusatzinformation- Inhalt 2',
    'Zusatzinformation - Art 3', 'Zusatzinformation- Inhalt 3',
    'Zusatzinformation - Art 4', 'Zusatzinformation- Inhalt 4',
    'Zusatzinformation - Art 5', 'Zusatzinformation- Inhalt 5',
    'Zusatzinformation - Art 6', 'Zusatzinformation- Inhalt 6',
    'Zusatzinformation - Art 7', 'Zusatzinformation- Inhalt 7',
    'Zusatzinformation - Art 8', 'Zusatzinformation- Inhalt 8',
    'Zusatzinformation - Art 9', 'Zusatzinformation- Inhalt 9',
    'Zusatzinformation - Art 10', 'Zusatzinformation- Inhalt 10',
    'Zusatzinformation - Art 11', 'Zusatzinformation- Inhalt 11',
    'Zusatzinformation - Art 12', 'Zusatzinformation- Inhalt 12',
    'Zusatzinformation - Art 13', 'Zusatzinformation- Inhalt 13',
    'Zusatzinformation - Art 14', 'Zusatzinformation- Inhalt 14',
    'Zusatzinformation - Art 15', 'Zusatzinformation- Inhalt 15',
    'Zusatzinformation - Art 16', 'Zusatzinformation- Inhalt 16',
    'Zusatzinformation - Art 17', 'Zusatzinformation- Inhalt 17',
    'Zusatzinformation - Art 18', 'Zusatzinformation- Inhalt 18',
    'Zusatzinformation - Art 19', 'Zusatzinformation- Inhalt 19',
    'Zusatzinformation - Art 20', 'Zusatzinformation- Inhalt 20',
    'Stück', 'Gewicht', 'Zahlweise', 'Forderungsart',
    'Veranlagungsjahr', 'Zugeordnete Fälligkeit', 'Skontotyp',
    'Auftragsnummer', 'Buchungstyp',
    'Ust-Schlüssel (Anzahlungen)', 'EU-Land (Anzahlungen)',
    'Sachverhalt L+L (Anzahlungen)', 'EU-Steuersatz (Anzahlungen)',
    'Erlöskonto (Anzahlungen)', 'Herkunft-Kz', 'Leerfeld',
    'KOST-Datum', 'Mandatsreferenz', 'Skontosperre',
    'Gesellschaftername', 'Beteiligtennummer', 'Identifikationsnummer',
    'Zeichnernummer', 'Postensperre bis',
    'Bezeichnung SoBil-Sachverhalt', 'Kennzeichen SoBil-Buchung',
    'Festschreibung', 'Leistungsdatum', 'Datum Zuord.Steuerperiode',
  ];

  const lines: string[] = [headerLine, columnNames.join(';')];

  for (const b of bookings as BookingForExport[]) {
    const fields: string[] = [];

    fields.push(formatAmount(b.amount));
    fields.push(escapeField(b.debitCredit));
    fields.push('""'); // WKZ
    fields.push('');    // Kurs
    fields.push('');    // Basis-Umsatz
    fields.push('""'); // WKZ Basis-Umsatz
    fields.push(b.account.accountNumber);
    fields.push(b.counterAccount.accountNumber);
    fields.push(escapeField(b.taxKey || ''));
    fields.push(formatDatevDate(b.bookingDate));
    fields.push(escapeField(b.receiptNumber.toString()));
    fields.push('""'); // Belegfeld 2
    fields.push('');    // Skonto
    fields.push(escapeField(b.description.substring(0, 60)));
    fields.push('');    // Postensperre
    fields.push('""'); // Diverse Adressnummer
    fields.push('');    // Geschäftspartnerbank
    fields.push('');    // Sachverhalt
    fields.push('');    // Zinssperre
    fields.push('""'); // Beleglink

    // Beleginfo 1-8 (16 empty fields)
    for (let i = 0; i < 16; i++) fields.push('""');

    fields.push(escapeField(b.costCenter?.code || '')); // KOST1
    fields.push('""'); // KOST2
    fields.push('');    // Kost-Menge
    fields.push('""'); // EU-Land
    fields.push('');    // EU-Steuersatz
    fields.push('""'); // Abw. Versteuerungsart

    // Sachverhalt L+L to BU 49 (5 empty)
    for (let i = 0; i < 5; i++) fields.push('');

    // Zusatzinformation 1-20 (40 empty fields)
    for (let i = 0; i < 40; i++) fields.push('""');

    fields.push('');    // Stück
    fields.push('');    // Gewicht
    fields.push('');    // Zahlweise
    fields.push('""'); // Forderungsart
    fields.push('');    // Veranlagungsjahr
    fields.push('');    // Zugeordnete Fälligkeit
    fields.push('');    // Skontotyp
    fields.push('""'); // Auftragsnummer
    fields.push('""'); // Buchungstyp
    fields.push('');    // Ust-Schlüssel Anz.
    fields.push('""'); // EU-Land Anz.
    fields.push('');    // Sachverhalt L+L Anz.
    fields.push('');    // EU-Steuersatz Anz.
    fields.push('""'); // Erlöskonto Anz.
    fields.push('""'); // Herkunft-Kz
    fields.push('""'); // Leerfeld
    fields.push('""'); // KOST-Datum
    fields.push('""'); // Mandatsreferenz
    fields.push('');    // Skontosperre
    fields.push('""'); // Gesellschaftername
    fields.push('""'); // Beteiligtennummer
    fields.push('""'); // Identifikationsnummer
    fields.push('""'); // Zeichnernummer
    fields.push('""'); // Postensperre bis
    fields.push('""'); // Bezeichnung SoBil
    fields.push('""'); // Kennzeichen SoBil
    fields.push(b.isFinalized ? '1' : '0'); // Festschreibung
    fields.push('');    // Leistungsdatum
    fields.push('');    // Datum Zuord.Steuerperiode

    lines.push(fields.join(';'));
  }

  return lines.join('\r\n');
}
