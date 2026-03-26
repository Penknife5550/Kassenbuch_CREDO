import { useState, useEffect } from 'react';
import { api } from '../../api/client';

interface CostCenter {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export function CostCenters() {
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [error, setError] = useState('');

  const load = () => api.get<CostCenter[]>('/cost-centers').then(setCostCenters);
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ code: '', name: '', description: '' });
    setEditing(null); setShowForm(false); setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const data = { ...form, description: form.description || undefined };
      if (editing) {
        await api.put(`/cost-centers/${editing.id}`, data);
      } else {
        await api.post('/cost-centers', data);
      }
      resetForm(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const startEdit = (cc: CostCenter) => {
    setEditing(cc);
    setForm({ code: cc.code, name: cc.name, description: cc.description || '' });
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex-between mb-3">
        <h1>Kostenstellen verwalten</h1>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>+ Neue Kostenstelle</button>
      </div>

      {showForm && (
        <div className="card mb-3">
          <h2 style={{ marginBottom: '1rem' }}>{editing ? 'Kostenstelle bearbeiten' : 'Neue Kostenstelle'}</h2>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="ccCode">Kürzel</label>
                <input id="ccCode" className="form-control" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="z.B. 10" />
              </div>
              <div className="form-group">
                <label htmlFor="ccName">Bezeichnung</label>
                <input id="ccName" className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="ccDesc">Beschreibung (optional)</label>
              <input id="ccDesc" className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
              <tr><th>Kürzel</th><th>Bezeichnung</th><th>Beschreibung</th><th><span className="sr-only">Aktionen</span></th></tr>
            </thead>
            <tbody>
              {costCenters.map((cc) => (
                <tr key={cc.id}>
                  <td style={{ fontWeight: 600 }}>{cc.code}</td>
                  <td>{cc.name}</td>
                  <td className="text-light">{cc.description || '–'}</td>
                  <td><button className="btn btn-sm btn-outline" onClick={() => startEdit(cc)}>Bearbeiten</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
