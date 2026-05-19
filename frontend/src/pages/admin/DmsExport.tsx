import { useState, useEffect, useMemo } from 'react';
import { api } from '../../api/client';

interface School { id: string; name: string; code: string }
interface Belegart { id: string; schoolId: string; code: string; label: string; isActive: boolean }
interface PreviewResult {
  bookingsCount: number;
  receiptsCount: number;
  estimatedPages: number;
  estimatedMB: number;
}

export function DmsExport() {
  const [schools, setSchools] = useState<School[]>([]);
  const [belegarten, setBelegarten] = useState<Belegart[]>([]);
  const [selectedSchoolIds, setSelectedSchoolIds] = useState<string[]>([]);
  const [selectedBelegartIds, setSelectedBelegartIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [includeWithoutReceipts, setIncludeWithoutReceipts] = useState(false);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.get<School[]>('/schools').then(setSchools).catch(() => undefined);

    const now = new Date();
    const year = now.getFullYear();
    setDateFrom(`${year}-01-01`);
    setDateTo(now.toISOString().slice(0, 10));
  }, []);

  // Belegarten der ausgewählten Schulen laden (vereinigt)
  useEffect(() => {
    if (selectedSchoolIds.length === 0) {
      setBelegarten([]);
      setSelectedBelegartIds([]);
      return;
    }
    Promise.all(
      selectedSchoolIds.map(id =>
        api.get<Belegart[]>(`/belegarten?schoolId=${id}`).catch(() => [] as Belegart[]),
      ),
    ).then(lists => {
      const flat = lists.flat();
      // Dedupliziere per id
      const seen = new Set<string>();
      const dedup = flat.filter(b => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
      setBelegarten(dedup);
    });
  }, [selectedSchoolIds]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const id of selectedSchoolIds) params.append('schoolId', id);
    for (const id of selectedBelegartIds) params.append('belegartId', id);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (includeWithoutReceipts) params.set('includeWithoutReceipts', 'true');
    return params.toString();
  }, [selectedSchoolIds, selectedBelegartIds, dateFrom, dateTo, includeWithoutReceipts]);

  const isFilterValid = dateFrom && dateTo && dateFrom <= dateTo;

  const handlePreview = async () => {
    setError('');
    if (!isFilterValid) return;
    setPreviewLoading(true);
    try {
      const p = await api.get<PreviewResult>(`/bookings/dms-export/preview?${queryString}`);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vorschau fehlgeschlagen');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Live-Vorschau: bei jeder Filter-Änderung 400 ms debounced neu laden.
  useEffect(() => {
    if (!isFilterValid) { setPreview(null); return; }
    const t = setTimeout(() => { void handlePreview(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString, isFilterValid]);

  const handleDownload = async () => {
    setError(''); setSuccess('');
    if (!isFilterValid) {
      setError('Bitte gültigen Zeitraum auswählen.');
      return;
    }
    setDownloadLoading(true);
    try {
      const filename = `dms-export_${dateFrom}_${dateTo}.pdf`;
      await api.download(`/bookings/dms-export?${queryString}`, filename);
      setSuccess('DMS-Export erfolgreich heruntergeladen');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export fehlgeschlagen');
    } finally {
      setDownloadLoading(false);
    }
  };

  const toggle = (list: string[], setList: (l: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  return (
    <div>
      <h1 className="mb-3">DMS-Export</h1>
      <p className="text-muted mb-3" style={{ fontSize: '0.875rem' }}>
        Sammel-PDF mit Swiss-QR-Trennseiten — eine Datei pro Zeitraum, vom DMS automatisch zerlegbar.
      </p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}

      <div className="card mb-3">
        <h2 style={{ marginBottom: '1rem' }}>Filter</h2>

        <div className="grid-2 mb-2">
          <div className="form-group">
            <label htmlFor="dateFrom">Zeitraum von</label>
            <input id="dateFrom" type="date" className="form-control"
              value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="dateTo">bis</label>
            <input id="dateTo" type="date" className="form-control"
              value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>Mandanten (leer = alle)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {schools.map((s) => (
              <label key={s.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.35rem 0.7rem', border: '1px solid #ccc', borderRadius: 4,
                background: selectedSchoolIds.includes(s.id) ? '#FFD500' : '#fff',
                cursor: 'pointer', fontSize: '0.875rem',
              }}>
                <input type="checkbox"
                  checked={selectedSchoolIds.includes(s.id)}
                  onChange={() => toggle(selectedSchoolIds, setSelectedSchoolIds, s.id)} />
                {s.code} {s.name}
              </label>
            ))}
          </div>
        </div>

        {belegarten.length > 0 && (
          <div className="form-group">
            <label>Belegarten (leer = alle)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {belegarten.map((b) => (
                <label key={b.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.35rem 0.7rem', border: '1px solid #ccc', borderRadius: 4,
                  background: selectedBelegartIds.includes(b.id) ? '#FFD500' : '#fff',
                  cursor: 'pointer', fontSize: '0.875rem',
                }}>
                  <input type="checkbox"
                    checked={selectedBelegartIds.includes(b.id)}
                    onChange={() => toggle(selectedBelegartIds, setSelectedBelegartIds, b.id)} />
                  {b.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox"
              checked={includeWithoutReceipts}
              onChange={(e) => setIncludeWithoutReceipts(e.target.checked)} />
            Buchungen ohne Beleg einbeziehen
          </label>
          <p className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
            Standard: aus. Sonst erzeugt das DMS Geistereinträge.
          </p>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>
          Vorschau {previewLoading && <span style={{ fontSize: '0.75rem', color: '#9D9D9C', fontWeight: 'normal' }}>(lädt …)</span>}
        </h2>

        <div className="mb-2" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem',
          padding: '0.75rem', background: '#f7f7f7', borderRadius: 4,
        }}>
          <PreviewBox label="Buchungen" value={preview ? preview.bookingsCount.toString() : '—'} />
          <PreviewBox label="Belege" value={preview ? preview.receiptsCount.toString() : '—'} />
          <PreviewBox label="≈ Seiten" value={preview ? preview.estimatedPages.toString() : '—'} />
          <PreviewBox label="≈ MB" value={preview ? preview.estimatedMB.toFixed(1) : '—'} />
        </div>

        <button className="btn btn-success" onClick={handleDownload}
          disabled={!isFilterValid || downloadLoading || (preview?.bookingsCount ?? 0) === 0}>
          {downloadLoading ? 'Erzeuge PDF…' : 'DMS-Export herunterladen (PDF)'}
        </button>
      </div>
    </div>
  );
}

function PreviewBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#575756' }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: '#9D9D9C', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}
