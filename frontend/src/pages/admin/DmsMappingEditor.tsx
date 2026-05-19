import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../api/client';

type FieldSource = 'BOOKING_FIELD' | 'CONSTANT';
type BookingField =
  | 'BOOKING_DATE' | 'RECEIPT_NUMBER' | 'AMOUNT' | 'DEBIT_CREDIT'
  | 'ACCOUNT_NUMBER' | 'ACCOUNT_NAME' | 'COUNTER_ACCOUNT_NUMBER' | 'COUNTER_ACCOUNT_NAME'
  | 'COST_CENTER_CODE' | 'COST_CENTER_NAME' | 'DESCRIPTION' | 'TAX_KEY'
  | 'BELEGART_CODE' | 'BELEGART_LABEL' | 'SCHOOL_NAME' | 'SCHOOL_CODE'
  | 'DMS_MANDANTEN_NR' | 'DATEV_MANDANTEN_NR' | 'CREATED_BY' | 'FILE_INDEX';
type FieldFormat =
  | 'RAW' | 'DATE_DDMMYYYY' | 'DATE_ISO' | 'DATE_YYYYMMDD'
  | 'NUMBER_DE' | 'NUMBER_DE_CURRENCY' | 'NUMBER_DOT' | 'UPPER' | 'LOWER';

interface MappingRow {
  id: string;          // client-only id für React-Key + dnd-kit
  source: FieldSource;
  bookingField: BookingField | null;
  constantValue: string | null;
  dmsKey: string;
  format: FieldFormat | null;
  maxLength: number | null;
  sortOrder: number;
  isActive: boolean;
  includeOnSeparator: boolean;
}

const BOOKING_FIELDS: { value: BookingField; label: string }[] = [
  { value: 'BOOKING_DATE',          label: 'Buchungsdatum' },
  { value: 'RECEIPT_NUMBER',        label: 'Belegnummer' },
  { value: 'AMOUNT',                label: 'Betrag' },
  { value: 'DEBIT_CREDIT',          label: 'Soll/Haben (S/H)' },
  { value: 'ACCOUNT_NUMBER',        label: 'Konto-Nr' },
  { value: 'ACCOUNT_NAME',          label: 'Konto-Name' },
  { value: 'COUNTER_ACCOUNT_NUMBER',label: 'Gegenkonto-Nr' },
  { value: 'COUNTER_ACCOUNT_NAME',  label: 'Gegenkonto-Name' },
  { value: 'COST_CENTER_CODE',      label: 'Kostenstelle-Code' },
  { value: 'COST_CENTER_NAME',      label: 'Kostenstelle-Name' },
  { value: 'DESCRIPTION',           label: 'Buchungstext' },
  { value: 'TAX_KEY',               label: 'Steuerschlüssel' },
  { value: 'BELEGART_CODE',         label: 'Belegart-Code' },
  { value: 'BELEGART_LABEL',        label: 'Belegart-Label' },
  { value: 'SCHOOL_NAME',           label: 'Schul-Name' },
  { value: 'SCHOOL_CODE',           label: 'Schul-Kürzel' },
  { value: 'DMS_MANDANTEN_NR',      label: 'DMS-Mandantennr.' },
  { value: 'DATEV_MANDANTEN_NR',    label: 'DATEV-Mandantennr.' },
  { value: 'CREATED_BY',            label: 'Erstellt von' },
  { value: 'FILE_INDEX',            label: 'Beleg-Index (1/2)' },
];

const DATE_FORMATS: FieldFormat[] = ['DATE_DDMMYYYY', 'DATE_ISO', 'DATE_YYYYMMDD'];
const NUMBER_FORMATS: FieldFormat[] = ['NUMBER_DE', 'NUMBER_DE_CURRENCY', 'NUMBER_DOT'];
const TEXT_FORMATS: FieldFormat[] = ['RAW', 'UPPER', 'LOWER'];

function formatsFor(field: BookingField | null): FieldFormat[] {
  if (!field) return ['RAW'];
  if (field === 'BOOKING_DATE') return DATE_FORMATS;
  if (field === 'AMOUNT')        return NUMBER_FORMATS;
  return TEXT_FORMATS;
}

const FORMAT_LABEL: Record<FieldFormat, string> = {
  RAW:                 'Original',
  DATE_DDMMYYYY:       'TT.MM.JJJJ',
  DATE_ISO:            'JJJJ-MM-TT',
  DATE_YYYYMMDD:       'JJJJMMTT',
  NUMBER_DE:           '1234,56',
  NUMBER_DE_CURRENCY:  '1234,56 EUR',
  NUMBER_DOT:          '1234.56',
  UPPER:               'GROSSBUCHSTABEN',
  LOWER:               'kleinbuchstaben',
};

let clientIdSeq = 1;
const makeClientId = () => `r${clientIdSeq++}`;

interface Props {
  schoolId: string;
  schoolName: string;
  onClose: () => void;
}

interface PreviewResult {
  unstructured: string;
  length: number;
  fields: Array<{ dmsKey: string; value: string }>;
  error?: string;
}

export function DmsMappingEditor({ schoolId, schoolName, onClose }: Props) {
  const [rows, setRows] = useState<MappingRow[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    api.get<MappingRow[]>(`/admin/dms-mapping/${schoolId}`)
      .then((list) => setRows(list.map(r => ({ ...r, id: makeClientId() }))))
      .catch(e => setError(e instanceof Error ? e.message : 'Fehler beim Laden'));
  }, [schoolId]);

  // Lokale Längen-Schätzung: keylen + ":wert" + Pipes
  // Wert ist unbekannt, daher minimum 1 Zeichen je Feld
  const estimatedMinLength = useMemo(() => {
    if (!rows) return 0;
    const active = rows.filter(r => r.isActive);
    if (active.length === 0) return 0;
    let total = 0;
    for (const r of active) {
      const valueLen = r.source === 'CONSTANT'
        ? (r.constantValue ?? '').length
        : 1; // unbekannt; konservativ 1
      total += r.dmsKey.length + 1 /* ":" */ + valueLen;
    }
    total += active.length - 1; // pipes
    return total;
  }, [rows]);

  const lengthColor =
    estimatedMinLength >= 140 ? 'var(--color-error)' :
    estimatedMinLength >= 120 ? 'var(--color-warning, #8a5a00)' :
    'var(--color-text-light)';

  const update = (id: string, patch: Partial<MappingRow>) => {
    setRows(prev => (prev ?? []).map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const remove = (id: string) => {
    setRows(prev => (prev ?? []).filter(r => r.id !== id));
  };

  const add = () => {
    const next = (rows ?? []);
    const maxSort = next.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    setRows([...next, {
      id: makeClientId(),
      source: 'BOOKING_FIELD',
      bookingField: 'DESCRIPTION',
      constantValue: null,
      dmsKey: '',
      format: 'RAW',
      maxLength: null,
      sortOrder: maxSort + 10,
      isActive: true,
      includeOnSeparator: true,
    }]);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !rows) return;
    const oldIdx = rows.findIndex(r => r.id === active.id);
    const newIdx = rows.findIndex(r => r.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(rows, oldIdx, newIdx).map((r, i) => ({ ...r, sortOrder: (i + 1) * 10 }));
    setRows(next);
  };

  const handleSave = async () => {
    if (!rows) return;
    setError('');
    setSaving(true);
    try {
      const payload = {
        rows: rows.map(r => ({
          source: r.source,
          bookingField: r.bookingField,
          constantValue: r.constantValue,
          dmsKey: r.dmsKey,
          format: r.format,
          maxLength: r.maxLength,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          includeOnSeparator: r.includeOnSeparator,
        })),
      };
      const saved = await api.put<MappingRow[]>(`/admin/dms-mapping/${schoolId}`, payload);
      setRows(saved.map(r => ({ ...r, id: makeClientId() })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!rows) return;
    setError('');
    setPreviewLoading(true);
    try {
      const payload = {
        rows: rows.map(r => ({
          source: r.source,
          bookingField: r.bookingField,
          constantValue: r.constantValue,
          dmsKey: r.dmsKey,
          format: r.format,
          maxLength: r.maxLength,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          includeOnSeparator: r.includeOnSeparator,
        })),
      };
      try {
        const result = await api.post<PreviewResult>(`/admin/dms-mapping/${schoolId}/preview`, payload);
        setPreview(result);
      } catch (e) {
        // Backend liefert bei Overlength einen 400 mit length-Info — als Vorschau anzeigen
        setPreview({
          unstructured: '',
          length: 0,
          fields: [],
          error: e instanceof Error ? e.message : 'Vorschau fehlgeschlagen',
        });
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1100px', width: '95vw' }}>
        <h2 style={{ marginBottom: '0.25rem' }}>DMS-Feldmapping · {schoolName}</h2>
        <p className="text-light" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Reihenfolge per Drag-and-Drop. Die Unstructured-Data-Zeile im Swiss-QR darf maximal 140 Zeichen enthalten.
        </p>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        {rows === null ? (
          <p className="text-light">Lade...</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                {rows.map((r) => (
                  <SortableMappingRow
                    key={r.id}
                    row={r}
                    onChange={(patch) => update(r.id, patch)}
                    onRemove={() => remove(r.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
          <button className="btn btn-sm btn-outline" onClick={add}>+ Feld hinzufügen</button>
          <div style={{ fontSize: '0.85rem', color: lengthColor, fontWeight: 600 }}>
            Mindest-Länge: {estimatedMinLength} / 140 Zeichen
            {estimatedMinLength >= 120 && estimatedMinLength < 140 && ' — wird eng'}
            {estimatedMinLength >= 140 && ' — zu lang!'}
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
          <button className="btn btn-outline" onClick={handlePreview} disabled={previewLoading || rows === null}>
            {previewLoading ? 'Lade Vorschau...' : 'QR-Vorschau'}
          </button>
          <div className="flex-gap">
            <button className="btn btn-outline" onClick={onClose}>Schließen</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || rows === null}>
              {saving ? 'Speichere...' : 'Speichern'}
            </button>
          </div>
        </div>

        {preview && (
          <PreviewPanel preview={preview} onClose={() => setPreview(null)} />
        )}
      </div>
    </div>
  );
}

function SortableMappingRow({
  row, onChange, onRemove,
}: {
  row: MappingRow;
  onChange: (patch: Partial<MappingRow>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'grid',
    gridTemplateColumns: 'auto 110px 220px 1fr 130px 80px auto auto',
    gap: '0.4rem',
    alignItems: 'center',
    padding: '0.4rem 0.5rem',
    background: isDragging ? 'var(--color-secondary)' : 'var(--color-bg, #fff)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    opacity: row.isActive ? 1 : 0.55,
  };

  const formats = formatsFor(row.bookingField);

  return (
    <div ref={setNodeRef} style={style}>
      <span {...attributes} {...listeners}
        style={{ cursor: 'grab', fontSize: '1.1rem', color: 'var(--color-text-light)', userSelect: 'none' }}
        aria-label="Sortieren">⠿</span>

      {/* Quelle */}
      <select className="form-control" value={row.source}
        onChange={(e) => {
          const src = e.target.value as FieldSource;
          if (src === 'CONSTANT') {
            onChange({ source: src, bookingField: null, format: null, constantValue: row.constantValue ?? '' });
          } else {
            onChange({ source: src, constantValue: null, bookingField: row.bookingField ?? 'DESCRIPTION', format: 'RAW' });
          }
        }}
        style={{ padding: '0.25rem 0.4rem' }}>
        <option value="BOOKING_FIELD">Buchung</option>
        <option value="CONSTANT">Konstante</option>
      </select>

      {/* Buchungsfeld oder Konstantenwert */}
      {row.source === 'BOOKING_FIELD' ? (
        <select className="form-control" value={row.bookingField ?? ''}
          onChange={(e) => onChange({ bookingField: e.target.value as BookingField, format: formatsFor(e.target.value as BookingField)[0] })}
          style={{ padding: '0.25rem 0.4rem' }}>
          {BOOKING_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      ) : (
        <input className="form-control" value={row.constantValue ?? ''}
          onChange={(e) => onChange({ constantValue: e.target.value })}
          placeholder='z.B. "1" (Fibu)'
          style={{ padding: '0.25rem 0.4rem' }} />
      )}

      {/* DMS-Schlüssel */}
      <input className="form-control" value={row.dmsKey}
        onChange={(e) => onChange({ dmsKey: e.target.value })}
        placeholder="dms-key"
        maxLength={40}
        style={{ padding: '0.25rem 0.4rem' }} />

      {/* Format */}
      {row.source === 'BOOKING_FIELD' ? (
        <select className="form-control" value={row.format ?? 'RAW'}
          onChange={(e) => onChange({ format: e.target.value as FieldFormat })}
          style={{ padding: '0.25rem 0.4rem' }}>
          {formats.map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
        </select>
      ) : (
        <span className="text-light" style={{ fontSize: '0.8rem' }}>—</span>
      )}

      {/* maxLength */}
      <input type="number" className="form-control" value={row.maxLength ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ maxLength: v === '' ? null : Math.max(1, Math.min(140, parseInt(v, 10) || 0)) });
        }}
        placeholder="—"
        min={1} max={140}
        title="Maximale Zeichenzahl (für Texte)"
        style={{ padding: '0.25rem 0.4rem' }} />

      {/* aktiv */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.8rem' }}>
        <input type="checkbox" checked={row.isActive}
          onChange={(e) => onChange({ isActive: e.target.checked })} />
        aktiv
      </label>

      {/* Löschen */}
      <button type="button" className="btn btn-sm btn-danger" onClick={onRemove} aria-label="Entfernen">×</button>
    </div>
  );
}

function PreviewPanel({ preview, onClose }: { preview: PreviewResult; onClose: () => void }) {
  return (
    <div style={{
      marginTop: '0.75rem',
      padding: '0.75rem',
      border: '2px solid var(--color-primary)',
      borderRadius: '6px',
      background: 'var(--color-secondary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>QR-Payload-Vorschau</strong>
        <button className="btn btn-sm btn-outline" onClick={onClose}>Schließen</button>
      </div>
      {preview.error ? (
        <div className="alert alert-error" role="alert" style={{ marginTop: '0.5rem' }}>
          {preview.error}
        </div>
      ) : (
        <>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <strong>Länge:</strong> {preview.length} / 140 Zeichen{' '}
            {preview.length >= 120 && preview.length < 140 && <span style={{ color: 'var(--color-warning, #8a5a00)' }}>(wird eng)</span>}
          </div>
          <pre style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: '#0f172a',
            color: '#e2e8f0',
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '0.78rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>{preview.unstructured}</pre>
        </>
      )}
    </div>
  );
}
