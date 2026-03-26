import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
}

interface CostCenter {
  id: string;
  code: string;
  name: string;
}

interface Booking {
  id: string;
  receiptNumber: number;
  bookingDate: string;
  amount: string;
  debitCredit: 'S' | 'H';
  description: string;
  isStorno: boolean;
  isFinalized: boolean;
  splitGroupId: string | null;
  account: { accountNumber: string; name: string };
  counterAccount: { accountNumber: string; name: string };
  costCenter: { code: string; name: string } | null;
  createdBy: { displayName: string };
  stornoOf: { receiptNumber: number } | null;
  stornoBookings?: { id: string }[];
}

interface BookingsResponse {
  bookings: Booking[];
  total: number;
  page: number;
  totalPages: number;
  currentBalance: string;
}

interface School {
  id: string;
  name: string;
  code: string;
  anfangsbestandAccountId: string | null;
  kassendifferenzAccountId: string | null;
}

interface DailyStatus {
  isClosed: boolean;
  expectedBalance: string;
  todayBookingsCount: number;
}

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function DailyStatusCard({ schoolId, isAdmin }: { schoolId: string; isAdmin: boolean }) {
  const [status, setStatus] = useState<DailyStatus | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    const p = isAdmin ? `?schoolId=${schoolId}` : '';
    api.get<DailyStatus>(`/daily-closing/status${p}`)
      .then(setStatus)
      .catch(() => {});
  }, [schoolId, isAdmin]);

  return (
    <div className="card" style={{ flex: '1', minWidth: '200px', padding: '1.25rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div>
          <div className="text-light" style={{ fontSize: '0.75rem', marginBottom: '4px' }}>Tagesabschluss heute</div>
          {status ? (
            <span className={`badge ${status.isClosed ? 'badge-finalized' : 'badge-storno'}`}>
              {status.isClosed ? '\u2713 Abgeschlossen' : '\u25CB Offen'}
            </span>
          ) : (
            <span className="text-light" style={{ fontSize: '0.8rem' }}>...</span>
          )}
        </div>
        <div>
          <div className="text-light" style={{ fontSize: '0.75rem', marginBottom: '2px' }}>Buchungen heute</div>
          <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
            {status ? status.todayBookingsCount : '\u2013'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [data, setData] = useState<BookingsResponse | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [showPdfExport, setShowPdfExport] = useState(false);
  const [showAnfangsbestand, setShowAnfangsbestand] = useState(false);

  // Get the selected school object for configured account IDs
  const selectedSchoolObj = schools.find((s) => s.id === selectedSchool);

  useEffect(() => {
    api.get<School[]>('/schools').then((s) => {
      setSchools(s);
      if (s.length === 1) setSelectedSchool(s[0].id);
      else if (user?.schoolId) setSelectedSchool(user.schoolId);
    });
    api.get<CostCenter[]>('/cost-centers').then(setCostCenters);
  }, [user]);

  useEffect(() => {
    if (!selectedSchool) return;
    const schoolParam = user?.role === 'ADMIN' ? `?schoolId=${selectedSchool}` : '';
    api.get<Account[]>(`/accounts${schoolParam}`).then(setAccounts);
  }, [selectedSchool, user]);

  const loadBookings = useCallback(() => {
    if (!selectedSchool) return;
    const schoolParam = user?.role === 'ADMIN' ? `schoolId=${selectedSchool}&` : '';
    api.get<BookingsResponse>(`/bookings?${schoolParam}page=${page}&limit=50`)
      .then((d) => {
        setData(d);
        if (d.total === 0) {
          setShowAnfangsbestand(true);
        }
      })
      .catch((e) => setError(e.message));
  }, [selectedSchool, page, user]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  const handleStorno = async (id: string) => {
    if (!confirm('Buchung wirklich stornieren? Bei Splittbuchungen werden alle Teilbuchungen storniert.')) return;
    try {
      const schoolParam = user?.role === 'ADMIN' ? `?schoolId=${selectedSchool}` : '';
      await api.post(`/bookings/${id}/storno${schoolParam}`);
      loadBookings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Storno fehlgeschlagen');
    }
  };

  const kasseAccounts = accounts.filter((a) => a.type === 'KASSE');
  const gegenAccounts = accounts.filter((a) => a.type === 'GEGENKONTO' || a.type === 'TRANSIT');

  // Use configured anfangsbestand account from school, fallback to accountNumber '0800'
  const anfangsbestandAccount = selectedSchoolObj?.anfangsbestandAccountId
    ? accounts.find((a) => a.id === selectedSchoolObj.anfangsbestandAccountId)
    : accounts.find((a) => a.accountNumber === '0800');

  // Group bookings by splitGroupId for display
  const groupedBookings = data ? groupBookings(data.bookings) : [];

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Kassenbuch</h1>
        <div className="flex-gap">
          {user?.role === 'ADMIN' && schools.length > 1 && (
            <select
              className="form-control"
              value={selectedSchool}
              onChange={(e) => { setSelectedSchool(e.target.value); setPage(1); }}
              aria-label="Schule auswählen"
            >
              <option value="">Schule wählen...</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {selectedSchool && (
            <>
              <button className="btn btn-outline" onClick={() => setShowPdfExport(true)}>
                Kassenbuch drucken
              </button>
              <button className="btn btn-primary" onClick={() => setShowNewBooking(true)}>
                + Neue Buchung
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* Balance + Status Cards */}
      {data && selectedSchool && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <div className="card" style={{
            flex: '2',
            minWidth: '220px',
            padding: '1.25rem',
            borderLeft: `5px solid ${parseFloat(data.currentBalance) >= 0 ? 'var(--color-success)' : 'var(--color-error)'}`,
          }}>
            <div className="text-light" style={{ fontSize: '0.75rem', marginBottom: '4px' }}>
              Kassenbestand (Soll)
            </div>
            <div style={{
              fontSize: '2.25rem',
              fontWeight: 800,
              color: parseFloat(data.currentBalance) >= 0 ? 'var(--color-success)' : 'var(--color-error)',
              lineHeight: 1.1,
            }}>
              {parseFloat(data.currentBalance).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
            </div>
            <div className="text-light" style={{ fontSize: '0.75rem', marginTop: '6px' }}>
              {data.total} Buchung{data.total !== 1 ? 'en' : ''} gesamt
            </div>
          </div>
          <DailyStatusCard schoolId={selectedSchool} isAdmin={user?.role === 'ADMIN'} />
        </div>
      )}

      {data && data.bookings.length > 0 && (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Beleg-Nr.</th>
                  <th>Datum</th>
                  <th>Buchungstext</th>
                  <th>Konto</th>
                  <th>Gegenkonto</th>
                  <th>KSt</th>
                  <th className="text-right">Einnahme</th>
                  <th className="text-right">Ausgabe</th>
                  <th>Status</th>
                  <th>Gebucht von</th>
                  <th><span className="sr-only">Aktionen</span></th>
                </tr>
              </thead>
              <tbody>
                {groupedBookings.map((group) => {
                  const isSplit = group.length > 1;
                  return group.map((b, idx) => (
                    <tr key={b.id} style={{ opacity: b.isStorno ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 600 }}>
                        {isSplit ? (
                          idx === 0
                            ? <span title="Splittbuchung">{b.receiptNumber} <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', verticalAlign: 'super' }}>Split</span></span>
                            : <span style={{ paddingLeft: '0.75rem', color: 'var(--color-text-light)', fontSize: '0.8rem' }}>\u2514 {b.receiptNumber}</span>
                        ) : b.receiptNumber}
                      </td>
                      <td>{new Date(b.bookingDate).toLocaleDateString('de-DE')}</td>
                      <td>
                        {b.description}
                        {b.stornoOf && (
                          <span className="text-light" style={{ fontSize: '0.75rem' }}>
                            {' '}(Storno von #{b.stornoOf.receiptNumber})
                          </span>
                        )}
                      </td>
                      <td>{b.account.accountNumber}</td>
                      <td>{b.counterAccount.accountNumber}</td>
                      <td>{b.costCenter?.code || '\u2013'}</td>
                      <td className="text-right" style={{ color: 'var(--color-success)' }}>
                        {b.debitCredit === 'S'
                          ? parseFloat(b.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                          : ''}
                      </td>
                      <td className="text-right" style={{ color: 'var(--color-error)' }}>
                        {b.debitCredit === 'H'
                          ? parseFloat(b.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
                          : ''}
                      </td>
                      <td>
                        {b.isStorno && <span className="badge badge-storno">Storno</span>}
                        {b.isFinalized && <span className="badge badge-finalized">Festgeschrieben</span>}
                      </td>
                      <td>{b.createdBy.displayName}</td>
                      <td>
                        {!b.isStorno && !b.isFinalized && idx === 0 && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleStorno(b.id)}
                          >
                            Storno{isSplit ? ' (alle)' : ''}
                          </button>
                        )}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          {data.totalPages > 1 && (
            <div className="flex-between mt-2">
              <button className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Zurück
              </button>
              <span className="text-light" style={{ fontSize: '0.8125rem' }}>
                Seite {data.page} von {data.totalPages}
              </span>
              <button className="btn btn-sm btn-outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
                Weiter
              </button>
            </div>
          )}
        </div>
      )}

      {data && data.bookings.length === 0 && selectedSchool && !showAnfangsbestand && (
        <div className="card text-center" style={{ padding: '3rem' }}>
          <p className="text-light">Noch keine Buchungen vorhanden.</p>
          <button className="btn btn-primary mt-2" onClick={() => setShowNewBooking(true)}>
            Erste Buchung erfassen
          </button>
        </div>
      )}

      {!selectedSchool && (
        <div className="card text-center" style={{ padding: '3rem' }}>
          <p className="text-light">Bitte wählen Sie eine Schule aus.</p>
        </div>
      )}

      {/* Anfangsbestand Modal */}
      {showAnfangsbestand && kasseAccounts.length > 0 && anfangsbestandAccount && (
        <AnfangsbestandModal
          schoolId={selectedSchool}
          isAdmin={user?.role === 'ADMIN'}
          kasseAccount={kasseAccounts[0]}
          anfangsbestandAccount={anfangsbestandAccount}
          onClose={() => setShowAnfangsbestand(false)}
          onCreated={() => {
            setShowAnfangsbestand(false);
            loadBookings();
          }}
        />
      )}

      {/* New Booking Modal */}
      {showNewBooking && (
        <NewBookingModal
          schoolId={selectedSchool}
          isAdmin={user?.role === 'ADMIN'}
          kasseAccounts={kasseAccounts}
          gegenAccounts={gegenAccounts}
          costCenters={costCenters}
          onClose={() => setShowNewBooking(false)}
          onCreated={() => { setShowNewBooking(false); loadBookings(); }}
        />
      )}

      {/* PDF Export Modal */}
      {showPdfExport && (
        <PdfExportModal
          schoolId={selectedSchool}
          isAdmin={user?.role === 'ADMIN'}
          onClose={() => setShowPdfExport(false)}
        />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupBookings(bookings: Booking[]): Booking[][] {
  const groups: Booking[][] = [];
  const splitMap = new Map<string, Booking[]>();

  for (const b of bookings) {
    if (b.splitGroupId) {
      if (!splitMap.has(b.splitGroupId)) {
        const arr: Booking[] = [];
        splitMap.set(b.splitGroupId, arr);
        groups.push(arr);
      }
      splitMap.get(b.splitGroupId)!.push(b);
    } else {
      groups.push([b]);
    }
  }
  return groups;
}

// ─── Anfangsbestand Modal ────────────────────────────────────────────────────

function AnfangsbestandModal({
  schoolId, isAdmin, kasseAccount, anfangsbestandAccount, onClose, onCreated,
}: {
  schoolId: string; isAdmin: boolean; kasseAccount: Account; anfangsbestandAccount: Account;
  onClose: () => void; onCreated: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const schoolParam = isAdmin ? `?schoolId=${schoolId}` : '';
      await api.post(`/bookings${schoolParam}`, {
        amount: parseFloat(amount.replace(',', '.')),
        debitCredit: 'S',
        accountId: kasseAccount.id,
        counterAccountId: anfangsbestandAccount.id,
        description: 'Anfangsbestand',
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Erfassen des Anfangsbestands');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="anfang-title">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <h2 id="anfang-title" style={{ marginBottom: '0.5rem' }}>Anfangsbestand erfassen</h2>
          <p className="text-light" style={{ fontSize: '0.9rem' }}>
            Dies ist die erste Buchung für diese Kasse.<br />
            Bitte geben Sie den aktuellen Kassenbestand ein.
          </p>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="anfangAmount">Anfangsbestand (EUR)</label>
            <input id="anfangAmount" type="text" className="form-control" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus required
              style={{ fontSize: '1.25rem', textAlign: 'right' }} />
            <div className="text-light" style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              Konto: {kasseAccount.accountNumber} {kasseAccount.name} / Gegenkonto: {anfangsbestandAccount.accountNumber} {anfangsbestandAccount.name}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Überspringen</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Wird erfasst...' : 'Anfangsbestand buchen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── New Booking Modal (mit Split-Modus) ─────────────────────────────────────

interface SplitLine {
  counterAccountId: string;
  costCenterId: string;
  description: string;
  amount: string;
  taxKey: string;
}

function emptySplitLine(): SplitLine {
  return { counterAccountId: '', costCenterId: '', description: '', amount: '', taxKey: '' };
}

function NewBookingModal({
  schoolId, isAdmin, kasseAccounts, gegenAccounts, costCenters, onClose, onCreated,
}: {
  schoolId: string; isAdmin: boolean; kasseAccounts: Account[]; gegenAccounts: Account[];
  costCenters: CostCenter[]; onClose: () => void; onCreated: () => void;
}) {
  const [mode, setMode] = useState<'single' | 'split'>('single');

  // Shared fields
  const [amount, setAmount] = useState('');
  const [debitCredit, setDebitCredit] = useState<'S' | 'H'>('S');
  const [accountId, setAccountId] = useState(kasseAccounts[0]?.id || '');
  const [bookingDate, setBookingDate] = useState(getTodayString());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Single mode fields
  const [counterAccountId, setCounterAccountId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [description, setDescription] = useState('');

  // Split mode fields
  const [splitLines, setSplitLines] = useState<SplitLine[]>([emptySplitLine(), emptySplitLine()]);

  const splitSum = splitLines.reduce((s, l) => s + (parseFloat(l.amount.replace(',', '.')) || 0), 0);
  const totalAmount = parseFloat(amount.replace(',', '.')) || 0;
  const splitRemaining = totalAmount - splitSum;

  const updateSplitLine = (idx: number, field: keyof SplitLine, value: string) => {
    setSplitLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addSplitLine = () => setSplitLines((prev) => [...prev, emptySplitLine()]);
  const removeSplitLine = (idx: number) => {
    if (splitLines.length <= 2) return;
    setSplitLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const schoolParam = isAdmin ? `?schoolId=${schoolId}` : '';

      if (mode === 'single') {
        await api.post(`/bookings${schoolParam}`, {
          amount: parseFloat(amount.replace(',', '.')),
          debitCredit,
          accountId,
          counterAccountId,
          costCenterId: costCenterId || undefined,
          description,
          bookingDate,
        });
      } else {
        // Split booking
        if (Math.abs(splitRemaining) > 0.005) {
          setError(`Bitte alle Beträge aufteilen. Noch ${splitRemaining.toFixed(2)} EUR offen.`);
          setLoading(false);
          return;
        }
        await api.post(`/bookings/split${schoolParam}`, {
          totalAmount: parseFloat(amount.replace(',', '.')),
          debitCredit,
          accountId,
          bookingDate,
          lines: splitLines.map((l) => ({
            amount: parseFloat(l.amount.replace(',', '.')),
            counterAccountId: l.counterAccountId,
            costCenterId: l.costCenterId || undefined,
            description: l.description,
            taxKey: l.taxKey || undefined,
          })),
        });
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Buchung fehlgeschlagen');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={mode === 'split' ? { maxWidth: '720px' } : undefined}>
        <h2 id="modal-title">Neue Buchung</h2>

        {/* Mode Toggle */}
        <div className="flex-gap mb-3">
          <button className={`btn btn-sm ${mode === 'single' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('single')}>
            Einfachbuchung
          </button>
          <button className={`btn btn-sm ${mode === 'split' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('split')}>
            Splittbuchung
          </button>
        </div>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Common header fields */}
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="amount">Gesamtbetrag (EUR)</label>
              <input id="amount" type="text" className="form-control" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus required />
            </div>
            <div className="form-group">
              <label htmlFor="debitCredit">Art</label>
              <select id="debitCredit" className="form-control" value={debitCredit}
                onChange={(e) => setDebitCredit(e.target.value as 'S' | 'H')}>
                <option value="S">Einnahme (Soll)</option>
                <option value="H">Ausgabe (Haben)</option>
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="bookingDate">Buchungsdatum</label>
              <input id="bookingDate" type="date" className="form-control" value={bookingDate}
                max={getTodayString()} onChange={(e) => setBookingDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="accountId">Kassenkonto</label>
              <select id="accountId" className="form-control" value={accountId}
                onChange={(e) => setAccountId(e.target.value)} required>
                <option value="">Konto wählen...</option>
                {kasseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ─── Single Mode ─── */}
          {mode === 'single' && (
            <>
              <div className="grid-2">
                <div className="form-group">
                  <label htmlFor="counterAccountId">Gegenkonto</label>
                  <select id="counterAccountId" className="form-control" value={counterAccountId}
                    onChange={(e) => setCounterAccountId(e.target.value)} required>
                    <option value="">Gegenkonto wählen...</option>
                    {gegenAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="costCenter">Kostenstelle (optional)</label>
                  <select id="costCenter" className="form-control" value={costCenterId}
                    onChange={(e) => setCostCenterId(e.target.value)}>
                    <option value="">Keine Kostenstelle</option>
                    {costCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>{cc.code} – {cc.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="description">Buchungstext</label>
                <input id="description" type="text" className="form-control" value={description}
                  onChange={(e) => setDescription(e.target.value)} placeholder="z.B. Büromaterial"
                  maxLength={500} required />
              </div>
            </>
          )}

          {/* ─── Split Mode ─── */}
          {mode === 'split' && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Split-Positionen</span>
                  <button type="button" className="btn btn-sm btn-outline" onClick={addSplitLine}>
                    + Position
                  </button>
                </div>

                {splitLines.map((line, idx) => (
                  <div key={idx} style={{
                    padding: '0.75rem',
                    background: idx % 2 === 0 ? 'var(--color-secondary)' : 'transparent',
                    borderRadius: '6px',
                    marginBottom: '0.5rem',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-light)' }}>
                        Position {idx + 1}
                      </span>
                      {splitLines.length > 2 && (
                        <button type="button" style={{
                          background: 'none', border: 'none', color: 'var(--color-error)',
                          cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                        }} onClick={() => removeSplitLine(idx)}>Entfernen</button>
                      )}
                    </div>
                    <div className="grid-2" style={{ gap: '0.5rem' }}>
                      <div className="form-group" style={{ marginBottom: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem' }}>Betrag (EUR)</label>
                        <input type="text" className="form-control" value={line.amount}
                          onChange={(e) => updateSplitLine(idx, 'amount', e.target.value)}
                          placeholder="0,00" required style={{ padding: '0.35rem 0.5rem' }} />
                      </div>
                      <div className="form-group" style={{ marginBottom: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem' }}>Gegenkonto</label>
                        <select className="form-control" value={line.counterAccountId}
                          onChange={(e) => updateSplitLine(idx, 'counterAccountId', e.target.value)}
                          required style={{ padding: '0.35rem 0.5rem' }}>
                          <option value="">Gegenkonto...</option>
                          {gegenAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem' }}>Kostenstelle</label>
                        <select className="form-control" value={line.costCenterId}
                          onChange={(e) => updateSplitLine(idx, 'costCenterId', e.target.value)}
                          style={{ padding: '0.35rem 0.5rem' }}>
                          <option value="">Keine</option>
                          {costCenters.map((cc) => (
                            <option key={cc.id} value={cc.id}>{cc.code} – {cc.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem' }}>Buchungstext</label>
                        <input type="text" className="form-control" value={line.description}
                          onChange={(e) => updateSplitLine(idx, 'description', e.target.value)}
                          placeholder="Beschreibung" required style={{ padding: '0.35rem 0.5rem' }} maxLength={500} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Split Summary */}
              <div style={{
                background: 'var(--color-secondary)', borderRadius: '8px', padding: '0.75rem 1rem',
                marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem',
              }}>
                <div>
                  <span className="text-light">Aufgeteilt:</span>{' '}
                  <strong style={{ color: Math.abs(splitRemaining) < 0.005 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {splitSum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                  </strong>
                  <span className="text-light"> / {totalAmount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</span>
                </div>
                <div>
                  {Math.abs(splitRemaining) < 0.005 ? (
                    <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{'\u2713'} Vollständig aufgeteilt</span>
                  ) : (
                    <span style={{ color: 'var(--color-error)', fontWeight: 600 }}>
                      Offen: {splitRemaining.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn btn-primary" disabled={loading || (mode === 'split' && Math.abs(splitRemaining) > 0.005)}>
              {loading ? 'Buche...' : mode === 'split' ? 'Splittbuchung buchen' : 'Buchen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── PDF Export Modal ────────────────────────────────────────────────────────

function PdfExportModal({
  schoolId, isAdmin, onClose,
}: {
  schoolId: string; isAdmin: boolean; onClose: () => void;
}) {
  const [mode, setMode] = useState<'range' | 'month'>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setError(''); setLoading(true);
    try {
      const schoolParam = isAdmin ? `schoolId=${schoolId}&` : '';
      let params: string;
      if (mode === 'month') {
        params = `${schoolParam}month=${month}`;
      } else {
        if (!dateFrom || !dateTo) { setError('Bitte Von- und Bis-Datum angeben'); setLoading(false); return; }
        params = `${schoolParam}dateFrom=${dateFrom}&dateTo=${dateTo}`;
      }
      await api.download(`/bookings/pdf?${params}`, `Kassenbuch_${mode === 'month' ? month : dateFrom}.pdf`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF-Export fehlgeschlagen');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="pdf-modal-title">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="pdf-modal-title">Kassenbuch drucken</h2>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="flex-gap mb-3">
          <button className={`btn btn-sm ${mode === 'month' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('month')}>Monat</button>
          <button className={`btn btn-sm ${mode === 'range' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setMode('range')}>Zeitraum</button>
        </div>
        {mode === 'month' && (
          <div className="form-group">
            <label htmlFor="pdfMonth">Monat</label>
            <input id="pdfMonth" type="month" className="form-control" value={month}
              onChange={(e) => setMonth(e.target.value)} />
          </div>
        )}
        {mode === 'range' && (
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="pdfFrom">Von</label>
              <input id="pdfFrom" type="date" className="form-control" value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="pdfTo">Bis</label>
              <input id="pdfTo" type="date" className="form-control" value={dateTo}
                onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={handleExport} disabled={loading}>
            {loading ? 'Wird erstellt...' : 'PDF herunterladen'}
          </button>
        </div>
      </div>
    </div>
  );
}
