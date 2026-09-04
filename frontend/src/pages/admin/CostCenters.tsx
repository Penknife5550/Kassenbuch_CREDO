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
  const [listError, setListError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = () => {
    setListError('');
    api.get<CostCenter[]>(`/cost-centers${showInactive ? '?includeInactive=true' : ''}`)
      .then(setCostCenters)
      .catch((e) => setListError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'));
  };
  useEffect(() => { load(); }, [showInactive]);

  const resetForm = () => {
    setForm({ code: '', name: '', description: '' });
    setEditing(null); setShowForm(false); setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setActionMsg('');
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

  const handleDelete = async (cc: CostCenter) => {
    setListError(''); setActionMsg('');
    if (!confirm(`Kostenstelle "${cc.code} – ${cc.name}" wirklich entfernen? Kostenstellen mit Buchungen werden deaktiviert statt gelöscht — sie bleiben für Journal, DATEV und DMS erhalten.`)) return;
    try {
      const res = await api.del<{ message: string; deactivated: boolean }>(`/cost-centers/${cc.id}`);
      setActionMsg(res.message);
      load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Entfernen fehlgeschlagen');
    }
  };

  const handleReactivate = async (cc: CostCenter) => {
    setListError(''); setActionMsg('');
    try {
      await api.post(`/cost-centers/${cc.id}/reactivate`);
      setActionMsg(`Kostenstelle ${cc.code} – ${cc.name} wurde wieder aktiviert.`);
      load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Aktivieren fehlgeschlagen');
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

      {listError && <div className="alert alert-error mb-3" role="alert">{listError}</div>}
      {actionMsg && <div className="alert alert-success mb-3" role="status">{actionMsg}</div>}

      <div className="card">
        <div className="flex-gap mb-2">
          <label className="flex-gap" style={{ marginLeft: 'auto', alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Deaktivierte Kostenstellen anzeigen
          </label>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Kürzel</th><th>Bezeichnung</th><th>Beschreibung</th><th><span className="sr-only">Aktionen</span></th></tr>
            </thead>
            <tbody>
              {costCenters.map((cc) => (
                <tr key={cc.id} style={cc.isActive ? undefined : { opacity: 0.6 }}>
                  <td style={{ fontWeight: 600 }}>{cc.code}</td>
                  <td>
                    {cc.name}
                    {!cc.isActive && <span className="badge badge-user" style={{ marginLeft: '0.5rem' }}>Deaktiviert</span>}
                  </td>
                  <td className="text-light">{cc.description || '–'}</td>
                  <td>
                    <div className="flex-gap">
                      <button className="btn btn-sm btn-outline" onClick={() => startEdit(cc)}>Bearbeiten</button>
                      {cc.isActive ? (
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(cc)}>Entfernen</button>
                      ) : (
                        <button className="btn btn-sm btn-outline" onClick={() => handleReactivate(cc)}>Aktivieren</button>
                      )}
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
