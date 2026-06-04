import { z } from 'zod'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import {
  limitedString,
  limitedStringArray,
  nullableLimitedString,
  optionalLimitedString,
} from '../utils/textLimits'

const wikiContentStatusSchema = z.enum(['draft', 'pending', 'published'])

export const wikiCreateSchema = z.object({
  title: limitedString('标题', CONTENT_LIMITS.wiki.title).min(1, '标题不能为空'),
  content: limitedString('内容', CONTENT_LIMITS.wiki.content).min(1, '内容不能为空'),
  slug: optionalLimitedString('路径', CONTENT_LIMITS.wiki.slug),
  category: optionalLimitedString('分类', CONTENT_LIMITS.wiki.category),
  tags: limitedStringArray('标签', CONTENT_LIMITS.wiki.tag, CONTENT_LIMITS.wiki.tags),
  relations: z
    .array(z.any())
    .max(CONTENT_LIMITS.wiki.relations, `关系最多${CONTENT_LIMITS.wiki.relations}个`)
    .optional(),
  eventDate: optionalLimitedString('事件日期', CONTENT_LIMITS.wiki.eventDate),
  locationCode: nullableLimitedString('地点编码', CONTENT_LIMITS.wiki.locationCode),
  locationDetail: nullableLimitedString('地点详情', CONTENT_LIMITS.wiki.locationDetail),
  status: wikiContentStatusSchema.optional(),
})

export const wikiUpdateSchema = wikiCreateSchema.partial()

export const wikiDeleteSchema = z
  .object({
    reason: optionalLimitedString('删除理由', CONTENT_LIMITS.wiki.reviewNote),
  })
  .default({})

export const wikiRevisionSchema = z.object({
  title: limitedString('标题', CONTENT_LIMITS.wiki.title).min(1, '标题不能为空'),
  content: limitedString('内容', CONTENT_LIMITS.wiki.content).min(1, '内容不能为空'),
  slug: optionalLimitedString('路径', CONTENT_LIMITS.wiki.slug),
  category: limitedString('分类', CONTENT_LIMITS.wiki.category).min(1, '分类不能为空'),
  tags: limitedStringArray('标签', CONTENT_LIMITS.wiki.tag, CONTENT_LIMITS.wiki.tags),
  relations: z
    .array(z.any())
    .max(CONTENT_LIMITS.wiki.relations, `关系最多${CONTENT_LIMITS.wiki.relations}个`)
    .optional(),
  eventDate: nullableLimitedString('事件日期', CONTENT_LIMITS.wiki.eventDate),
  isAutoSave: z.boolean().optional(),
})
