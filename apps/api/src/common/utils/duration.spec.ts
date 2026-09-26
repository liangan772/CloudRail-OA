import { parseDurationToSeconds } from './duration';

describe('duration · 时长解析', () => {
  it('支持 s/m/h/d 四种单位', () => {
    expect(parseDurationToSeconds('30s')).toBe(30);
    expect(parseDurationToSeconds('15m')).toBe(900);
    expect(parseDurationToSeconds('8h')).toBe(28800);
    expect(parseDurationToSeconds('7d')).toBe(604800);
  });

  it('不写单位时按秒处理，允许空格', () => {
    expect(parseDurationToSeconds('120')).toBe(120);
    expect(parseDurationToSeconds(' 15 m ')).toBe(900);
  });

  it('非法或非正数回落默认值（默认 15 分钟），不抛错', () => {
    expect(parseDurationToSeconds('abc')).toBe(900);
    expect(parseDurationToSeconds('0m')).toBe(900);
    expect(parseDurationToSeconds('-5m')).toBe(900);
    expect(parseDurationToSeconds('15x')).toBe(900);
    expect(parseDurationToSeconds('', 60)).toBe(60);
  });
});
