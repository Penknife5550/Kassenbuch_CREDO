# Handoff — Belege & DMS-Export (Stand 2026-05-19)

Dieses Dokument ist ein Übergabezettel für die nächste Claude-Code-Session. Es beschreibt **was schon im Code ist, was noch fehlt, und was der User vor dem nächsten Smoketest manuell ausführen muss.**

> **Master-Spec:** `BELEGE_PLAN.html` im Projekt-Root — bitte einmal im Browser öffnen, das ist die verbindliche Feature-Beschreibung inkl. Datenmodell, QR-Format, Layout, GoBD-Compliance.

---

## Was ist im Repo (Commit `d156d1a` auf `main`)

### Phase 1 — Beleg-Upload pro Buchung ✅
| Bereich | Dateien |
|---|---|
| Schema + Migration | `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260519100000_belegarten_and_receipts/` |
| Belegarten (CRUD + Default-Seed) | `backend/src/services/belegartService.ts`, `backend/src/routes/belegarten.ts` |
| Upload-Service (multer, Magic-Byte, SHA-256) | `backend/src/services/uploadService.ts` |
| Receipts-Routes (Upload/List/Download/Preview/Delete) | `backend/src/routes/receipts.ts` |
| Schools-Erweiterung (`dmsMandantenNummer`, `belegartDefaultId`, `belegartRequired`) | `backend/src/routes/schools.ts` |
| Docker-Volume `kb_${MANDANT}_uploads` | `docker-compose.yml`, `backend/Dockerfile` |
| Upload-Komponente | `frontend/src/components/ReceiptUpload.tsx` |
| Beleg-Popover (Liste + Inline-Vorschau + Add/Remove) | `frontend/src/components/ReceiptPopover.tsx` |
| 📎-Spalte mit Kein-Beleg-Indikator + Toast | `frontend/src/pages/Dashboard.tsx`, `dashboard-columns.tsx` |
| Admin-UI: Belegarten pro Schule | `frontend/src/pages/admin/BelegartenManager.tsx` |
| Admin-UI: neue Felder in Schulen-Maske | `frontend/src/pages/admin/Schools.tsx` |

### Phase 2 — DMS-Feldmapping ✅
| Bereich | Dateien |
|---|---|
| Schema + Migration | `backend/prisma/migrations/20260519110000_dms_field_mappings/` |
| Builder-Service (Sanitize, code-point-sichere Truncate, Hard-Cap 140 Zeichen, LRU-Cache) | `backend/src/services/dmsMappingService.ts` |
| Routes (CRUD + Preview) | `backend/src/routes/dmsMapping.ts` (mounted unter `/api/admin/dms-mapping`) |
| Default-Seed mit 9 DMS-Feldern | `dmsMappingService.ts` Konstante `DEFAULT_DMS_MAPPING` + Aufruf in `schools.ts` POST + `seed.ts` |
| Admin-UI: Mapping-Editor mit Drag-Sort + Live-Längen-Anzeige + QR-Vorschau | `frontend/src/pages/admin/DmsMappingEditor.tsx` |

### Vereinbartes Default-DMS-Mapping (verbindlich vom User)
| Sort | Quelle | BookingField / Wert | DMS-Schlüssel | Format | Max |
|---|---|---|---|---|---|
| 10 | Buchungsfeld | DMS_MANDANTEN_NR | `mandant` | RAW | — |
| 20 | Buchungsfeld | BELEGART_CODE | `dokumentart` | RAW | — |
| 30 | Buchungsfeld | BOOKING_DATE | `datumindokument1` | DATE_DDMMYYYY | — |
| 40 | Buchungsfeld | AMOUNT | `betagsumme` | NUMBER_DE | — |
| 50 | Buchungsfeld | COST_CENTER_CODE | `projektnr1` | RAW | — |
| 60 | **Konstante** | `"1"` (= Fibu im DMS) | `sichtid1` | — | — |
| 70 | Buchungsfeld | DESCRIPTION | `textindokument` | RAW | **60** |
| 80 | Buchungsfeld | ACCOUNT_NUMBER | `Kontonr1` | RAW | — |
| 90 | Buchungsfeld | RECEIPT_NUMBER | `belegnr` | RAW | — |

**Wichtig:** Das Default-Mapping hat ca. 110 Zeichen Struktur-Overhead. In der Praxis kollidiert `textindokument` schnell mit der 140-Zeichen-Grenze des Swiss-QR; der Editor zeigt das live im Mapping-Editor („QR-Vorschau"-Button) und am Builder wird ein Hard-Cap-Error geworfen. Vor produktivem Einsatz ggf. `textindokument` auf maxLength 20 reduzieren oder deaktivieren.

---

## Was der User VOR dem nächsten Smoketest ausführen muss

```powershell
# 1. Migrationen anwenden (DB muss laufen)
cd backend
npx prisma migrate deploy

# 2. Default-Belegarten + Default-DMS-Mapping fuer die 6 bestehenden Schulen
npm run prisma:seed

# 3. Docker neu bauen (fuer das neue 'uploads'-Volume + multer-Dep)
cd ..
docker compose build
docker compose up -d
```

Build-Stand bei Übergabe: **Backend + Frontend kompilieren beide grün** (`npx tsc --noEmit` ist leer).

---

## Phase 3 — Was als nächstes ansteht

Sammel-Export-PDF mit Swiss-QR-Trennseiten. Plan siehe `BELEGE_PLAN.html` §6–§8.

**Konkrete Tasks (noch nicht angelegt):**

1. **Dependencies hinzufügen**: `qrcode` (npm), `pdfkit` ist schon da.
2. **QR-Service**: `backend/src/services/qrService.ts` — baut den 26-Zeilen-SPC-Payload (siehe Plan §6.1) und rendert den QR via `qrcode.toBuffer({ type:'png', width:260, margin:0, errorCorrectionLevel:'M' })`.
3. **Trennseite-Renderer** mit pdfkit: A4-Seite mit Linkspalte (alle aktiven DMS-Mapping-Felder mit `includeOnSeparator=true`) + QR rechts oben. Layout siehe Plan §7.
4. **Beleg-Einbettung in Bulk-PDF**:
   - PDFs der Belege: Seiten 1:1 übernehmen (PDFKit unterstützt das nicht nativ — entweder `pdf-lib` als zweite Lib oder PDFs per `gs`/extern; alternativ pdfkit-`addPage()` mit Bild-Embedding für PDFs).
   - Bilder (JPG/PNG): mit `addPage().image(...)` skaliert auf A4.
   - **Empfehlung:** für PDFs zusätzlich `pdf-lib` als Dep nutzen — das kann PDFs mergen. PDFKit für die Trennseite, pdf-lib für den Merge. Oder direkt komplett `pdf-lib`.
5. **Bulk-Export-Endpoint**: `GET /api/bookings/dms-export` (Admin) mit Streaming-Response.
   - Query-Params: `schoolId[]`, `dateFrom`, `dateTo`, `belegartId[]`, `includeWithoutReceipts=false`
   - Sortierung: `ORDER BY schoolId ASC, bookingDate ASC, receiptNumber ASC` (User-bestätigt)
   - Cover-Seite: Inhaltsverzeichnis, Summen **pro Konto** (User-bestätigt), PDF-SHA-256, Filter-Parameter
   - Pro Beleg: Trennseite + Belegdatei
   - Buchungen ohne Beleg: nur wenn Flag gesetzt
6. **Preview-Endpoint** für Vorschau-Zähler im Admin-Dialog (Anzahl Buchungen / Belege / geschätzte Seiten / MB).
7. **Admin-UI „DMS-Export"**: neuer Menüpunkt unter Admin, Filter-Maske, Vorschau-Zähler, Download-Button.
8. **Audit-Log-Eintrag**: bei jedem Export mit Filter-Parametern + PDF-Hash für Reproduzierbarkeit (GoBD).
9. **Performance-Pfad**: Bei `> 500 Buchungen` async Job + Download per Mail/Link statt direktes Streaming. Erst Stretch-Goal.

**Offene Detailfragen** (vom User noch nicht beantwortet, siehe `BELEGE_PLAN.html` §14):
- Brauchst du `Gegenkonto` als zusätzliches DMS-Feld (z.B. `Kontonr2`)?
- Soll der Datei-Index (z.B. „Beleg 1 von 2") als eigenes DMS-Feld in den QR? Aktuell im Seed nicht enthalten.
- Format für `betagsumme`: NUMBER_DE (42,80) bestätigt — oder lieber NUMBER_DOT (42.80) oder Cent-Integer (4280)?
- Format für `belegnr`: aktuell `"2026-00123"` — DMS-Wunschformat klären.

---

## Bekannte To-Dos / Hinweise

- **Storno-Belege**: Bei Storno-Buchungen sollen die Belege der Original-Buchung referenziert werden (nicht doppelt hochladen). Im Code aktuell **nicht behandelt** — Storno hat heute keine Belege.
- **Split-Buchungen + Belege**: Im Frontend wird der Beleg an die erste Zeile der Split-Gruppe gehängt. Multi-Tenant- + isFinalized-Checks greifen, aber für Bulk-Export muss bei Splits beachtet werden, dass Belege nicht doppelt erscheinen.
- **Backup-Strategie für das Uploads-Volume**: Postgres-Backup deckt das nicht ab. Vor Produktiv-Cutover dokumentieren (rsync, restic, oder Volume-Snapshot).
- **HEIC-Support**: bewusst nicht implementiert (User-Entscheidung, nur Desktop-Nutzung).
- **Virus-Scan**: nicht implementiert. Für später (Phase 3+).

---

## Schnellzugriff im neuen Session-Start

1. Lies `BELEGE_PLAN.html` (Master-Spec)
2. Lies dieses Dokument (`NEXT_SESSION.md`) für den aktuellen Stand
3. Falls die Phase-3-Tasks angegangen werden: `TaskCreate` für jede Phase-3-Unteraufgabe anlegen
4. Vor Schreibarbeit: prüfe, ob `backend/node_modules` und `frontend/node_modules` da sind, sonst `npm install` in beiden Projekten
5. Bei DB-Schema-Änderungen: nach dem Edit immer `npx prisma generate` im `backend/`
