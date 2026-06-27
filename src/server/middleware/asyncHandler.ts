import type {
  NextFunction,
  ParamsFlatDictionary,
  Request,
  RequestHandler,
  Response,
} from 'express-serve-static-core'

export function asyncHandler<T extends RequestHandler<ParamsFlatDictionary>>(fn: T): RequestHandler<ParamsFlatDictionary> {
  return (req: Request<ParamsFlatDictionary>, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
