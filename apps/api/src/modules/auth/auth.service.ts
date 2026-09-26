import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { LoginInput } from '@oa/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { verifyPassword } from '../../common/crypto/password';
import { AppError } from '../../common/errors/app-error';
import { parseDurationToSeconds } from '../../common/utils/duration';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { effectiveScope, mergePermissions } from '../../domain/rbac/effective-access';

/** 连续失败达到该次数即锁定账号 */
const MAX_FAILED_ATTEMPTS = 5;
/** 锁定时长（分钟） */
const LOCK_MINUTES = 15;
/** 具备该权限的上级部门成员可放大到上报链全部投票明细（B3） */
export const PERM_VOTE_VIEW_ALL = 'VOTE_VIEW_ALL';

/** 登录/刷新时一并取回的权限与组织信息（尽量一次查询取全，避免 N+1） */
const userAccessInclude = {
  departments: { include: { department: true } },
  roles: {
    include: {
      role: {
        include: { permissions: { include: { permission: true } } },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userAccessInclude }>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** 秒 */
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

export interface LoginResult {
  tokens: TokenPair;
  user: AuthenticatedUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  get accessSecret(): string {
    return this.readSecret('JWT_ACCESS_SECRET', 'oa-dev-access-secret');
  }

  get refreshSecret(): string {
    return this.readSecret('JWT_REFRESH_SECRET', 'oa-dev-refresh-secret');
  }

  /** 生产环境必须显式配置密钥：留着默认值上线等于没有签名保护 */
  private readSecret(key: string, devFallback: string): string {
    const value = this.config.get<string>(key);
    if (value && value.length >= 16) return value;
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw AppError.of('SYS_INTERNAL_ERROR', `生产环境缺少环境变量 ${key}`);
    }
    return devFallback;
  }

  private get tenantCode(): string {
    return this.config.get<string>('DEFAULT_TENANT_CODE') ?? 'demo';
  }

  /** 登录：租户 → 账号状态 → 口令校验（失败计数与锁定）→ 签发令牌 */
  async login(input: LoginInput): Promise<LoginResult> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { code: this.tenantCode, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!tenant) throw AppError.of('AUTH_INVALID_CREDENTIALS', '租户不存在或已停用');

    const user = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, email: input.email.trim().toLowerCase() },
      include: userAccessInclude,
    });
    if (!user) throw AppError.of('AUTH_INVALID_CREDENTIALS');
    if (user.status === 'DISABLED') throw AppError.of('AUTH_ACCOUNT_DISABLED');
    this.assertNotLocked(user.lockedUntil);

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      const lockedNow = await this.registerFailure(user.id, user.failedLoginCount);
      if (lockedNow) {
        throw AppError.of('AUTH_ACCOUNT_LOCKED', `连续失败 ${MAX_FAILED_ATTEMPTS} 次，已锁定 ${LOCK_MINUTES} 分钟`);
      }
      throw AppError.of('AUTH_INVALID_CREDENTIALS');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    const authenticated = this.toAuthenticatedUser(user);
    return { tokens: await this.issueTokens(authenticated), user: authenticated };
  }

  /**
   * 刷新令牌。本轮实现为**无状态 JWT 轮换**（每次刷新换发新的一对令牌）。
   *
   * 已知边界：schema 里还没有 `RefreshToken` 表，因此服务端无法列出/主动吊销某个刷新令牌，
   * 登出是客户端丢弃。要做到"单点登出 / 设备管理 / 盗用检测"，阶段 3 加
   * `RefreshToken { jti, userId, expiresAt, revokedAt, replacedByJti }` 表即可（见 README 的后续说明）。
   */
  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload: { sub?: number; tid?: number; typ?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: number; tid?: number; typ?: string }>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw AppError.of('AUTH_TOKEN_EXPIRED');
    }
    if (payload.typ !== 'refresh' || !payload.sub || !payload.tid) {
      throw AppError.of('AUTH_TOKEN_INVALID', '刷新令牌类型不正确');
    }

    const user = await this.buildAuthenticatedUser(payload.sub, payload.tid);
    return { tokens: await this.issueTokens(user), user };
  }

  /** 登出：无状态实现，仅作为客户端丢弃令牌的确认点 */
  logout(user: AuthenticatedUser): { revoked: boolean; userId: number; note: string } {
    return {
      revoked: false,
      userId: user.userId,
      note: '无状态 JWT：服务端未保存刷新令牌，客户端丢弃即可；主动吊销能力在阶段 3 加 RefreshToken 表后提供',
    };
  }

  /** 当前登录用户档案（对应 shared 的 currentUserSchema） */
  profile(user: AuthenticatedUser): {
    id: number;
    name: string;
    email: string;
    tenantId: number;
    deptIds: number[];
    primaryDeptId: number | null;
    roleCodes: string[];
    permissions: string[];
    scope: string;
  } {
    return {
      id: user.userId,
      name: user.name,
      email: user.email,
      tenantId: user.tenantId,
      deptIds: user.departments.map((d) => d.id),
      primaryDeptId: user.primaryDeptId,
      roleCodes: user.roleCodes,
      permissions: user.permissions,
      scope: user.scopeType,
    };
  }

  /**
   * 按 id 重建登录上下文（JWT 策略每个请求调用一次）。
   * 每次从库里取最新角色与部门，因此改了权限/调了部门立刻生效，不需要等令牌过期。
   */
  async buildAuthenticatedUser(userId: number, tenantId: number): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: userAccessInclude,
    });
    if (!user) throw AppError.of('AUTH_TOKEN_INVALID', '用户不存在或已被移除');
    if (user.status === 'DISABLED') throw AppError.of('AUTH_ACCOUNT_DISABLED');
    this.assertNotLocked(user.lockedUntil);
    return this.toAuthenticatedUser(user);
  }

  private assertNotLocked(lockedUntil: Date | null): void {
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      throw AppError.of('AUTH_ACCOUNT_LOCKED', `账号锁定至 ${lockedUntil.toISOString()}`);
    }
  }

  /** 记录一次失败；返回是否「本次触发锁定」 */
  private async registerFailure(userId: number, currentCount: number): Promise<boolean> {
    const nextCount = currentCount + 1;
    const shouldLock = nextCount >= MAX_FAILED_ATTEMPTS;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    return shouldLock;
  }

  private async issueTokens(user: AuthenticatedUser): Promise<TokenPair> {
    const accessExpiresIn = parseDurationToSeconds(this.config.get<string>('JWT_ACCESS_TTL') ?? '15m', 900);
    const refreshExpiresIn = parseDurationToSeconds(
      this.config.get<string>('JWT_REFRESH_TTL') ?? '7d',
      604800,
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: user.userId, tid: user.tenantId, typ: 'access' },
        { secret: this.accessSecret, expiresIn: accessExpiresIn, jwtid: randomUUID() },
      ),
      this.jwt.signAsync(
        { sub: user.userId, tid: user.tenantId, typ: 'refresh' },
        { secret: this.refreshSecret, expiresIn: refreshExpiresIn, jwtid: randomUUID() },
      ),
    ]);

    return { accessToken, refreshToken, accessExpiresIn, refreshExpiresIn };
  }

  private toAuthenticatedUser(user: UserWithAccess): AuthenticatedUser {
    const permissions = mergePermissions(
      user.roles.map((assignment) => assignment.role.permissions.map((rp) => rp.permission.code)),
    );
    const scope = effectiveScope(
      user.roles.map((assignment) => ({
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId ?? null,
      })),
      user.roles[0]?.role.dataScopeDefault ?? 'SELF',
    );
    const primary = user.departments.find((d) => d.isPrimary) ?? user.departments[0];

    return {
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
      name: user.name,
      departments: user.departments.map((d) => ({ id: d.department.id, path: d.department.path })),
      primaryDeptId: primary ? primary.department.id : null,
      scopeType: scope.scopeType,
      scopedDeptIds: scope.scopedDeptIds,
      // B3 的「在链上」判断在投票模块按具体实例再校验一次；这里只是权限层面的初筛
      escalationChainVisible: permissions.includes(PERM_VOTE_VIEW_ALL),
      roleCodes: user.roles.map((assignment) => assignment.role.code).sort(),
      permissions,
    };
  }
}
