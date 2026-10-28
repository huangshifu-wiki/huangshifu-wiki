// Node.js 22 支持此方法，项目 TypeScript 库仍为 ES2022。
const promiseWithResolvers = Promise as PromiseConstructor & {
  withResolvers<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (reason?: unknown) => void
  }
}

export const deferred = <T>() => promiseWithResolvers.withResolvers<T>()
