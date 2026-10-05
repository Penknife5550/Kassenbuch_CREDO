import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import { MIN_BOOKING_DATE, parseAmountCents } from '../utils/bookingInput';
import { ReceiptUpload } from './ReceiptUpload';

export interface EigenbelegAccount {
  id: string;
  accountNumber: string;
  name: string;
  defaultCostCenterId: string | null;
}

export interface EigenbelegCostCenter {
  id: string;
  code: string;
  name: string;
}

export interface EigenbelegResult {
  booking: { id: string; receiptNumber: number; amount: string; debitCredit: 'S' | 'H' };
  /** belegartId: die Belegart „Eigenbeleg" des Mandanten — auch Anlagen bekommen sie */
  receipt: { id: string; belegartId: string | null; originalName: string; sizeBytes: number };
  payeeSigns: boolean;
  /** Meldung, falls eine Anlage nach dem Buchen nicht hochgeladen werden konnte */
  attachmentError?: string;
}

interface Props {
  schoolId: string;
  isAdmin: boolean;
  kasseAccounts: EigenbelegAccount[];
  gegenAccounts: EigenbelegAccount[];
  costCenters: EigenbelegCostCenter[];
  dateMode: 'TODAY' | 'EMPTY';
  onCancel: () => void;
  /**
   * true, solange die Buchung unterwegs ist. Die Maske darf dann nicht
   * geschlossen werden: die Bestätigung ginge verloren und das Journal bliebe alt.
   */
  onBookingChange: (booking: boolean) => void;
  onBooked: (result: EigenbelegResult) => void;
}

interface PositionRow {
  label: string;
  unitPrice: string;
  quantity: string;
}

interface Reason {
  label: string;
  /** Ohne Erläuterung sagt dieser Grund zu wenig */
  noteRequired: boolean;
}

/** Gründe, warum es keinen Fremdbeleg gibt — so stehen sie auf dem Beleg. */
const REASONS: Record<'S' | 'H', Reason[]> = {
  S: [
    { label: 'Sammel-Einnahme, keine Einzelquittungen ausgestellt', noteRequired: false },
    { label: 'Bareinnahme ohne Fremdbeleg', noteRequired: false },
    { label: 'Sonstiges', noteRequired: true },
  ],
  H: [
    { label: 'Kein Beleg erhältlich', noteRequired: true },
    { label: 'Beleg verloren', noteRequired: true },
    { label: 'Sonstiges', noteRequired: true },
  ],
};

/** Grenzen wie im Backend (EIGENBELEG_LIMITS) */
const MAX_POSITIONS = 30;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_SUGGESTION = 80;

function emptyRow(): PositionRow {
  return { label: '', unitPrice: '', quantity: '1' };
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/** Einzelpreis in ganze Cent ("1,50", "1.250,00") — null, wenn das kein Betrag unter 100.000 € ist. */
function parseCents(text: string): number | null {
  const cents = parseAmountCents(text);
  return cents !== null && cents < 10_000_000 ? cents : null;
}

function parseQuantity(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const quantity = parseInt(text, 10);
  return quantity >= 1 ? quantity : null;
}

function rowAmountCents(row: PositionRow): number | null {
  const unitPrice = parseCents(row.unitPrice);
  const quantity = parseQuantity(row.quantity);
  return unitPrice !== null && quantity !== null ? unitPrice * quantity : null;
}

function isBlank(row: PositionRow): boolean {
  return row.label.trim() === '' && row.unitPrice.trim() === '';
}

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

/**
 * Kam keine Antwort des Kassenbuchs an, ist offen, ob der Server schon gebucht
 * hat — ein zweiter Klick ergäbe dann einen doppelten Beleg. fetch wirft dafür
 * TypeError; 502 bis 504 antwortet der Proxy vor dem Kassenbuch.
 */
function outcomeUnknown(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ApiError && e.status >= 502 && e.status <= 504);
}

/** Vorschlag für den Buchungstext aus den Bezeichnungen — gilt, bis jemand selbst tippt. */
function suggestDescription(labels: string[]): string {
  let text = '';
  for (const label of labels) {
    const next = text ? `${text}, ${label}` : label;
    if (next.length > MAX_DESCRIPTION_SUGGESTION) {
      return text ? `${text} u. a.` : label.slice(0, MAX_DESCRIPTION_SUGGESTION);
    }
    text = next;
  }
  return text;
}

/**
 * Enter in einem Eingabefeld bucht nicht. Ein Eigenbeleg lässt sich nicht
 * zurücknehmen — gebucht wird nur über die Schaltfläche.
 */
function keepEnterFromBooking(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
}

export function EigenbelegForm({
  schoolId, isAdmin, kasseAccounts, gegenAccounts, costCenters, dateMode, onCancel, onBookingChange, onBooked,
}: Props) {
  const [debitCredit, setDebitCredit] = useState<'S' | 'H'>('S');
  const [bookingDate, setBookingDate] = useState(dateMode === 'TODAY' ? getTodayString() : '');
  const [counterparty, setCounterparty] = useState('');
  const [payeeSigns, setPayeeSigns] = useState(true);
  const [rows, setRows] = useState<PositionRow[]>([emptyRow()]);
  const [reasonIndex, setReasonIndex] = useState(0);
  const [reasonNote, setReasonNote] = useState('');
  // '' = noch nichts gewählt: dann gilt das erste Kassenkonto (siehe accountId unten)
  const [chosenAccountId, setChosenAccountId] = useState('');
  const [counterAccountId, setCounterAccountId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  // null = der Vorschlag aus den Positionen gilt
  const [ownDescription, setOwnDescription] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [issuerMissing, setIssuerMissing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'book' | 'preview' | null>(null);

  const schoolParam = isAdmin ? `?schoolId=${schoolId}` : '';
  // Abgeleitet statt als Startwert gesetzt: die Konten können erst nach dem
  // Öffnen der Maske eintreffen, das Feld bliebe sonst leer.
  const accountId = chosenAccountId || kasseAccounts[0]?.id || '';
  const reasons = REASONS[debitCredit];
  const reason = reasons[reasonIndex];
  const filledRows = rows.filter((row) => !isBlank(row));
  const totalCents = filledRows.reduce((sum, row) => sum + (rowAmountCents(row) ?? 0), 0);
  const description = ownDescription ?? suggestDescription(
    filledRows.map((row) => row.label.trim()).filter(Boolean),
  );

  useEffect(() => {
    let cancelled = false;
    api.get<{ name: string } | null>('/receipt-issuer')
      .then((issuer) => { if (!cancelled) setIssuerMissing(issuer === null); })
      .catch(() => { /* der Server meldet einen fehlenden Aussteller beim Buchen ohnehin */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Trifft die Vorschau erst ein, wenn die Maske schon zu ist, nimmt sie niemand mehr entgegen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const changeKind = (kind: 'S' | 'H') => {
    setDebitCredit(kind);
    setReasonIndex(0);
    setReasonNote('');
  };

  const changeCounterAccount = (id: string) => {
    setCounterAccountId(id);
    const account = gegenAccounts.find((a) => a.id === id);
    setCostCenterId(account?.defaultCostCenterId ?? '');
  };

  const updateRow = (index: number, field: keyof PositionRow, value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [emptyRow()]));
  };

  /** Prüft die Eingaben und baut die Anfrage. Setzt die Fehlermeldung und liefert null, wenn etwas fehlt. */
  const buildPayload = () => {
    if (filledRows.length === 0) {
      setError('Bitte mindestens eine Position mit Betrag erfassen.');
      return null;
    }
    // Über alle Zeilen zählen, damit die Meldung die Zeile nennt, die auf dem Bildschirm steht.
    for (const [i, row] of rows.entries()) {
      if (isBlank(row)) continue;
      const name = row.label.trim() || `Position ${i + 1}`;
      if (row.label.trim() === '') {
        setError(`Position ${i + 1}: Bitte eine Bezeichnung eintragen.`);
        return null;
      }
      const unitPrice = parseCents(row.unitPrice);
      if (unitPrice === null || unitPrice === 0) {
        setError(`„${name}“: Bitte einen Einzelpreis größer 0 mit höchstens zwei Nachkommastellen eintragen.`);
        return null;
      }
      if (parseQuantity(row.quantity) === null) {
        setError(`„${name}“: Die Anzahl muss eine ganze Zahl von 1 bis 9999 sein.`);
        return null;
      }
    }
    const note = reason.noteRequired ? reasonNote.trim() : '';
    if (reason.noteRequired && note === '') {
      setError('Bitte kurz erläutern, warum es keinen Beleg gibt.');
      return null;
    }

    setError('');
    return {
      debitCredit,
      bookingDate,
      accountId,
      counterAccountId,
      costCenterId: costCenterId || undefined,
      description: description.trim(),
      counterparty: counterparty.trim(),
      reason: note ? `${reason.label}: ${note}` : reason.label,
      payeeSigns: debitCredit === 'H' && payeeSigns,
      positions: filledRows.map((row) => ({
        label: row.label.trim(),
        unitPrice: parseCents(row.unitPrice)! / 100,
        quantity: parseQuantity(row.quantity)!,
      })),
    };
  };

  const handlePreview = async (form: HTMLFormElement | null) => {
    if (form && !form.reportValidity()) return;
    const payload = buildPayload();
    if (!payload) return;
    setBusy('preview');
    try {
      const url = await api.blobUrl(`/eigenbelege/preview${schoolParam}`, payload);
      if (mounted.current) setPreviewUrl(url);
      else URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Vorschau konnte nicht erzeugt werden.');
    } finally {
      setBusy(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    setBusy('book');
    onBookingChange(true);
    try {
      const created = await api.post<EigenbelegResult>(`/eigenbelege${schoolParam}`, payload);

      // Die Buchung steht. Scheitert jetzt noch die Anlage, darf das nicht wie
      // ein Fehlschlag der Buchung aussehen — sie lässt sich nachreichen.
      let attachmentError: string | undefined;
      if (attachments.length > 0) {
        try {
          const { belegartId } = created.receipt;
          await api.upload(`/receipts/booking/${created.booking.id}`, attachments, belegartId ? { belegartId } : {});
        } catch (uploadErr) {
          attachmentError = uploadErr instanceof Error ? uploadErr.message : 'Upload fehlgeschlagen';
        }
      }

      onBooked({ ...created, attachmentError });
    } catch (e) {
      setError(outcomeUnknown(e)
        ? 'Keine Antwort vom Server. Bitte die Seite neu laden und im Kassenbuch nachsehen, ob die Buchung angelegt wurde – erst dann noch einmal buchen.'
        : e instanceof Error ? e.message : 'Der Eigenbeleg konnte nicht gebucht werden.');
      setBusy(null);
      onBookingChange(false);
    }
  };

  return (
    <>
      {issuerMissing && (
        <div className="alert alert-warning" role="alert">
          Der Aussteller der Belege ist noch nicht hinterlegt. {isAdmin
            ? 'Bitte unter „Mandant“ bei „Aussteller auf Belegen“ eintragen.'
            : 'Bitte an die Verwaltung wenden.'}
        </div>
      )}
      <form onSubmit={handleSubmit} onKeyDown={keepEnterFromBooking}>
        <div className="eb-group" style={{ marginTop: 0 }}>Angaben auf dem Beleg</div>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="ebKind">Art</label>
            <select id="ebKind" className="form-control" value={debitCredit}
              onChange={(e) => changeKind(e.target.value as 'S' | 'H')}>
              <option value="S">Einnahme (Soll)</option>
              <option value="H">Ausgabe (Haben)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="ebDate">Belegdatum</label>
            <input id="ebDate" type="date" className="form-control" value={bookingDate}
              min={MIN_BOOKING_DATE} max={getTodayString()} onChange={(e) => setBookingDate(e.target.value)} required />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="ebCounterparty">{debitCredit === 'S' ? 'Eingenommen von' : 'Ausgezahlt an'}</label>
          <input id="ebCounterparty" type="text" className="form-control" value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)} maxLength={200} required autoFocus
            placeholder={debitCredit === 'S'
              ? 'z. B. Schülerinnen und Schülern der 3b'
              : 'Name – bei einer Auslage auch, wo gekauft wurde'} />
          {debitCredit === 'H' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500, color: 'var(--color-text)' }}>
              <input type="checkbox" checked={payeeSigns} onChange={(e) => setPayeeSigns(e.target.checked)} />
              Empfänger bestätigt den Erhalt mit Unterschrift auf dem Ausdruck
            </label>
          )}
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label id="ebPositionsLabel">Positionen</label>
        </div>
        <div className="eb-positions" role="group" aria-labelledby="ebPositionsLabel">
          <div className="eb-row eb-row-head">
            <span>Bezeichnung</span>
            <span className="text-right">Einzelpreis</span>
            <span className="text-right">Anzahl</span>
            <span className="text-right">Betrag</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const amount = rowAmountCents(row);
            return (
              <div className="eb-row" key={index}>
                <input type="text" className="form-control" value={row.label} maxLength={MAX_LABEL_LENGTH}
                  onChange={(e) => updateRow(index, 'label', e.target.value)}
                  placeholder="z. B. Heft" aria-label={`Bezeichnung Position ${index + 1}`} />
                <input type="text" inputMode="decimal" className="form-control text-right" value={row.unitPrice}
                  onChange={(e) => updateRow(index, 'unitPrice', e.target.value)}
                  placeholder="0,00" aria-label={`Einzelpreis Position ${index + 1}`} />
                <input type="text" inputMode="numeric" className="form-control text-right" value={row.quantity}
                  onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                  aria-label={`Anzahl Position ${index + 1}`} />
                <span className="eb-amount">{amount !== null ? formatEuro(amount) : '–'}</span>
                <button type="button" className="eb-remove" onClick={() => removeRow(index)}
                  aria-label={`Position ${index + 1} entfernen`}>×</button>
              </div>
            );
          })}
          <div className="eb-foot">
            <button type="button" className="btn btn-sm btn-outline" disabled={rows.length >= MAX_POSITIONS}
              onClick={() => setRows((prev) => [...prev, emptyRow()])}>
              + Position
            </button>
            <span className="eb-sum">Summe<strong>{formatEuro(totalCents)}</strong></span>
          </div>
        </div>

        {/* Die Erläuterung erscheint nur, wo der Grund allein zu wenig sagt */}
        <div className={reason.noteRequired ? 'grid-2' : undefined}>
          <div className="form-group">
            <label htmlFor="ebReason">Warum gibt es keinen Fremdbeleg?</label>
            <select id="ebReason" className="form-control" value={reasonIndex}
              onChange={(e) => setReasonIndex(Number(e.target.value))}>
              {reasons.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
            </select>
          </div>
          {reason.noteRequired && (
            <div className="form-group">
              <label htmlFor="ebReasonNote">Erläuterung</label>
              <input id="ebReasonNote" type="text" className="form-control" value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)} maxLength={200} required
                placeholder={debitCredit === 'H' ? 'z. B. Marktstand stellt keine Quittung aus' : ''} />
            </div>
          )}
        </div>

        <div className="form-group">
          <label id="ebAttachmentsLabel">Anlage (optional)</label>
          <ReceiptUpload compact addLabel="+ Datei hinzufügen" files={attachments} onChange={setAttachments} />
          <span className="text-light" style={{ fontSize: '0.75rem' }}>
            Zum Beispiel eine Strichliste oder Namensliste. Wird nach dem Buchen hochgeladen.
          </span>
        </div>

        <div className="eb-group">Buchung</div>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="ebAccount">Kassenkonto</label>
            <select id="ebAccount" className="form-control" value={accountId}
              onChange={(e) => setChosenAccountId(e.target.value)} required>
              <option value="">Konto wählen...</option>
              {kasseAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="ebCounterAccount">Gegenkonto</label>
            <select id="ebCounterAccount" className="form-control" value={counterAccountId}
              onChange={(e) => changeCounterAccount(e.target.value)} required>
              <option value="">Gegenkonto wählen...</option>
              {gegenAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="ebCostCenter">Kostenstelle (optional)</label>
            <select id="ebCostCenter" className="form-control" value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}>
              <option value="">Keine Kostenstelle</option>
              {costCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>{cc.code} – {cc.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="ebDescription">Buchungstext</label>
            <input id="ebDescription" type="text" className="form-control" value={description}
              onChange={(e) => setOwnDescription(e.target.value)} maxLength={500} required
              placeholder="Vorschlag aus den Positionen" autoComplete="off" />
          </div>
        </div>

        {/* Direkt über den Knöpfen: oben in der scrollenden Maske sähe man die Meldung auf
            Laptop-Bildschirmen nicht — auch nicht „Keine Antwort vom Server … erst dann noch einmal buchen“ */}
        {error && <div className="alert alert-error" role="alert" style={{ marginTop: '1rem' }}>{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-outline" disabled={busy === 'book'} onClick={onCancel}>Abbrechen</button>
          <button type="button" className="btn btn-outline" disabled={busy !== null || issuerMissing}
            onClick={(e) => handlePreview(e.currentTarget.form)}>
            {busy === 'preview' ? 'Erzeuge...' : 'Vorschau'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy !== null || issuerMissing}>
            {busy === 'book' ? 'Buche...' : 'Buchen und Beleg erzeugen'}
          </button>
        </div>
      </form>

      {previewUrl && (
        <div className="modal-overlay" onClick={() => setPreviewUrl(null)} style={{ zIndex: 1100 }}
          role="dialog" aria-modal="true" aria-label="Vorschau des Eigenbelegs">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', width: '900px' }}>
            <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Vorschau – noch nicht gebucht</h3>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setPreviewUrl(null)}>Schließen</button>
            </div>
            <iframe src={previewUrl} title="Vorschau des Eigenbelegs"
              style={{ width: '100%', height: '75vh', border: 'none' }} />
          </div>
        </div>
      )}
    </>
  );
}
