'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api-client';
import { errorText, runAction } from '@/lib/action';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { SCOPE_TYPE_LABEL, type ScopeType } from '@oa/shared';

interface Role {
  id: number;
  code: string;
  name: string;
  dataScopeDefault: string;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
  permissions: { code: string; name: string; module: string }[];
}

interface PermissionGroup {
  module: string;
  items: { code: string; name: string; type: string }[];
}

const MODULE_LABEL: Record<string, string> = {
  system: '组织与权限',
  workflow: '流程',
  vote: '投票',
  task: '任务',
  escalation: '上报',
  stats: '统计',
  audit: '审计',
};

export default function AdminRolesPage() {
  const { can } = useSession();
  const canWrite = can('ROLE_MANAGE');

  const { data: roles, isLoading, mutate } = useSWR<{ items: Role[]; total: number }>('/admin/roles?page=1&pageSize=100');
  const { data: catalog } = useSWR<PermissionGroup[]>('/admin/roles/permissions');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', dataScopeDefault: 'DEPT' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [permTarget, setPermTarget] = useState<Role | null>(null);
  const [permSelection, setPermSelection] = useState<string[]>([]);
  const [permFilter, setPermFilter] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    const keyword = permFilter.trim().toLowerCase();
    if (!keyword) return catalog;
    return catalog
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => item.name.toLowerCase().includes(keyword) || item.code.toLowerCase().includes(keyword),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [catalog, permFilter]);

  const createRole = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setFormError('角色码与名称必填');
      return;
    }
    setSubmitting(true);
    const result = await runAction(
      () => api.post('/admin/roles', { code: form.code.trim().toUpperCase(), name: form.name.trim(), dataScopeDefault: form.dataScopeDefault }),
      { success: '角色已创建' },
    );
    setSubmitting(false);
    if (result.ok) {
      setCreateOpen(false);
      setForm({ code: '', name: '', dataScopeDefault: 'DEPT' });
      void mutate();
    } else {
      setFormError(errorText(result.error));
    }
  };

  const savePermissions = async () => {
    if (!permTarget) return;
    const result = await runAction(() => api.post(`/admin/roles/${permTarget.id}/permissions`, { permissionCodes: permSelection }), {
      success: '权限已更新',
    });
    if (result.ok) {
      setPermTarget(null);
      void mutate();
    }
  };

  const deleteRole = async () => {
    if (!deleteTarget) return;
    const result = await runAction(() => api.delete(`/admin/roles/${deleteTarget.id}`), { success: '角色已删除' });
    if (result.ok) void mutate();
  };

  return (
    <div className="space-y-4">
      <Card
        pad={false}
        title="角色权限"
        description="角色 = 一组权限点 + 默认数据范围。内置角色不可删除，但可以按需调整权限。"
        actions={
          canWrite ? (
            <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setFormError(''); setCreateOpen(true); }}>
              新建角色
            </Button>
          ) : null
        }
      >
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : (roles?.items ?? []).length === 0 ? (
          <EmptyState title="还没有角色" description="至少需要为一个管理员分配角色，否则后台无法登录使用。" />
        ) : (
          <ul className="divide-y">
            {(roles?.items ?? []).map((role) => (
              <li key={role.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{role.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{role.code}</span>
                    {role.isSystem ? <span className="oa-chip border-border bg-muted text-muted-foreground">内置</span> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular">权限点 {role.permissionCount}</span>
                    <span className="tabular inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {role.userCount} 人
                    </span>
                    <span>默认数据范围：{SCOPE_TYPE_LABEL[role.dataScopeDefault as ScopeType] ?? role.dataScopeDefault}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {role.permissions.slice(0, 6).map((permission) => (
                      <span key={permission.code} className="oa-chip border-border bg-[hsl(var(--surface))] text-muted-foreground">
                        {permission.name}
                      </span>
                    ))}
                    {role.permissionCount > 6 ? (
                      <span className="self-center text-xs text-muted-foreground">+{role.permissionCount - 6}</span>
                    ) : null}
                  </div>
                </div>

                {canWrite ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ShieldCheck className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setPermTarget(role);
                        setPermSelection(role.permissions.map((permission) => permission.code));
                        setPermFilter('');
                      }}
                    >
                      配置权限
                    </Button>
                    {!role.isSystem ? (
                      <Tooltip content="删除角色">
                        <button type="button" className="oa-icon-button text-danger" onClick={() => setDeleteTarget(role)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 新建角色 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建角色"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button variant="primary" loading={submitting} onClick={createRole}>
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError ? (
            <div className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-xs text-danger">{formError}</div>
          ) : null}
          <Field label="角色码" required hint="大写字母开头，仅字母 / 数字 / 下划线，创建后不可修改">
            <input
              className="oa-input font-mono"
              placeholder="DEPT_AUDITOR"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="角色名称" required>
            <input className="oa-input" placeholder="部门审核员" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="默认数据范围" hint="新建用户时按此范围授予，可在用户层面另行调整">
            <select
              className="oa-input"
              value={form.dataScopeDefault}
              onChange={(event) => setForm({ ...form, dataScopeDefault: event.target.value })}
            >
              {Object.entries(SCOPE_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>

      {/* 配置权限 */}
      <Drawer
        open={Boolean(permTarget)}
        onClose={() => setPermTarget(null)}
        title={`配置权限 · ${permTarget?.name ?? ''}`}
        description={`已选 ${permSelection.length} 个权限点（保存后整表替换）`}
        width="xl"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (!catalog) return;
                setPermSelection(catalog.flatMap((group) => group.items.map((item) => item.code)));
              }}
            >
              全选
            </Button>
            <Button variant="ghost" onClick={() => setPermSelection([])}>
              全不选
            </Button>
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => setPermTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={savePermissions}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <input
            className="oa-input h-8 text-xs"
            placeholder="搜索权限点名称或编码"
            value={permFilter}
            onChange={(event) => setPermFilter(event.target.value)}
          />

          {filteredCatalog.map((group) => (
            <div key={group.module}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground">{MODULE_LABEL[group.module] ?? group.module}</h3>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    const codes = group.items.map((item) => item.code);
                    const allSelected = codes.every((code) => permSelection.includes(code));
                    setPermSelection(
                      allSelected
                        ? permSelection.filter((code) => !codes.includes(code))
                        : [...new Set([...permSelection, ...codes])],
                    );
                  }}
                >
                  切换本组
                </button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {group.items.map((item) => {
                  const checked = permSelection.includes(item.code);
                  return (
                    <label
                      key={item.code}
                      className={
                        checked
                          ? 'flex cursor-pointer items-start gap-2 rounded-md border border-primary/30 bg-primary-subtle/60 p-2 transition-colors'
                          : 'flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors hover:bg-muted/60'
                      }
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 rounded border"
                        checked={checked}
                        onChange={() =>
                          setPermSelection(checked ? permSelection.filter((code) => code !== item.code) : [...permSelection, item.code])
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{item.name}</span>
                        <span className="block truncate font-mono text-2xs text-muted-foreground">{item.code}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`删除角色「${deleteTarget?.name ?? ''}」`}
        description={
          deleteTarget?.userCount
            ? `该角色仍有 ${deleteTarget.userCount} 个用户在使用，删除会被拒绝。请先把这些用户改派到其它角色。`
            : '删除后不可恢复。该角色下的权限配置会一并清除。'
        }
        confirmText="确认删除"
        danger
        onConfirm={deleteRole}
        onClose={() => setDeleteTarget(null)}
      />

      {canWrite ? (
        <p className="px-1 text-xs text-muted-foreground">
          <StatusBadge status="INFO" label="提示" dot={false} className="mr-1.5" />
          权限点由代码定义（<span className="font-mono">packages/shared</span>），这里只能分配、不能新建 —— 否则前后端权限判定会漂移。
        </p>
      ) : null}
    </div>
  );
}
