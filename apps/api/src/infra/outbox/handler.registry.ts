import { Injectable } from '@nestjs/common';

/** 一条待投递的 Outbox 事件（已解析 payload） */
export interface OutboxEventView {
  id: bigint;
  tenantId: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  rooms: string[];
  notifications: {
    userId: number;
    type: string;
    title: string;
    content?: string;
    link?: string;
    level?: string;
    channel?: string;
  }[];
  data: Record<string, unknown>;
}

/** Outbox 事件的消费者（WS 广播、站内通知、未来的邮件/IM） */
export interface OutboxHandler {
  name: string;
  handle(event: OutboxEventView): Promise<void>;
}

/**
 * 消费者的注册表。
 *
 * 用注册表而不是在 OutboxModule 里直接依赖 GatewayModule，是为了避免循环依赖：
 * GatewayModule 反过来依赖 OutboxModule（要用派发器），单向注册就没有环。
 */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers: OutboxHandler[] = [];

  register(handler: OutboxHandler): void {
    if (this.handlers.some((item) => item.name === handler.name)) return;
    this.handlers.push(handler);
  }

  list(): OutboxHandler[] {
    return [...this.handlers];
  }
}
