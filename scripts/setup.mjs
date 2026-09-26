#!/usr/bin/env node
// 一条命令准备开发环境：依赖 → 依赖服务（postgres/redis）→ .env → 迁移 → 种子。
// 设计原则：**能跑就跑，缺什么说什么**——没有 Docker 时不会硬失败，
// 而是提示"用已有的 PostgreSQL/Redis 也行"，把选择留给开发者（见阶段 0 风险 R2）。
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const run = (command, options = {}) =>
  spawnSync(command, { shell: true, stdio: 'inherit', cwd: root, ...options });
const quiet = (command) => spawnSync(command, { shell: true, cwd: root, stdio: 'pipe' });

function has(command) {
  return quiet(`${command} --version`).status === 0;
}

console.log('▶ 1/5 环境检查');
if (!has('node')) {
  console.error('✖ 需要 Node.js 20+');
  process.exit(1);
}
const useDocker = has('docker') && quiet('docker info').status === 0;
console.log(useDocker ? '  · 检测到 Docker，将启动 postgres + redis 容器' : '  · 未检测到可用的 Docker，请确保本机已有 PostgreSQL 16 与 Redis');

console.log('▶ 2/5 安装依赖');
if (!has('pnpm')) {
  console.log('  · 未安装 pnpm，先通过 corepack 启用');
  run('corepack enable') ;
  run('corepack prepare pnpm@9.12.0 --activate');
}
run('pnpm install --no-frozen-lockfile');

console.log('▶ 3/5 依赖服务');
if (useDocker) {
  run('docker compose -f docker/docker-compose.dev.yml up -d');
  run('node scripts/wait-for.mjs 127.0.0.1 5432 60');
  run('node scripts/wait-for.mjs 127.0.0.1 6379 30');
} else {
  console.log('  · 跳过容器启动；请自行确认 DATABASE_URL / REDIS_URL 可达');
}

console.log('▶ 4/5 环境变量');
if (existsSync(path.join(root, '.env'))) {
  console.log('  · .env 已存在，保持不变');
} else {
  copyFileSync(path.join(root, '.env.example'), path.join(root, '.env'));
  console.log('  · 已从 .env.example 生成 .env（生产请务必替换 JWT 密钥与数据库口令）');
}

console.log('▶ 5/5 数据库迁移与种子');
const env = readFileSync(path.join(root, '.env'), 'utf8');
const databaseUrl = /^DATABASE_URL=(.*)$/m.exec(env)?.[1];
if (!databaseUrl) {
  console.error('✖ .env 里缺少 DATABASE_URL');
  process.exit(1);
}
const result = run(`pnpm --filter @oa/api db:deploy`, { env: { ...process.env, DATABASE_URL: databaseUrl } });
if (result.status !== 0) {
  console.error('✖ 迁移失败：请检查数据库是否可达（Docker 模式下先确认容器已 healthy）');
  process.exit(1);
}
run(`pnpm db:seed`, { env: { ...process.env, DATABASE_URL: databaseUrl } });

console.log('\n✔ 准备完成。下一步：pnpm dev（api :3001 / web :3000）');
console.log('  演示账号：admin@cloudrail.dev / Oa@12345678');
void execSync;
