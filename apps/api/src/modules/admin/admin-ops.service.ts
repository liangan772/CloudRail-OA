import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainEventService } from '../../infra/events/domain-event.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import type { OutboxQuery } from './admin.dto';

const OUTBOX_SELECT = {
  id: true,
  eventType: true,
  aggregateType: true,
  aggregateId: true,
  status: true,
  retries: true,
  lastError: true,
  availableAt: true,
  lockedAt: true,
  processedAt: true,
  createdAt: true,
} satisfies Prisma.OutboxEventSelect;

/**
 * 运维监控。
 *
 * 三块内容：① 租户业务概览（管理员一进来要看到"系统里到底有多少东西"）
 * ② 发件箱健康度与人工重放（派发器卡住时的唯一补救手段）
 * ③ 后台任务与通知渠道的运行态（不引入 Prometheus，只暴露现状 —— C8/G5）。
 */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  /** 业务概览：一次事务里取全部计数，避免数字之间自相矛盾 */
  async overview(tenantId: number) {
    const [
      users,
      activeUsers,
      departments,
      workNos,
      roles,
      templates,
      instances,
      runningInstances,
      tasks,
      openTasks,
      overdueTasks,
      escalations,
      openEscalations,
      notifications,
      unreadNotifications,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { tenantId } }),
      this.prisma.user.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.department.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.department.count({ where: { tenantId, status: 'ACTIVE', workNo: { not: null } } }),
      this.prisma.role.count({ where: { tenantId } }),
      this.prisma.workflowTemplate.count({ where: { tenantId } }),
      this.prisma.workflowInstance.count({ where: { tenantId } }),
      this.prisma.workflowInstance.count({
        where: { tenantId, status: { in: ['VOTING', 'SUSPENDED', 'ESCALATED'] } },
      }),
      this.prisma.task.count({ where: { tenantId } }),
      this.prisma.task.count({ where: { tenantId, status: { notIn: ['DONE', 'CANCELLED'] } } }),
      this.prisma.task.count({
        where: { tenantId, status: { notIn: ['DONE', 'CANCELLED'] }, dueAt: { lt: new Date() } },
      }),
      this.prisma.escalation.count({ where: { tenantId } }),
      this.prisma.escalation.count({ where: { tenantId, status: { not: 'CLOSED' } } }),
      this.prisma.notification.count({ where: { tenantId } }),
      this.prisma.notification.count({ where: { tenantId, read: false } }),
    ]);

    const auditTotal = await this.prisma.auditLog.count({ where: { tenantId } });

    return {
      users: { total: users, active: activeUsers, disabled: users - activeUsers },
      departments: { total: departments, withWorkNo: workNos },
      roles,
      templates,
      instances: { total: instances, running: runningInstances },
      tasks: { total: tasks, open: openTasks, overdue: overdueTasks },
      escalations: { total: escalations, open: openEscalations },
      notifications: { total: notifications, unread: unreadNotifications },
      audit: { total: auditTotal },
    };
  }

  /** 运行态：后台任务模式 + 发件箱积压 + 通知渠道开关 */
  async runtime() {
    const status = await this.jobs.status();
    // 逐状态 count 而不是 groupBy：只有 5 个状态，语义直白且类型精确
    const [pending, processing, sent, failed, dead, oldestPending] = await this.prisma.$transaction([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'PROCESSING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'SENT' } }),
      this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, eventType: true },
      }),
    ]);

    return {
      jobs: { mode: status.mode, schedule: status.schedule },
      outbox: {
        pending,
        processing,
        sent,
        failed,
        dead,
        problem: failed + dead,
        oldestPendingAt: oldestPending?.createdAt ?? null,
        oldestPendingEvent: oldestPending?.eventType ?? null,
      },
      channels: {
        // 只报告"配没配"，不回显任何密钥
        wecom: Boolean(this.config.get<string>('WECOM_WEBHOOK')),
        dingtalk: Boolean(this.config.get<string>('DINGTALK_WEBHOOK')),
        feishu: Boolean(this.config.get<string>('FEISHU_WEBHOOK')),
        mail: Boolean(this.config.get<string>('MAIL_HOST')),
        sms: Boolean(this.config.get<string>('SMS_PROVIDER')),
      },
      storage: {
        driver: this.config.get<string>('STORAGE_DRIVER') ?? 'local',
        localDir: this.config.get<string>('STORAGE_LOCAL_DIR') ?? './data/uploads',
      },
      workerMode: this.config.get<string>('WORKER_MODE') ?? 'all',
    };
  }

  /** 发件箱列表：默认只看有问题的（FAILED/DEAD），排障时最常看这个 */
  async outbox(query: OutboxQuery) {
    const where: Prisma.OutboxEventWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword ? { eventType: { contains: query.keyword, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.outboxEvent.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: OUTBOX_SELECT,
      }),
      this.prisma.outboxEvent.count({ where }),
    ]);

    // id 是 BigInt，对外转字符串（JSON.stringify 不能处理 BigInt）
    return {
      items: rows.map((row) => ({ ...row, id: row.id.toString() })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 人工重放：把 FAILED/DEAD 置回 PENDING 并清空重试计数，交给派发器下一轮投递 */
  async replay(actor: AuthenticatedUser, ids: string[]) {
    const bigIds = ids.map((id) => BigInt(id));

    const result = await this.prisma.runInTransaction(async (tx) => {
      const targets = await tx.outboxEvent.findMany({
        where: { id: { in: bigIds } },
        select: { id: true, status: true, eventType: true, retries: true },
      });
      const replayable = targets.filter((row) => row.status === 'FAILED' || row.status === 'DEAD');

      if (replayable.length > 0) {
        await tx.outboxEvent.updateMany({
          where: { id: { in: replayable.map((row) => row.id) } },
          data: { status: 'PENDING', retries: 0, availableAt: new Date(), lockedAt: null, lastError: null },
        });
      }

      await this.events.emit(tx, {
        tenantId: actor.tenantId,
        eventType: 'ADMIN_OUTBOX_REPLAYED',
        aggregateType: 'SYSTEM',
        aggregateId: 0,
        payload: { requested: ids.length, replayed: replayable.length },
        audit: {
          actorId: actor.userId,
          action: 'OUTBOX_REPLAY',
          targetType: 'OUTBOX',
          targetId: ids.join(','),
          before: targets.map((row) => ({ id: row.id.toString(), status: row.status, retries: row.retries })),
          after: { replayed: replayable.map((row) => row.id.toString()) },
        },
      });

      return { requested: ids.length, replayed: replayable.length };
    });

    return result;
  }

  /** 手动跑一轮派发（不依赖定时器，排障时立刻见效） */
  async dispatchNow() {
    return this.jobs.run('outbox-dispatch');
  }
}
