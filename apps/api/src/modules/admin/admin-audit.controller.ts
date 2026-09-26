import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { AdminAuditService } from './admin-audit.service';
import { adminAuditQuerySchema, type AdminAuditQuery } from './admin.dto';

@ApiTags('admin')
@Controller('admin/audit')
@RequirePermissions('AUDIT_READ')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({ summary: '审计日志列表（按操作人 / 动作 / 对象 / 时间筛选）' })
  list(@Query(new ZodValidationPipe(adminAuditQuerySchema)) query: AdminAuditQuery) {
    return this.audit.list(query);
  }

  @Get('facets')
  @ApiOperation({ summary: '筛选项字典（已有动作 / 对象类型 / 操作人）' })
  facets() {
    return this.audit.facets();
  }

  @Get(':id')
  @ApiOperation({ summary: '审计详情（含 before/after 全量快照）' })
  detail(@Param('id') id: string) {
    return this.audit.detail(id);
  }

  /**
   * 导出 CSV。
   *
   * 这里**不**直接吐 `text/csv` 流：全局响应拦截器会给所有返回值套 `{code,data,...}`，
   * 绕过它就要手写 `@Res()` 并自己负责头与错误处理。改成返回内容由前端落盘更省事，
   * 也让"导出失败"能和其它接口一样走统一错误码。
   */
  @Post('export')
  @RequirePermissions('AUDIT_EXPORT')
  @ApiOperation({ summary: '导出审计 CSV（返回文件内容，由前端保存）' })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminAuditQuerySchema)) query: AdminAuditQuery,
  ) {
    void user;
    const content = await this.audit.exportCsv(query);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return { filename: `audit-${stamp}.csv`, content, rows: content.split('\r\n').length - 1 };
  }
}
