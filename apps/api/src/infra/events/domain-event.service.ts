import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { NotificationType } from '@oa/shared';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface OutboxNotification {
  userId: number;
  type: NotificationType;
  title: string;
  content?: string;
  link?: string;
  level?: 'INFO' | 'WARN' | 'ERROR';
  /** 额外的渠道（邮件/IM 等，阶段 6 的适配器消费） */
  channel?: string;
}

export interface DomainEventInput {
  tenantId: number;
  /** 事件名，取自 shared 的 `WS_EVENTS`（前后端同一份常量） */
  eventType: string;
  /**
   * 聚合根类型。前四种是业务流程聚合；后几种是管理后台的配置聚合
   * （用户 / 角色 / 部门 / 工号 / 系统运维），它们同样必须留下审计。
   */
  aggregateType: 'INSTANCE' | 'NODE' | 'TASK' | 'ESCALATION' | 'USER' | 'ROLE' | 'DEPARTMENT' | 'WORKNO' | 'SYSTEM';
  aggregateId: number | string;
  payload?: Record<string, unknown>;
  /** 广播房间，取自 shared 的 `WS_ROOMS` */
  rooms?: string[];
  /** 需要落库的站内通知（解耦：业务只管声明"谁该收到什么"） */
  notifications?: OutboxNotification[];
  /** 审计内容（缺省时按事件名生成一条最小审计） */
  audit?: {
    actorId?: number | null;
    action: string;
    targetType: string;
    targetId: string | number;
    before?: unknown;
    after?: unknown;
    traceId?: string;
  };
}

/**
 * 领域事件出口（C9 的"四点式落库"里的审计 + 发件箱两点）。
 *
 * 为什么必须在**同一个事务**里写：状态改了但事件没发（或反过来）都会让系统自相矛盾。
 * Outbox 表在这里只是"收件箱"，真正投递（WS 广播 / 站内通知）由 OutboxDispatcher 负责，
 * 这样即使 Redis 或 WS 挂了，事件也不会丢，恢复后会补投。
 */
@Injectable()
export class DomainEventService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(tx: Tx, event: DomainEventInput): Promise<void> {
    const audit = event.audit;
    await tx.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorId: audit?.actorId ?? null,
        action: audit?.action ?? event.eventType,
        targetType: audit?.targetType ?? event.aggregateType,
        targetId: String(audit?.targetId ?? event.aggregateId),
        before: (audit?.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (audit?.after ?? event.payload) as Prisma.InputJsonValue | undefined,
        traceId: audit?.traceId ?? null,
      },
    });

    await tx.outboxEvent.create({
      data: {
        tenantId: event.tenantId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: String(event.aggregateId),
        payload: {
          rooms: event.rooms ?? [],
          notifications: event.notifications ?? [],
          data: event.payload ?? {},
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** 无事务场景（例如定时任务里的补记） */
  emitStandalone(event: DomainEventInput): Promise<void> {
    return this.prisma.runInTransaction((tx) => this.emit(tx, event));
  }
}
