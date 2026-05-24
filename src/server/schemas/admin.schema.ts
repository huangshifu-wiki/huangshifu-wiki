import { z } from 'zod'
import { passwordSchema } from './auth.schema'

export const backupRestoreSchema = z.object({
  password: z.string().min(1),
})

export const adminResetUserPasswordSchema = z.object({
  newPassword: passwordSchema,
})
