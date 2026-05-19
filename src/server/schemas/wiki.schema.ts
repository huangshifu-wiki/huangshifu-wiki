import { z } from 'zod'

export const wikiCreateSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  slug: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  relations: z.array(z.any()).optional(),
  status: z.enum(['draft', 'published']).optional(),
})

export const wikiUpdateSchema = wikiCreateSchema.partial()
