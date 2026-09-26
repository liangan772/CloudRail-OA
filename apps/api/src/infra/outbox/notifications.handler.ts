import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxHandlerRegistry, type OutboxEventView, type OutboxHandler } from './handler.registry';

/**
 * 站内通知消费者：把事件里声明的 `notifications` 落成 `Notification` 行。
 * 业务代码只声明"谁该收到什么"，渠道适配（邮件/IM）留给阶段 6。
 */
@Injectable()
export class NotificationsOutboxHandler implements OutboxHandler, OnModuleInit {
  readonly name = 'notifications';

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEventView): Promise<void> {
    if (event.notifications.length === 0) return;
    await this.prisma.notification.createMany({
      data: event.notifications.map((item) => ({
        tenantId: event.tenantId,
        userId: item.userId,
        type: item.type as never,
        title: item.title.slice(0, 200),
        content: item.content ?? null,
        link: item.link ?? null,
        level: item.level ?? 'INFO',
        channel: item.channel ?? 'INAPP',
        payload: { eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId },
      })),
    });
  }
}
