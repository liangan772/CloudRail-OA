import { z } from 'zod';
import { castVoteSchema, markAbsentSchema, submitConclusionSchema } from '@oa/shared';

/** 投票 / 改票：只允许同意或反对（不允许弃权，与已确认规则 A2 一致） */
export const castVoteBodySchema = castVoteSchema;
export type CastVoteBody = z.infer<typeof castVoteBodySchema>;

/** 标记缺席：必须填理由（理由会写进 InstanceNodeVoter.absentReason） */
export const markAbsentBodySchema = markAbsentSchema;
export type MarkAbsentBody = z.infer<typeof markAbsentBodySchema>;

/** 人工结论：意见必填，改判另需理由（服务层再校验权限） */
export const submitConclusionBodySchema = submitConclusionSchema;
export type SubmitConclusionBody = z.infer<typeof submitConclusionBodySchema>;

export const revokeAbsentBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RevokeAbsentBody = z.infer<typeof revokeAbsentBodySchema>;
