import { EventsGateway } from './events.gateway';
import { AppError } from '../common/errors/app-error';

// WS 网关单测：不装 socket.io-client，用假 socket/server 验证鉴权、房间与广播语义。
function buildFake() {
  const joined: string[] = [];
  const emitted: { event: string; payload: unknown }[] = [];
  const socket = {
    data: {} as { user?: { userId: number; tenantId: number } },
    handshake: {
      auth: { token: 'good-token' } as Record<string, unknown>,
      headers: {} as Record<string, unknown>,
      query: {} as Record<string, unknown>,
    },
    join: jest.fn(async (room: string) => void joined.push(room)),
    emit: jest.fn((event: string, payload: unknown) => void emitted.push({ event, payload })),
    disconnect: jest.fn(),
  };
  const to = jest.fn(() => ({ emit: jest.fn() }));
  const auth = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token !== 'good-token') throw AppError.of('AUTH_TOKEN_INVALID', '令牌无效');
      return { sub: 3, tid: 1 };
    }),
    buildAuthenticatedUser: jest.fn(async () => ({
      userId: 3,
      tenantId: 1,
      departments: [{ id: 3, path: '/1/2/3/' }],
    })),
  };
  const prisma = {
    departmentWorkNoMember: {
      findMany: jest.fn(async () => [{ department: { workNo: 'D1003' } }, { department: { workNo: null } }]),
    },
  };
  const gateway = new EventsGateway(auth as never, prisma as never);
  gateway.server = { to } as never;
  return { gateway, socket, joined, emitted, to, auth };
}

describe('实时网关 · 连接与房间', () => {
  it('令牌有效时加入 本人 / 部门 / 所属工号 三类房间（上按工号投递，成员必须收得到）', async () => {
    const { gateway, socket, joined } = buildFake();

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(joined).toEqual(expect.arrayContaining(['user:3', 'dept:3', 'workno:D1003']));
    // workNo 为空的部门不产生房间
    expect(joined).not.toContain('workno:null');
    expect(socket.data.user).toEqual({ userId: 3, tenantId: 1 });
  });

  it('令牌无效时告知原因并断开连接', async () => {
    const { gateway, socket, emitted } = buildFake();
    socket.handshake.auth = { token: 'bad-token' };

    await gateway.handleConnection(socket as never);

    expect(emitted[0]!.event).toBe('unauthorized');
    expect((emitted[0]!.payload as { code: string }).code).toBe('AUTH_TOKEN_INVALID');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('缺失令牌时同样拒绝（不能让匿名连接挂在房间里）', async () => {
    const { gateway, socket } = buildFake();
    socket.handshake.auth = {};

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('实时网关 · 广播', () => {
  it('按房间广播事件', () => {
    const { gateway, to } = buildFake();
    gateway.broadcast(['instance:1', 'workno:D1001'], 'vote.cast', { decision: 'APPROVE' });
    expect(to).toHaveBeenCalledWith(['instance:1', 'workno:D1001']);
  });

  it('没有房间的事件不广播（只落库与通知）', () => {
    const { gateway, to } = buildFake();
    gateway.broadcast([], 'vote.cast', {});
    expect(to).not.toHaveBeenCalled();
  });
});
