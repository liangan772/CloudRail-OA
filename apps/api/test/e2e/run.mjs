#!/usr/bin/env node
/**
 * 真实库 e2e 编排：
 *   1. 若 E2E_BASE_URL 指定的服务已在跑，直接复用；
 *   2. 否则用当前环境变量启动 dist/main.js（要求先 build），等 /health 就绪；
 *   3. 跑 jest e2e；
 *   4. 结束时收掉自己起的服务。
 *
 * 为什么不在 jest 进程里 in-process 启动应用：本机环境下 Prisma 在 jest 里连接不稳定，
 * 且"起真实服务再打"更接近联调语义。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const port = process.env.E2E_PORT ?? '3099';
const baseUrl = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const apiDir = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const entry = `${apiDir}dist/main.js`.replace(/\/+/g, '/');

async function isUp() {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForUp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp()) return true;
    await delay(400);
  }
  return false;
}

let server = null;

if (!(await isUp())) {
  if (!existsSync(entry)) {
    console.error(`✖ 找不到构建产物 ${entry}，请先执行 nest build`);
    process.exit(1);
  }
  server = spawn(process.execPath, [entry], {
    cwd: apiDir,
    env: { ...process.env, API_PORT: port },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const ready = await waitForUp(25_000);
  if (!ready) {
    server.kill();
    console.error(`✖ 服务在 ${baseUrl} 未能就绪（20 秒超时）`);
    process.exit(1);
  }
  console.log(`▶ e2e 服务已就绪：${baseUrl}`);
} else {
  console.log(`▶ 复用已运行的服务：${baseUrl}`);
}

const jest = spawn(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand', ...process.argv.slice(2)],
  { cwd: apiDir, env: { ...process.env, E2E_BASE_URL: baseUrl }, stdio: 'inherit' },
);

const code = await new Promise((resolve) => jest.on('exit', resolve));
if (server) server.kill();
process.exit(code ?? 0);
