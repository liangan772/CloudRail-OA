import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AdminAuditQuery } from './admin.dto';

/** 审计保留 3 年（F5），导出上限防止一次拉爆内存 */
const EXPORT_LIMIT = 10_000;

const AUDIT_SELECT = {
  id: true,
  createdAt: true,
  actorId: true,
  action: true,
  targetType: true,
  targetId: true,
  traceId: true,
  before: true,
  after: true,
  actor: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

/**
 * 审计表主键是 BigInt —— 它**不能**被 JSON.stringify（会直接抛 TypeError），
 * 所以对外一律转成字符串。审计量级下 id 精度没有问题，转字符串比转 Number 更稳妥。
 */
function toView(row: AuditRow) {
  return { ...row, id: row.id.toString() };
}

/**
 * 审计日志查询（F5：全量写操作记 before/after，含 ip/ua/traceId，保留 3 年）。
 *
 * 注意：审计是**只读**的。这里不提供任何修改/删除接口 —— 能改的审计等于没有审计。
 * 导出走 CSV 流式拼串，不引入 excel 依赖（单机部署取向 C8）。
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(query: AdminAuditQuery): Prisma.AuditLogWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) {
      const from = new Date(query.from);
      if (!Number.isNaN(from.getTime())) createdAt.gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      // 只给日期时把"当天"包含进来，否则用户会以为漏了最后一天的记录
      if (!Number.isNaN(to.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) to.setHours(23, 59, 59, 999);
        createdAt.lte = to;
      }
    }

    return {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(query.keyword
        ? {
            OR: [
              { action: { contains: query.keyword, mode: 'insensitive' } },
              { targetType: { contains: query.keyword, mode: 'insensitive' } },
              { targetId: { contains: query.keyword } },
              { traceId: { contains: query.keyword } },
            ],
          }
        : {}),
    };
  }

  async list(query: AdminAuditQuery) {
    const where = this.buildWhere(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: AUDIT_SELECT,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items: rows.map(toView), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(id: string) {
    const row = await this.prisma.auditLog.findUnique({ where: { id: BigInt(id) }, select: AUDIT_SELECT });
    return row ? toView(row) : null;
  }

  /** 筛选项字典：让前端下拉不用硬编码 */
  async facets() {
    // 用原生聚合而不是 Prisma 的 groupBy —— 后者的返回类型在 TS 下会退化成联合类型，
    // 取 `_count._all` 拿不到精确类型；这里只有两个只读聚合，直接 SQL 更清晰也更快。
    const [actionRows, targetRows, actors] = await Promise.all([
      this.prisma.$queryRaw<{ value: string; count: bigint }[]>`
        SELECT action AS value, COUNT(*)::bigint AS count
        FROM audit_logs
        GROUP BY action
        ORDER BY action ASC
        LIMIT 200
      `,
      this.prisma.$queryRaw<{ value: string; count: bigint }[]>`
        SELECT "targetType" AS value, COUNT(*)::bigint AS count
        FROM audit_logs
        GROUP BY "targetType"
        ORDER BY "targetType" ASC
        LIMIT 200
      `,
      this.prisma.user.findMany({
        where: { auditLogs: { some: {} } },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
        take: 200,
      }),
    ]);

    return {
      actions: actionRows.map((row) => ({ value: row.value, count: Number(row.count) })),
      targetTypes: targetRows.map((row) => ({ value: row.value, count: Number(row.count) })),
      actors,
    };
  }

  /** 导出 CSV（带 BOM，Excel 打开中文不乱码） */
  async exportCsv(query: AdminAuditQuery): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.buildWhere(query),
      orderBy: { id: 'desc' },
      take: EXPORT_LIMIT,
      select: AUDIT_SELECT,
    });

    const header = ['id', '时间', '操作人', '动作', '对象类型', '对象ID', 'traceId', '变更前', '变更后'];
    const lines = [header.map(csvCell).join(',')];

    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.createdAt.toISOString(),
          row.actor ? `${row.actor.name}<${row.actor.email}>` : '系统',
          row.action,
          row.targetType,
          row.targetId,
          row.traceId ?? '',
          row.before === null ? '' : JSON.stringify(row.before),
          row.after === null ? '' : JSON.stringify(row.after),
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return `\uFEFF${lines.join('\r\n')}`;
  }
}

/** CSV 单元转义：含逗号/引号/换行时整体加引号，内部引号翻倍 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
