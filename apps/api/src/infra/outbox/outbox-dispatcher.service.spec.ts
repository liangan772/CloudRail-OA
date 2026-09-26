import { OutboxDispatcher } from './outbox-dispatcher.service';
import type { OutboxHandler } from './handler.registry';

// 发件箱派发器单测（假仓储）：重点覆盖失败退避重试与超上限转死信。
interface FakeRow {
  id: bigint;
  tenantId: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  status: string;
  retries: number;
  availableAt: Date;
  lastError?: string | null;
}

function buildFake(initialRetries = 0) {
  const rows: FakeRow[] = [
    {
      id: 1n,
      tenantId: 1,
      eventType: 'vote.cast',
      aggregateType: 'NODE',
      aggregateId: '9',
      payload: { rooms: ['instance:1'], notifications: [], data: { decision: 'APPROVE' } },
      status: 'PENDING',
      retries: initialRetries,
      availableAt: new Date(Date.now() - 1000),
      lastError: null,
    },
  ];

  const prisma = {
    outboxEvent: {
      findMany: jest.fn(async (args: { select?: unknown }) =>
        args.select
          ? rows.filter((row) => row.status === 'PENDING').map((row) => ({ id: row.id }))
          : rows.filter((row) => row.status === 'PROCESSING'),
      ),
      updateMany: jest.fn(async ({ where }: { where: { id: { in: bigint[] } } }) => {
        let count = 0;
        for (const row of rows) {
          if (where.id.in.includes(row.id) && row.status === 'PENDING') {
            row.status = 'PROCESSING';
            count += 1;
          }
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
        const row = rows.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      count: jest.fn(async ({ where }: { where: { status: string } }) =>
        rows.filter((row) => row.status === where.status).length,
      ),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
  };

  const handlers: OutboxHandler[] = [];
  const registry = { list: () => handlers, register: (handler: OutboxHandler) => handlers.push(handler) };
  return { prisma, rows, handlers, dispatcher: new OutboxDispatcher(prisma as never, registry as never) };
}

describe('发件箱派发器 · 正常投递', () => {
  it('认领 PENDING → 交给消费者 → 标记 SENT，并把 payload 展开给消费者', async () => {
    const { dispatcher, rows, handlers } = buildFake();
    const seen: unknown[] = [];
    handlers.push({ name: 'spy', handle: async (event) => void seen.push(event) });

    const result = await dispatcher.dispatchBatch();

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(rows[0]!.status).toBe('SENT');
    expect(seen[0]).toMatchObject({ eventType: 'vote.cast', rooms: ['instance:1'], data: { decision: 'APPROVE' } });
  });

  it('没有待投递事件时不做任何事', async () => {
    const { dispatcher, rows } = buildFake();
    rows[0]!.status = 'SENT';
    expect(await dispatcher.dispatchBatch()).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });
});

describe('发件箱派发器 · 失败处理', () => {
  it('消费者抛错：退回 PENDING 并指数退避，错误写入 lastError', async () => {
    const { dispatcher, rows, handlers } = buildFake();
    handlers.push({
      name: 'boom',
      handle: async () => {
        throw new Error('WS 未就绪');
      },
    });

    const result = await dispatcher.dispatchBatch();

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(rows[0]!.status).toBe('PENDING');
    expect(rows[0]!.retries).toBe(1);
    expect(rows[0]!.lastError).toContain('WS 未就绪');
    expect(rows[0]!.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('连续失败到上限后转入 DEAD，避免坏事件永远占队列', async () => {
    const { dispatcher, rows, handlers } = buildFake(4);
    handlers.push({
      name: 'boom',
      handle: async () => {
        throw new Error('永久失败');
      },
    });

    await dispatcher.dispatchBatch();

    expect(rows[0]!.status).toBe('DEAD');
    expect(rows[0]!.retries).toBe(5);
  });

  it('backlog 分别统计待投递与死信', async () => {
    const { dispatcher, rows } = buildFake();
    rows.push({ ...rows[0]!, id: 2n, status: 'DEAD' });
    expect(await dispatcher.backlog()).toEqual({ pending: 1, dead: 1 });
  });
});
