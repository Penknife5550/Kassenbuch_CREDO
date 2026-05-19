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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/login';
    throw new Error('Nicht authentifiziert');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Fehler: ${res.status}`);
  }

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

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/login';
    throw new Error('Nicht authentifiziert');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Fehler: ${res.status}`);
  }

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

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/login';
    throw new Error('Nicht authentifiziert');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Fehler: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * Holt eine authentifizierte Ressource als Blob-URL (für <iframe> / <img>).
 * Caller muss URL.revokeObjectURL(url) aufrufen, wenn die URL nicht mehr gebraucht wird.
 */
async function fetchBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`Fehler: ${res.status}`);
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
