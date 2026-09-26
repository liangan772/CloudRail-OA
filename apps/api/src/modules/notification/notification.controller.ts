import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationQuerySchema } from '@oa/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import { PrismaService } from '../../infra/prisma/prisma.service';

const listQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().optional(),
});

@ApiTags('notification')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '我的站内通知' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: { page: number; pageSize: number; unreadOnly?: boolean },
  ) {
    const where = {
      tenantId: user.tenantId,
      userId: user.userId,
      ...(query.unreadOnly ? { read: false } : {}),
    };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { tenantId: user.tenantId, userId: user.userId, read: false } }),
    ]);
    return { items, total, unread, page: query.page, pageSize: query.pageSize };
  }

  @Post(':id/read')
  @ApiOperation({ summary: '标记通知已读' })
  async read(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseIntPipe) id: number) {
    await this.prisma.notification.updateMany({
      where: { id, tenantId: user.tenantId, userId: user.userId },
      data: { read: true, readAt: new Date() },
    });
    return { id, read: true };
  }

  @Post('read-all')
  @ApiOperation({ summary: '全部标记已读' })
  async readAll(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId: user.tenantId, userId: user.userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { updated: result.count };
  }
}
