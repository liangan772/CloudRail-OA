import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** 单号类型 → 前缀 */
const PREFIX: Record<string, string> = {
  INSTANCE: 'OA',
  TASK: 'TK',
  ESCALATION: 'ES',
};

/**
 * 单号生成：走 `NumberSequence` 的原子自增，保证单机部署下不重复。
 * 流程实例与上报单共用，避免各自实现一份自增逻辑（两份必然漂移）。
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async next(tx: Prisma.TransactionClient, tenantId: number, type: string): Promise<string> {
    const sequence = await tx.numberSequence.upsert({
      where: { tenantId_type_period: { tenantId, type, period: 'GLOBAL' } },
      update: { nextValue: { increment: 1 } },
      create: { tenantId, type, period: 'GLOBAL', nextValue: 1 },
      select: { nextValue: true },
    });
    const now = new Date();
    const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `${PREFIX[type] ?? 'NO'}-${period}-${String(sequence.nextValue).padStart(4, '0')}`;
  }

  /** 无事务场景（只读试算等） */
  nextStandalone(tenantId: number, type: string): Promise<string> {
    return this.prisma.$transaction((tx) => this.next(tx, tenantId, type));
  }
}
