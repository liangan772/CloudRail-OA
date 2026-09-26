import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { AdminRoleController } from './admin-role.controller';
import { AdminRoleService } from './admin-role.service';
import { AdminOrgController } from './admin-org.controller';
import { AdminOrgService } from './admin-org.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';

/**
 * 管理后台。
 *
 * 五个控制器按聚合拆开，各自声明所需权限点（`@RequirePermissions`）：
 *   users → USER_MANAGE / roles → ROLE_MANAGE / org+worknos → ORG_MANAGE·DEPT_WORKNO_MANAGE
 *   audit → AUDIT_READ（导出另需 AUDIT_EXPORT）/ ops → SYS_MONITOR
 *
 * 与 org 模块的分工：org 是"给所有登录用户用的只读选择器"（按数据范围裁剪），
 * admin 是"给管理员用的读写管理台"（按权限点放行、不做数据范围裁剪）。
 * 所有写操作都经 DomainEventService 在**同一事务**内落审计与发件箱（C9）。
 */
@Module({
  imports: [JobsModule],
  controllers: [
    AdminUserController,
    AdminRoleController,
    AdminOrgController,
    AdminAuditController,
    AdminOpsController,
  ],
  providers: [AdminUserService, AdminRoleService, AdminOrgService, AdminAuditService, AdminOpsService],
  exports: [AdminUserService, AdminRoleService, AdminOrgService],
})
export class AdminModule {}
