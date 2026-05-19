# Handoff — Belege & DMS-Export (Stand 2026-05-19, Phase 3 fertig)

Dieses Dokument ist ein Übergabezettel für die nächste Claude-Code-Session. Es beschreibt **was im Code ist, was der User manuell ausführen muss, und welche Punkte als Stretch-Goals offen sind.**

> **Master-Spec:** `BELEGE_PLAN.html` im Projekt-Root — verbindliche Feature-Beschreibung inkl. Datenmodell, QR-Format, Layout, GoBD-Compliance.

---

## Was ist im Repo

### Phase 1 — Beleg-Upload pro Buchung ✅ (Commit `d156d1a`)
| Bereich | Dateien |
|---|---|
| Schema + Migration | `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260519100000_belegarten_and_receipts/` |
| Belegarten (CRUD + Default-Seed) | `backend/src/services/belegartService.ts`, `backend/src/routes/belegarten.ts` |
| Upload-Service (multer, Magic-Byte, SHA-256) | `backend/src/services/uploadService.ts` |
| Receipts-Routes (Upload/List/Download/Preview/Delete) | `backend/src/routes/receipts.ts` |
| Schools-Erweiterung | `backend/src/routes/schools.ts` |
| Docker-Volume `kb_${MANDANT}_uploads` | `docker-compose.yml`, `backend/Dockerfile` |
| Upload-Komponente + Popover | `frontend/src/components/ReceiptUpload.tsx`, `ReceiptPopover.tsx` |
| 📎-Spalte mit Kein-Beleg-Indikator | `frontend/src/pages/Dashboard.tsx`, `dashboard-columns.tsx` |
| Admin-UIs | `frontend/src/pages/admin/BelegartenManager.tsx`, `Schools.tsx` |

### Phase 2 — DMS-Feldmapping ✅ (Commit `d156d1a`)
| Bereich | Dateien |
|---|---|
| Schema + Migration | `backend/prisma/migrations/20260519110000_dms_field_mappings/` |
| Builder-Service | `backend/src/services/dmsMappingService.ts` |
| Routes (CRUD + Preview) | `backend/src/routes/dmsMapping.ts` |
| Admin-UI Editor | `frontend/src/pages/admin/DmsMappingEditor.tsx` |

### Phase 3 — Sammel-Export-PDF mit Swiss-QR-Trennseiten ✅ (NEU, noch nicht committed)
| Bereich | Dateien |
|---|---|
| **Kontonr2 im Default-Mapping** (Gegenkonto, Sort 81) | `backend/src/services/dmsMappingService.ts` |
| Idempotenter Backfill beim Backend-Start | `backend/src/services/dmsMappingService.ts` (`backfillKontonr2Mapping`), gewired in `backend/src/index.ts` |
| QR-Service (SPC-Payload + PNG-Rendering) | `backend/src/services/qrService.ts` |
| Export-Service (Cover, Trennseite, Beleg-Merge mit `pdf-lib`) | `backend/src/services/dmsExportService.ts` |
| Routes `/api/bookings/dms-export` + `/preview` | `backend/src/routes/dmsExport.ts` |
| Admin-UI „DMS Export" mit Filter, Preview-Zähler, Download | `frontend/src/pages/admin/DmsExport.tsx` |
| Nav-Eintrag + Route | `frontend/src/components/Layout.tsx`, `frontend/src/App.tsx` |
| Audit-Log-Eintrag `DMS_EXPORT` mit Filter + Hashes | `backend/src/routes/dmsExport.ts` |

#### Neue Backend-Dependencies (bereits installiert)
- `qrcode` (runtime)
- `pdf-lib` (runtime)
- `@types/qrcode` (dev)

#### Default-DMS-Mapping (jetzt 10 Zeilen)
| Sort | Quelle | Wert | DMS-Schlüssel | Format | Max |
|---|---|---|---|---|---|
| 10 | Buchungsfeld | DMS_MANDANTEN_NR | `mandant` | RAW | — |
| 20 | Buchungsfeld | BELEGART_CODE | `dokumentart` | RAW | — |
| 30 | Buchungsfeld | BOOKING_DATE | `datumindokument1` | DATE_DDMMYYYY | — |
| 40 | Buchungsfeld | AMOUNT | `betagsumme` | NUMBER_DE | — |
| 50 | Buchungsfeld | COST_CENTER_CODE | `projektnr1` | RAW | — |
| 60 | Konstante | `"1"` | `sichtid1` | — | — |
| 70 | Buchungsfeld | DESCRIPTION | `textindokument` | RAW | 60 |
| 80 | Buchungsfeld | ACCOUNT_NUMBER | `Kontonr1` | RAW | — |
| **81** | Buchungsfeld | **COUNTER_ACCOUNT_NUMBER** | **`Kontonr2`** | **RAW** | — |
| 90 | Buchungsfeld | RECEIPT_NUMBER | `belegnr` | RAW | — |

#### QR-Header (BELEGE_PLAN.html §6.2 — 24-Zeilen-Variante)
- SPC, 0200, 1, leer (IBAN), K, `<schoolName>`, drei leere Adresszeilen, CH, vier leer, `<amount.toFixed(2)>`, EUR, vier leer, NON, leer (Ref), `<unstructured>`, EPD
- QR-PNG: width 260, margin 0, EC-Level M

#### Bundle-SHA-256 (auf Cover + HTTP-Header)
Deterministisch über `{schoolIds, dateRange, belegartIds, includeWithoutReceipts, sorted bookingIds, sorted receiptShas}` — reproduzierbar.
**Zusätzlich** wird der echte PDF-SHA-256 ins Audit-Log + HTTP-Header `X-DMS-Pdf-Sha256` geschrieben.

---

## Was der User VOR dem nächsten Smoketest ausführen muss

```powershell
# 1. Falls nicht schon: Migrationen + Seed
cd backend
npx prisma migrate deploy
npm run prisma:seed

# 2. Backend-Container neu bauen (für neue Deps qrcode + pdf-lib)
cd ..
docker compose build backend
docker compose up -d
```

Beim ersten Backend-Start läuft `backfillKontonr2Mapping()` einmal und ergänzt `Kontonr2` für alle Schulen, denen es im Mapping noch fehlt (idempotent — bestehende User-Anpassungen bleiben unberührt).

Build-Stand bei Übergabe: **Backend + Frontend kompilieren grün** (`npx tsc --noEmit` ist leer).

---

## Smoketest-Checkliste

1. **Admin → DMS Mapping eines Mandanten öffnen** — `Kontonr2` muss als Sort 81 zwischen `Kontonr1` und `belegnr` stehen.
2. **Admin → DMS Export** (neuer Nav-Eintrag):
   - Zeitraum + (optional) Mandant + Belegart auswählen
   - „Vorschau-Zähler aktualisieren" → zeigt Buchungen / Belege / Seiten / MB
   - „DMS-Export herunterladen" → PDF mit Cover + Trennseite je Beleg + Belegdatei
3. **PDF-Sichtprüfung:**
   - Cover: Filter-Block, Buchungen/Belege-Zahlen, Summen pro Konto (bei Multi-Mandant pro Schule gruppiert), CREDO-Streifen oben, Bundle-SHA-256 im Footer
   - Trennseite: linke Spalte zeigt alle aktiven Mapping-Felder mit `includeOnSeparator=true`, QR rechts oben, Datei/Hochgeladen-Block unten, Footer mit Mandanten-Code + Beleg-Nr.
   - QR scannen → erste Zeile `SPC`, unstructured = `mandant:…|dokumentart:…|…|Kontonr2:…|belegnr:…`
4. **PDF-Belege**: Bei PDF-Belegen werden alle Seiten 1:1 übernommen. Bei JPG/PNG: ein Bild zentriert auf A4.
5. **Buchung ohne Beleg + Checkbox „Ohne Beleg einbeziehen"** → Trennseite mit „— keine Belegdatei —"; ohne Checkbox: Buchung wird übersprungen.
6. **Audit-Log** in DB prüfen: Eintrag `DMS_EXPORT` mit `pdfSha256`, `bundleSha256`, Filter-Parametern.
7. **DmsBuilderError** (z. B. `textindokument` zu lang → QR > 140) → HTTP 422 mit deutscher Fehlermeldung + bookingId.

---

## Bekannte To-Dos / Stretch-Goals

- **Async-Job für > 500 Buchungen**: noch nicht gebaut. Aktuell streamt der Export synchron — bei sehr großen Zeiträumen kann das den Request-Timeout sprengen. Bei realer Last später: Queue + Download-Link via Mail.
- **Storno-Belege**: Storno-Buchungen referenzieren aktuell keine Belege der Original-Buchung. Im Export erscheinen Stornos daher ohne Trennseite (bzw. nur wenn `includeWithoutReceipts=true`).
- **Split-Buchungen + Belege**: Beleg hängt im Frontend an der ersten Split-Zeile. Im Bulk-Export erscheinen die anderen Split-Zeilen damit als „ohne Beleg" — bei `includeWithoutReceipts=true` ggf. Dubletten möglich. Soll im echten Smoketest mit Split-Daten validiert werden.
- **Verschlüsselte PDF-Belege**: `PDFDocument.load(buf, { ignoreEncryption: true })` lässt verschlüsselte PDFs durch; bei kritischen Fehlern wird eine Fehlerseite eingebettet. Hard-Fail-Variante (Export abbrechen) ist denkbar.
- **HEIC-Support**: bewusst nicht implementiert.
- **Virus-Scan**: nicht implementiert.
- **Backup-Strategie für Uploads-Volume**: Postgres-Backup deckt das nicht ab. Vor Produktiv-Cutover dokumentieren (rsync, restic, Volume-Snapshot).
- **Cover-Pagination**: Bei sehr vielen Konten könnte das Cover auf eine zweite Seite überlaufen. Aktuell wird ein zweites leeres Cover-Sheet erzeugt, aber der weitere Text fließt nicht automatisch dorthin. Bei Bedarf einbauen.

---

## Schnellzugriff im neuen Session-Start

1. Lies `BELEGE_PLAN.html` (Master-Spec)
2. Lies dieses Dokument
3. Vor Schreibarbeit: `backend/node_modules` und `frontend/node_modules` da? sonst `npm install`
4. Bei DB-Schema-Änderungen: nach dem Edit `npx prisma generate` im `backend/`
5. Bei `dmsMappingService.ts` Änderungen am `DEFAULT_DMS_MAPPING`: Backfill-Funktion analog `backfillKontonr2Mapping` ergänzen oder bewusst auf Neu-Seed setzen.
