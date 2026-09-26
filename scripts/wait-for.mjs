#!/usr/bin/env node
// 等待某个 TCP 端口可连：`node scripts/wait-for.mjs 127.0.0.1 5432 60`
// 用于 setup 里等 postgres/redis 起来，避免"容器还没就绪就 migrate"。
import net from 'node:net';

const [host = '127.0.0.1', portArg = '5432', timeoutArg = '60'] = process.argv.slice(2);
const port = Number(portArg);
const timeoutMs = Number(timeoutArg) * 1000;
const deadline = Date.now() + timeoutMs;

function probe() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

while (Date.now() < deadline) {
  if (await probe()) {
    console.log(`✔ ${host}:${port} 已就绪`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.error(`✖ 等待 ${host}:${port} 超时（${timeoutArg}s）`);
process.exit(1);
