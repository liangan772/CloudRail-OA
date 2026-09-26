import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';

interface TextResponse {
  type(contentType: string): void;
  send(body: string): void;
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: '健康检查（含依赖探活）' })
  async health() {
    let database = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      dependencies: { database },
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }

  @Public()
  @Get('metrics')
  @ApiOperation({ summary: '轻量指标（Prometheus 文本格式，不部署采集器）' })
  metrics(@Res() res: TextResponse) {
    const memory = process.memoryUsage();
    const lines = [
      '# HELP oa_process_uptime_seconds 进程运行时长',
      '# TYPE oa_process_uptime_seconds gauge',
      `oa_process_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP oa_process_heap_used_bytes 堆内存使用量',
      '# TYPE oa_process_heap_used_bytes gauge',
      `oa_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP oa_process_resident_bytes 常驻内存',
      '# TYPE oa_process_resident_bytes gauge',
      `oa_process_resident_bytes ${memory.rss}`,
    ];
    res.type('text/plain; version=0.0.4; charset=utf-8');
    res.send(`${lines.join('\n')}\n`);
  }
}
