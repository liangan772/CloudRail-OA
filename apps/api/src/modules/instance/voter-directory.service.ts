import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/context/authenticated-user';
import type { VoterDirectory } from '../../domain/vote/voter-resolution';

/**
 * 投票人解析所需的候选数据装载（按租户一次性查全，避免逐条规则查库）。
 * 实例发起与后续层级推进都要用，所以独立成 provider，而不是塞进某个 service 的私有方法。
 */
@Injectable()
export class VoterDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async load(user: AuthenticatedUser, initiatorDeptId?: number | null): Promise<VoterDirectory> {
    const [departments, users, groups, workNoMembers] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where: { tenantId: user.tenantId, status: 'ACTIVE' },
        select: { id: true, parentId: true, path: true },
      }),
      this.prisma.user.findMany({
        where: { tenantId: user.tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          departments: { select: { departmentId: true, isLeader: true } },
          roles: { select: { role: { select: { code: true } } } },
        },
      }),
      this.prisma.voteGroup.findMany({
        where: { tenantId: user.tenantId },
        select: { code: true, members: { select: { userId: true, weight: true } } },
      }),
      this.prisma.departmentWorkNoMember.findMany({
        where: { tenantId: user.tenantId, status: 'ACTIVE' },
        select: { departmentId: true, userId: true, isPrimary: true },
      }),
    ]);

    const deptById = new Map(departments.map((d) => [d.id, d]));
    // INITIATOR_DEPT / PARENT_DEPT 都以「流程发起人所在部门」为基准，而不是当前操作人
    const baseDeptId = initiatorDeptId ?? user.primaryDeptId ?? null;
    const parentDeptId = baseDeptId != null ? deptById.get(baseDeptId)?.parentId ?? null : null;

    return {
      departments,
      users: users.map((item) => ({
        userId: item.id,
        deptIds: item.departments.map((d) => d.departmentId),
        leaderDeptIds: item.departments.filter((d) => d.isLeader).map((d) => d.departmentId),
        roleCodes: item.roles.map((assignment) => assignment.role.code),
      })),
      voteGroups: groups.map((group) => ({
        code: group.code,
        members: group.members.map((member) => ({ userId: member.userId, weight: Number(member.weight) })),
      })),
      workNoMembers,
      initiatorDeptId: baseDeptId,
      parentDeptId,
    };
  }
}
