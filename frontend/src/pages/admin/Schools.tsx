import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { BelegartenManager } from './BelegartenManager';
import { DmsMappingEditor } from './DmsMappingEditor';

interface KasseAccountRef {
  id: string;
  accountNumber: string;
  name: string;
}

interface School {
  id: string;
  name: string;
  code: string;
  address: string | null;
  isActive: boolean;
  kasseAccountId: string | null;
  kasseAccount: KasseAccountRef | null;
  defaultBookingDateMode: 'TODAY' | 'EMPTY';
  dmsMandantenNummer: string | null;
  belegartDefaultId: string | null;
  belegartRequired: boolean;
}

interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
}

export function Schools() {
  const [schools, setSchools] = useState<School[]>([]);
  const [kasseAccounts, setKasseAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<School | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [kasseAccountId, setKasseAccountId] = useState('');
  const [defaultBookingDateMode, setDefaultBookingDateMode] = useState<'TODAY' | 'EMPTY'>('TODAY');
  const [dmsMandantenNummer, setDmsMandantenNummer] = useState('');
  const [belegartRequired, setBelegartRequired] = useState(false);
  const [belegartenFor, setBelegartenFor] = useState<School | null>(null);
  const [dmsMappingFor, setDmsMappingFor] = useState<School | null>(null);
  const [error, setError] = useState('');

  const load = () => api.get<School[]>('/schools').then(setSchools);
  useEffect(() => {
    load();
    api.get<Account[]>('/accounts?type=KASSE').then(setKasseAccounts);
  }, []);

  const resetForm = () => {
    setName(''); setCode(''); setAddress(''); setKasseAccountId('');
    setDefaultBookingDateMode('TODAY');
    setDmsMandantenNummer(''); setBelegartRequired(false);
    setEditing(null); setShowForm(false); setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const data = {
        name, code,
        address: address || undefined,
        kasseAccountId: kasseAccountId || null,
        defaultBookingDateMode,
        dmsMandantenNummer: dmsMandantenNummer.trim() || null,
        belegartRequired,
      };
      if (editing) {
        await api.put(`/schools/${editing.id}`, data);
      } else {
        await api.post('/schools', data);
      }
      resetForm();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const startEdit = (s: School) => {
    setEditing(s); setName(s.name); setCode(s.code); setAddress(s.address || '');
    setKasseAccountId(s.kasseAccountId || '');
    setDefaultBookingDateMode(s.defaultBookingDateMode ?? 'TODAY');
    setDmsMandantenNummer(s.dmsMandantenNummer ?? '');
    setBelegartRequired(s.belegartRequired);
    setShowForm(true);
  };

  const updateDefaultBelegart = async (schoolId: string, belegartId: string | null) => {
    try {
      await api.put(`/schools/${schoolId}`, { belegartDefaultId: belegartId });
      // lokale State aktualisieren
      setSchools(prev => prev.map(s => s.id === schoolId ? { ...s, belegartDefaultId: belegartId } : s));
      setBelegartenFor(prev => prev && prev.id === schoolId ? { ...prev, belegartDefaultId: belegartId } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Default konnte nicht gesetzt werden');
    }
  };

  const handleDelete = async (s: School) => {
    if (!window.confirm(`Mandant "${s.name}" (${s.code}) wirklich löschen?\n\nAlle zugeordneten Benutzer werden ebenfalls gelöscht!`)) return;
    setError('');
    try {
      await api.del(`/schools/${s.id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Löschen');
    }
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Mandanten verwalten</h1>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Neuer Mandant
        </button>
      </div>

      {error && !showForm && <div className="alert alert-error mb-3" role="alert">{error}</div>}

      {showForm && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1rem' }}>{editing ? 'Mandant bearbeiten' : 'Neuer Mandant'}</h2>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="schoolName">Name</label>
                <input id="schoolName" className="form-control" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label htmlFor="schoolCode">Kürzel</label>
                <input id="schoolCode" className="form-control" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="z.B. FES-MI" />
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="schoolAddress">Adresse (optional)</label>
                <input id="schoolAddress" className="form-control" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="kasseAccount">Kassenkonto</label>
                <select id="kasseAccount" className="form-control" value={kasseAccountId} onChange={(e) => setKasseAccountId(e.target.value)}>
                  <option value="">Kein Kassenkonto</option>
                  {kasseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="dateMode">Buchungsdatum-Vorgabe</label>
                <select id="dateMode" className="form-control" value={defaultBookingDateMode}
                  onChange={(e) => setDefaultBookingDateMode(e.target.value as 'TODAY' | 'EMPTY')}>
                  <option value="TODAY">Heutiges Datum vorbelegen</option>
                  <option value="EMPTY">Leer lassen (Benutzer wählt selbst)</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="dmsMnr">DMS-Mandantennummer (optional)</label>
                <input id="dmsMnr" className="form-control" value={dmsMandantenNummer}
                  onChange={(e) => setDmsMandantenNummer(e.target.value)}
                  placeholder="z.B. 40" maxLength={50} />
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={belegartRequired}
                  onChange={(e) => setBelegartRequired(e.target.checked)} />
                Belegart ist beim Buchen Pflichtfeld
              </label>
            </div>
            <div className="flex-gap">
              <button type="submit" className="btn btn-primary">{editing ? 'Speichern' : 'Anlegen'}</button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>Abbrechen</button>
            </div>
          </form>
        </div>
      )}

      {belegartenFor && (
        <BelegartenManager
          schoolId={belegartenFor.id}
          schoolName={belegartenFor.name}
          currentDefaultId={belegartenFor.belegartDefaultId}
          onDefaultChange={(id) => updateDefaultBelegart(belegartenFor.id, id)}
          onClose={() => setBelegartenFor(null)}
        />
      )}

      {dmsMappingFor && (
        <DmsMappingEditor
          schoolId={dmsMappingFor.id}
          schoolName={dmsMappingFor.name}
          onClose={() => setDmsMappingFor(null)}
        />
      )}

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Kürzel</th>
                <th>Name</th>
                <th>Adresse</th>
                <th>Kassenkonto</th>
                <th>DMS-Mnr</th>
                <th>Status</th>
                <th><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.code}</td>
                  <td>{s.name}</td>
                  <td>{s.address || '–'}</td>
                  <td>{s.kasseAccount ? `${s.kasseAccount.accountNumber} – ${s.kasseAccount.name}` : '–'}</td>
                  <td>{s.dmsMandantenNummer || '–'}</td>
                  <td>{s.isActive ? <span className="badge badge-finalized">Aktiv</span> : <span className="badge badge-storno">Inaktiv</span>}</td>
                  <td className="flex-gap">
                    <button className="btn btn-sm btn-outline" onClick={() => startEdit(s)}>Bearbeiten</button>
                    <button className="btn btn-sm btn-outline" onClick={() => setBelegartenFor(s)}>Belegarten</button>
                    <button className="btn btn-sm btn-outline" onClick={() => setDmsMappingFor(s)}>DMS-Mapping</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s)}>Löschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
