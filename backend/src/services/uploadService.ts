import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { config } from '../config';

const MAX_BYTES = config.maxReceiptSizeMb * 1024 * 1024;

// Magic-Byte-Signaturen: nur PDF, JPEG, PNG akzeptieren
const SIGNATURES: Array<{ mime: string; ext: string; bytes: number[] }> = [
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  { mime: 'image/jpeg',      ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },                 // JPEG SOI
  { mime: 'image/png',       ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG
];

export interface DetectedFile {
  mime: string;
  ext: string;
}

export function detectFileType(buffer: Buffer): DetectedFile | null {
  for (const sig of SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[i] !== sig.bytes[i]) { match = false; break; }
    }
    if (match) return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}

// Multer mit In-Memory-Storage — wir validieren und schreiben selbst auf Disk,
// damit Magic-Byte-Check vor dem Persistieren laufen kann.
export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_BYTES,
    files: config.maxReceiptFilesPerUpload,
  },
});

export interface StoredReceipt {
  storagePath: string;   // relativ zu config.uploadDir
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  ext: string;
}

/**
 * Schreibt einen validierten Beleg auf Disk.
 * Pfadschema: schoolId/YYYY-MM/uuid.ext  (relativ zu config.uploadDir)
 */
export async function storeReceipt(
  schoolId: string,
  bookingDate: Date,
  buffer: Buffer,
  detected: DetectedFile,
): Promise<StoredReceipt> {
  const yyyy = bookingDate.getFullYear().toString();
  const mm = (bookingDate.getMonth() + 1).toString().padStart(2, '0');
  const yyyyMm = `${yyyy}-${mm}`;
  const uuid = randomUUID();
  const relativePath = join(schoolId, yyyyMm, `${uuid}.${detected.ext}`);
  const absolutePath = join(config.uploadDir, relativePath);

  await fs.mkdir(dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  const sha256 = createHash('sha256').update(buffer).digest('hex');

  return {
    storagePath: relativePath,
    sha256,
    sizeBytes: buffer.length,
    mimeType: detected.mime,
    ext: detected.ext,
  };
}

export function absolutePathFor(storagePath: string): string {
  return join(config.uploadDir, storagePath);
}

export async function deleteReceiptFile(storagePath: string): Promise<void> {
  // Soft-Delete im DB-Modell — Datei bleibt für GoBD bestehen.
  // Diese Funktion existiert für späteres Hard-Delete (10-Jahres-Frist).
  await fs.unlink(absolutePathFor(storagePath)).catch(() => undefined);
}
