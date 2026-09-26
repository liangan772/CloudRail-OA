import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry, type OutboxEventView, type OutboxHandler } from '../infra/outbox/handler.registry';
import { EventsGateway } from './events.gateway';

/** 把 Outbox 事件广播到实时通道（WS 是"四点式"里的最后一点） */
@Injectable()
export class WebSocketOutboxHandler implements OutboxHandler, OnModuleInit {
  readonly name = 'websocket';

  constructor(
    private readonly gateway: EventsGateway,
    private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEventView): Promise<void> {
    if (event.rooms.length === 0) return;
    this.gateway.broadcast(event.rooms, event.eventType, {
      event: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      at: new Date().toISOString(),
      ...event.data,
    });
  }
}
