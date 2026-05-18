import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export type ColumnId =
  | 'receiptNumber' | 'date' | 'description' | 'account' | 'counterAccount'
  | 'costCenter' | 'einnahme' | 'ausgabe' | 'status' | 'createdBy' | 'actions';

export const COLUMN_DEFS: Record<ColumnId, { label: string; align?: 'right' }> = {
  date: { label: 'Datum' },
  account: { label: 'Konto' },
  costCenter: { label: 'KSt' },
  einnahme: { label: 'Einnahme', align: 'right' },
  ausgabe: { label: 'Ausgabe', align: 'right' },
  description: { label: 'Buchungstext' },
  status: { label: 'Status' },
  createdBy: { label: 'Gebucht von' },
  receiptNumber: { label: 'Beleg-Nr.' },
  counterAccount: { label: 'Gegenkonto' },
  actions: { label: '' },
};

export const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  'date', 'account', 'costCenter', 'einnahme', 'ausgabe', 'description',
  'status', 'createdBy', 'receiptNumber', 'counterAccount', 'actions',
];

export function validateColumnOrder(input: unknown): ColumnId[] | null {
  if (!Array.isArray(input)) return null;
  const allIds = new Set<ColumnId>(DEFAULT_COLUMN_ORDER);
  const seen = new Set<string>();
  const result: ColumnId[] = [];
  for (const v of input) {
    if (typeof v !== 'string' || !allIds.has(v as ColumnId) || seen.has(v)) return null;
    seen.add(v);
    result.push(v as ColumnId);
  }
  if (result.length !== DEFAULT_COLUMN_ORDER.length) return null;
  return result;
}

export interface Booking {
  id: string;
  receiptNumber: number;
  bookingDate: string;
  amount: string;
  debitCredit: 'S' | 'H';
  description: string;
  isStorno: boolean;
  isFinalized: boolean;
  splitGroupId: string | null;
  account: { accountNumber: string; name: string };
  counterAccount: { accountNumber: string; name: string };
  costCenter: { code: string; name: string } | null;
  createdBy: { displayName: string };
  stornoOf: { receiptNumber: number } | null;
  stornoBookings?: { id: string }[];
}

export function renderCellStyle(colId: ColumnId): React.CSSProperties | undefined {
  if (colId === 'receiptNumber') return { fontWeight: 600 };
  if (colId === 'einnahme') return { color: 'var(--color-success)' };
  if (colId === 'ausgabe') return { color: 'var(--color-error)' };
  return undefined;
}

export function renderCell(
  colId: ColumnId,
  b: Booking,
  isSplit: boolean,
  idx: number,
  onStorno: (id: string) => void,
): React.ReactNode {
  switch (colId) {
    case 'receiptNumber':
      return isSplit ? (
        idx === 0
          ? <span title="Splittbuchung">{b.receiptNumber} <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', verticalAlign: 'super' }}>Split</span></span>
          : <span style={{ paddingLeft: '0.75rem', color: 'var(--color-text-light)', fontSize: '0.8rem' }}>└ {b.receiptNumber}</span>
      ) : b.receiptNumber;
    case 'date':
      return new Date(b.bookingDate).toLocaleDateString('de-DE');
    case 'description':
      return (
        <>
          {b.description}
          {b.stornoOf && (
            <span className="text-light" style={{ fontSize: '0.75rem' }}>
              {' '}(Storno von #{b.stornoOf.receiptNumber})
            </span>
          )}
        </>
      );
    case 'account':
      return b.account.accountNumber;
    case 'counterAccount':
      return b.counterAccount.accountNumber;
    case 'costCenter':
      return b.costCenter?.code || '–';
    case 'einnahme':
      return b.debitCredit === 'S'
        ? parseFloat(b.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
        : '';
    case 'ausgabe':
      return b.debitCredit === 'H'
        ? parseFloat(b.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
        : '';
    case 'status':
      return (
        <>
          {b.isStorno && <span className="badge badge-storno">Storno</span>}
          {b.isFinalized && <span className="badge badge-finalized">Festgeschrieben</span>}
        </>
      );
    case 'createdBy':
      return b.createdBy.displayName;
    case 'actions':
      return !b.isStorno && !b.isFinalized && idx === 0 ? (
        <button className="btn btn-sm btn-danger" onClick={() => onStorno(b.id)}>
          Storno{isSplit ? ' (alle)' : ''}
        </button>
      ) : null;
  }
}

export function SortableTh({ id, children, align }: {
  id: ColumnId; children: React.ReactNode; align?: 'right';
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: 'grab',
    userSelect: 'none',
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? 'var(--color-secondary)' : undefined,
    textAlign: align ?? undefined,
  };
  return (
    <th ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </th>
  );
}
