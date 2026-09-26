import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrgModule } from './modules/org/org.module';
import { WorkflowTemplateModule } from './modules/workflow-template/workflow-template.module';
import { InstanceModule } from './modules/instance/instance.module';
import { VoteModule } from './modules/vote/vote.module';
import { RuleModule } from './modules/rule/rule.module';
import { EscalationModule } from './modules/escalation/escalation.module';
import { TaskModule } from './modules/task/task.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationModule } from './modules/notification/notification.module';
import { GatewayModule } from './gateway/gateway.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { HealthController } from './modules/health/health.controller';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { DataScopeGuard } from './modules/auth/guards/data-scope.guard';

@Module({
  imports: [
    // 仓库根目录放 .env；CWD 在 apps/api 时用 ../../.env 兜底
    ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    // 审计 + 发件箱（全局）：C9 四点式落库的基础设施
    OutboxModule,
    AuthModule,
    OrgModule,
    WorkflowTemplateModule,
    InstanceModule,
    VoteModule,
    RuleModule,
    EscalationModule,
    TaskModule,
    JobsModule,
    NotificationModule,
    GatewayModule,
  ],
  controllers: [HealthController],
  providers: [
    // 三级链路：身份 → 权限点 → 数据范围（顺序不能变，后者依赖前者写入的上下文）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: DataScopeGuard },
  ],
})
export class AppModule {}
