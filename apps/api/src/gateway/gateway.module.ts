import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { EventsGateway } from './events.gateway';
import { WebSocketOutboxHandler } from './websocket-outbox.handler';

@Module({
  imports: [AuthModule],
  providers: [EventsGateway, WebSocketOutboxHandler],
  exports: [EventsGateway],
})
export class GatewayModule {}
