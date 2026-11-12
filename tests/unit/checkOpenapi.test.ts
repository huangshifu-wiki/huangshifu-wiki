import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../../scripts/check-openapi.ts', import.meta.url))
const tsx = createRequire(import.meta.url).resolve('tsx/cli')
const directories: string[] = []
const excluded = [
  ['post', '/api/auth/login'],
  ['post', '/api/auth/wechat/login'],
  ['post', '/api/auth/logout'],
  ['get', '/api/users/me/api-keys'],
  ['post', '/api/users/me/api-keys'],
  ['delete', '/api/users/me/api-keys/:id'],
]

function fixture(binding = 'registerWidgetRoutes', module = "'./routes'", properties?: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'check-openapi-test-'))
  directories.push(directory)
  mkdirSync(path.join(directory, 'public'))
  // 动态 import() 是待解析的回归输入，不能改为静态导入。
  writeFileSync(
    path.join(directory, 'server.ts'),
    `import { registerSessionRoutes } from './routes'
registerSessionRoutes(app)
if (false) {
  const { ${binding} } = await import(${module})
  ${binding.includes(':') ? binding.split(':')[1].trim() : binding}(app)
}`
  )
  // 若检查器执行而不是解析模块，这个异常会让测试失败。
  writeFileSync(
    path.join(directory, 'routes.ts'),
    `throw new Error('路由模块不得在静态检查中执行')
export function registerSessionRoutes(app: unknown) {
  ${excluded.map(([method, route]) => `app.${method}('${route}', handler)`).join('\n  ')}
}
export function registerWidgetRoutes(app: unknown) {
  app.get('/api/widgets', handler)
}`
  )
  writeFileSync(
    path.join(directory, 'public/openapi.json'),
    `{"paths":{${
      properties ??
      '"/api/widgets":{"get":{"operationId":"listWidgets","summary":"查询组件","tags":["组件"]}}'
    }}}`
  )
  writeFileSync(path.join(directory, 'public/api-docs.md'), '### GET /api/widgets\n')
  return directory
}

function check(directory: string) {
  const result = spawnSync(process.execPath, [tsx, script], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  })
  if (result.error) throw result.error
  return result
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OpenAPI 静态路由检查', () => {
  it.each(['registerWidgetRoutes', 'registerWidgetRoutes: registerLazyRoutes'])(
    '解析 Babel 8 动态导入与条件分支，不执行模块：%s',
    (binding) => {
      const result = check(fixture(binding))
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('挂载 7 项，排除 6 项，规范与 Markdown 均为 1 项')
    }
  )

  it('动态导入路由缺少文档时仍然报错', () => {
    const result = check(fixture(undefined, undefined, ''))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('OpenAPI 缺少：get /api/widgets')
  })

  it('拒绝无法静态解析的动态模块路径', () => {
    const result = check(fixture(undefined, 'modulePath'))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('不支持动态模块表达式')
  })

  it('表达式 AST 仍能发现 JSON 重复键', () => {
    const result = check(
      fixture(
        undefined,
        undefined,
        '"/api/widgets":{"get":{"operationId":"listWidgets","summary":"查询组件","summary":"重复说明","tags":["组件"]}}'
      )
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('JSON 键重复：summary')
  })
})
