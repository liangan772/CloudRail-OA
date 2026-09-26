import { ERROR_CODES } from '@oa/shared';

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
  traceId?: string;
}

/** 后端统一错误码 → 前端异常；`code` 用于文案与埋点，不解析 message */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const ACCESS_KEY = 'oa-access-token';
const REFRESH_KEY = 'oa-refresh-token';

/** 令牌只放内存 + localStorage：刷新页面不丢，登出即清 */
export const tokenStore = {
  access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  save(pair: { accessToken: string; refreshToken: string }): void {
    window.localStorage.setItem(ACCESS_KEY, pair.accessToken);
    window.localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

/**
 * 刷新令牌的**单飞**队列。
 *
 * 页面同时发多个请求、令牌恰好过期时，如果每个 401 都去刷新，会出现"后到的刷新把先到的令牌顶掉"的竞态。
 * 这里让第一个 401 触发刷新，其余请求等同一个 Promise。
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokenStore.refresh();
    if (!refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      const body = (await res.json()) as ApiEnvelope<{ tokens: { accessToken: string; refreshToken: string } }>;
      tokenStore.save(body.data.tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 内部用：刷新后只重试一次，避免死循环 */
  retried?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, retried, headers, ...rest } = options;
  const access = tokenStore.access();

  const response = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // 访问令牌过期：刷新一次再重放原请求
  if (response.status === 401 && !retried && tokenStore.refresh()) {
    if (await refreshTokens()) return apiFetch<T>(path, { ...options, retried: true });
    tokenStore.clear();
  }

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok || !payload) {
    throw new ApiError(
      payload?.code ?? ERROR_CODES.SYS_INTERNAL_ERROR.code,
      payload?.message ?? '请求失败，请稍后重试',
      response.status,
      (payload as { detail?: string } | null)?.detail,
      payload?.traceId,
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE', body }),
};

/** SWR 的 fetcher（含刷新与错误码语义） */
export const swrFetcher = <T>(path: string) => apiFetch<T>(path);
