import { z } from 'zod'
import { CONTENT_LIMITS } from '../../lib/contentLimits'

const trimmedOptionalString = (label: string, max: number) =>
  z
    .string({ error: `${label}不能为空` })
    .trim()
    .max(max, `${label}不能超过${max}个字符`)
    .optional()

const trimmedRequiredString = (label: string, max: number) =>
  z
    .string({ error: `${label}不能为空` })
    .trim()
    .min(1, `${label}不能为空`)
    .max(max, `${label}不能超过${max}个字符`)

export const ticketListingWriteSchema = z
  .object({
    type: z.enum(['offer', 'request'], { error: '盘票类型不能为空' }),
    quantity: z
      .number({ error: '数量必须是整数' })
      .int('数量必须是整数')
      .min(1, '数量必须至少为 1')
      .max(CONTENT_LIMITS.ticketListing.quantity, '数量不能超过10000'),
    ticketTier: trimmedRequiredString('票档', CONTENT_LIMITS.ticketListing.ticketTier),
    seat: trimmedOptionalString('座位', CONTENT_LIMITS.ticketListing.seat).default(''),
    description: trimmedOptionalString('描述', CONTENT_LIMITS.ticketListing.description).default(
      ''
    ),
    contact: trimmedRequiredString('联系方式', CONTENT_LIMITS.ticketListing.contact),
    eventId: z.string({ error: '活动 ID 格式不正确' }).trim().min(1, '活动 ID 不能为空').optional(),
    customEventName: trimmedRequiredString(
      '自定义活动名称',
      CONTENT_LIMITS.ticketListing.customEventName
    ).optional(),
    status: z.enum(['draft', 'pending', 'published']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasEvent = Boolean(value.eventId)
    const hasCustomEvent = Boolean(value.customEventName)
    if (hasEvent === hasCustomEvent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eventId'],
        message: '关联活动和自定义活动名称必须二选一',
      })
    }
  })
