import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { printPdf } from '../utils/printPdf';
import { formatBytes } from './ReceiptUpload';
import type { EigenbelegResult } from './EigenbelegForm';

interface Props {
  result: EigenbelegResult;
  onClose: () => void;
}

/** Bestätigung nach dem Buchen: zeigt den gespeicherten Beleg, von hier aus wird gedruckt. */
export function EigenbelegDone({ result, onClose }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { booking, receipt } = result;

  useEffect(() => {
    let cancelled = false;
    let loadedUrl: string | null = null;
    api.blobUrl(`/receipts/${receipt.id}/preview`)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        loadedUrl = url;
        setPdfUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Der Beleg konnte nicht geladen werden.');
      });
    return () => {
      cancelled = true;
      if (loadedUrl) URL.revokeObjectURL(loadedUrl);
    };
  }, [receipt.id]);

  const amount = parseFloat(booking.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const kind = booking.debitCredit === 'S' ? 'Einnahme' : 'Ausgabe';

  const download = () => {
    api.download(`/receipts/${receipt.id}/download`, receipt.originalName)
      .catch((e) => setError(e instanceof Error ? e.message : 'Download fehlgeschlagen'));
  };

  // Eigene Blob-URL für den Druck: die der Vorschau wird beim Schließen entwertet,
  // der Druckdialog kann dann aber noch offen sein.
  const print = () => {
    api.blobUrl(`/receipts/${receipt.id}/preview`)
      .then(printPdf)
      .catch((e) => setError(e instanceof Error ? e.message : 'Drucken fehlgeschlagen'));
  };

  return (
    <>
      <h2 id="modal-title">Eigenbeleg gebucht</h2>
      <div className="alert alert-success" role="status">
        Gebucht unter <strong>Beleg-Nr. {booking.receiptNumber}</strong>: {amount} {kind}.
        Der Eigenbeleg hängt als PDF an der Buchung.
      </div>
      {result.payeeSigns && (
        <div className="alert alert-warning" role="status">
          Bitte drucken, vom Empfänger unterschreiben lassen und den Scan über die Büroklammer an die Buchung hängen.
          Das geht auch noch nach dem Tagesabschluss.
        </div>
      )}
      {result.attachmentError && (
        <div className="alert alert-error" role="alert">
          Die Anlage konnte nicht hochgeladen werden: {result.attachmentError} Bitte über die Büroklammer nachreichen.
        </div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {pdfUrl && (
        <iframe src={pdfUrl} title={receipt.originalName}
          style={{ width: '100%', height: '46vh', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />
      )}
      <div className="text-light" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
        {receipt.originalName} · {formatBytes(receipt.sizeBytes)}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={download}>PDF herunterladen</button>
        <button type="button" className="btn btn-outline" onClick={print}>Drucken</button>
        <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>Fertig</button>
      </div>
    </>
  );
}
