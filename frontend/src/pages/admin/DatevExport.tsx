import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface DatevConfig {
  id: string;
  beraterNummer: string;
  mandantenNummer: string;
  wirtschaftsjahrBeginn: string;
  sachkontenLaenge: number;
}

interface School {
  id: string;
  name: string;
  code: string;
}

export function DatevExport() {
  const [config, setConfig] = useState<DatevConfig | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [beraterNr, setBeraterNr] = useState('');
  const [mandantenNr, setMandantenNr] = useState('');
  const [wjBeginn, setWjBeginn] = useState('');
  const [sachkontenLaenge, setSachkontenLaenge] = useState(4);
  const [exportSchool, setExportSchool] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    api.get<DatevConfig | null>('/datev-export/config').then((c) => {
      if (c) {
        setConfig(c);
        setBeraterNr(c.beraterNummer);
        setMandantenNr(c.mandantenNummer);
        setWjBeginn(c.wirtschaftsjahrBeginn);
        setSachkontenLaenge(c.sachkontenLaenge);
      }
    });
    api.get<School[]>('/schools').then(setSchools);

    const now = new Date();
    const year = now.getFullYear();
    setDateFrom(`${year}-01-01`);
    setDateTo(now.toISOString().split('T')[0]);
  }, []);

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post('/datev-export/config', {
        beraterNummer: beraterNr,
        mandantenNummer: mandantenNr,
        wirtschaftsjahrBeginn: wjBeginn,
        sachkontenLaenge,
      });
      setSuccess('DATEV-Konfiguration gespeichert');
      setConfigSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const handleExport = async () => {
    setError(''); setSuccess('');
    try {
      const res = await fetch('/api/datev-export/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ schoolId: exportSchool, dateFrom, dateTo }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Export fehlgeschlagen');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EXTF_Buchungsstapel_${dateFrom}_${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('Export erfolgreich heruntergeladen');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export fehlgeschlagen');
    }
  };

  return (
    <div>
      <h1 className="mb-3">DATEV Export</h1>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}

      <div className="card mb-3">
        <h2 style={{ marginBottom: '1rem' }}>DATEV-Konfiguration</h2>
        <form onSubmit={saveConfig}>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="beraterNr">Berater-Nr.</label>
              <input id="beraterNr" className="form-control" value={beraterNr} onChange={(e) => setBeraterNr(e.target.value)} required />
            </div>
            <div className="form-group">
              <label htmlFor="mandantenNr">Mandanten-Nr.</label>
              <input id="mandantenNr" className="form-control" value={mandantenNr} onChange={(e) => setMandantenNr(e.target.value)} required />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label htmlFor="wjBeginn">Wirtschaftsjahr Beginn (YYYYMMDD)</label>
              <input id="wjBeginn" className="form-control" value={wjBeginn} onChange={(e) => setWjBeginn(e.target.value)} required placeholder="20260101" />
            </div>
            <div className="form-group">
              <label htmlFor="skl">Sachkontenlänge</label>
              <select id="skl" className="form-control" value={sachkontenLaenge} onChange={(e) => setSachkontenLaenge(parseInt(e.target.value))}>
                <option value={4}>4</option>
                <option value={5}>5</option>
                <option value={6}>6</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Konfiguration speichern</button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '1rem' }}>Buchungsstapel exportieren</h2>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="exportSchool">Schule</label>
            <select id="exportSchool" className="form-control" value={exportSchool} onChange={(e) => setExportSchool(e.target.value)}>
              <option value="">Schule wählen...</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="dateFrom">Von</label>
            <input id="dateFrom" type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="dateTo">Bis</label>
            <input id="dateTo" type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
        <button
          className="btn btn-success"
          onClick={handleExport}
          disabled={!exportSchool || !dateFrom || !dateTo || (!config && !configSaved)}
        >
          DATEV-Export herunterladen (CSV)
        </button>
        {!config && !configSaved && (
          <p className="text-error mt-1" style={{ fontSize: '0.8125rem' }}>
            Bitte zuerst die DATEV-Konfiguration speichern.
          </p>
        )}
      </div>
    </div>
  );
}
