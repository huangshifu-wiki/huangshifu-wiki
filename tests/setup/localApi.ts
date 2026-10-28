import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { promisify } from 'node:util'

export interface LocalApi {
  handlers: Map<string, (req: IncomingMessage, res: ServerResponse) => void>
  requests: string[]
  fetch: typeof fetch
  json: (path: string, body: unknown, status?: number) => void
  close: () => Promise<void>
}

// 通过本地 HTTP 服务驱动真实 apiClient，不替换项目模块或伪造 fetch 响应。
export async function createLocalApi(): Promise<LocalApi> {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const requests: string[] = []
  const server = createServer((req, res) => {
    const pathname = new URL(req.url!, 'http://localhost').pathname
    requests.push(pathname)
    res.setHeader('Content-Type', 'application/json')
    const handler = handlers.get(pathname)
    if (handler) handler(req, res)
    else {
      res.statusCode = 404
      res.end(JSON.stringify({ error: `未配置测试接口：${pathname}` }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const nativeFetch = globalThis.fetch
  return {
    handlers,
    requests,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      nativeFetch(typeof input === 'string' ? new URL(input, origin) : input, init),
    json(path: string, body: unknown, status = 200) {
      handlers.set(path, (_req, res) => {
        res.statusCode = status
        res.end(JSON.stringify(body))
      })
    },
    async close() {
      server.closeAllConnections()
      await promisify(server.close.bind(server))()
    },
  }
}
