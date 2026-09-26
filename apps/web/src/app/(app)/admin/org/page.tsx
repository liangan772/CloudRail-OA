'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronRight, CornerDownRight, Pencil, Plus, Star, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api } from '@/lib/api-client';
import { errorText, runAction } from '@/lib/action';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';

interface AdminDept {
  id: number;
  parentId: number | null;
  name: string;
  code: string | null;
  path: string;
  level: number;
  sort: number;
  workNo: string | null;
  status: 'ACTIVE' | 'DISABLED';
  managerId: number | null;
  managerName: string | null;
  memberCount: number;
  childrenCount: number;
  workNoMemberCount: number;
}

interface WorkNoRow {
  departmentId: number;
  departmentName: string;
  path: string;
  level: number;
  workNo: string | null;
  primaryUserId: number | null;
  members: { userId: number; name: string; email: string; isPrimary: boolean }[];
}

interface OrgUser {
  id: number;
  name: string;
  email: string;
}

const EMPTY_DEPT = { name: '', code: '', parentId: '', workNo: '', sort: '0' };

export default function AdminOrgPage() {
  const { can } = useSession();
  const canManageDept = can('ORG_MANAGE');
  const canManageWorkNo = can('DEPT_WORKNO_MANAGE');

  const [tab, setTab] = useState<'dept' | 'workno'>('dept');
  const { data: departments, isLoading, mutate: mutateDepts } = useSWR<AdminDept[]>('/admin/departments?includeDisabled=true');
  const { data: workNos, mutate: mutateWorkNos } = useSWR<WorkNoRow[]>('/admin/worknos?includeDisabled=true');
  const { data: users } = useSWR<{ items: OrgUser[] }>('/org/users?page=1&pageSize=100');

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [deptFormOpen, setDeptFormOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<AdminDept | null>(null);
  const [deptForm, setDeptForm] = useState(EMPTY_DEPT);
  const [deptError, setDeptError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteDept, setDeleteDept] = useState<AdminDept | null>(null);

  const [workNoTarget, setWorkNoTarget] = useState<WorkNoRow | null>(null);
  const [workNoDraft, setWorkNoDraft] = useState('');
  const [memberDraft, setMemberDraft] = useState('');

  const byParent = useMemo(() => {
    const map = new Map<number | null, AdminDept[]>();
    for (const dept of departments ?? []) {
      const key = dept.parentId;
      map.set(key, [...(map.get(key) ?? []), dept]);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id);
    return map;
  }, [departments]);

  const openCreateDept = (parent: AdminDept | null) => {
    setEditingDept(null);
    setDeptForm({ ...EMPTY_DEPT, parentId: parent ? String(parent.id) : '' });
    setDeptError('');
    setDeptFormOpen(true);
  };

  const openEditDept = (dept: AdminDept) => {
    setEditingDept(dept);
    setDeptForm({
      name: dept.name,
      code: dept.code ?? '',
      parentId: String(dept.parentId ?? ''),
      workNo: dept.workNo ?? '',
      sort: String(dept.sort),
    });
    setDeptError('');
    setDeptFormOpen(true);
  };

  const submitDept = async () => {
    if (!deptForm.name.trim()) {
      setDeptError('部门名称必填');
      return;
    }
    setSubmitting(true);
    const payload = {
      name: deptForm.name.trim(),
      code: deptForm.code.trim() || undefined,
      workNo: deptForm.workNo.trim() || null,
      sort: Number(deptForm.sort) || 0,
    };

    // 新建与编辑分开：新建允许指定上级，编辑改上级走独立的 move 接口（要重写子树路径）
    const result = editingDept
      ? await runAction(() => api.patch(`/admin/departments/${editingDept.id}`, payload), { success: '部门已更新' })
      : await runAction(
          () =>
            api.post('/admin/departments', {
              ...payload,
              parentId: deptForm.parentId ? Number(deptForm.parentId) : null,
            }),
          { success: '部门已创建' },
        );

    if (result.ok && editingDept && deptForm.parentId !== String(editingDept.parentId ?? '')) {
      const moved = await runAction(
        () => api.post(`/admin/departments/${editingDept.id}/move`, { parentId: deptForm.parentId ? Number(deptForm.parentId) : null }),
        { success: '部门层级已调整' },
      );
      if (!moved.ok) setDeptError(errorText(moved.error));
    }

    setSubmitting(false);
    if (result.ok) {
      setDeptFormOpen(false);
      void mutateDepts();
      void mutateWorkNos();
    } else {
      setDeptError(errorText(result.error));
    }
  };

  const removeDept = async () => {
    if (!deleteDept) return;
    const result = await runAction(() => api.delete(`/admin/departments/${deleteDept.id}`), { success: '部门已删除' });
    if (result.ok) {
      void mutateDepts();
      void mutateWorkNos();
    }
  };

  const saveWorkNo = async () => {
    if (!workNoTarget) return;
    const result = await runAction(
      () => api.post(`/admin/worknos/${workNoTarget.departmentId}`, { workNo: workNoDraft.trim() || null }),
      { success: '工号已保存' },
    );
    if (result.ok) {
      setWorkNoTarget(null);
      void mutateWorkNos();
      void mutateDepts();
    }
  };

  const addMember = async () => {
    if (!workNoTarget || !memberDraft) return;
    const result = await runAction(
      () => api.post(`/admin/worknos/${workNoTarget.departmentId}/members`, { userId: Number(memberDraft) }),
      { success: '成员已添加' },
    );
    if (result.ok) {
      setMemberDraft('');
      void mutateWorkNos();
    }
  };

  const removeMember = async (departmentId: number, userId: number) => {
    const result = await runAction(() => api.delete(`/admin/worknos/${departmentId}/members/${userId}`), { success: '成员已移除' });
    if (result.ok) void mutateWorkNos();
  };

  const setPrimary = async (departmentId: number, userId: number) => {
    const result = await runAction(() => api.post(`/admin/worknos/${departmentId}/primary/${userId}`, {}), { success: '主责人已更新' });
    if (result.ok) void mutateWorkNos();
  };

  const renderTree = (parentId: number | null, depth = 0) => {
    const nodes = byParent.get(parentId) ?? [];
    if (nodes.length === 0) return null;

    return (
      <ul className={cn('space-y-0.5', depth > 0 && 'ml-4 border-l pl-3')}>
        {nodes.map((dept) => {
          const hasChildren = (byParent.get(dept.id) ?? []).length > 0;
          const isCollapsed = collapsed.has(dept.id);
          return (
            <li key={dept.id}>
              <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
                <button
                  type="button"
                  className={cn('oa-icon-button h-5 w-5 shrink-0', !hasChildren && 'invisible')}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(dept.id)) next.delete(dept.id);
                      else next.add(dept.id);
                      return next;
                    })
                  }
                  aria-label={isCollapsed ? '展开' : '折叠'}
                >
                  <ChevronRight className={cn('h-3 w-3 transition-transform', !isCollapsed && 'rotate-90')} />
                </button>

                <span className={cn('truncate text-sm', dept.status === 'DISABLED' && 'text-muted-foreground line-through')}>
                  {dept.name}
                </span>
                {dept.workNo ? <span className="shrink-0 rounded bg-[hsl(var(--surface))] px-1.5 py-0.5 font-mono text-2xs">{dept.workNo}</span> : null}
                {dept.managerName ? (
                  <span className="shrink-0 text-2xs text-muted-foreground">负责人 {dept.managerName}</span>
                ) : null}
                <span className="shrink-0 text-2xs text-muted-foreground tabular">
                  {dept.memberCount} 人{dept.childrenCount > 0 ? ` · ${dept.childrenCount} 下级` : ''}
                </span>
                {dept.status === 'DISABLED' ? <StatusBadge status="DISABLED" label="已停用" /> : null}

                {canManageDept ? (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Tooltip content="新增下级部门">
                      <button type="button" className="oa-icon-button h-6 w-6" onClick={() => openCreateDept(dept)}>
                        <CornerDownRight className="h-3 w-3" />
                      </button>
                    </Tooltip>
                    <Tooltip content="编辑">
                      <button type="button" className="oa-icon-button h-6 w-6" onClick={() => openEditDept(dept)}>
                        <Pencil className="h-3 w-3" />
                      </button>
                    </Tooltip>
                    <Tooltip content="删除">
                      <button type="button" className="oa-icon-button h-6 w-6 text-danger" onClick={() => setDeleteDept(dept)}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Tooltip>
                  </span>
                ) : null}
              </div>

              {hasChildren && !isCollapsed ? renderTree(dept.id, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const workNoRows = (workNos ?? []).filter((row) => row.workNo);
  const memberOptions = (users?.items ?? []).filter(
    (user) => !(workNoTarget?.members ?? []).some((member) => member.userId === user.id),
  );

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'dept', label: '部门', count: departments?.length },
          { value: 'workno', label: '部门工号', count: workNoRows.length },
        ]}
      />

      {tab === 'dept' ? (
        <Card
          pad={false}
          title="部门树"
          description="层级由物化路径维护，调整上级会自动重写整棵子树"
          actions={
            canManageDept ? (
              <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openCreateDept(null)}>
                新建部门
              </Button>
            ) : null
          }
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-7 w-full" />
              ))}
            </div>
          ) : (departments ?? []).length === 0 ? (
            <EmptyState title="还没有部门" description="部门是投票人与上报链路的基础，建议先建出组织层级。" />
          ) : (
            <div className="p-2">{renderTree(null)}</div>
          )}
        </Card>
      ) : (
        <Card pad={false} title="部门工号" description="上报投递到上级部门的工号；工号成员即该级投票人，各持 1 票">
          {workNoRows.length === 0 ? (
            <EmptyState
              title="还没有配置工号"
              description="没有工号的部门无法作为上报目标。到「部门」页给每个部门设置工号。"
            />
          ) : (
            <ul className="divide-y">
              {workNoRows.map((row) => (
                <li key={row.departmentId} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{row.workNo}</span>
                    <span className="text-sm">{row.departmentName}</span>
                    <span className="text-2xs text-muted-foreground">L{row.level}</span>
                    {canManageWorkNo ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        icon={<Pencil className="h-3 w-3" />}
                        onClick={() => {
                          setWorkNoTarget(row);
                          setWorkNoDraft(row.workNo ?? '');
                          setMemberDraft('');
                        }}
                      >
                        管理成员
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.members.length === 0 ? (
                      <span className="text-xs text-warning">尚无成员 —— 该工号不会产生投票人，上报会按 onMissingWorkNo 策略处理</span>
                    ) : (
                      row.members.map((member) => (
                        <span
                          key={member.userId}
                          className={cn(
                            'oa-chip',
                            member.isPrimary ? 'border-primary/20 bg-primary-subtle text-primary' : 'border-border bg-muted text-muted-foreground',
                          )}
                        >
                          {member.isPrimary ? <Star className="h-3 w-3" /> : null}
                          {member.name}
                        </span>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* 部门表单 */}
      <Modal
        open={deptFormOpen}
        onClose={() => setDeptFormOpen(false)}
        title={editingDept ? `编辑 ${editingDept.name}` : '新建部门'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeptFormOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button variant="primary" loading={submitting} onClick={submitDept}>
              {editingDept ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {deptError ? (
            <div className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-xs text-danger">{deptError}</div>
          ) : null}
          <Field label="部门名称" required>
            <input className="oa-input" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="部门编码" hint="可选，用于外部系统对接">
              <input className="oa-input font-mono" value={deptForm.code} onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })} />
            </Field>
            <Field label="部门工号" hint="上报投递目标，全租户唯一">
              <input className="oa-input font-mono" value={deptForm.workNo} onChange={(e) => setDeptForm({ ...deptForm, workNo: e.target.value })} />
            </Field>
            <Field label="上级部门">
              <select className="oa-input" value={deptForm.parentId} onChange={(e) => setDeptForm({ ...deptForm, parentId: e.target.value })}>
                <option value="">（根部门）</option>
                {(departments ?? [])
                  .filter((dept) => !editingDept || (dept.id !== editingDept.id && !dept.path.startsWith(editingDept.path)))
                  .map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {'　'.repeat(Math.max(dept.level - 1, 0))}
                      {dept.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="排序">
              <input
                className="oa-input"
                type="number"
                value={deptForm.sort}
                onChange={(e) => setDeptForm({ ...deptForm, sort: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* 工号成员管理 */}
      <Modal
        open={Boolean(workNoTarget)}
        onClose={() => setWorkNoTarget(null)}
        title={`工号 ${workNoTarget?.workNo ?? ''} · ${workNoTarget?.departmentName ?? ''}`}
        description="成员即该级投票人；主责人只决定默认谁填结论"
        width="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWorkNoTarget(null)}>
              关闭
            </Button>
            <Button variant="primary" onClick={saveWorkNo}>
              保存工号
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="工号" hint="清空则取消该部门的工号（它将不再能作为上报目标）">
            <input className="oa-input font-mono" value={workNoDraft} onChange={(event) => setWorkNoDraft(event.target.value)} />
          </Field>

          <div className="oa-divider" />

          <div>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">成员（{(workNoTarget?.members ?? []).length}）</h3>
            {(workNoTarget?.members ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">还没有成员</p>
            ) : (
              <ul className="space-y-1.5">
                {(workNoTarget?.members ?? []).map((member) => (
                  <li key={member.userId} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm">
                        {member.name}
                        {member.isPrimary ? <span className="oa-chip border-primary/20 bg-primary-subtle text-primary">主责</span> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                    </span>
                    {!member.isPrimary ? (
                      <Tooltip content="设为主责人">
                        <button
                          type="button"
                          className="oa-icon-button h-7 w-7"
                          onClick={() => setPrimary(workNoTarget!.departmentId, member.userId)}
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    ) : null}
                    <Tooltip content="移除成员">
                      <button
                        type="button"
                        className="oa-icon-button h-7 w-7 text-danger"
                        onClick={() => removeMember(workNoTarget!.departmentId, member.userId)}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Field label="添加成员" className="flex-1">
              <select className="oa-input" value={memberDraft} onChange={(event) => setMemberDraft(event.target.value)}>
                <option value="">选择用户…</option>
                {memberOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}（{user.email}）
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="secondary" icon={<UserPlus className="h-3.5 w-3.5" />} disabled={!memberDraft} onClick={addMember}>
              添加
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteDept)}
        title={`删除部门「${deleteDept?.name ?? ''}」`}
        description={
          deleteDept && (deleteDept.childrenCount > 0 || deleteDept.memberCount > 0)
            ? `该部门还有 ${deleteDept.childrenCount} 个下级、${deleteDept.memberCount} 名成员，删除会被拒绝。请先处理干净。`
            : '删除后不可恢复。该部门的工号与工号成员配置会一并清除。'
        }
        confirmText="确认删除"
        danger
        onConfirm={removeDept}
        onClose={() => setDeleteDept(null)}
      />
    </div>
  );
}
