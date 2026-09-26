import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

interface TraceRequest {
  headers?: Record<string, string | string[] | undefined>;
  traceId?: string;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // 全链路 traceId：优先用上游传的，便于和前端/网关日志对齐
  app.use((req: TraceRequest, _res: unknown, next: () => void) => {
    const header = req.headers?.['x-trace-id'];
    req.traceId = typeof header === 'string' && header.length > 0 ? header : randomUUID();
    next();
  });

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('CloudRail OA API')
    .setDescription('层级投票制 OA：投票 / 任务 / 上报')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[oa-api] listening on http://localhost:${port} （Swagger: /docs）`);
}

void bootstrap();
