import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PrismaService } from './infra/prisma/prisma.service';

/**
 * 装配冒烟测试：**不需要真实数据库**。
 *
 * 目的是把「Nest 模块图能不能装配起来」和「三级守卫链路顺序对不对」变成可回归的断言，
 * 而不是等真连上库才发现漏了 provider 或守卫顺序颠倒。
 * PrismaService 用内存替身覆盖，`$connect` 不会真的建连接。
 */
const prismaStub = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  $transaction: jest.fn().mockResolvedValue([]),
};

describe('应用装配冒烟（不连数据库）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AppExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health 返回统一响应封装，且依赖探活走 $queryRaw', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.code).toBe('OK');
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.dependencies.database).toBe('up');
    expect(prismaStub.$queryRaw).toHaveBeenCalled();
  });

  it('未带令牌访问受保护接口 → 401 AUTH_TOKEN_INVALID（身份守卫生效）', async () => {
    const res = await request(app.getHttpServer()).get('/org/departments').expect(401);
    expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
    expect(res.body.data).toBeNull();
  });

  it('带无效令牌同样被拒（不会漏到业务层）', async () => {
    const res = await request(app.getHttpServer())
      .get('/org/departments')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('登录接口是公开的：参数不合法时返回 400 校验错误（而不是 401）', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: '123' })
      .expect(400);
    expect(res.body.code).toBe('SYS_VALIDATION_FAILED');
  });

  it('GET /metrics 返回 Prometheus 文本而不是 JSON 封装', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('oa_process_uptime_seconds');
    expect(res.text.startsWith('# HELP')).toBe(true);
  });
});
