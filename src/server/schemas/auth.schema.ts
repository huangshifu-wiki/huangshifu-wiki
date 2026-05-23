import { z } from 'zod'

export const AUTH_DISPLAY_NAME_MAX_LENGTH = 50

const authEmailSchema = z
  .string({ error: '邮箱不能为空' })
  .trim()
  .superRefine((value, ctx) => {
    if (!value) {
      ctx.addIssue({
        code: 'custom',
        message: '邮箱不能为空',
      })
      return
    }

    if (!z.email().safeParse(value).success) {
      ctx.addIssue({
        code: 'custom',
        message: '邮箱格式无效',
      })
    }
  })

const optionalDisplayNameSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value
    }

    const normalizedValue = value.trim()
    return normalizedValue || undefined
  },
  z
    .string({ error: '显示名称不能为空' })
    .max(AUTH_DISPLAY_NAME_MAX_LENGTH, `显示名称过长，最多${AUTH_DISPLAY_NAME_MAX_LENGTH}个字符`)
    .optional()
)

export const registerSchema = z.object({
  email: authEmailSchema,
  password: z
    .string({ error: '密码不能为空' })
    .min(8, '密码至少8个字符')
    .max(128, '密码最多128个字符'),
  displayName: optionalDisplayNameSchema,
})

export const loginSchema = z.object({
  email: authEmailSchema,
  password: z
    .string({ error: '密码不能为空' })
    .min(1, '密码不能为空'),
})
