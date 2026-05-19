import { z } from 'zod'

export const postCreateSchema = z.object({
  title: z.string().min(1).max(200),
  section: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published']).optional(),
  musicDocId: z.string().optional(),
  albumDocId: z.string().optional(),
  locationCode: z.string().optional(),
  locationDetail: z.string().optional(),
})

export const postCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parentId: z.string().optional(),
})
