import { z } from 'zod'

import { passwordSchema } from './auth.schema'

export const userEmailUpdateSchema = z.object({
  currentPassword: z.string({ error: '当前密码不能为空' }).min(1, '当前密码不能为空'),
  newEmail: z
    .string({ error: '新邮箱不能为空' })
    .trim()
    .superRefine((value, ctx) => {
      if (!value) {
        ctx.addIssue({
          code: 'custom',
          message: '新邮箱不能为空',
        })
        return
      }

      if (!z.email().safeParse(value).success) {
        ctx.addIssue({
          code: 'custom',
          message: '邮箱格式无效',
        })
      }
    }),
})

export const userPasswordUpdateSchema = z.object({
  currentPassword: z.string({ error: '当前密码不能为空' }).min(1, '当前密码不能为空'),
  newPassword: passwordSchema,
})
