import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppError } from '../../../common/errors/app-error';
import type { AuthenticatedUser } from '../../../common/context/authenticated-user';
import { AuthService } from '../auth.service';

export interface AccessTokenPayload {
  sub: number;
  tid: number;
  typ: 'access';
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? 'oa-dev-access-secret',
    });
  }

  /** 每个请求按 payload 重建上下文：权限/部门变更立即生效，不依赖令牌过期 */
  async validate(payload: Partial<AccessTokenPayload>): Promise<AuthenticatedUser> {
    if (payload.typ !== 'access' || !payload.sub || !payload.tid) {
      throw AppError.of('AUTH_TOKEN_INVALID', '访问令牌类型不正确');
    }
    return this.auth.buildAuthenticatedUser(payload.sub, payload.tid);
  }
}
