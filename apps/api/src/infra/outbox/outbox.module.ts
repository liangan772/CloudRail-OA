import { Global, Module } from '@nestjs/common';
import { DomainEventService } from '../events/domain-event.service';
import { OutboxHandlerRegistry } from './handler.registry';
import { NotificationsOutboxHandler } from './notifications.handler';
import { OutboxDispatcher } from './outbox-dispatcher.service';

@Global()
@Module({
  providers: [DomainEventService, OutboxHandlerRegistry, OutboxDispatcher, NotificationsOutboxHandler],
  exports: [DomainEventService, OutboxHandlerRegistry, OutboxDispatcher],
})
export class OutboxModule {}
