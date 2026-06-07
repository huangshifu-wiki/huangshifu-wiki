import { z } from 'zod'
import { CONTENT_LIMITS } from '../../lib/contentLimits'
import { optionalLimitedString } from '../utils/textLimits'

export const galleryDeleteSchema = z
  .object({
    reason: optionalLimitedString('删除理由', CONTENT_LIMITS.gallery.reviewNote),
  })
  .default({})
