// Dünner Client für die eigene API (ersetzt supabase-js). Session läuft über ein HttpOnly-Cookie.
export type Me = { id: string; email: string; name: string; is_admin: boolean }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined && method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`)
  return data as T
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = { ok: true }>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = { ok: true }>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T = { ok: true }>(path: string) => request<T>('DELETE', path),
}

// Ergebnis-Tupel statt try/catch an jeder Stelle: [data, null] oder [null, Fehlertext]
export async function attempt<T>(p: Promise<T>): Promise<[T, null] | [null, string]> {
  try { return [await p, null] } catch (e) { return [null, e instanceof Error ? e.message : String(e)] }
}
