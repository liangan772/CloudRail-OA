import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxHandlerRegistry, type OutboxEventView } from './handler.registry';

/** 超过该次数仍未投递成功就标 DEAD，避免坏事件永远占着队列 */
const MAX_RETRIES = 5;
/** 单批处理条数 */
const DEFAULT_BATCH = 50;

/**
 * 发件箱派发器：把 `OutboxEvent` 投递给各消费者（WS 广播 / 站内通知 / …）。
 *
 * 语义要点：
 * - **先认领再投递**：把 PENDING 改 PROCESSING + lockedAt，多实例并发时同一条只会被一个进程拿到；
 * - **失败退避重试**：retries++ 且 availableAt 往后推，超过 MAX_RETRIES 标 DEAD（可人工重放）；
 * - **幂等**：投递成功才标 SENT；重复投递最多让前端多收一条事件，不影响数据正确性。
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  async dispatchBatch(batchSize = DEFAULT_BATCH): Promise<{ claimed: number; sent: number; failed: number }> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', availableAt: { lte: new Date() } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    });
    if (pending.length === 0) return { claimed: 0, sent: 0, failed: 0 };

    const ids = pending.map((item) => item.id);
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'PROCESSING', lockedAt: new Date() },
    });

    const rows = await this.prisma.outboxEvent.findMany({
      where: { id: { in: ids }, status: 'PROCESSING' },
      orderBy: { id: 'asc' },
    });

    const handlers = this.registry.list();
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const view = this.toView(row);
      try {
        for (const handler of handlers) {
          await handler.handle(view);
        }
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: 'SENT', processedAt: new Date(), lastError: null },
        });
        sent += 1;
      } catch (error) {
        const retries = row.retries + 1;
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: retries >= MAX_RETRIES ? 'DEAD' : 'PENDING',
            retries,
            // 指数退避：2^retries 秒，最多 5 分钟
            availableAt: new Date(Date.now() + Math.min(2 ** retries * 1000, 300_000)),
            lastError: message.slice(0, 2000),
            lockedAt: null,
          },
        });
        failed += 1;
        this.logger.warn(`Outbox #${row.id}（${row.eventType}）投递失败：${message}`);
      }
    }

    return { claimed: claimed.count, sent, failed };
  }

  /** 待投递积压量（健康检查与告警用） */
  async backlog(): Promise<{ pending: number; dead: number }> {
    const [pending, dead] = await this.prisma.$transaction([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
    ]);
    return { pending, dead };
  }

  private toView(row: {
    id: bigint;
    tenantId: number;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Prisma.JsonValue;
  }): OutboxEventView {
    const payload = (row.payload ?? {}) as {
      rooms?: string[];
      notifications?: OutboxEventView['notifications'];
      data?: Record<string, unknown>;
    };
    return {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      rooms: payload.rooms ?? [],
      notifications: payload.notifications ?? [],
      data: payload.data ?? {},
    };
  }
}
