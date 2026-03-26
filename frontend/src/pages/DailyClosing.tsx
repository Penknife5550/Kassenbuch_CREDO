import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

interface DailyStatus {
  date: string;
  isClosed: boolean;
  expectedBalance: string;
  todayBookingsCount: number;
}

interface DailyClosingRecord {
  id: string;
  closingDate: string;
  expectedBalance: string;
  actualBalance: string;
  difference: string;
  comment?: string;
  createdAt: string;
  closedBy: { displayName: string };
  correctionBooking?: { receiptNumber: number; amount: string; debitCredit: string; description: string } | null;
}

interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
}

interface School {
  id: string;
  name: string;
  code: string;
  kassendifferenzAccountId: string | null;
}

const DENOMINATION_DEFS = [
  { key: 'n500', label: '500,00 €', centValue: 50000, type: 'note' },
  { key: 'n200', label: '200,00 €', centValue: 20000, type: 'note' },
  { key: 'n100', label: '100,00 €', centValue: 10000, type: 'note' },
  { key: 'n50',  label:  '50,00 €', centValue:  5000, type: 'note' },
  { key: 'n20',  label:  '20,00 €', centValue:  2000, type: 'note' },
  { key: 'n10',  label:  '10,00 €', centValue:  1000, type: 'note' },
  { key: 'n5',   label:   '5,00 €', centValue:   500, type: 'note' },
  { key: 'c200', label:   '2,00 €', centValue:   200, type: 'coin' },
  { key: 'c100', label:   '1,00 €', centValue:   100, type: 'coin' },
  { key: 'c50',  label:   '0,50 €', centValue:    50, type: 'coin' },
  { key: 'c20',  label:   '0,20 €', centValue:    20, type: 'coin' },
  { key: 'c10',  label:   '0,10 €', centValue:    10, type: 'coin' },
  { key: 'c5',   label:   '0,05 €', centValue:     5, type: 'coin' },
  { key: 'c2',   label:   '0,02 €', centValue:     2, type: 'coin' },
  { key: 'c1',   label:   '0,01 €', centValue:     1, type: 'coin' },
] as const;

type DenominationKey = typeof DENOMINATION_DEFS[number]['key'];
type DenominationCounts = Record<DenominationKey, number>;

function emptyDenominations(): DenominationCounts {
  return Object.fromEntries(DENOMINATION_DEFS.map((d) => [d.key, 0])) as DenominationCounts;
}

function calcIstbestandCents(counts: DenominationCounts): number {
  return DENOMINATION_DEFS.reduce((sum, d) => sum + (counts[d.key] ?? 0) * d.centValue, 0);
}

function fmtEur(amount: number | string): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

type WizardStep = 'overview' | 'zaehlung' | 'difference' | 'done';

export function DailyClosing() {
  const { user } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [history, setHistory] = useState<DailyClosingRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');

  const [step, setStep] = useState<WizardStep>('overview');
  const [counts, setCounts] = useState<DenominationCounts>(emptyDenominations());
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingEigenbeleg, setDownloadingEigenbeleg] = useState(false);
  const [lastClosingId, setLastClosingId] = useState<string | null>(null);

  const istbestandCents = calcIstbestandCents(counts);
  const istbestand = istbestandCents / 100;
  const sollbestand = parseFloat(status?.expectedBalance ?? '0');
  const differenceCents = istbestandCents - Math.round(sollbestand * 100);
  const difference = differenceCents / 100;
  const hasDifference = Math.abs(differenceCents) > 0;

  useEffect(() => {
    api.get<School[]>('/schools').then((s) => {
      setSchools(s);
      if (s.length === 1) setSelectedSchool(s[0].id);
      else if (user?.schoolId) setSelectedSchool(user.schoolId);
    });
  }, [user]);

  useEffect(() => {
    if (!selectedSchool) return;
    const p = user?.role === 'ADMIN' ? `?schoolId=${selectedSchool}` : '';
    api.get<Account[]>(`/accounts${p}`).then(setAccounts);
  }, [selectedSchool, user]);

  const loadData = useCallback(() => {
    if (!selectedSchool) return;
    const p = user?.role === 'ADMIN' ? `?schoolId=${selectedSchool}` : '';
    Promise.all([
      api.get<DailyStatus>(`/daily-closing/status${p}`),
      api.get<DailyClosingRecord[]>(`/daily-closing${p}`),
    ])
      .then(([s, h]) => {
        setStatus(s);
        setHistory(h);
        if (s.isClosed) setStep('done');
        else setStep('overview');
      })
      .catch((e) => setError(e.message));
  }, [selectedSchool, user]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectedSchoolObj = schools.find((s) => s.id === selectedSchool);
  const kasseAccount = accounts.find((a) => a.type === 'KASSE');
  // Konfiguriertes Kassendifferenzkonto verwenden, Fallback auf '2370'
  const kassendifferenzAccount = selectedSchoolObj?.kassendifferenzAccountId
    ? accounts.find((a) => a.id === selectedSchoolObj.kassendifferenzAccountId)
    : accounts.find((a) => a.accountNumber === '2370');

  const handleClose = async () => {
    setError('');
    setLoading(true);
    try {
      const schoolParam = user?.role === 'ADMIN' ? `?schoolId=${selectedSchool}` : '';
      const body: Record<string, unknown> = {
        actualBalance: istbestand,
        denominationCounts: counts,
      };
      if (hasDifference) {
        body.comment = comment;
        body.createCorrectionBooking = true;
        body.kasseAccountId = kasseAccount?.id;
        body.kassendifferenzAccountId = kassendifferenzAccount?.id;
      }

      const result = await api.post<{ id: string }>(`/daily-closing${schoolParam}`, body);
      setLastClosingId(result.id);

      if (hasDifference) {
        setDownloadingEigenbeleg(true);
        try {
          const today = new Date().toISOString().split('T')[0];
          await api.download(
            `/daily-closing/eigenbeleg/${result.id}${schoolParam}`,
            `Eigenbeleg_${today}.pdf`
          );
        } catch {
          // Non-critical
        } finally {
          setDownloadingEigenbeleg(false);
        }
      }

      setStep('done');
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tagesabschluss fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  const handleCountChange = (key: DenominationKey, value: string) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setCounts((prev) => ({ ...prev, [key]: n }));
  };

  if (!selectedSchool && user?.role === 'ADMIN' && schools.length > 1) {
    return (
      <div>
        <h1>Tagesabschluss</h1>
        <div className="card text-center" style={{ padding: '3rem' }}>
          <p className="text-light mb-3">Bitte Schule auswählen:</p>
          <select
            className="form-control"
            style={{ maxWidth: '300px', margin: '0 auto' }}
            value={selectedSchool}
            onChange={(e) => setSelectedSchool(e.target.value)}
          >
            <option value="">Schule wählen...</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Tagesabschluss</h1>
        {user?.role === 'ADMIN' && schools.length > 1 && (
          <select
            className="form-control"
            style={{ maxWidth: '200px' }}
            value={selectedSchool}
            onChange={(e) => {
              setSelectedSchool(e.target.value);
              setStep('overview');
              setCounts(emptyDenominations());
              setComment('');
            }}
          >
            <option value="">Schule wählen...</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* Schritt 1: Sollbestand */}
      {step === 'overview' && status && !status.isClosed && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1.5rem' }}>Schritt 1: Sollbestand prüfen</h2>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <div>
              <div className="text-light" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                Sollbestand (laut Buchhaltung)
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                {fmtEur(status.expectedBalance)}
              </div>
            </div>
            <div>
              <div className="text-light" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Buchungen heute</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{status.todayBookingsCount}</div>
            </div>
          </div>
          <button className="btn btn-primary" style={{ fontSize: '1rem' }} onClick={() => setStep('zaehlung')}>
            Weiter zur Zählung →
          </button>
        </div>
      )}

      {/* Schritt 2: Zählprotokoll */}
      {step === 'zaehlung' && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '0.5rem' }}>Schritt 2: Zählprotokoll</h2>
          <p className="text-light" style={{ marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            Bitte zählen Sie den Kasseninhalt und tragen Sie die Anzahl je Stückelung ein.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-primary)', fontSize: '0.875rem' }}>
                📄 SCHEINE
              </div>
              {DENOMINATION_DEFS.filter((d) => d.type === 'note').map((d) => {
                const count = counts[d.key];
                const lineTotal = count * d.centValue / 100;
                return (
                  <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '70px 70px 80px', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>{d.label}</label>
                    <input
                      type="number"
                      min="0"
                      className="form-control"
                      style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}
                      value={count || ''}
                      placeholder="0"
                      onChange={(e) => handleCountChange(d.key, e.target.value)}
                    />
                    <span style={{ textAlign: 'right', fontSize: '0.8rem', color: count > 0 ? 'var(--color-success)' : 'var(--color-text-light)' }}>
                      {count > 0 ? fmtEur(lineTotal) : '–'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-primary)', fontSize: '0.875rem' }}>
                🪙 MÜNZEN
              </div>
              {DENOMINATION_DEFS.filter((d) => d.type === 'coin').map((d) => {
                const count = counts[d.key];
                const lineTotal = count * d.centValue / 100;
                return (
                  <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '70px 70px 80px', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>{d.label}</label>
                    <input
                      type="number"
                      min="0"
                      className="form-control"
                      style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}
                      value={count || ''}
                      placeholder="0"
                      onChange={(e) => handleCountChange(d.key, e.target.value)}
                    />
                    <span style={{ textAlign: 'right', fontSize: '0.8rem', color: count > 0 ? 'var(--color-success)' : 'var(--color-text-light)' }}>
                      {count > 0 ? fmtEur(lineTotal) : '–'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live-Summe */}
          <div style={{ background: 'var(--color-secondary)', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span className="text-light">Sollbestand:</span>
              <strong>{fmtEur(sollbestand)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span className="text-light">Istbestand (gezählt):</span>
              <strong style={{ color: 'var(--color-success)' }}>{fmtEur(istbestand)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)', fontWeight: 700, fontSize: '1.1rem' }}>
              <span>Differenz:</span>
              <span style={{ color: differenceCents === 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                {differenceCents === 0 ? '✓ ' : differenceCents > 0 ? '+' : ''}{fmtEur(difference)}
              </span>
            </div>
          </div>

          <div className="flex-gap">
            <button className="btn btn-outline" onClick={() => setStep('overview')}>← Zurück</button>
            <button className="btn btn-primary" onClick={() => setStep('difference')}>Weiter →</button>
          </div>
        </div>
      )}

      {/* Schritt 3: Abschluss */}
      {step === 'difference' && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1rem' }}>Schritt 3: Abschluss</h2>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Sollbestand', value: fmtEur(sollbestand), color: 'var(--color-primary)' },
              { label: 'Istbestand', value: fmtEur(istbestand), color: 'var(--color-primary)' },
              {
                label: differenceCents === 0 ? 'Differenz' : differenceCents > 0 ? 'Überschuss' : 'Fehlbetrag',
                value: fmtEur(Math.abs(difference)),
                color: differenceCents === 0 ? 'var(--color-success)' : 'var(--color-error)',
              },
            ].map((item) => (
              <div key={item.label} style={{ flex: 1, minWidth: '120px', padding: '0.75rem 1rem', background: 'var(--color-secondary)', borderRadius: '8px' }}>
                <div className="text-light" style={{ fontSize: '0.75rem' }}>{item.label}</div>
                <div style={{ fontWeight: 700, fontSize: '1.25rem', color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>

          {!hasDifference && (
            <div style={{ background: '#E8F5E9', border: '1px solid var(--color-success)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', color: '#2E7D32' }}>
              ✓ Kasse stimmt! Keine Differenz festgestellt.
            </div>
          )}

          {hasDifference && (
            <>
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                ⚠ {differenceCents > 0 ? 'Überschuss' : 'Fehlbetrag'} von {fmtEur(Math.abs(difference))} festgestellt.
                Eine Korrekturbuchung wird automatisch erstellt und ein Eigenbeleg generiert.
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label htmlFor="diffComment">
                  Begründung <span style={{ color: 'var(--color-error)' }}>*</span>
                  <span className="text-light" style={{ fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.8rem' }}>(mind. 10 Zeichen)</span>
                </label>
                <textarea
                  id="diffComment"
                  className="form-control"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="z.B. Wechselgeld fehlt, Kassierfehler beim Rückgeld..."
                />
                <div style={{ fontSize: '0.75rem', color: comment.length < 10 ? 'var(--color-error)' : 'var(--color-success)', marginTop: '4px' }}>
                  {comment.length} / 10 Zeichen Minimum
                </div>
              </div>

              {comment.length >= 10 && (
                <div style={{ background: 'var(--color-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem' }}>Vorgeschlagene Korrekturbuchung:</div>
                  <div style={{ fontSize: '0.875rem' }}>
                    <strong>{differenceCents > 0 ? 'Einnahme (S)' : 'Ausgabe (H)'}</strong>{' '}
                    <span style={{ color: differenceCents > 0 ? 'var(--color-success)' : 'var(--color-error)', fontWeight: 600 }}>
                      {fmtEur(Math.abs(difference))}
                    </span>
                    {' – '}
                    {differenceCents > 0 ? `Kassendifferenz - Überschuss: ${comment}` : `Kassendifferenz - Fehlbetrag: ${comment}`}
                  </div>
                  <div className="text-light" style={{ fontSize: '0.8rem', marginTop: '4px' }}>Gegenkonto: 2370 Kassendifferenz</div>
                </div>
              )}
            </>
          )}

          {error && <div className="alert alert-error mb-2" role="alert">{error}</div>}

          <div className="flex-gap">
            <button className="btn btn-outline" onClick={() => setStep('zaehlung')}>← Zurück</button>
            <button
              className="btn btn-primary"
              onClick={handleClose}
              disabled={loading || (hasDifference && comment.length < 10)}
              style={{ fontSize: '1rem' }}
            >
              {loading
                ? (downloadingEigenbeleg ? 'Eigenbeleg wird erstellt...' : 'Wird durchgeführt...')
                : hasDifference
                  ? 'Korrekturbuchung erstellen & Abschluss durchführen'
                  : 'Tagesabschluss durchführen'}
            </button>
          </div>
        </div>
      )}

      {/* Fertig */}
      {step === 'done' && status?.isClosed && (
        <div className="card mb-3" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
          <h2>Tagesabschluss abgeschlossen</h2>
          <p className="text-light">Der Tagesabschluss für heute wurde erfolgreich durchgeführt.</p>
          {lastClosingId && hasDifference && (
            <button
              className="btn btn-outline mt-2"
              onClick={async () => {
                const schoolParam = user?.role === 'ADMIN' ? `?schoolId=${selectedSchool}` : '';
                const today = new Date().toISOString().split('T')[0];
                await api.download(
                  `/daily-closing/eigenbeleg/${lastClosingId}${schoolParam}`,
                  `Eigenbeleg_${today}.pdf`
                );
              }}
            >
              Eigenbeleg erneut herunterladen
            </button>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '1rem' }}>Abschluss-Historie</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th className="text-right">Soll-Bestand</th>
                  <th className="text-right">Ist-Bestand</th>
                  <th className="text-right">Differenz</th>
                  <th>Kommentar</th>
                  <th>Korrekturbuchung</th>
                  <th>Abgeschlossen von</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => {
                  const diff = parseFloat(c.difference);
                  return (
                    <tr key={c.id}>
                      <td>{new Date(c.closingDate).toLocaleDateString('de-DE')}</td>
                      <td className="text-right">{fmtEur(c.expectedBalance)}</td>
                      <td className="text-right">{fmtEur(c.actualBalance)}</td>
                      <td className="text-right" style={{ fontWeight: diff !== 0 ? 700 : 400, color: diff === 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                        {diff > 0 ? '+' : ''}{fmtEur(diff)}
                      </td>
                      <td style={{ fontSize: '0.8rem', maxWidth: '150px' }}>
                        {c.comment ? <span title={c.comment}>{c.comment.slice(0, 40)}{c.comment.length > 40 ? '…' : ''}</span> : '–'}
                      </td>
                      <td>
                        {c.correctionBooking
                          ? <span style={{ fontSize: '0.8rem' }}>Beleg #{c.correctionBooking.receiptNumber} ({fmtEur(c.correctionBooking.amount)})</span>
                          : '–'}
                      </td>
                      <td>{c.closedBy.displayName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
