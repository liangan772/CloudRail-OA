import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxDispatcher } from '../../infra/outbox/outbox-dispatcher.service';
import { TaskService } from '../task/task.service';
import { TimeoutService } from '../timeout/timeout.service';

export type JobName = 'outbox-dispatch' | 'vote-timeout' | 'conclusion-timeout' | 'escalation-timeout';

export interface JobRunResult {
  job: JobName;
  tenants: number;
  results: unknown[];
}

/** 各任务的默认周期（毫秒） */
const SCHEDULE: Record<JobName, number> = {
  'outbox-dispatch': 5_000,
  'vote-timeout': 5 * 60_000,
  'conclusion-timeout': 5 * 60_000,
  'escalation-timeout': 5 * 60_000,
};

/**
 * 后台任务编排。
 *
 * 布署取向（C8：开发一条命令、生产一台机器）决定了这里必须是**双模式**：
 * - 配了可用 Redis → 走 BullMQ（多实例安全、可观测）；
 * - 没配或连不上 Redis → 退回**进程内定时器**，功能不降级（单机部署本来就不需要 broker）。
 * 两种模式跑的是同一个 `run()`，避免"队列里一套逻辑、兜底一套逻辑"。
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private timers: NodeJS.Timeout[] = [];

  mode: 'queue' | 'in-process' | 'stopped' = 'stopped';

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: OutboxDispatcher,
    private readonly timeouts: TimeoutService,
    private readonly tasks: TaskService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl && (await this.tryStartQueue(redisUrl))) return;
    this.startInProcess();
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
    this.mode = 'stopped';
  }

  /** 手动触发一次任务（运维排障与测试用；定时器与队列都走这里） */
  async run(job: JobName): Promise<JobRunResult> {
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    const results: unknown[] = [];

    for (const tenant of tenants) {
      switch (job) {
        case 'outbox-dispatch':
          results.push(await this.dispatcher.dispatchBatch());
          break;
        case 'vote-timeout':
          results.push(await this.timeouts.scanVoteTimeouts(tenant.id));
          break;
        case 'conclusion-timeout':
          results.push(await this.timeouts.scanConclusionTimeouts(tenant.id));
          break;
        case 'escalation-timeout':
          results.push(await this.timeouts.scanEscalationTimeouts(tenant.id));
          break;
      }
    }

    return { job, tenants: tenants.length, results };
  }

  async status(): Promise<{
    mode: string;
    schedule: Record<string, number>;
    outbox: { pending: number; dead: number };
  }> {
    return { mode: this.mode, schedule: SCHEDULE, outbox: await this.dispatcher.backlog() };
  }

  /* -------------------------------- 内部 -------------------------------- */

  private async tryStartQueue(redisUrl: string): Promise<boolean> {
    try {
      const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
      connection.on('error', (error) => this.logger.warn(`Redis 连接异常：${error.message}`));
      await connection.connect();
      // 2 秒内 PING 不通就当不可用，退回进程内模式（不然 BullMQ 会一直重连刷日志）
      const pong = await Promise.race([
        connection.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('PING 超时')), 2000)),
      ]);
      if (pong !== 'PONG') throw new Error('PING 未返回 PONG');

      this.connection = connection;
      this.queue = new Queue('oa-jobs', { connection });
      this.worker = new Worker(
        'oa-jobs',
        async (bullJob) => this.run(bullJob.name as JobName),
        { connection, concurrency: 1 },
      );
      this.worker.on('failed', (job, error) => this.logger.warn(`任务 ${job?.name} 失败：${error.message}`));

      for (const [name, every] of Object.entries(SCHEDULE)) {
        await this.queue.add(name, {}, { repeat: { every }, jobId: `oa:${name}`, removeOnComplete: 100 });
      }

      this.mode = 'queue';
      this.logger.log(`后台任务已启用 BullMQ 模式（Redis：${redisUrl.replace(/:[^:@]*@/, ':***@')}）`);
      return true;
    } catch (error) {
      this.logger.warn(
        `Redis 不可用（${error instanceof Error ? error.message : String(error)}），后台任务退回进程内定时器模式`,
      );
      return false;
    }
  }

  private startInProcess(): void {
    for (const [name, every] of Object.entries(SCHEDULE)) {
      const timer = setInterval(() => {
        void this.run(name as JobName).catch((error) =>
          this.logger.warn(`任务 ${name} 执行失败：${error instanceof Error ? error.message : String(error)}`),
        );
      }, every);
      timer.unref?.();
      this.timers.push(timer);
    }
    this.mode = 'in-process';
    this.logger.log('后台任务已启用进程内定时器模式（未配置或连不上 Redis）');
  }
}
