import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">页面不存在</h1>
      <p className="text-sm text-muted-foreground">链接可能已失效，或该资源不在你的数据范围内。</p>
      <Link href="/" className="oa-button-ghost">
        返回工作台
      </Link>
    </div>
  );
}
