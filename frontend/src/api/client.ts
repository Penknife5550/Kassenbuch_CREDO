const API_BASE = '/api';

let token: string | null = localStorage.getItem('token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

export function getToken(): string | null {
  return token;
}

/**
 * Fehlerantwort auf eine Anfrage. Am `status` erkennt der Aufrufer, ob das
 * Kassenbuch selbst abgesagt hat oder ein Proxy davor (502–504) — im zweiten
 * Fall ist offen, ob die Anfrage noch verarbeitet wurde.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Gemeinsame Prüfung jeder Antwort: eine abgelaufene Anmeldung führt zur
 * Anmeldeseite, jede andere Fehlerantwort wird zum ApiError mit der Meldung
 * des Servers.
 */
async function ensureOk(res: Response): Promise<void> {
  // Bei der Anmeldung selbst heißt 401 "Benutzername oder Passwort falsch" —
  // das soll als Meldung stehen bleiben, statt die Anmeldeseite neu zu laden.
  if (res.status === 401 && !res.url.endsWith('/auth/login')) {
    setToken(null);
    window.location.href = '/login';
    throw new ApiError('Nicht authentifiziert', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 413 ohne Meldung kommt vom Proxy vor dem Kassenbuch: die Anfrage war zu groß
    const fallback = res.status === 413 ? 'Die Datei ist zu groß.' : `Fehler: ${res.status}`;
    throw new ApiError(body.error || fallback, res.status);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  await ensureOk(res);

  if (res.status === 204) return undefined as T;

  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res.text() as unknown as T;
  }

  return res.json();
}

async function downloadBlob(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  await ensureOk(res);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function uploadFiles<T>(
  path: string,
  files: File[],
  extraFields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: form });
  await ensureOk(res);

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Holt eine authentifizierte Ressource als Blob-URL (für <iframe> / <img>).
 * Mit `body` wird per POST angefragt — so liefert der Server ein PDF zu
 * Angaben, die noch nicht gespeichert sind (Entwurfs-Vorschau).
 * Caller muss URL.revokeObjectURL(url) aufrufen, wenn die URL nicht mehr gebraucht wird.
 */
async function fetchBlobUrl(path: string, body?: unknown): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = { headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.method = 'POST';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  await ensureOk(res);

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  download: downloadBlob,
  upload: uploadFiles,
  blobUrl: fetchBlobUrl,
};
