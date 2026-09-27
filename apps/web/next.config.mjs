/** @type {import('next').NextConfig} */
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

/**
 * 构建 worker 数。Next 14 默认是 4（见 next/dist/build/index.js 的 getNumberOfWorkers），
 * 每个 worker 都是独立 V8 堆；8G 机器上再叠加 api 的 tsc 与宿主机上已运行的
 * postgres/redis 容器，容易触发 swap 颠簸、整机无响应。
 * 默认压到 2；内存充裕想换构建速度时设 NEXT_BUILD_CPUS=4。
 */
const buildCpus = Number(process.env.NEXT_BUILD_CPUS ?? 2);

const nextConfig = {
  reactStrictMode: true,
  // 浏览器端统一走同源 /api/*，由 Next 转发到后端；这样 cookie/CORS 都不用特殊处理
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiBase}/:path*` }];
  },
  // 生产 source map 会让每个 chunk 在内存里多留一份映射表，构建期内存翻倍，
  // 而线上排错收益有限（我们有 API traceId + 服务端日志）——显式关掉。
  productionBrowserSourceMaps: false,
  experimental: {
    // 0 = 不限制（交回 Next 默认）；>0 = 固定 worker 数
    cpus: buildCpus,
  },
};

export default nextConfig;
