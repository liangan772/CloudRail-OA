'use client';

import useSWR from 'swr';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';

interface DeptNode {
  id: number;
  name: string;
  workNo: string | null;
  level: number;
  path: string;
  children: DeptNode[];
}

interface WorkNo {
  departmentId: number;
  departmentName: string;
  workNo: string;
  level: number;
  primaryUserName: string | null;
  memberCount: number;
  members: { userId: number; name: string; isPrimary: boolean }[];
}

export default function OrgPage() {
  const { data: tree, isLoading } = useSWR<DeptNode[]>('/org/departments');
  const { data: workNos } = useSWR<WorkNo[]>('/org/worknos');

  const columns: Column<WorkNo & { id: number }>[] = [
    { key: 'workNo', header: '部门工号', render: (row) => <span className="font-mono">{row.workNo}</span> },
    { key: 'departmentName', header: '部门', render: (row) => `${'　'.repeat(Math.max(row.level - 1, 0))}${row.departmentName}` },
    { key: 'primaryUserName', header: '主责人', render: (row) => row.primaryUserName ?? '—' },
    {
      key: 'members',
      header: '工号成员',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.members.map((member) => `${member.name}${member.isPrimary ? '（主责）' : ''}`).join('、') || '—'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="组织架构"
        description="部门树与部门工号：上报统一投递到上级部门的工号，工号成员即该级投票人"
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="oa-card">
          <h2 className="mb-2 text-sm font-medium">部门树</h2>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-4" style={{ width: `${90 - index * 8}%` }} />
              ))}
            </div>
          ) : (
            <DeptTree nodes={tree ?? []} />
          )}
        </div>
        <div className="oa-card p-0">
          <h2 className="px-4 pt-3 text-sm font-medium">部门工号</h2>
          <DataTable
            columns={columns}
            rows={(workNos ?? []).map((item) => ({ ...item, id: item.departmentId }))}
            emptyTitle="还没有配置部门工号"
            emptyDescription="部门工号是上报的投递单元，建议每级部门都配一个。"
          />
        </div>
      </div>
    </>
  );
}

function DeptTree({ nodes }: { nodes: DeptNode[] }) {
  if (nodes.length === 0) return <p className="text-sm text-muted-foreground">没有可见的部门</p>;
  return (
    <ul className="space-y-1 text-sm">
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="flex items-center gap-2">
            <span>{node.name}</span>
            {node.workNo ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{node.workNo}</span> : null}
          </div>
          {node.children?.length ? (
            <div className="ml-4 border-l pl-3">
              <DeptTree nodes={node.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
