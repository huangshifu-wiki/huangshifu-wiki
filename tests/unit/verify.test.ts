import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { runVerify } from '../../scripts/verify.mjs'

const names = ['lint', 'unit', 'integration', 'build'] as const
const parallel = availableParallelism() >= 4
const directories: string[] = []
const nodeCommand = (code: string) => ({ command: process.execPath, args: ['-e', code] })
async function directory() {
  const dir = await mkdtemp(path.join(tmpdir(), 'verify-test-'))
  directories.push(dir)
  return dir
}
// 文件握手跨越真实 Node 进程，轮询只等待可观测状态，不能使用进程内假时钟。
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待真实子进程就绪超时')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('verify 真实进程', () => {
  it('完成全部阶段，隔离上传目录并通过文件握手证明阶段重叠', async () => {
    const dir = await directory()
    const commands = Object.fromEntries(
      names.map((name) => [
        name,
        nodeCommand(`
      const fs = require('node:fs');
      const dir = ${JSON.stringify(dir)};
      const name = ${JSON.stringify(name)};
      const file = n => require('node:path').join(dir, n);
      const wait = async n => { while (!fs.existsSync(file(n))) await new Promise(r => setTimeout(r, 10)); };
      (async () => {
        if (name === 'unit' || name === 'build') {
          if (!fs.existsSync(file('lint'))) process.exit(9);
        }
        if (${parallel} && name === 'integration') await wait('build');
        if (${parallel} && name === 'build') await wait('integration-ready');
        fs.writeFileSync(file(name), JSON.stringify({name, uploads: process.env.UPLOADS_PATH}));
      })();
      if (name === 'integration') fs.writeFileSync(file('integration-ready'), 'ready');
    `),
      ])
    )
    const result = await runVerify(commands)
    expect(result.exitCode).toBe(0)
    expect(result.stages.map((stage) => stage.status)).toEqual(names.map(() => '通过'))
    expect(result.totalSeconds).toBeGreaterThanOrEqual(0)
    const files = await Promise.all(
      names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), 'utf8')))
    )
    expect(files.map((file) => file.name)).toEqual(names)
    const unit = files[1].uploads
    const integration = files[2].uploads
    expect(unit).not.toBe(integration)
    expect(path.dirname(unit)).toBe(path.dirname(integration))
    expect(existsSync(path.dirname(unit))).toBe(false)
  })

  it.each(['退出码', '启动失败'])('保留失败原因且等待其他阶段完成：%s', async (failure) => {
    const dir = await directory()
    const commands = Object.fromEntries(
      names.map((name) => [
        name,
        nodeCommand(`
      require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, name))}, '完成')
    `),
      ])
    )
    commands.unit =
      failure === '退出码'
        ? nodeCommand('process.exit(7)')
        : { command: path.join(dir, '不存在的命令'), args: [] }
    const result = await runVerify(commands)
    expect(result.exitCode).toBe(1)
    expect(result.stages.find((stage) => stage.name === 'unit')).toMatchObject({
      status: '失败',
      error: expect.stringMatching(failure === '退出码' ? /7/ : /ENOENT/),
    })
    for (const name of parallel ? ['lint', 'integration', 'build'] : ['lint']) {
      expect(await readFile(path.join(dir, name), 'utf8')).toBe('完成')
    }
  })

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('转发 %s 至子进程及后代，等待退出后返回 %i', async (signal, exitCode) => {
    const dir = await directory()
    const runningNames = parallel ? ['unit', 'integration'] : ['unit']
    // 父进程负责回收后代，标记与 PID 用于验证真实信号传播及退出。
    const childCode = `
        const fs = require('node:fs');
        fs.writeFileSync(process.env.MARK + '-child-ready', String(process.pid));
        process.on(${JSON.stringify(signal)}, () => {
          fs.writeFileSync(process.env.MARK + '-child-stopped', '停止'); process.exit(0);
        });
        setInterval(() => {}, 1000);
      `
    const parentCode = `
        const fs = require('node:fs');
        const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio: 'inherit'});
        fs.writeFileSync(process.env.MARK + '-parent-ready', String(process.pid));
        process.on(${JSON.stringify(signal)}, () => {
          fs.writeFileSync(process.env.MARK + '-parent-stopped', '停止');
          child.on('close', () => process.exit(0));
        });
      `
    const harness = path.join(dir, 'harness.mjs')
    await writeFile(
      harness,
      `
        import { runVerify } from ${JSON.stringify(new URL('../../scripts/verify.mjs', import.meta.url).href)};
        import { writeFile } from 'node:fs/promises';
        const commands = Object.fromEntries(${JSON.stringify(names)}.map(name => [name, {
          command: process.execPath,
          args: ['-e', ${JSON.stringify(parallel ? ['unit', 'integration'] : ['unit'])}.includes(name)
            ? 'process.env.MARK = ' + JSON.stringify(${JSON.stringify(dir)} + '/' + name) + ';' + ${JSON.stringify(parentCode)}
            : 'process.exit(0)']
        }]));
        const result = await runVerify(commands);
        await writeFile(${JSON.stringify(path.join(dir, 'result'))}, JSON.stringify(result));
        process.exitCode = result.exitCode;
      `
    )
    const processHarness = spawn(process.execPath, [harness], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    processHarness.stdout.on('data', (data) => {
      output += data
    })
    processHarness.stderr.on('data', (data) => {
      output += data
    })
    const closed = new Promise((resolve) => processHarness.on('close', resolve))
    try {
      await waitFor(() =>
        runningNames.every((name) =>
          ['parent', 'child'].every((kind) => existsSync(path.join(dir, `${name}-${kind}-ready`)))
        )
      )
      processHarness.kill(signal)
      expect(await closed, output).toBe(exitCode)
      const result = JSON.parse(await readFile(path.join(dir, 'result'), 'utf8'))
      expect(result.exitCode).toBe(exitCode)
      expect(
        result.stages
          .filter((stage) => runningNames.includes(stage.name))
          .map((stage) => stage.status)
      ).toEqual(runningNames.map(() => '中断'))
      for (const name of runningNames)
        for (const kind of ['parent', 'child']) {
          expect(await readFile(path.join(dir, `${name}-${kind}-stopped`), 'utf8')).toBe('停止')
          const pid = Number(await readFile(path.join(dir, `${name}-${kind}-ready`), 'utf8'))
          expect(() => process.kill(pid, 0)).toThrow()
        }
    } finally {
      if (processHarness.exitCode === null) {
        processHarness.kill('SIGTERM')
        await closed
      }
    }
  })
})
