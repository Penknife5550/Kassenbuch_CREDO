import { useState, useEffect } from 'react';
import { api } from '../../api/client';

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
  const [error, setError] = useState('');

  const load = () => api.get<School[]>('/schools').then(setSchools);
  useEffect(() => {
    load();
    api.get<Account[]>('/accounts?type=KASSE').then(setKasseAccounts);
  }, []);

  const resetForm = () => {
    setName(''); setCode(''); setAddress(''); setKasseAccountId('');
    setEditing(null); setShowForm(false); setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const data = { name, code, address: address || undefined, kasseAccountId: kasseAccountId || null };
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
    setKasseAccountId(s.kasseAccountId || ''); setShowForm(true);
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Schulen verwalten</h1>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Neue Schule
        </button>
      </div>

      {showForm && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1rem' }}>{editing ? 'Schule bearbeiten' : 'Neue Schule'}</h2>
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
            <div className="flex-gap">
              <button type="submit" className="btn btn-primary">{editing ? 'Speichern' : 'Anlegen'}</button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>Abbrechen</button>
            </div>
          </form>
        </div>
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
                  <td>{s.isActive ? <span className="badge badge-finalized">Aktiv</span> : <span className="badge badge-storno">Inaktiv</span>}</td>
                  <td><button className="btn btn-sm btn-outline" onClick={() => startEdit(s)}>Bearbeiten</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
