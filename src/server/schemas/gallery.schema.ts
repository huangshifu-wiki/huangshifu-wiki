import { z } from 'zod'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { optionalLimitedString } from '../utils/textLimits'
import { createContentLinkListSchema } from './contentLink.schema'

export const galleryDeleteSchema = z
  .object({
    reason: optionalLimitedString('删除理由', CONTENT_LIMITS.gallery.reviewNote),
  })
  .default({})

export const galleryRelatedLinksSchema = createContentLinkListSchema({
  label: '相关链接',
  labelLimit: CONTENT_LIMITS.gallery.relatedLinkLabel,
  maxItems: CONTENT_LIMITS.gallery.relatedLinks,
  allowInternalPath: true,
})
