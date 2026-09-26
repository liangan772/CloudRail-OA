import { ERROR_CODES, type ErrorDef } from '@oa/shared';

/**
 * 表单数据校验（纯函数，零 IO）。
 *
 * 只支持模板 `formSchema` 用到的 JSON Schema 子集：object + required + properties 的
 * type / minLength / maxLength / minimum / maximum / enum / format(date,date-time)。
 * 不做完整 JSON Schema 实现，是因为模板表单由本项目的设计器生成，
 * 子集足够覆盖，且能在前后端共用同一份判断（前端渲、后端再校验一次）。
 */

interface PropertySchema {
  type?: string;
  title?: string;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
}

interface ObjectSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, PropertySchema>;
}

export type FormValidationResult = { ok: true } | { ok: false; error: ErrorDef; reasons: string[] };

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function typeMatches(value: unknown, type: string | undefined): boolean {
  switch (type) {
    case undefined:
      return true;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export function validateFormData(schema: unknown, data: Record<string, unknown> | null | undefined): FormValidationResult {
  const reasons: string[] = [];
  const input = data ?? {};

  // 模板没配 schema 时不做任何限制（允许先跑通流程再补表单）
  if (!schema || typeof schema !== 'object') return { ok: true };
  const objectSchema = schema as ObjectSchema;
  if (objectSchema.type && objectSchema.type !== 'object') {
    return { ok: false, error: ERROR_CODES.WF_FORM_SCHEMA_INVALID, reasons: ['表单 schema 根节点必须是 object'] };
  }

  const properties = objectSchema.properties ?? {};

  for (const key of objectSchema.required ?? []) {
    if (isEmpty(input[key])) reasons.push(`缺少必填字段：${properties[key]?.title ?? key}`);
  }

  for (const [key, property] of Object.entries(properties)) {
    const value = input[key];
    if (isEmpty(value)) continue; // 非必填字段留空直接跳过
    const label = property.title ?? key;

    if (!typeMatches(value, property.type)) {
      reasons.push(`字段「${label}」类型应为 ${property.type}`);
      continue;
    }

    if (typeof value === 'string') {
      if (property.minLength != null && value.length < property.minLength) {
        reasons.push(`字段「${label}」至少 ${property.minLength} 个字符`);
      }
      if (property.maxLength != null && value.length > property.maxLength) {
        reasons.push(`字段「${label}」最多 ${property.maxLength} 个字符`);
      }
      if (property.format === 'date' && Number.isNaN(Date.parse(value))) {
        reasons.push(`字段「${label}」不是合法日期（YYYY-MM-DD）`);
      }
      if (property.format === 'date-time' && Number.isNaN(Date.parse(value))) {
        reasons.push(`字段「${label}」不是合法时间`);
      }
    }

    if (typeof value === 'number') {
      if (property.minimum != null && value < property.minimum) {
        reasons.push(`字段「${label}」不能小于 ${property.minimum}`);
      }
      if (property.maximum != null && value > property.maximum) {
        reasons.push(`字段「${label}」不能大于 ${property.maximum}`);
      }
    }

    if (property.enum && !property.enum.includes(value)) {
      reasons.push(`字段「${label}」取值不在允许范围内：${property.enum.join(' / ')}`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, error: ERROR_CODES.WF_FORM_SCHEMA_INVALID, reasons };
  }
  return { ok: true };
}
