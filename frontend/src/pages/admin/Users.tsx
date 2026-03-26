import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface School { id: string; name: string; code: string; }
interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  schoolId: string | null;
  isActive: boolean;
  school: School | null;
}

export function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'USER' as 'ADMIN' | 'USER', schoolId: '' as string | null });
  const [error, setError] = useState('');

  const load = () => {
    api.get<User[]>('/users').then(setUsers);
    api.get<School[]>('/schools').then(setSchools);
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ username: '', password: '', displayName: '', role: 'USER', schoolId: '' });
    setEditing(null); setShowForm(false); setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        const data: Record<string, unknown> = {
          displayName: form.displayName,
          role: form.role,
          schoolId: form.schoolId || null,
        };
        if (form.password) data.password = form.password;
        await api.put(`/users/${editing.id}`, data);
      } else {
        await api.post('/users', {
          username: form.username,
          password: form.password,
          displayName: form.displayName,
          role: form.role,
          schoolId: form.schoolId || null,
        });
      }
      resetForm(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const startEdit = (u: User) => {
    setEditing(u);
    setForm({ username: u.username, password: '', displayName: u.displayName, role: u.role, schoolId: u.schoolId || '' });
    setShowForm(true);
  };

  const toggleActive = async (u: User) => {
    await api.put(`/users/${u.id}`, { isActive: !u.isActive });
    load();
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Benutzer verwalten</h1>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Neuer Benutzer</button>
      </div>

      {showForm && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1rem' }}>{editing ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}</h2>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="uUsername">Benutzername</label>
                <input id="uUsername" className="form-control" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={!!editing} />
              </div>
              <div className="form-group">
                <label htmlFor="uPassword">{editing ? 'Neues Passwort (leer = unverändert)' : 'Passwort'}</label>
                <input id="uPassword" type="password" className="form-control" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} minLength={8} />
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="uDisplayName">Anzeigename</label>
                <input id="uDisplayName" className="form-control" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
              </div>
              <div className="form-group">
                <label htmlFor="uRole">Rolle</label>
                <select id="uRole" className="form-control" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'USER' })}>
                  <option value="USER">Benutzer</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </div>
            </div>
            {form.role === 'USER' && (
              <div className="form-group">
                <label htmlFor="uSchool">Schule</label>
                <select id="uSchool" className="form-control" value={form.schoolId || ''} onChange={(e) => setForm({ ...form, schoolId: e.target.value })} required>
                  <option value="">Schule wählen...</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
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
              <tr><th>Benutzername</th><th>Anzeigename</th><th>Rolle</th><th>Schule</th><th>Status</th><th><span className="sr-only">Aktionen</span></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td><span className={`badge ${u.role === 'ADMIN' ? 'badge-admin' : 'badge-user'}`}>{u.role}</span></td>
                  <td>{u.school?.name || '–'}</td>
                  <td>{u.isActive ? <span className="badge badge-finalized">Aktiv</span> : <span className="badge badge-storno">Inaktiv</span>}</td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-sm btn-outline" onClick={() => startEdit(u)}>Bearbeiten</button>
                      <button className="btn btn-sm" style={{ background: u.isActive ? '#FEE' : '#EFE', color: u.isActive ? 'var(--color-error)' : 'var(--color-success)' }} onClick={() => toggleActive(u)}>
                        {u.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    </div>
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
