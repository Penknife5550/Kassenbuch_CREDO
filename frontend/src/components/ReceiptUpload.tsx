import { useRef, useState, DragEvent, ChangeEvent } from 'react';

export interface ReceiptUploadProps {
  /** Maximale Anzahl Dateien (Default 10) */
  maxFiles?: number;
  /** Maximalgröße je Datei in MB (Default 10) */
  maxSizeMb?: number;
  /** Aktuell ausgewählte Dateien (Controlled) */
  files: File[];
  onChange: (files: File[]) => void;
  /** Visuelles Hinweistext-Overlay */
  hint?: string;
  /** Wenn true: Komponente kompakter, ohne große Drop-Zone (für Popover) */
  compact?: boolean;
}

const ACCEPT = 'application/pdf,image/jpeg,image/png';
const ACCEPTED_EXT = ['pdf', 'jpg', 'jpeg', 'png'];

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

export function ReceiptUpload({
  maxFiles = 10,
  maxSizeMb = 10,
  files,
  onChange,
  hint,
  compact = false,
}: ReceiptUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState('');
  const maxBytes = maxSizeMb * 1024 * 1024;

  const addFiles = (incoming: FileList | File[]) => {
    setLocalError('');
    const list = Array.from(incoming);
    const accepted: File[] = [];
    for (const f of list) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ACCEPTED_EXT.includes(ext)) {
        setLocalError(`"${f.name}" ist kein erlaubter Dateityp (nur PDF, JPG, PNG).`);
        continue;
      }
      if (f.size > maxBytes) {
        setLocalError(`"${f.name}" ist größer als ${maxSizeMb} MB.`);
        continue;
      }
      // Duplikat-Schutz nach Name + Größe
      if (files.some(x => x.name === f.name && x.size === f.size)) continue;
      accepted.push(f);
    }
    const next = [...files, ...accepted].slice(0, maxFiles);
    if (files.length + accepted.length > maxFiles) {
      setLocalError(`Maximal ${maxFiles} Dateien pro Upload.`);
    }
    onChange(next);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const remove = (idx: number) => onChange(files.filter((_, i) => i !== idx));

  if (compact) {
    return (
      <div>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => inputRef.current?.click()}
        >
          + Beleg hinzufügen
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={handleSelect}
        />
        {localError && (
          <div className="alert alert-error" role="alert" style={{ marginTop: '0.5rem' }}>
            {localError}
          </div>
        )}
        {files.length > 0 && <FileList files={files} onRemove={remove} />}
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: '8px',
          padding: '1rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--color-secondary)' : 'transparent',
          transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>📎</div>
        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
          Beleg(e) hierher ziehen oder klicken zum Auswählen
        </div>
        <div className="text-light" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
          {hint ?? `PDF, JPG, PNG · max. ${maxSizeMb} MB je Datei · bis zu ${maxFiles} Dateien`}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={handleSelect}
        />
      </div>
      {localError && (
        <div className="alert alert-error" role="alert" style={{ marginTop: '0.5rem' }}>
          {localError}
        </div>
      )}
      {files.length > 0 && <FileList files={files} onRemove={remove} />}
    </div>
  );
}

function FileList({ files, onRemove }: { files: File[]; onRemove: (idx: number) => void }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
      {files.map((f, i) => (
        <li key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.4rem 0.6rem',
          background: 'var(--color-secondary)',
          borderRadius: '4px',
          marginBottom: '0.25rem',
          fontSize: '0.85rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>{fileIcon(f.type)}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.name}
          </span>
          <span className="text-light" style={{ fontSize: '0.75rem' }}>{formatBytes(f.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            style={{
              background: 'none', border: 'none', color: 'var(--color-error)',
              cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.25rem',
            }}
            aria-label={`${f.name} entfernen`}
          >×</button>
        </li>
      ))}
    </ul>
  );
}
