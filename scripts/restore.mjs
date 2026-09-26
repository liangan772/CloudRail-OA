#!/usr/bin/env node
// 恢复：`node scripts/restore.mjs docker/backups/oa-20260926120000.dump`
// 恢复是**破坏性操作**（会覆盖现有数据），所以这里要求显式传 --yes 才执行。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const [fileArg, ...flags] = process.argv.slice(2);

if (!fileArg) {
  console.error('用法：node scripts/restore.mjs <备份文件> --yes');
  process.exit(1);
}
const file = path.isAbsolute(fileArg) ? fileArg : path.join(root, fileArg);
if (!existsSync(file)) {
  console.error(`✖ 找不到备份文件：${file}`);
  process.exit(1);
}
if (!flags.includes('--yes')) {
  console.error(`⚠ 恢复会覆盖现有数据。确认无误后加 --yes 再执行：\n  node scripts/restore.mjs ${fileArg} --yes`);
  process.exit(1);
}

function envValue(key, fallback) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return fallback;
  const matched = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(envPath, 'utf8'));
  return matched?.[1] ?? fallback;
}

const candidates = process.env.OA_PG_CONTAINER ? [process.env.OA_PG_CONTAINER] : ['oa-postgres', 'oa-postgres-dev'];
const user = envValue('POSTGRES_USER', 'oa');
const db = envValue('POSTGRES_DB', 'oa');
const fileName = path.basename(file);
const containerPath = `/backups/${fileName}`;

function containerRunning(name) {
  const result = spawnSync('docker', ['ps', '--filter', `name=${name}`, '--format', '{{.Names}}'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  return result.status === 0 && (result.stdout ?? '').includes(name);
}

const container = candidates.find((name) => containerRunning(name)) ?? candidates[0];
const running = containerRunning(container);

// 备份目录挂进容器（见 compose 的 /backups），所以先确认文件在容器里可见
if (running && !existsSync(path.join(root, 'docker', 'backups', fileName))) {
  console.error('✖ 备份文件不在 docker/backups/ 下，容器看不到它');
  process.exit(1);
}

console.log(`▶ 恢复 ${fileName} → ${db}`);
const result = running
  ? spawnSync('docker', ['exec', container, 'sh', '-c', `pg_restore -U ${user} -d ${db} --clean --if-exists /backups/${fileName}`], {
      stdio: 'inherit',
    })
  : spawnSync('pg_restore', ['-U', user, '-d', db, '--clean', '--if-exists', file], { stdio: 'inherit' });

if (result.error) {
  console.error('✖ 本机没有 pg_restore：请安装 postgresql-client');
  process.exit(1);
}
process.exit(result.status ?? 1);
