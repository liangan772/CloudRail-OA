'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { PageHeader } from '@/components/ui/page-header';
import { api, ApiError } from '@/lib/api-client';

interface TemplateRow {
  id: number;
  name: string;
  category: string;
  status: string;
  latestVersion: { version: number; publishedAt: string | null } | null;
}

interface PropertySchema {
  type?: string;
  title?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

interface FormSchema {
  required?: string[];
  properties?: Record<string, PropertySchema>;
}

interface TemplateDetail {
  id: number;
  name: string;
  formSchema: FormSchema;
  versions: { version: number; publishedAt: string | null }[];
}

// 发起流程：表单按模板的 formSchema 动态渲染。
// 前端只做"能填对"的校验，真正的校验在后端（validateFormData 与节点图校验都在服务端再跑一遍）。
export default function NewInstancePage() {
  const router = useRouter();
  const { data: templates } = useSWR<{ items: TemplateRow[] }>('/workflow/templates?page=1&pageSize=50&status=PUBLISHED');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const { data: detail } = useSWR<TemplateDetail>(templateId ? `/workflow/templates/${templateId}` : null);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const published = useMemo(() => detail?.versions.find((version) => version.publishedAt != null), [detail]);
  const properties = useMemo(() => Object.entries(detail?.formSchema?.properties ?? {}), [detail]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateId) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.post<{ instanceId: number }>('/instances', {
        templateId,
        title,
        formData,
        priority,
        saveAsDraft: false,
      });
      router.push(`/instances/${created.instanceId}`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}${err.detail ? `（${err.detail}）` : ''}` : '发起失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="发起流程" description="选择已发布模板 → 填写表单 → 提交后自动快照首层投票人并开投" />

      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="oa-card space-y-4">
          <label className="block space-y-1">
            <span className="text-sm">流程模板</span>
            <select
              className="oa-input"
              value={templateId ?? ''}
              onChange={(event) => {
                setTemplateId(event.target.value ? Number(event.target.value) : null);
                setFormData({});
              }}
              required
            >
              <option value="">请选择</option>
              {(templates?.items ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm">标题</span>
            <input className="oa-input" value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} required />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">优先级</span>
            <select className="oa-input" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="LOW">低</option>
              <option value="NORMAL">普通</option>
              <option value="HIGH">高</option>
              <option value="URGENT">紧急</option>
            </select>
          </label>

          {templateId ? (
            <div className="space-y-3 border-t pt-3">
              <div className="text-sm font-medium">
                表单
                {published ? <span className="ml-2 text-xs text-muted-foreground">v{published.version}</span> : null}
              </div>
              {properties.length === 0 ? (
                <p className="text-xs text-muted-foreground">该模板没有表单字段</p>
              ) : (
                properties.map(([key, property]) => (
                  <FieldInput
                    key={key}
                    fieldKey={key}
                    schema={property}
                    required={detail?.formSchema.required?.includes(key) ?? false}
                    value={formData[key]}
                    onChange={(value) => setFormData((prev) => ({ ...prev, [key]: value }))}
                  />
                ))
              )}
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" className="oa-button-ghost" onClick={() => router.back()}>
              取消
            </button>
            <button type="submit" className="oa-button" disabled={submitting || !templateId}>
              {submitting ? '提交中…' : '提交流程'}
            </button>
          </div>
        </div>

        <aside className="oa-card space-y-2 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">提交后会发生什么</div>
          <p>1. 按模板解析**首层投票人**并快照（组织后续变动不影响已开始的流程）。</p>
          <p>2. 首层进入投票中，投票人收到「待你投票」通知。</p>
          <p>3. 池内全员表态后进入人工结论；通过则按模板派任务，任务全部完成后才开启下一层。</p>
          <p>4. 命中上报规则（如金额超限）时会先上报上级部门工号，而不是直接出结论。</p>
        </aside>
      </form>
    </>
  );
}

function FieldInput({
  fieldKey,
  schema,
  required,
  value,
  onChange,
}: {
  fieldKey: string;
  schema: PropertySchema;
  required: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = `${schema.title ?? fieldKey}${required ? ' *' : ''}`;

  if (schema.enum?.length) {
    return (
      <label className="block space-y-1">
        <span className="text-sm">{label}</span>
        <select className="oa-input" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} required={required}>
          <option value="">请选择</option>
          {schema.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (schema.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }

  const inputType = schema.type === 'number' || schema.type === 'integer' ? 'number' : schema.format === 'date' ? 'date' : 'text';
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      <input
        className="oa-input"
        type={inputType}
        value={value === undefined || value === null ? '' : String(value)}
        min={schema.minimum}
        max={schema.maximum}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') return onChange(undefined);
          onChange(inputType === 'number' ? Number(raw) : raw);
        }}
        required={required}
      />
    </label>
  );
}
