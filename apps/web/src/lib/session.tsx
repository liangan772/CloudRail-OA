'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api-client';

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  tenantId: number;
  deptIds: number[];
  primaryDeptId: number | null;
  roleCodes: string[];
  permissions: string[];
  scope: string;
}

interface SessionValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  reload: () => Promise<void>;
  /** 权限判定：按钮级显隐与路由守卫共用同一份权限点（来自 shared） */
  can: (code: string) => boolean;
  canAny: (codes: string[]) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!tokenStore.access()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.get<CurrentUser>('/auth/me'));
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.post<{ tokens: { accessToken: string; refreshToken: string } }>('/auth/login', {
        email,
        password,
      });
      tokenStore.save(result.tokens);
      await reload();
    },
    [reload],
  );

  const logout = useCallback(() => {
    // 无状态 JWT：服务端不保存刷新令牌，登出即清本地
    tokenStore.clear();
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      reload,
      can: (code) => user?.permissions.includes(code) ?? false,
      canAny: (codes) => codes.some((code) => user?.permissions.includes(code) ?? false),
    }),
    [user, loading, login, logout, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用');
  return value;
}
