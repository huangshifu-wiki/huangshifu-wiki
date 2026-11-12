import fs from 'node:fs'
import path from 'node:path'
import { parse, parseExpression } from '@babel/parser'

// 只解析源码；不加载路由模块、数据库或后台任务。
type Node = {
  type: string
  name?: string
  value?: unknown
  loc?: { start: { line: number } }
  [key: string]: unknown
}
type Operation = { method: string; route: string; origin: string }
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
const root = process.cwd()
const failures: string[] = []
const excluded = new Map([
  ['post /api/auth/login', '仅网站会话登录'],
  ['post /api/auth/wechat/login', '仅网站会话登录'],
  ['post /api/auth/logout', '仅网站会话登出'],
  ['get /api/users/me/api-keys', '仅 Cookie 会话管理密钥'],
  ['post /api/users/me/api-keys', '仅 Cookie 会话管理密钥'],
  ['delete /api/users/me/api-keys/:id', '仅 Cookie 会话管理密钥'],
])
const node = (value: unknown) => value as Node
const nodes = (value: unknown) => value as Node[]
const visit = (value: unknown, callback: (item: Node) => void) => {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, callback))
    return
  }
  const item = node(value)
  if (typeof item.type !== 'string') return
  callback(item)
  for (const [key, child] of Object.entries(item)) {
    if (!['loc', 'start', 'end', 'tokens', 'comments'].includes(key)) visit(child, callback)
  }
}
const name = (value: unknown) => node(value)?.name
const literal = (value: unknown) => {
  const item = node(value)
  return item?.type === 'StringLiteral' ? String(item.value) : undefined
}
const canonicalPaths = new Map<string, string>()
const normalize = (route: string) => {
  const normalized = route
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\*([A-Za-z0-9_]+)/g, '{$1}')
  return canonicalPaths.get(normalized.replace(/\{[^}]+\}/g, '{}')) ?? normalized
}
const key = (operation: Operation) => `${operation.method} ${normalize(operation.route)}`
const location = (file: string, item: Node) => `${file}:${item.loc?.start.line ?? '?'}`
type Source = {
  imports: Node[]
  calls: Node[]
  functions: Map<string, Node>
}
const cache = new Map<string, Source>()
const source = (file: string) => {
  const cached = cache.get(file)
  if (cached) return cached
  const ast = parse(fs.readFileSync(path.join(root, file), 'utf8'), {
    sourceType: 'module',
    plugins: ['typescript'],
    attachComment: false,
  })
  const indexed: Source = { imports: [], calls: [], functions: new Map() }
  // 每个模块只扫描一次，注册函数与路由调用共用索引。
  visit(ast, (item) => {
    if (
      item.type === 'ImportDeclaration' ||
      (item.type === 'VariableDeclarator' && node(item.id)?.type === 'ObjectPattern')
    ) {
      indexed.imports.push(item)
    }
    if (item.type === 'CallExpression') indexed.calls.push(item)
    if (item.type === 'FunctionDeclaration') {
      indexed.functions.set(name(item.id)!, item)
    }
    if (
      item.type === 'VariableDeclarator' &&
      ['ArrowFunctionExpression', 'FunctionExpression'].includes(node(item.init)?.type)
    ) {
      indexed.functions.set(name(item.id)!, node(item.init))
    }
  })
  cache.set(file, indexed)
  return indexed
}
const resolveModule = (file: string, module: string) => {
  const base = path.resolve(root, path.dirname(file), module)
  const resolved = [base, `${base}.ts`, path.join(base, 'index.ts')].find((candidate) =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()
  )
  if (!resolved) throw new Error(`${file}: 无法解析模块 ${module}`)
  return path.relative(root, resolved)
}

function collectRoutes(): Operation[] {
  const server = source('server.ts')
  const registrations = new Map<string, { module: string; exported: string }>()
  server.imports.forEach((item) => {
    if (item.type === 'ImportDeclaration') {
      const module = literal(item.source)
      if (!module?.startsWith('.')) return
      for (const specifier of nodes(item.specifiers)) {
        if (specifier.type === 'ImportSpecifier') {
          registrations.set(name(specifier.local)!, {
            module,
            exported: name(specifier.imported) ?? literal(specifier.imported)!,
          })
        }
      }
    }
    if (item.type !== 'VariableDeclarator' || node(item.id)?.type !== 'ObjectPattern') return
    const init = node(item.init)
    const awaited = init?.type === 'AwaitExpression' ? node(init.argument) : init
    // Babel 8 将动态 import() 表示为 ImportExpression，模块路径位于 source。
    if (awaited?.type !== 'ImportExpression') return
    const module = literal(awaited.source)
    if (!module) throw new Error(`${location('server.ts', item)}: 不支持动态模块表达式`)
    if (!module.startsWith('.')) return
    for (const property of nodes(node(item.id).properties)) {
      registrations.set(name(property.value)!, {
        module,
        exported: name(property.key)!,
      })
    }
  })

  const operations: Operation[] = []
  const invoked = new Set<string>()
  server.calls.forEach((item) => {
    if (name(nodes(item.arguments)[0]) !== 'app') return
    const registrationName = name(item.callee)
    if (!registrationName?.startsWith('register')) return
    const registration = registrations.get(registrationName)
    if (!registration) throw new Error(`${location('server.ts', item)}: 未解析 ${registrationName}`)
    const file = resolveModule('server.ts', registration.module)
    const identity = `${file}:${registration.exported}`
    if (invoked.has(identity)) throw new Error(`${identity}: 注册函数重复调用`)
    invoked.add(identity)
    const indexed = source(file)
    const fn = indexed.functions.get(registration.exported)
    if (!fn) throw new Error(`${identity}: 未找到路由注册函数`)
    const appName = name(nodes(fn.params)[0])
    const mounts: { prefix: string; router: string }[] = []
    visit(fn.body, (call) => {
      if (call.type !== 'CallExpression') return
      const callee = node(call.callee)
      if (name(callee.object) !== appName) return
      const method = name(callee.property)
      const args = nodes(call.arguments)
      const prefix = literal(args[0])
      if (!prefix) {
        throw new Error(`${location(file, call)}: 不支持的路由注册表达式`)
      }
      if (!prefix.startsWith('/api/')) return
      if (method && methods.includes(method)) {
        operations.push({ method, route: prefix, origin: location(file, call) })
        return
      }
      if (method !== 'use') {
        throw new Error(`${location(file, call)}: 不支持的路由方法 ${method}`)
      }
      const routers = args.slice(1).map((argument) => name(argument))
      if (routers.length !== 1 || !routers[0]) {
        throw new Error(`${location(file, call)}: 不支持的 router 挂载表达式`)
      }
      mounts.push({ prefix, router: routers[0] })
    })

    // 链式 route().put().patch() 回溯至原始 router 和路径。
    const chain = (expression: Node): { router?: string; route?: string } | undefined => {
      if (expression.type !== 'CallExpression') return undefined
      const callee = node(expression.callee)
      if (callee.type !== 'MemberExpression') return undefined
      if (name(callee.property) === 'route') {
        return { router: name(callee.object), route: literal(nodes(expression.arguments)[0]) }
      }
      return chain(node(callee.object))
    }
    indexed.calls.forEach((call) => {
      const callee = node(call.callee)
      if (callee.type !== 'MemberExpression') return
      const method = name(callee.property)
      const chained =
        node(callee.object).type === 'CallExpression' ? chain(node(callee.object)) : undefined
      const router = chained?.router ?? name(callee.object)
      const mount = mounts.find((entry) => entry.router === router)
      if (!mount || method === 'route') return
      if (!method || !methods.includes(method)) {
        throw new Error(`${location(file, call)}: 不支持的路由方法 ${method ?? '[表达式]'}`)
      }
      const route = chained?.route ?? literal(nodes(call.arguments)[0])
      if (route === undefined || !route.startsWith('/')) {
        throw new Error(`${location(file, call)}: 不支持的路由路径表达式`)
      }
      operations.push({
        method,
        route: `${mount.prefix}${route === '/' ? '' : route}`,
        origin: location(file, call),
      })
    })
  })
  return operations
}

function check() {
  if (process.argv.length > 3) throw new Error('用法：tsx scripts/check-openapi.ts [规范文件]')
  const operations = collectRoutes()
  // OpenAPI 要求相同路径形状共用参数名；原始参数语义由每个方法分别说明。
  const pathVariants = new Map<string, Set<string>>()
  for (const operation of operations) {
    const route = normalize(operation.route)
    const shape = route.replace(/\{[^}]+\}/g, '{}')
    const variants = pathVariants.get(shape) ?? new Set<string>()
    variants.add(route)
    pathVariants.set(shape, variants)
  }
  for (const [shape, variants] of pathVariants) {
    if (variants.size < 2) continue
    let position = 0
    canonicalPaths.set(
      shape,
      shape.replace(/\{\}/g, () => `{identifier${++position === 1 ? '' : position}}`)
    )
  }
  const all = new Map<string, Operation>()
  for (const operation of operations) {
    const id = key(operation)
    const previous = all.get(id)
    if (previous) failures.push(`${id} 重复或标准化冲突：${previous.origin}、${operation.origin}`)
    all.set(id, operation)
  }
  for (const original of excluded.keys()) {
    const [method, route] = original.split(' ')
    if (!all.has(key({ method, route, origin: '' }))) failures.push(`排除项不再存在：${original}`)
  }
  const expected = new Set(
    operations.filter((entry) => !excluded.has(`${entry.method} ${entry.route}`)).map(key)
  )
  const specificationFile = process.argv[2] ?? 'public/openapi.json'
  const specificationText = fs.readFileSync(specificationFile, 'utf8')
  const specification = JSON.parse(specificationText)
  // JSON.parse 会覆盖重复键；额外检查语法树，避免重复路径或方法被静默吞掉。
  visit(parseExpression(specificationText), (item) => {
    if (item.type !== 'ObjectExpression') return
    const keys = new Set<string>()
    for (const property of nodes(item.properties)) {
      const propertyName = literal(property.key) ?? name(property.key)!
      if (keys.has(propertyName)) {
        failures.push(`${location(specificationFile, property)}: JSON 键重复：${propertyName}`)
      }
      keys.add(propertyName)
    }
  })
  const documented = new Set<string>()
  const operationIds = new Map<string, string>()
  for (const [route, pathItem] of Object.entries(specification.paths ?? {})) {
    for (const [method, raw] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!methods.includes(method)) continue
      const operation = raw as {
        operationId?: string
        summary?: string
        tags?: string[]
        'x-express-path'?: string
      }
      const id = `${method} ${route}`
      documented.add(id)
      const registered = all.get(id)
      if (
        registered &&
        canonicalPaths.has(route.replace(/\{[^}]+\}/g, '{}')) &&
        operation['x-express-path'] !== registered.route
      ) {
        failures.push(`${id} 的 x-express-path 必须为 ${registered.route}`)
      }
      if (!operation.operationId) failures.push(`${id} 缺少 operationId`)
      else if (operationIds.has(operation.operationId)) {
        failures.push(
          `${id} 与 ${operationIds.get(operation.operationId)} 的 operationId 重复：${operation.operationId}`
        )
      } else operationIds.set(operation.operationId, id)
      if (!operation.summary?.trim()) failures.push(`${id} 缺少 summary`)
      if (!operation.tags?.length) failures.push(`${id} 缺少 tags`)
    }
  }
  const markdown = new Set<string>()
  const text = fs.readFileSync('public/api-docs.md', 'utf8')
  for (const match of text.matchAll(
    /^### (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE) (\/api\/[^\r\n]+)$/gm
  )) {
    const id = `${match[1].toLowerCase()} ${normalize(match[2].replaceAll('\\*', '*'))}`
    if (markdown.has(id)) failures.push(`Markdown 重复正文：${id}`)
    markdown.add(id)
  }
  for (const [label, actual] of [
    ['OpenAPI', documented],
    ['Markdown', markdown],
  ] as const) {
    for (const id of expected) if (!actual.has(id)) failures.push(`${label} 缺少：${id}`)
    for (const id of actual)
      if (!expected.has(id)) failures.push(`${label} 多余或禁止密钥调用：${id}`)
  }
  if (failures.length) throw new Error(failures.map((failure) => `- ${failure}`).join('\n'))
  console.log(
    `OpenAPI 覆盖检查通过：挂载 ${operations.length} 项，排除 ${excluded.size} 项，规范与 Markdown 均为 ${expected.size} 项`
  )
}

try {
  check()
} catch (error) {
  console.error(`OpenAPI 检查失败：\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
