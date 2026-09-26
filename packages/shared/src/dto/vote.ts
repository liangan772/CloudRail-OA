import { z } from 'zod';
import { ConclusionDecision, VoteDecision } from '../enums';

/** 本层可投的两种表态：同意 / 反对（不允许弃权） */
export const castVoteSchema = z.object({
  decision: z.enum([VoteDecision.APPROVE, VoteDecision.REJECT], {
    errorMap: () => ({ message: '必须明确表态（同意或反对），不允许弃权' }),
  }),
  comment: z.string().trim().max(2000).optional(),
});
export type CastVoteInput = z.infer<typeof castVoteSchema>;

/** 反对必须填写意见（便于结论人决策） */
export const castVoteStrictSchema = castVoteSchema.refine(
  (v) => v.decision !== VoteDecision.REJECT || (v.comment && v.comment.length > 0),
  { message: '选择反对时必须填写意见', path: ['comment'] },
);

/** 人工投票结论（改判系统判定必须填理由） */
export const submitConclusionSchema = z
  .object({
    decision: z.enum([ConclusionDecision.APPROVE, ConclusionDecision.REJECT]),
    content: z.string().trim().min(1, '结论意见必填').max(4000),
    overrideReason: z.string().trim().max(2000).optional(),
    attachments: z
      .array(z.object({ fileName: z.string(), fileKey: z.string(), size: z.number(), mime: z.string() }))
      .max(10)
      .optional(),
  })
  .strict();
export type SubmitConclusionInput = z.infer<typeof submitConclusionSchema>;

/** 标记缺席（不算票、不计入投票池） */
export const markAbsentSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, '至少选择一人'),
  reason: z.string().trim().min(2, '理由必填').max(500),
  source: z.enum(['MANUAL', 'LEAVE_SYNC', 'DECLARED']).default('MANUAL'),
});
export type MarkAbsentInput = z.infer<typeof markAbsentSchema>;

/** 投票进度（前端进度条与头像组的契约） */
export const voteProgressSchema = z.object({
  expected: z.number().int().nonnegative(),
  pool: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  stated: z.number().int().nonnegative(),
  approve: z.number().int().nonnegative(),
  reject: z.number().int().nonnegative(),
  quorumSatisfied: z.boolean(),
  minQuorum: z.number(),
});
export type VoteProgress = z.infer<typeof voteProgressSchema>;
