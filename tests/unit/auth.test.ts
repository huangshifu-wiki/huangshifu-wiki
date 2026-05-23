import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthModule = typeof import('../../src/lib/auth');
type User = import('../../src/lib/auth').User;

function createMockUser(overrides?: Partial<User>): User {
  return {
    uid: 'u_1',
    email: 'test@example.com',
    displayName: '测试用户',
    photoURL: null,
    role: 'user',
    status: 'active',
    banReason: null,
    bannedAt: null,
    level: 1,
    bio: '',
    emailVerified: true,
    isAnonymous: false,
    tenantId: null,
    providerData: [],
    ...overrides,
  };
}

describe('auth module', () => {
  const fetchMock = vi.fn<typeof fetch>();

  async function loadAuthModule(): Promise<AuthModule> {
    vi.stubGlobal('fetch', fetchMock);
    return import('../../src/lib/auth');
  }

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshAuthState updates auth.currentUser from /api/auth/me', async () => {
    const { auth, refreshAuthState } = await loadAuthModule();
    const user = createMockUser();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    const current = await refreshAuthState();
    expect(current?.uid).toBe('u_1');
    expect(auth.currentUser?.email).toBe('test@example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('onAuthStateChanged emits initial and refreshed state', async () => {
    const { onAuthStateChanged } = await loadAuthModule();
    const user = createMockUser({ uid: 'u_2' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    const received: Array<string | null> = [];
    const unsubscribe = onAuthStateChanged({}, (current) => {
      received.push(current?.uid ?? null);
    });

    for (let i = 0; i < 20; i += 1) {
      if (received.includes('u_2')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(received).toContain('u_2');

    expect(received[0]).toBe('u_2');

    unsubscribe();
  });

  it('login performs login request then refreshes auth state', async () => {
    const { auth, login } = await loadAuthModule();
    const user = createMockUser({ uid: 'u_login' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    await login('test@example.com', 'secret123');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', password: 'secret123' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(auth.currentUser?.uid).toBe('u_login');
  });

  it('register performs register request then refreshes auth state', async () => {
    const { auth, register } = await loadAuthModule();
    const user = createMockUser({ uid: 'u_register' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    await register('new@example.com', 'pw123456', '新用户');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com', password: 'pw123456', displayName: '新用户' }),
      }),
    );
    expect(auth.currentUser?.uid).toBe('u_register');
  });

  it('loginWithWeChat returns response payload and refreshes auth state', async () => {
    const { auth, loginWithWeChat } = await loadAuthModule();
    const user = createMockUser({ uid: 'u_wx' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 't', user }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    const data = await loginWithWeChat<{ token: string }>('mock:openid', { displayName: 'wx' });
    expect(data.token).toBe('t');
    expect(auth.currentUser?.uid).toBe('u_wx');
  });

  it('logoutRequest clears auth state via refresh', async () => {
    const { auth, logoutRequest, refreshAuthState } = await loadAuthModule();
    const user = createMockUser({ uid: 'u_before_logout' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));
    await refreshAuthState();
    expect(auth.currentUser?.uid).toBe('u_before_logout');

    vi.stubGlobal('document', {
      cookie: 'XSRF-TOKEN=test-xsrf-token',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: null }), { status: 200 }));

    await logoutRequest();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'X-XSRF-TOKEN': 'test-xsrf-token' },
      }),
    );
    expect(auth.currentUser).toBeNull();
  });

  describe('password strength validation', () => {
    it('returns 400 when registering with password shorter than 8 characters', async () => {
      const { register } = await loadAuthModule();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: 'Validation failed',
          fields: { password: '密码至少8个字符' },
        }), { status: 400 }),
      );

      await expect(register('test@example.com', 'short', '测试用户')).rejects.toThrow('密码至少8个字符');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', password: 'short', displayName: '测试用户' }),
        }),
      );
    });

    it('prefers field-level validation messages for login requests', async () => {
      const { login } = await loadAuthModule();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: 'Validation failed',
          fields: { email: '邮箱不能为空' },
        }), { status: 400 }),
      );

      await expect(login('', '')).rejects.toThrow('邮箱不能为空');
    });

    it('shows the empty-email message for whitespace-only auth inputs', async () => {
      const { register } = await loadAuthModule();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: 'Validation failed',
          fields: { email: '邮箱不能为空' },
        }), { status: 400 }),
      );

      await expect(register('   ', 'ValidPassword123!', '测试用户')).rejects.toThrow('邮箱不能为空');
    });
  });
});
