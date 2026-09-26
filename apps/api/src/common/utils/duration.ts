/**
 * 时长解析：把 `.env` 里的 `15m` / `7d` 这类人类可读写法转成秒。
 *
 * 为什么要自己算：`jsonwebtoken` 的类型把 `expiresIn` 收窄成特定字面量联合，
 * 直接用配置里的 string 会类型不通过；转成"秒"既类型安全，语义也明确。
 */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

export function parseDurationToSeconds(input: string, fallbackSeconds = 900): number {
  const text = input?.trim().toLowerCase() ?? '';
  const matched = /^(\d+)\s*([smhd])?$/.exec(text);
  if (!matched) return fallbackSeconds;

  const amount = Number(matched[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackSeconds;

  const unit = matched[2] ?? 's';
  return amount * (UNIT_SECONDS[unit] ?? 1);
}
