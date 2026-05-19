import { useEffect, useState } from 'react';
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../api/client';

interface Belegart {
  id: string;
  schoolId: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface Props {
  schoolId: string;
  schoolName: string;
  onClose: () => void;
  /** Wird aufgerufen, wenn der Default-Belegart-Verweis im School-Datensatz geändert werden soll */
  onDefaultChange?: (belegartId: string | null) => void;
  currentDefaultId?: string | null;
}

const CODE_REGEX = /^[A-Z][A-Z0-9_]{0,31}$/;

export function BelegartenManager({ schoolId, schoolName, onClose, onDefaultChange, currentDefaultId }: Props) {
  const [items, setItems] = useState<Belegart[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = () => {
    setLoading(true);
    api.get<Belegart[]>(`/belegarten/admin/${schoolId}`)
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(i => i.id === active.id);
    const newIndex = items.findIndex(i => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex)
      .map((it, idx) => ({ ...it, sortOrder: (idx + 1) * 10 }));
    setItems(next);
    // Sort persistieren — pro Eintrag PUT
    try {
      await Promise.all(next.map(it =>
        api.put(`/belegarten/${it.id}`, { sortOrder: it.sortOrder })
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sortieren fehlgeschlagen');
      load();
    }
  };

  const toggleActive = async (it: Belegart) => {
    try {
      const updated = await api.put<Belegart>(`/belegarten/${it.id}`, { isActive: !it.isActive });
      setItems(prev => prev.map(x => x.id === it.id ? updated : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const renameLabel = async (it: Belegart, label: string) => {
    if (label === it.label) return;
    try {
      const updated = await api.put<Belegart>(`/belegarten/${it.id}`, { label });
      setItems(prev => prev.map(x => x.id === it.id ? updated : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const handleAdd = async () => {
    setError('');
    if (!CODE_REGEX.test(newCode)) {
      setError('Code muss UPPER_SNAKE sein (Großbuchstaben, Ziffern, Unterstrich, max 32 Zeichen).');
      return;
    }
    if (!newLabel.trim()) {
      setError('Label darf nicht leer sein.');
      return;
    }
    try {
      const sortOrder = items.length > 0 ? Math.max(...items.map(i => i.sortOrder)) + 10 : 10;
      const created = await api.post<Belegart>(`/belegarten/admin/${schoolId}`, {
        code: newCode, label: newLabel, sortOrder,
      });
      setItems(prev => [...prev, created]);
      setNewCode(''); setNewLabel(''); setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Anlegen');
    }
  };

  const handleDelete = async (it: Belegart) => {
    if (!window.confirm(`Belegart "${it.label}" wirklich löschen?`)) return;
    setError('');
    try {
      await api.del(`/belegarten/${it.id}`);
      setItems(prev => prev.filter(x => x.id !== it.id));
      if (currentDefaultId === it.id) onDefaultChange?.(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '720px' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Belegarten · {schoolName}</h2>
        <p className="text-light" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Reihenfolge per Drag-and-Drop ändern. Inaktive Belegarten erscheinen nicht im Buchungs-Modal,
          bleiben aber in bestehenden Belegen erhalten.
        </p>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        {loading ? (
          <p className="text-light">Lade...</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {items.map((it) => (
                  <SortableRow
                    key={it.id}
                    item={it}
                    isDefault={currentDefaultId === it.id}
                    onSetDefault={() => onDefaultChange?.(it.id)}
                    onClearDefault={() => onDefaultChange?.(null)}
                    onToggleActive={() => toggleActive(it)}
                    onRenameLabel={(label) => renameLabel(it, label)}
                    onDelete={() => handleDelete(it)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {!adding ? (
          <button className="btn btn-sm btn-outline" style={{ marginTop: '0.75rem' }} onClick={() => setAdding(true)}>
            + Neue Belegart
          </button>
        ) : (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '6px' }}>
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="baCode">Code (UPPER_SNAKE)</label>
                <input id="baCode" className="form-control" value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="z.B. SPENDENBELEG" maxLength={32} />
              </div>
              <div className="form-group">
                <label htmlFor="baLabel">Label (Anzeige)</label>
                <input id="baLabel" className="form-control" value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="z.B. Spendenbeleg" maxLength={80} />
              </div>
            </div>
            <div className="flex-gap">
              <button className="btn btn-sm btn-primary" onClick={handleAdd}>Anlegen</button>
              <button className="btn btn-sm btn-outline" onClick={() => { setAdding(false); setNewCode(''); setNewLabel(''); }}>
                Abbrechen
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-outline" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

function SortableRow({
  item, isDefault, onSetDefault, onClearDefault, onToggleActive, onRenameLabel, onDelete,
}: {
  item: Belegart;
  isDefault: boolean;
  onSetDefault: () => void;
  onClearDefault: () => void;
  onToggleActive: () => void;
  onRenameLabel: (label: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editingLabel, setEditingLabel] = useState(item.label);

  useEffect(() => setEditingLabel(item.label), [item.label]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    background: isDragging ? 'var(--color-secondary)' : 'var(--color-bg, #fff)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    marginBottom: '0.4rem',
    opacity: item.isActive ? 1 : 0.6,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <span {...attributes} {...listeners} style={{ cursor: 'grab', fontSize: '1.2rem', color: 'var(--color-text-light)' }} aria-label="Sortieren">
        ⠿
      </span>
      <code style={{ minWidth: '140px', fontSize: '0.8rem' }}>{item.code}</code>
      <input
        className="form-control"
        style={{ flex: 1 }}
        value={editingLabel}
        onChange={(e) => setEditingLabel(e.target.value)}
        onBlur={() => onRenameLabel(editingLabel.trim() || item.label)}
        maxLength={80}
      />
      <button
        type="button"
        className={`btn btn-sm ${isDefault ? 'btn-primary' : 'btn-outline'}`}
        onClick={isDefault ? onClearDefault : onSetDefault}
        title={isDefault ? 'Aktueller Default — klicken zum Entfernen' : 'Als Default setzen'}
      >
        {isDefault ? '★ Default' : 'Default'}
      </button>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}>
        <input type="checkbox" checked={item.isActive} onChange={onToggleActive} />
        aktiv
      </label>
      <button type="button" className="btn btn-sm btn-danger" onClick={onDelete} aria-label="Löschen">×</button>
    </li>
  );
}
