'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const { login } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('admin@cloudrail.dev');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch (err) {
      // 后端已按错误码给了中文文案（含账号锁定/停用等区分），直接用
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">登录 CloudRail OA</h1>
          <p className="text-sm text-muted-foreground">层级投票制审批 · 任务协作 · 逐级上报</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm">邮箱</span>
          <input
            className="oa-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">密码</span>
          <input
            className="oa-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <button className="oa-button w-full" type="submit" disabled={submitting}>
          {submitting ? '登录中…' : '登录'}
        </button>

        <p className="text-xs text-muted-foreground">演示账号：admin@cloudrail.dev / Oa@12345678</p>
      </form>
    </div>
  );
}
