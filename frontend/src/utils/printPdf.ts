/** So lange bleibt der unsichtbare Druck-Rahmen stehen — der Druckdialog braucht das Dokument, bis er geschlossen ist. */
const PRINT_FRAME_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Öffnet den Druckdialog für ein PDF, das als Blob-URL vorliegt.
 *
 * Der Druck läuft über einen unsichtbaren iframe. Verweigert der Browser das,
 * öffnet sich das PDF in einem neuen Tab und wird von dort gedruckt.
 *
 * Die Funktion übernimmt die Blob-URL und gibt sie später selbst frei — der
 * Aufrufer darf sie nicht vorher mit revokeObjectURL entwerten, sonst lädt
 * der Druck-Rahmen ins Leere.
 */
export function printPdf(blobUrl: string): void {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Druckansicht';

  frame.onload = () => {
    try {
      const target = frame.contentWindow;
      if (!target) throw new Error('Druck-Rahmen nicht erreichbar');
      target.focus();
      target.print();
    } catch {
      window.open(blobUrl, '_blank');
    }
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(blobUrl);
    }, PRINT_FRAME_LIFETIME_MS);
  };

  frame.src = blobUrl;
  document.body.appendChild(frame);
}
