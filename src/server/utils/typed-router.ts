import { Router } from 'express'
import type {
  ErrorRequestHandler,
  ParamsFlatDictionary,
  PathParams,
  RequestHandler,
  Router as ExpressRouter,
} from 'express-serve-static-core'

type FlatHandler =
  | RequestHandler<ParamsFlatDictionary>
  | RequestHandler
  | ErrorRequestHandler<ParamsFlatDictionary>
  | ErrorRequestHandler
  | Array<
      | RequestHandler<ParamsFlatDictionary>
      | RequestHandler
      | ErrorRequestHandler<ParamsFlatDictionary>
      | ErrorRequestHandler
    >

type FlatRouteMethods = {
  get(path: PathParams, ...handlers: FlatHandler[]): ExpressRouter
  post(path: PathParams, ...handlers: FlatHandler[]): ExpressRouter
  put(path: PathParams, ...handlers: FlatHandler[]): ExpressRouter
  patch(path: PathParams, ...handlers: FlatHandler[]): ExpressRouter
  delete(path: PathParams, ...handlers: FlatHandler[]): ExpressRouter
  use(path: PathParams, ...handlers: FlatHandler[]): ExpressRouter
  use(...handlers: FlatHandler[]): ExpressRouter
}

type FlatRouter = FlatRouteMethods & ExpressRouter

export function createRouter() {
  return Router() as FlatRouter
}
