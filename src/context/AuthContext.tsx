import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { User } from '../lib/auth';
import { UserPreferencesProvider } from './UserPreferencesContext';
import type { UserProfile } from '../types/entities';

// 延迟加载 auth 模块，避免首屏阻塞
// 使用动态导入实现真正的懒加载
type AuthModule = typeof import('../lib/auth');
// 注意：项目使用基于 JWT 的自定义认证系统，不是 Firebase

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  isBanned: boolean;
  // 手动触发初始化的方法（用于需要认证的操作）
  ensureInitialized: () => Promise<void>;
  // 重新加载认证状态
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isBanned: false,
  ensureInitialized: async () => {},
  refreshAuth: async () => {},
});

// 延迟初始化配置
const LAZY_INIT_DELAY = 100; // 延迟初始化时间（毫秒），足够让首屏渲染完成

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authModuleRef = useRef<AuthModule | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const isInitializedRef = useRef(false);

  // 清理订阅
  const cleanupSubscription = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, []);

  // 初始化认证状态（延迟执行）
  const initializeAuth = useCallback(async (immediate = false) => {
    // 如果已经在初始化中或已完成，则跳过
    if (isInitializedRef.current && !immediate) return;

    try {
      // 动态导入 auth 模块
      if (!authModuleRef.current) {
        authModuleRef.current = await import('../lib/auth');
      }
      const { auth, onAuthStateChanged } = authModuleRef.current;

      // 清理之前的订阅
      cleanupSubscription();

      // 设置新的订阅
      unsubscribeRef.current = onAuthStateChanged(auth, async (user) => {
        setUser(user);
        setLoading(false);
        isInitializedRef.current = true;
      });
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      setUser(null);
      setLoading(false);
      isInitializedRef.current = true;
    }
  }, [cleanupSubscription]);

  // 延迟初始化 - 使用 requestIdleCallback 或 setTimeout
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleCallbackId: number | null = null;

    // 使用 requestIdleCallback 进行延迟初始化（如果可用）
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleCallbackId = requestIdleCallback(
        () => {
          initializeAuth();
        },
        { timeout: LAZY_INIT_DELAY }
      );
    } else {
      // 降级方案：使用 setTimeout
      timeoutId = setTimeout(() => {
        initializeAuth();
      }, LAZY_INIT_DELAY);
    }

    return () => {
      if (idleCallbackId !== null) {
        cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      // 组件卸载时才清理订阅
      cleanupSubscription();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupSubscription, initializeAuth]);

  // 确保初始化完成（用于需要认证的操作）
  const ensureInitialized = useCallback(async () => {
    if (isInitializedRef.current) return;
    await initializeAuth(true);
  }, [initializeAuth]);

  // 刷新认证状态
  const refreshAuth = useCallback(async () => {
    try {
      setLoading(true);
      if (!authModuleRef.current) {
        authModuleRef.current = await import('../lib/auth');
      }
      await authModuleRef.current.refreshAuthState();
    } catch (error) {
      console.error('Failed to refresh auth:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 构建用户资料
  const profile = user
    ? {
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL || '',
        email: user.email,
        role: user.role,
        status: user.status,
        banReason: user.banReason,
        bannedAt: user.bannedAt,
        level: user.level,
        bio: user.bio,
      }
    : null;

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const isBanned = profile?.status === 'banned';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAdmin,
        isBanned,
        ensureInitialized,
        refreshAuth,
      }}
    >
      <UserPreferencesProvider>{children}</UserPreferencesProvider>
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

// 用于需要认证的高阶组件/Hook
export const useRequireAuth = () => {
  const { ensureInitialized, loading, user } = useAuth();

  useEffect(() => {
    // 当组件挂载时确保认证已初始化
    ensureInitialized();
  }, [ensureInitialized]);

  return { loading, user, isAuthenticated: !!user };
};
