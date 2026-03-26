import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface SchoolStatus {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  currentBalance: string;
  lastBooking: { date: string; createdAt: string; user: string } | null;
  lastDailyClosing: { date: string } | null;
  isClosedToday: boolean;
}

export function KassenStatus() {
  const [data, setData] = useState<SchoolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = () => {
    setLoading(true);
    setError('');
    api.get<SchoolStatus[]>('/admin/kassenstatus')
      .then((d) => { setData(d); setLastRefresh(new Date()); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Kassenstatus Übersicht</h1>
        <button className="btn btn-outline" onClick={load} disabled={loading}>
          {loading ? 'Lädt...' : '⟳ Aktualisieren'}
        </button>
      </div>
      <p className="text-light" style={{ fontSize: '0.75rem', marginBottom: '1.5rem' }}>
        Stand: {lastRefresh.toLocaleTimeString('de-DE')}
      </p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {!loading && data.length === 0 && !error && (
        <div className="card text-center" style={{ padding: '3rem' }}>
          <p className="text-light">Keine aktiven Schulen gefunden.</p>
        </div>
      )}

      {data.length > 0 && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: 1, minWidth: '160px', padding: '1rem', textAlign: 'center' }}>
              <div className="text-light" style={{ fontSize: '0.75rem' }}>Schulen gesamt</div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{data.length}</div>
            </div>
            <div className="card" style={{ flex: 1, minWidth: '160px', padding: '1rem', textAlign: 'center' }}>
              <div className="text-light" style={{ fontSize: '0.75rem' }}>Heute abgeschlossen</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-success)' }}>
                {data.filter((s) => s.isClosedToday).length}
              </div>
            </div>
            <div className="card" style={{ flex: 1, minWidth: '160px', padding: '1rem', textAlign: 'center' }}>
              <div className="text-light" style={{ fontSize: '0.75rem' }}>Noch offen</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: data.filter((s) => !s.isClosedToday).length > 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                {data.filter((s) => !s.isClosedToday).length}
              </div>
            </div>
            <div className="card" style={{ flex: 2, minWidth: '200px', padding: '1rem', textAlign: 'center' }}>
              <div className="text-light" style={{ fontSize: '0.75rem' }}>Gesamtbestand aller Kassen</div>
              <div style={{
                fontSize: '1.75rem',
                fontWeight: 800,
                color: data.reduce((s, d) => s + parseFloat(d.currentBalance), 0) >= 0 ? 'var(--color-success)' : 'var(--color-error)',
              }}>
                {data.reduce((s, d) => s + parseFloat(d.currentBalance), 0)
                  .toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
              </div>
            </div>
          </div>

          {/* Tabelle */}
          <div className="card">
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Schule</th>
                    <th className="text-right">Kassenbestand</th>
                    <th>Letzte Buchung</th>
                    <th>Letzter Abschluss</th>
                    <th>Status heute</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((s) => {
                    const balance = parseFloat(s.currentBalance);
                    return (
                      <tr key={s.schoolId}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{s.schoolName}</div>
                          <div className="text-light" style={{ fontSize: '0.75rem' }}>{s.schoolCode}</div>
                        </td>
                        <td className="text-right">
                          <span style={{
                            fontWeight: 700,
                            fontSize: '1.1rem',
                            color: balance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                          }}>
                            {balance.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
                          </span>
                        </td>
                        <td>
                          {s.lastBooking ? (
                            <>
                              <div>{new Date(s.lastBooking.date).toLocaleDateString('de-DE')}</div>
                              <div className="text-light" style={{ fontSize: '0.75rem' }}>{s.lastBooking.user}</div>
                            </>
                          ) : <span className="text-light">–</span>}
                        </td>
                        <td>
                          {s.lastDailyClosing
                            ? new Date(s.lastDailyClosing.date).toLocaleDateString('de-DE')
                            : <span className="text-light">Noch kein Abschluss</span>}
                        </td>
                        <td>
                          <span className={`badge ${s.isClosedToday ? 'badge-finalized' : 'badge-storno'}`}>
                            {s.isClosedToday ? '✓ Abgeschlossen' : '○ Offen'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
