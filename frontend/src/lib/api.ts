"use client";

/**
 * API client.
 * - Access token lives in memory only (XSS-safe as practical for SPA).
 * - Refresh token rides in an httpOnly cookie set by the backend; on boot or
 *   401 we call /api/auth/refresh to mint a new access token.
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export interface SessionUser {
  id: string;
  username: string;
  rating: number;
  email?: string;
}

let currentUser: SessionUser | null = null;
export function getCurrentUser(): SessionUser | null {
  return currentUser;
}

// --- auth state pub/sub (Navbar etc. react to login/logout/refresh) ---
type AuthListener = (user: SessionUser | null) => void;
const authListeners = new Set<AuthListener>();

function notifyAuth() {
  for (const cb of authListeners) cb(currentUser);
}

export function onAuthChange(cb: AuthListener): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

/**
 * Refresh the access token. DEDUPED: concurrent callers (Navbar, page
 * components, WS reconnects) share one in-flight request. Critical because
 * the backend rotates refresh tokens - a second parallel call would reuse the
 * just-revoked cookie, get 401, and falsely look like a logout.
 */
function rawRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = await res.json();
      accessToken = data.access_token;
      currentUser = data.user;
      notifyAuth();
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Force a token refresh (used before WS reconnects with a possibly-expired token). */
export function refreshSession(): Promise<boolean> {
  return rawRefresh();
}

/** Try to establish a session from the httpOnly refresh cookie. */
export async function ensureSession(): Promise<SessionUser | null> {
  if (accessToken && currentUser) return currentUser;
  const ok = await rawRefresh();
  if (!ok) {
    currentUser = null;
    accessToken = null;
  }
  return currentUser;
}

export async function login(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return { ok: false, error: (await errorText(res)) };
  const data = await res.json();
  accessToken = data.access_token;
  currentUser = data.user;
  notifyAuth();
  return { ok: true };
}

export async function register(
  email: string,
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, username, password }),
  });
  if (!res.ok) return { ok: false, error: await errorText(res) };
  const data = await res.json();
  accessToken = data.access_token;
  currentUser = data.user;
  notifyAuth();
  return { ok: true };
}

export async function logout() {
  await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => undefined);
  accessToken = null;
  currentUser = null;
  notifyAuth();
}

/** In-memory access token for the WS auth frame (never put on the query string). */
export function getAccessToken(): string | null {
  return accessToken;
}

export function getWsUrl(): string {
  if (!accessToken) throw new Error("no access token");
  const wsBase = process.env.NEXT_PUBLIC_WS_BASE;
  if (wsBase) return `${wsBase.replace(/\/$/, "")}/api/ws`;
  // Split-port local dev: REST already targets NEXT_PUBLIC_API_BASE (:8000)
  // but window.location is the Next server (:3000), which 404s /api/ws.
  const api = process.env.NEXT_PUBLIC_API_BASE;
  if (api) {
    const origin = api.replace(/^http/i, "ws").replace(/\/$/, "");
    return `${origin}/api/ws`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/ws`;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && !retried) {
    if (await rawRefresh()) return api<T>(path, init, true);
  }
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<T>;
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) {
      return String(body.detail[0].msg);
    }
  } catch {
    /* ignore */
  }
  if (res.status >= 500) return "Server error. Try again in a moment.";
  return `HTTP ${res.status}`;
}
