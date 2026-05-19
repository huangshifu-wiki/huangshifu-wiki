import { z } from 'zod'

export const backupRestoreSchema = z.object({
  password: z.string().min(1),
})
