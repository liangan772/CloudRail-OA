/** @type {import('next').NextConfig} */
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  // 浏览器端统一走同源 /api/*，由 Next 转发到后端；这样 cookie/CORS 都不用特殊处理
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiBase}/:path*` }];
  },
};

export default nextConfig;
