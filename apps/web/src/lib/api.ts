/**
 * Cliente HTTP del API. El access token vive solo en memoria; la sesión persiste en la cookie
 * httpOnly de refresh (docs/05-api.md §1.1).
 */
export interface Problem {
  status: number;
  code: string;
  title: string;
  detail?: string;
  errors?: { field: string; code: string; message: string }[];
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.title);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Obtiene un access token nuevo con la cookie de refresh. Deduplica llamadas concurrentes. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch' },
    credentials: 'same-origin',
  })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = ((await res.json()) as { accessToken: string }).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Descarga de archivos (exportaciones) con la sesión actual; dispara la descarga en el navegador. */
export async function apiDownload(path: string, body: unknown, retry = true): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(`/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' });
  if (res.status === 401 && retry && (await refreshSession())) return apiDownload(path, body, false);
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    throw new ApiError(problem ?? { status: res.status, code: 'NETWORK_ERROR', title: 'No se pudo descargar' });
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'reporte.xlsx';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });

  if (res.status === 401 && retry && (await refreshSession())) {
    return api<T>(path, init, false);
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    throw new ApiError(problem ?? { status: res.status, code: 'NETWORK_ERROR', title: 'No se pudo conectar con el servidor' });
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
