import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ReceiptUpload } from './ReceiptUpload';

export interface ReceiptDto {
  id: string;
  bookingId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  belegart?: { id: string; code: string; label: string } | null;
}

export interface BelegartDto {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface Props {
  bookingId: string;
  /** Falls Buchung festgeschrieben — User kann nicht hochladen/löschen */
  isFinalized: boolean;
  /** Ist der aktuelle User Admin? (Admin darf trotz Finalized) */
  isAdmin: boolean;
  /** Belegarten der Schule der Buchung (für nachträglichen Upload) */
  belegarten: BelegartDto[];
  defaultBelegartId?: string | null;
  belegartRequired?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  return '📎';
}

export function ReceiptPopover({
  bookingId, isFinalized, isAdmin, belegarten, defaultBelegartId, belegartRequired, onClose, onChanged,
}: Props) {
  const [receipts, setReceipts] = useState<ReceiptDto[] | null>(null);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [previewMime, setPreviewMime] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [addBelegartId, setAddBelegartId] = useState<string>(defaultBelegartId ?? '');
  const [uploading, setUploading] = useState(false);

  const canMutate = !isFinalized || isAdmin;

  useEffect(() => {
    api.get<ReceiptDto[]>(`/receipts/booking/${bookingId}`)
      .then(setReceipts)
      .catch(e => setError(e instanceof Error ? e.message : 'Fehler beim Laden'));
  }, [bookingId]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const openPreview = async (r: ReceiptDto) => {
    try {
      const url = await api.blobUrl(`/receipts/${r.id}/preview`);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      setPreviewName(r.originalName);
      setPreviewMime(r.mimeType);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vorschau fehlgeschlagen');
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewName('');
    setPreviewMime('');
  };

  const download = (r: ReceiptDto) =>
    api.download(`/receipts/${r.id}/download`, r.originalName).catch(e => setError(e.message));

  const remove = async (r: ReceiptDto) => {
    if (!confirm(`Beleg "${r.originalName}" wirklich löschen?`)) return;
    try {
      await api.del(`/receipts/${r.id}`);
      setReceipts(prev => (prev ?? []).filter(x => x.id !== r.id));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    }
  };

  const handleAdd = async () => {
    if (addFiles.length === 0) return;
    if (belegartRequired && !addBelegartId) {
      setError('Belegart ist erforderlich.');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const extra: Record<string, string> = {};
      if (addBelegartId) extra.belegartId = addBelegartId;
      const created = await api.upload<ReceiptDto[]>(`/receipts/booking/${bookingId}`, addFiles, extra);
      setReceipts(prev => [...(prev ?? []), ...created]);
      setAddFiles([]);
      setShowAdd(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="receipt-pop-title">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <h2 id="receipt-pop-title" style={{ marginBottom: '0.5rem' }}>Belege</h2>
        {isFinalized && !isAdmin && (
          <div className="alert alert-warning" role="status" style={{ marginBottom: '0.75rem' }}>
            Buchung ist festgeschrieben — Belege können nur noch angesehen werden.
          </div>
        )}
        {error && <div className="alert alert-error" role="alert">{error}</div>}

        {receipts === null && <p className="text-light">Lade...</p>}

        {receipts && receipts.length === 0 && !showAdd && (
          <div className="text-center" style={{ padding: '1rem 0' }}>
            <p className="text-light" style={{ marginBottom: '0.75rem' }}>Keine Belege vorhanden.</p>
            {canMutate && (
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                + Beleg hochladen
              </button>
            )}
          </div>
        )}

        {receipts && receipts.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {receipts.map((r) => (
              <li key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.6rem 0.75rem', background: 'var(--color-secondary)',
                borderRadius: '6px', marginBottom: '0.4rem',
              }}>
                <span style={{ fontSize: '1.2rem' }}>{fileIcon(r.mimeType)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.originalName}
                  </div>
                  <div className="text-light" style={{ fontSize: '0.75rem' }}>
                    {formatBytes(r.sizeBytes)}
                    {r.belegart && <> · {r.belegart.label}</>}
                    {' · '}{new Date(r.uploadedAt).toLocaleString('de-DE')}
                  </div>
                </div>
                <button className="btn btn-sm btn-outline" onClick={() => openPreview(r)}>Vorschau</button>
                <button className="btn btn-sm btn-outline" onClick={() => download(r)}>Download</button>
                {canMutate && (
                  <button className="btn btn-sm btn-danger" onClick={() => remove(r)} aria-label="Löschen">
                    Löschen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {receipts && receipts.length > 0 && !showAdd && canMutate && (
          <div style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-sm btn-outline" onClick={() => setShowAdd(true)}>
              + Beleg hinzufügen
            </button>
          </div>
        )}

        {showAdd && canMutate && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px' }}>
            <div className="form-group">
              <label htmlFor="addBelegart">Belegart{belegartRequired ? ' *' : ' (optional)'}</label>
              <select id="addBelegart" className="form-control" value={addBelegartId}
                onChange={(e) => setAddBelegartId(e.target.value)}>
                <option value="">— bitte wählen —</option>
                {belegarten.filter(b => b.isActive).map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
            <ReceiptUpload files={addFiles} onChange={setAddFiles} />
            <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
              <button className="btn btn-outline" onClick={() => { setShowAdd(false); setAddFiles([]); }}>
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={handleAdd}
                disabled={uploading || addFiles.length === 0}>
                {uploading ? 'Lade hoch...' : 'Hochladen'}
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-outline" onClick={onClose}>Schließen</button>
        </div>
      </div>

      {previewUrl && (
        <div className="modal-overlay" onClick={closePreview} style={{ zIndex: 1100 }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', width: '900px' }}>
            <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>{previewName}</h3>
              <button className="btn btn-sm btn-outline" onClick={closePreview}>Schließen</button>
            </div>
            {previewMime.startsWith('image/') ? (
              <img src={previewUrl} alt={previewName}
                style={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' }} />
            ) : (
              <iframe src={previewUrl} title={previewName}
                style={{ width: '100%', height: '75vh', border: 'none' }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
