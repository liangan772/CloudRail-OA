import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxHandlerRegistry, type OutboxEventView, type OutboxHandler } from './handler.registry';

/**
 * 站内通知消费者：把事件里声明的 `notifications` 落成 `Notification` 行。
 * 业务代码只声明"谁该收到什么"，渠道适配（邮件/IM）留给阶段 6。
 */
@Injectable()
export class NotificationsOutboxHandler implements OutboxHandler, OnModuleInit {
  readonly name = 'notifications';
  private readonly logger = new Logger(NotificationsOutboxHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
    private readonly config: ConfigService,
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

    // 站内通知之外，若配置了 IM Webhook 就再推一条摘要。
    // 关键：外发失败**不能影响发件箱状态**，否则一个 Webhook 挂掉会把站内通知也拖成重试。
    await this.pushWebhooks(event);
  }

  private async pushWebhooks(event: OutboxEventView): Promise<void> {
    const targets: { name: string; url: string; body: (text: string) => unknown }[] = [];
    const wecom = this.config.get<string>('WECOM_WEBHOOK');
    const dingtalk = this.config.get<string>('DINGTALK_WEBHOOK');
    const feishu = this.config.get<string>('FEISHU_WEBHOOK');

    if (wecom) targets.push({ name: '企业微信', url: wecom, body: (text) => ({ msgtype: 'text', text: { content: text } }) });
    if (dingtalk) targets.push({ name: '钉钉', url: dingtalk, body: (text) => ({ msgtype: 'text', text: { content: text } }) });
    if (feishu) targets.push({ name: '飞书', url: feishu, body: (text) => ({ msg_type: 'text', content: { text } }) });
    if (targets.length === 0) return;

    const text = `[CloudRail OA] ${event.notifications.map((item) => item.title).join('；')}`;

    await Promise.all(
      targets.map(async (target) => {
        try {
          const response = await fetch(target.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(target.body(text)),
          });
          if (!response.ok) this.logger.warn(`${target.name} Webhook 返回 ${response.status}`);
        } catch (error) {
          this.logger.warn(`${target.name} Webhook 推送失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  }
}
