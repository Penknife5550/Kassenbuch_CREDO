import { useEffect, useState } from 'react';
import { api } from '../../api/client';

interface ReceiptIssuer {
  name: string;
  address: string;
}

/** Aussteller der Eigenbelege — eine Angabe für die ganze Installation, nicht je Mandant. */
export function ReceiptIssuerCard() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ReceiptIssuer | null>('/receipt-issuer')
      .then((issuer) => {
        if (!issuer) return;
        setName(issuer.name);
        setAddress(issuer.address);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Aussteller konnte nicht geladen werden'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const issuer = await api.put<ReceiptIssuer>('/receipt-issuer', { name, address });
      setName(issuer.name);
      setAddress(issuer.address);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aussteller konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card mb-3">
      <h2 style={{ marginBottom: '0.5rem' }}>Aussteller auf Belegen</h2>
      <p className="text-light" style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
        Steht oben auf jedem Eigenbeleg und gilt für alle Mandanten. Darunter erscheint automatisch der Name des Mandanten.
      </p>
      {saved && <div className="alert alert-success" role="status">Aussteller gespeichert</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="issuerName">Name</label>
            <input id="issuerName" className="form-control" value={name} maxLength={120} required
              onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </div>
          <div className="form-group">
            <label htmlFor="issuerAddress">Anschrift</label>
            <input id="issuerAddress" className="form-control" value={address} maxLength={200} required
              placeholder="Straße Hausnummer, PLZ Ort"
              onChange={(e) => { setAddress(e.target.value); setSaved(false); }} />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Speichere...' : 'Speichern'}
        </button>
      </form>
    </div>
  );
}
