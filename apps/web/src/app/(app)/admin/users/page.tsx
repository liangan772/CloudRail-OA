'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { KeyRound, Pencil, Plus, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '@/lib/api-client';
import { errorText, runAction } from '@/lib/action';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip } from '@/components/ui/tooltip';
import { USER_STATUS_LABEL } from '@oa/shared';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  departments: { departmentId: number; departmentName: string; isPrimary: boolean; isLeader: boolean; title: string | null }[];
  roles: { code: string; name: string; isSystem: boolean }[];
}

interface RoleOption {
  id: number;
  code: string;
  name: string;
  dataScopeDefault: string;
  isSystem: boolean;
}

interface DeptNode {
  id: number;
  name: string;
  level: number;
  children?: DeptNode[];
}

interface UserForm {
  email: string;
  name: string;
  phone: string;
  password: string;
  deptId: string;
  title: string;
  isLeader: boolean;
  roleCodes: string[];
}

const EMPTY_FORM: UserForm = {
  email: '',
  name: '',
  phone: '',
  password: '',
  deptId: '',
  title: '',
  isLeader: false,
  roleCodes: [],
};

function flattenDepts(nodes: DeptNode[]): { id: number; label: string }[] {
  const result: { id: number; label: string }[] = [];
  const walk = (list: DeptNode[]) => {
    for (const node of list) {
      result.push({ id: node.id, label: `${'　'.repeat(Math.max(node.level - 1, 0))}${node.name}` });
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

export default function AdminUsersPage() {
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [deptId, setDeptId] = useState('');

  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (search) query.set('keyword', search);
  if (status) query.set('status', status);
  if (deptId) query.set('deptId', deptId);

  const { data, isLoading, mutate } = useSWR<{ items: AdminUser[]; total: number }>(`/admin/users?${query.toString()}`);
  const { data: roles } = useSWR<RoleOption[]>('/admin/roles/options');
  const { data: deptTree } = useSWR<DeptNode[]>('/org/departments');
  const departments = useMemo(() => flattenDepts(deptTree ?? []), [deptTree]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [roleSelection, setRoleSelection] = useState<string[]>([]);

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [issuedPassword, setIssuedPassword] = useState<{ user: AdminUser; password: string } | null>(null);

  const canWrite = can('USER_MANAGE');

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setForm({
      email: user.email,
      name: user.name,
      phone: user.phone ?? '',
      password: '',
      deptId: String(user.departments[0]?.departmentId ?? ''),
      title: user.departments[0]?.title ?? '',
      isLeader: user.departments[0]?.isLeader ?? false,
      roleCodes: user.roles.map((role) => role.code),
    });
    setFormError('');
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.email.trim() || !form.name.trim()) {
      setFormError('邮箱与姓名必填');
      return;
    }
    if (!editing && form.password.length < 8) {
      setFormError('初始密码至少 8 位');
      return;
    }

    setSubmitting(true);
    const result = await runAction(
      () =>
        editing
          ? api.patch(`/admin/users/${editing.id}`, {
              name: form.name.trim(),
              phone: form.phone.trim() || null,
              deptId: form.deptId ? Number(form.deptId) : null,
              title: form.title.trim() || null,
              isLeader: form.isLeader,
            })
          : api.post('/admin/users', {
              email: form.email.trim(),
              name: form.name.trim(),
              phone: form.phone.trim() || undefined,
              password: form.password,
              deptId: form.deptId ? Number(form.deptId) : undefined,
              title: form.title.trim() || undefined,
              isLeader: form.isLeader,
              roleCodes: form.roleCodes,
            }),
      { success: editing ? '用户已更新' : '用户已创建' },
    );
    setSubmitting(false);

    if (result.ok) {
      setFormOpen(false);
      void mutate();
    } else {
      setFormError(errorText(result.error));
    }
  };

  const submitRoles = async () => {
    if (!roleTarget) return;
    const result = await runAction(() => api.post(`/admin/users/${roleTarget.id}/roles`, { roleCodes: roleSelection }), {
      success: '角色已更新',
    });
    if (result.ok) {
      setRoleTarget(null);
      void mutate();
    }
  };

  const doResetPassword = async () => {
    if (!resetTarget) return;
    const target = resetTarget;
    const result = await runAction(() => api.post<{ password: string }>(`/admin/users/${target.id}/reset-password`, {}), {
      success: '密码已重置',
    });
    if (result.ok && result.data) {
      setIssuedPassword({ user: target, password: result.data.password });
    }
  };

  const toggleStatus = async (user: AdminUser) => {
    const next = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    const result = await runAction(() => api.patch(`/admin/users/${user.id}`, { status: next }), {
      success: next === 'ACTIVE' ? '已启用' : '已停用',
    });
    if (result.ok) void mutate();
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: '用户',
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{row.name}</span>
            {row.departments[0]?.isLeader ? <span className="oa-chip border-primary/20 bg-primary-subtle text-primary">负责人</span> : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      key: 'phone',
      header: '手机号',
      hideOnMobile: true,
      render: (row) => <span className="tabular text-xs text-muted-foreground">{row.phone || '—'}</span>,
    },
    {
      key: 'dept',
      header: '部门 / 职务',
      hideOnMobile: true,
      render: (row) =>
        row.departments.length === 0 ? (
          <span className="text-xs text-muted-foreground">未分配</span>
        ) : (
          <div className="text-xs">
            <div>{row.departments.map((d) => d.departmentName).join('、')}</div>
            {row.departments[0]?.title ? <div className="text-muted-foreground">{row.departments[0].title}</div> : null}
          </div>
        ),
    },
    {
      key: 'roles',
      header: '角色',
      render: (row) =>
        row.roles.length === 0 ? (
          <span className="text-xs text-muted-foreground">未分配</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.roles.slice(0, 3).map((role) => (
              <span key={role.code} className="oa-chip border-border bg-muted text-muted-foreground">
                {role.name}
              </span>
            ))}
            {row.roles.length > 3 ? <span className="text-xs text-muted-foreground">+{row.roles.length - 3}</span> : null}
          </div>
        ),
    },
    {
      key: 'status',
      header: '状态',
      sortValue: (row) => row.status,
      render: (row) => <StatusBadge status={row.status} label={USER_STATUS_LABEL[row.status]} />,
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <div className="flex items-center justify-end gap-0.5">
            <Tooltip content="编辑资料">
              <button type="button" className="oa-icon-button" onClick={() => openEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="分配角色">
              <button
                type="button"
                className="oa-icon-button"
                onClick={() => {
                  setRoleTarget(row);
                  setRoleSelection(row.roles.map((role) => role.code));
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="重置密码">
              <button type="button" className="oa-icon-button" onClick={() => setResetTarget(row)}>
                <KeyRound className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <button type="button" className="oa-button-ghost h-7 px-2 text-xs" onClick={() => toggleStatus(row)}>
              {row.status === 'ACTIVE' ? '停用' : '启用'}
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">只读</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card
        pad={false}
        title="用户管理"
        description={`共 ${data?.total ?? 0} 名用户`}
        actions={
          canWrite ? (
            <Button variant="primary" size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={openCreate}>
              新建用户
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(keyword.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="oa-input h-8 w-56 pl-8 text-xs"
              placeholder="搜索姓名 / 邮箱 / 手机号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </form>

          <select
            className="oa-input h-8 w-28 text-xs"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(USER_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            className="oa-input h-8 w-40 text-xs"
            value={deptId}
            onChange={(event) => {
              setDeptId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部部门</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.label}
              </option>
            ))}
          </select>

          {search || status || deptId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setKeyword('');
                setSearch('');
                setStatus('');
                setDeptId('');
                setPage(1);
              }}
            >
              清空筛选
            </Button>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          loading={isLoading}
          emptyTitle="没有匹配的用户"
          emptyDescription="调整筛选条件，或新建一个用户。"
          emptyAction={
            canWrite ? (
              <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
                新建用户
              </Button>
            ) : undefined
          }
        />

        {data ? <Pagination page={page} pageSize={20} total={data.total} onChange={setPage} className="border-t" /> : null}
      </Card>

      {/* 新建 / 编辑 */}
      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `编辑 ${editing.name}` : '新建用户'}
        description={editing ? '邮箱不可修改（作为登录账号）' : '创建后可用初始密码登录，建议首次登录后立即修改'}
        width="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button variant="primary" loading={submitting} onClick={submitForm}>
              {editing ? '保存' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <div className="rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-xs text-danger">{formError}</div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="姓名" required>
              <input className="oa-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="邮箱（登录账号）" required>
              <input
                className="oa-input disabled:bg-muted"
                disabled={Boolean(editing)}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="手机号">
              <input className="oa-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            {!editing ? (
              <Field label="初始密码" required hint="至少 8 位">
                <input
                  className="oa-input"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
            ) : null}
            <Field label="主部门">
              <select className="oa-input" value={form.deptId} onChange={(e) => setForm({ ...form, deptId: e.target.value })}>
                <option value="">不分配</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="职务">
              <input className="oa-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              checked={form.isLeader}
              onChange={(e) => setForm({ ...form, isLeader: e.target.checked })}
            />
            设为部门负责人
          </label>

          {!editing ? (
            <Field label="角色" hint="角色决定权限点与默认数据范围；也可创建后再分配">
              <div className="flex flex-wrap gap-1.5">
                {(roles ?? []).map((role) => {
                  const checked = form.roleCodes.includes(role.code);
                  return (
                    <button
                      key={role.code}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          roleCodes: checked ? form.roleCodes.filter((code) => code !== role.code) : [...form.roleCodes, role.code],
                        })
                      }
                      className={
                        checked
                          ? 'rounded-md border border-primary/30 bg-primary-subtle px-2 py-1 text-xs font-medium text-primary'
                          : 'rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted'
                      }
                    >
                      {role.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
        </div>
      </Drawer>

      {/* 分配角色 */}
      <Modal
        open={Boolean(roleTarget)}
        onClose={() => setRoleTarget(null)}
        title={`分配角色 · ${roleTarget?.name ?? ''}`}
        description="保存后会整表替换该用户的角色"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoleTarget(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={submitRoles}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {(roles ?? []).map((role) => {
            const checked = roleSelection.includes(role.code);
            return (
              <label
                key={role.code}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border"
                  checked={checked}
                  onChange={() =>
                    setRoleSelection(checked ? roleSelection.filter((code) => code !== role.code) : [...roleSelection, role.code])
                  }
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {role.name}
                    {role.isSystem ? <span className="oa-chip border-border bg-muted text-muted-foreground">内置</span> : null}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {role.code} · 默认范围 {role.dataScopeDefault}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </Modal>

      {/* 重置密码确认 */}
      <ConfirmDialog
        open={Boolean(resetTarget)}
        title={`重置 ${resetTarget?.name ?? ''} 的密码`}
        description="将把密码重置为系统默认口令，并把账号状态恢复为「正常」。重置后请尽快通知本人修改。"
        confirmText="确认重置"
        danger
        onConfirm={doResetPassword}
        onClose={() => setResetTarget(null)}
      />

      {/* 重置结果 */}
      <Modal
        open={Boolean(issuedPassword)}
        onClose={() => setIssuedPassword(null)}
        title="密码已重置"
        width="sm"
        footer={
          <Button variant="primary" onClick={() => setIssuedPassword(null)}>
            我已记录
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          {issuedPassword?.user.name} 的新密码（仅本次显示，关闭后无法再查看）：
        </p>
        <p className="mt-2 select-all rounded-md border bg-[hsl(var(--surface))] px-3 py-2 font-mono text-sm">
          {issuedPassword?.password}
        </p>
      </Modal>
    </div>
  );
}
