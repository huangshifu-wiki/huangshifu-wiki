import type { Request, Response, NextFunction } from 'express'
import type { AuthenticatedRequest } from '../types'
import { z } from 'zod'

type ValidatedRequest = Request | AuthenticatedRequest

export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: ValidatedRequest, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      const fields: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const key = issue.path.join('.')
        fields[key] = issue.message
      }
      res.status(400).json({
        error: 'Validation failed',
        fields,
      })
      return
    }

    req.body = result.data
    next()
  }
}
