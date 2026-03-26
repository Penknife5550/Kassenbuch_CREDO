import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface Account {
  id: string;
  accountNumber: string;
  name: string;
  description: string | null;
  type: 'KASSE' | 'TRANSIT' | 'GEGENKONTO';
  isActive: boolean;
}

interface School {
  id: string;
  name: string;
  code: string;
  kasseAccountId: string | null;
  anfangsbestandAccountId: string | null;
  kassendifferenzAccountId: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  KASSE: 'Kassenkonto',
  TRANSIT: 'Transitkonto',
  GEGENKONTO: 'Gegenkonto',
};

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState({ accountNumber: '', name: '', description: '', type: 'GEGENKONTO' as Account['type'] });
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [schoolSettingsMsg, setSchoolSettingsMsg] = useState('');

  const load = () => {
    api.get<Account[]>('/accounts').then(setAccounts);
    api.get<School[]>('/schools').then(setSchools);
  };
  useEffect(() => { load(); }, []);

  const filtered = filter ? accounts.filter((a) => a.type === filter) : accounts;
  const gegenkonten = accounts.filter((a) => a.type === 'GEGENKONTO');

  const resetForm = () => {
    setForm({ accountNumber: '', name: '', description: '', type: 'GEGENKONTO' });
    setEditing(null); setShowForm(false); setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const data = { ...form, description: form.description || undefined };
      if (editing) {
        await api.put(`/accounts/${editing.id}`, data);
      } else {
        await api.post('/accounts', data);
      }
      resetForm(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const handleDelete = async (account: Account) => {
    setDeleteError('');
    if (!confirm(`Konto "${account.accountNumber} – ${account.name}" wirklich löschen?`)) return;
    try {
      await api.del(`/accounts/${account.id}`);
      load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    }
  };

  const startEdit = (a: Account) => {
    setEditing(a);
    setForm({ accountNumber: a.accountNumber, name: a.name, description: a.description || '', type: a.type });
    setShowForm(true);
  };

  const handleSchoolAccountChange = async (schoolId: string, field: 'anfangsbestandAccountId' | 'kassendifferenzAccountId', value: string | null) => {
    setSchoolSettingsMsg('');
    try {
      await api.put(`/schools/${schoolId}`, { [field]: value || null });
      setSchoolSettingsMsg('Gespeichert');
      load();
      setTimeout(() => setSchoolSettingsMsg(''), 2000);
    } catch (e) {
      setSchoolSettingsMsg(e instanceof Error ? e.message : 'Fehler');
    }
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Konten verwalten</h1>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Neues Konto</button>
      </div>

      {showForm && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1rem' }}>{editing ? 'Konto bearbeiten' : 'Neues Konto'}</h2>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="accNum">Kontonummer (SKR03)</label>
                <input id="accNum" className="form-control" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required placeholder="z.B. 1000" />
              </div>
              <div className="form-group">
                <label htmlFor="accType">Kontentyp</label>
                <select id="accType" className="form-control" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Account['type'] })}>
                  <option value="KASSE">Kassenkonto</option>
                  <option value="TRANSIT">Transitkonto</option>
                  <option value="GEGENKONTO">Gegenkonto</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="accName">Bezeichnung</label>
              <input id="accName" className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="form-group">
              <label htmlFor="accDesc">Beschreibung (optional)</label>
              <input id="accDesc" className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex-gap">
              <button type="submit" className="btn btn-primary">{editing ? 'Speichern' : 'Anlegen'}</button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>Abbrechen</button>
            </div>
          </form>
        </div>
      )}

      {deleteError && <div className="alert alert-error mb-3" role="alert">{deleteError}</div>}

      <div className="card mb-3">
        <div className="flex-gap mb-2">
          <button className={`btn btn-sm ${!filter ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('')}>Alle</button>
          <button className={`btn btn-sm ${filter === 'KASSE' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('KASSE')}>Kassenkonten</button>
          <button className={`btn btn-sm ${filter === 'TRANSIT' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('TRANSIT')}>Transitkonten</button>
          <button className={`btn btn-sm ${filter === 'GEGENKONTO' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('GEGENKONTO')}>Gegenkonten</button>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Kontonr.</th><th>Bezeichnung</th><th>Typ</th><th>Beschreibung</th><th><span className="sr-only">Aktionen</span></th></tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.accountNumber}</td>
                  <td>{a.name}</td>
                  <td><span className="badge badge-user">{TYPE_LABELS[a.type]}</span></td>
                  <td className="text-light">{a.description || '–'}</td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-sm btn-outline" onClick={() => startEdit(a)}>Bearbeiten</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(a)}>Löschen</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Schuleinstellungen: konfigurierbare Standard-Konten */}
      {schools.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: '0.5rem' }}>Kontoeinstellungen je Schule</h2>
          <p className="text-light" style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            Legen Sie fest, welches Gegenkonto für den Anfangsbestand und für Kassendifferenzen verwendet wird.
          </p>
          {schoolSettingsMsg && (
            <div className={`alert ${schoolSettingsMsg === 'Gespeichert' ? 'alert-success' : 'alert-error'} mb-2`} role="status">
              {schoolSettingsMsg}
            </div>
          )}
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Schule</th>
                  <th>Konto Anfangsbestand</th>
                  <th>Konto Kassendifferenz</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name} ({s.code})</td>
                    <td>
                      <select
                        className="form-control"
                        style={{ minWidth: '200px' }}
                        value={s.anfangsbestandAccountId || ''}
                        onChange={(e) => handleSchoolAccountChange(s.id, 'anfangsbestandAccountId', e.target.value)}
                      >
                        <option value="">– nicht zugewiesen –</option>
                        {gegenkonten.map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-control"
                        style={{ minWidth: '200px' }}
                        value={s.kassendifferenzAccountId || ''}
                        onChange={(e) => handleSchoolAccountChange(s.id, 'kassendifferenzAccountId', e.target.value)}
                      >
                        <option value="">– nicht zugewiesen –</option>
                        {gegenkonten.map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} – {a.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
