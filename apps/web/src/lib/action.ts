import { ApiError } from './api-client';

export interface ActionResult<T> {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
}

/**
 * 统一的"提交 + 反馈"包装。
 *
 * 为什么要包一层：项目里每个写操作都要做三件事 —— 调接口、成功后给正反馈、失败后给可读原因。
 * 散着写必然出现"有的地方失败静默、有的地方弹 alert"。这里统一成返回结果对象，
 * 而不是把异常抛给调用方（调用方大多是 onClick，没有 catch 的位置）。
 */
export async function runAction<T>(
  fn: () => Promise<T>,
  messages: { success?: string; failure?: string } = {},
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (messages.success) {
      const { toast } = await import('@/components/ui/toast');
      toast.success(messages.success);
    }
    return { ok: true, data, error: null };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    const { toast } = await import('@/components/ui/toast');
    toast.error(messages.failure ?? apiError?.message ?? '操作失败，请稍后重试', {
      description: apiError?.detail ?? (apiError ? `错误码 ${apiError.code}` : undefined),
    });
    return { ok: false, data: null, error: apiError };
  }
}

/** 把接口错误转成可直接渲染的文案（详情优先，因为它通常更具体） */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : '未知错误';
}
