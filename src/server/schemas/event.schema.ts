import { z } from 'zod'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { limitedString, optionalLimitedString } from '../utils/textLimits'

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const timeSlotSchema = z
  .object({
    type: z.enum(['date', 'datetime']),
    start: z.string().trim(),
    end: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    const pattern = value.type === 'datetime' ? localDateTimePattern : localDatePattern
    const label = value.type === 'datetime' ? '日期时间' : '日期'

    if (!pattern.test(value.start)) {
      ctx.addIssue({
        code: 'custom',
        path: ['start'],
        message: `开始时间必须是有效${label}`,
      })
    }

    if (value.end && !pattern.test(value.end)) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: `结束时间必须是有效${label}`,
      })
    }
  })

const saleTimeSchema = z
  .object({
    time: z.string().trim().regex(localDateTimePattern, '起售时间必须是有效日期时间'),
    note: optionalLimitedString('起售备注', CONTENT_LIMITS.event.saleTimeNote),
  })
  .transform((value) => ({
    time: value.time,
    note: value.note?.trim() || undefined,
  }))

const externalLinkSchema = z
  .object({
    label: limitedString('链接名称', CONTENT_LIMITS.event.externalLinkLabel)
      .trim()
      .min(1, '链接名称不能为空'),
    url: z.string().trim().url('外部链接必须是有效 URL').max(CONTENT_LIMITS.url),
  })
  .transform((value) => ({
    label: value.label,
    url: value.url,
  }))

const ticketPriceSchema = z
  .object({
    description: optionalLimitedString('票价描述', CONTENT_LIMITS.event.ticketPriceDescription),
    price: z
      .number({ error: '票价必须是数字' })
      .finite('票价必须是有效数字')
      .min(0, '票价不能小于 0'),
  })
  .strict()
  .transform(({ description, price }) => {
    const trimmedDescription = description?.trim()
    return {
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      price,
    }
  })

const imageInstructionSchema = z.union([
  z.object({ imageId: z.string().trim().min(1) }),
  z.object({ assetId: z.string().trim().min(1) }),
])

export const eventWriteSchema = z.object({
  title: limitedString('活动标题', CONTENT_LIMITS.event.title).trim().min(1, '活动标题不能为空'),
  location: limitedString('活动地点', CONTENT_LIMITS.event.location).trim().optional().default(''),
  content: limitedString('活动内容', CONTENT_LIMITS.event.content).optional().default(''),
  timeSlots: z.array(timeSlotSchema).max(CONTENT_LIMITS.event.timeSlots).optional().default([]),
  ticketPrices: z
    .array(ticketPriceSchema)
    .max(CONTENT_LIMITS.event.ticketPrices)
    .optional()
    .default([]),
  saleTimes: z.array(saleTimeSchema).max(CONTENT_LIMITS.event.saleTimes).optional().default([]),
  lineup: z
    .array(limitedString('阵容', CONTENT_LIMITS.event.lineupItem).trim().min(1, '阵容不能为空'))
    .max(CONTENT_LIMITS.event.lineup)
    .optional()
    .default([]),
  externalLinks: z
    .array(externalLinkSchema)
    .max(CONTENT_LIMITS.event.externalLinks)
    .optional()
    .default([]),
  coverAssetId: z.string().trim().min(1).nullable().optional(),
  posters: z.array(imageInstructionSchema).optional().default([]),
})

export type EventWriteInput = z.infer<typeof eventWriteSchema>
