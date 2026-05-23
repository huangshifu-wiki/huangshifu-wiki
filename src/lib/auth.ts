import { getXsrfToken } from './xsrf';

export interface AuthProviderInfo {
  providerId: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  wechatBound?: boolean;
  role: 'user' | 'admin' | 'super_admin';
  status: 'active' | 'banned';
  banReason: string | null;
  bannedAt: string | null;
  level: number;
  bio: string;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: AuthProviderInfo[];
}

type AuthStateListener = (user: User | null) => void;

const listeners = new Set<AuthStateListener>();
let currentUser: User | null = null;
let initialized = false;

function notifyListeners() {
  for (const listener of listeners) {
    listener(currentUser);
  }
}

function getValidationFieldMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('fields' in data)) {
    return null
  }

  const { fields } = data as { fields?: unknown }
  if (!fields || typeof fields !== 'object') {
    return null
  }

  for (const value of Object.values(fields as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return null
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (() => {
      if (typeof data !== 'object' || !data || !('error' in data)) {
        return `Request failed with status ${response.status}`
      }

      const error = String((data as Record<string, unknown>).error)
      if (error === 'Validation failed') {
        return getValidationFieldMessage(data) || error
      }

      return error
    })()
    throw new Error(message);
  }
  return data as T;
}

export async function refreshAuthState() {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
    });
    const data = await parseJsonResponse<{ user: User | null }>(response);
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  initialized = true;
  notifyListeners();
  return currentUser;
}

export function readBootstrapAuthUid(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const bootstrapUid = window.__HSF_BOOTSTRAP_AUTH_UID__
  if (typeof bootstrapUid !== 'string') {
    return null
  }

  const normalizedUid = bootstrapUid.trim()
  return normalizedUid || null
}

export const auth = {
  get currentUser() {
    return currentUser;
  },
};

export function onAuthStateChanged(
  _auth: unknown,
  callback: AuthStateListener,
) {
  listeners.add(callback);

  if (initialized) {
    callback(currentUser);
  } else {
    refreshAuthState()
      .then(() => {
        callback(currentUser);
      })
      .catch((error) => {
        console.error('Failed to initialize auth state:', error);
        callback(null);
      });
  }

  return () => {
    listeners.delete(callback);
  };
}

export async function login(email: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  await parseJsonResponse(response);
  await refreshAuthState();
}

export async function register(email: string, password: string, displayName?: string) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      email,
      password,
      ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
    }),
  });

  await parseJsonResponse(response);
  await refreshAuthState();
}

export async function loginWithWeChat<T = unknown>(code: string, profile?: { displayName?: string; photoURL?: string }) {
  const response = await fetch('/api/auth/wechat/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      code,
      displayName: profile?.displayName,
      photoURL: profile?.photoURL,
    }),
  });

  const data = await parseJsonResponse<T>(response);
  await refreshAuthState();
  return data;
}

export async function logoutRequest() {
  const xsrfToken = getXsrfToken();
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : undefined,
  });

  await parseJsonResponse(response);
  await refreshAuthState();
}
