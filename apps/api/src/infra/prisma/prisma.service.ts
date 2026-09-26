import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端生命周期封装。
 *
 * 约定（约束 C9）：所有状态变更都要走领域服务 + `$transaction`（AuditLog / OutboxEvent 同事务），
 * 业务代码里禁止出现裸的 `prisma.xxx.update({ data: { status } })`。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
