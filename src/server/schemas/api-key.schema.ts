import { z } from 'zod'

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, '密钥名称不能为空').max(100, '密钥名称不能超过 100 个字符'),
  expiry: z.enum(['30d', '90d', '365d', 'never']).default('90d'),
})
