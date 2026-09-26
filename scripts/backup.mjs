#!/usr/bin/env node
// 备份：优先在容器里跑 pg_dump（生产 compose 部署），否则退回本机 pg_dump。
// 产物落在 docker/backups/（compose 里挂进了 postgres 容器，便于两边互认）。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'docker', 'backups');
mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const file = `oa-${stamp}.dump`;
const container = process.env.OA_PG_CONTAINER ?? 'oa-postgres-dev';

function containerRunning(name) {
  const result = spawnSync('docker', ['ps', '--filter', `name=${name}`, '--format', '{{.Names}}'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim().includes(name);
}

function envValue(key, fallback) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return fallback;
  const matched = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(envPath, 'utf8'));
  return matched?.[1] ?? fallback;
}

const user = envValue('POSTGRES_USER', 'oa');
const db = envValue('POSTGRES_DB', 'oa');

if (containerRunning(container)) {
  console.log(`▶ 从容器 ${container} 备份 ${db}`);
  const result = spawnSync(
    'docker',
    ['exec', container, 'sh', '-c', `pg_dump -U ${user} -d ${db} -Fc -f /backups/${file}`],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`✔ 已备份到 docker/backups/${file}`);
} else {
  console.log('▶ 未发现容器，改用本机 pg_dump + DATABASE_URL');
  const result = spawnSync('pg_dump', ['-Fc', '-f', path.join(outDir, file), envValue('DATABASE_URL', '')], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error('✖ 本机没有 pg_dump：请安装 postgresql-client，或用 docker 部署');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`✔ 已备份到 docker/backups/${file}`);
}
