import { z } from 'zod'
import { normalizeContentLinks, validateContentLinks } from '../../lib/contentLinks'

/**
 * 图集、活动共用的链接列校验。
 * 规则和文案只在 src/lib/contentLinks.ts 写一份，这里只做 zod 适配，避免接口与编辑器两套规则漂移。
 */
export const createContentLinkListSchema = (rules: Parameters<typeof validateContentLinks>[1]) =>
  z
    .array(
      z.object({
        label: z.string().optional().default(''),
        url: z.string().optional().default(''),
      })
    )
    .optional()
    .default([])
    .superRefine((links, ctx) => {
      const issue = validateContentLinks(links, rules)
      if (issue) ctx.addIssue({ code: 'custom', message: issue.message })
    })
    .transform((links) => normalizeContentLinks(links))
