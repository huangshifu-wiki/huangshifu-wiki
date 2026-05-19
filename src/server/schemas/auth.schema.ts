import { z } from 'zod'

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(6).max(128),
  displayName: z.string().min(1).max(50),
})

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})
