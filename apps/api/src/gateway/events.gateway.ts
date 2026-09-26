import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { WS_ROOMS } from '@oa/shared';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { AuthService } from '../modules/auth/auth.service';

/**
 * 只声明真正用到的 socket/server 形状，避免 import 'socket.io'。
 *
 * `socket.io` 目前是 `@nestjs/platform-socket.io` 的传递依赖（运行时可用），
 * 但没被声明为本包的直接依赖；这里用最小接口既能过类型检查，也不会假装有完整类型。
 */
interface SocketLike {
  data: { user?: { userId: number; tenantId: number } };
  handshake: {
    auth?: Record<string, unknown>;
    headers: Record<string, unknown>;
    query?: Record<string, unknown>;
  };
  join(room: string): Promise<void> | void;
  emit(event: string, payload: unknown): void;
  disconnect(close?: boolean): void;
}

interface ServerLike {
  to(rooms: string[]): { emit(event: string, payload: unknown): void };
}

/**
 * 实时通道（Socket.IO）。
 *
 * 房间语义与阶段 0 §G3 一致：`instance:{id}` / `workno:{工号}` / `user:{id}` / `dept:{id}`。
 * 连接时用访问令牌鉴权，并把用户自动加入"本人 + 其所属部门工号"的房间，
 * 所以业务侧只按房间广播，不需要知道"谁在线"。
 */
@WebSocketGateway({ namespace: 'ws', cors: { origin: true, credentials: true } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: ServerLike;

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: SocketLike): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) throw AppError.of('AUTH_TOKEN_INVALID', '缺少访问令牌');

      const payload = await this.auth.verifyAccessToken(token);
      const user = await this.auth.buildAuthenticatedUser(payload.sub, payload.tid);
      socket.data.user = { userId: user.userId, tenantId: user.tenantId };

      await socket.join(WS_ROOMS.user(user.userId));
      for (const dept of user.departments) await socket.join(WS_ROOMS.dept(dept.id));

      // 部门工号房间：上报单是投递给"工号"而不是个人（D3），
      // 所以工号成员必须能收到该工号房间的广播
      const memberships = await this.prisma.departmentWorkNoMember.findMany({
        where: { tenantId: user.tenantId, userId: user.userId, status: 'ACTIVE' },
        select: { department: { select: { workNo: true } } },
      });
      for (const item of memberships) {
        if (item.department.workNo) await socket.join(WS_ROOMS.workno(item.department.workNo));
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'AUTH_TOKEN_INVALID';
      socket.emit('unauthorized', { code, message: error instanceof Error ? error.message : '连接鉴权失败' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: SocketLike): void {
    const userId = socket.data.user?.userId;
    if (userId) this.logger.debug(`用户 ${userId} 断开实时连接`);
  }

  /** 按房间广播；没有房间的事件只落库与通知，不广播 */
  broadcast(rooms: readonly string[], eventType: string, payload: unknown): void {
    if (rooms.length === 0 || !this.server) return;
    this.server.to([...rooms]).emit(eventType, payload);
  }

  private extractToken(socket: SocketLike): string | null {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);

    const query = socket.handshake.query?.['token'];
    return typeof query === 'string' && query.length > 0 ? query : null;
  }
}
