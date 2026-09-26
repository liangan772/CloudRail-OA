import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * 密码哈希：使用 Node 内置 scrypt，避免 argon2/bcrypt 的原生编译依赖
 * （Windows 开发机与 alpine 镜像都不需要 node-gyp）。
 *
 * 存储格式：scrypt$<keylen>$<saltBase64>$<hashBase64>
 */
const KEYLEN = 64;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain.normalize('NFKC'), salt, KEYLEN);
  return `${PREFIX}$${KEYLEN}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const keylen = Number(parts[1]);
  if (!Number.isInteger(keylen) || keylen <= 0) return false;
  const salt = Buffer.from(parts[2] ?? '', 'base64');
  const expected = Buffer.from(parts[3] ?? '', 'base64');
  const derived = await scrypt(plain.normalize('NFKC'), salt, keylen);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
