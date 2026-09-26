import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Prisma 客户端生命周期封装。
 *
 * 约定（约束 C9）：所有状态变更都要走领域服务 + `$transaction`（AuditLog / OutboxEvent 同事务），
 * 业务代码里禁止出现裸的 `prisma.xxx.update({ data: { status } })`。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * 交互式事务参数。
   *
   * Prisma 默认超时只有 5 秒，而本项目的"写事务"往往要跑十几条语句
   * （例如人工结论 → 开下一层：查模板版本、装载投票人目录、建节点与快照、回写实例）。
   * 一旦数据库在远端（哪怕只有几十毫秒 RTT），默认 5 秒就会以
   * `Transaction already closed` 失败 —— 这在本地 docker 上几乎复现不出来。
   */
  readonly txOptions = { maxWait: 10_000, timeout: 30_000 } as const;

  constructor() {
    super({ log: ['warn', 'error'] });
  }

  /**
   * 带宽松超时的交互式事务。所有"写事务"都走这里，避免各处手写超时参数（也容易漏改）。
   */
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn, this.txOptions);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
