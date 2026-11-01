import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const NAMES = ['lint', 'unit', 'integration', 'build']
const DEFAULT_COMMANDS = Object.fromEntries(
  NAMES.map((name) => [
    name,
    {
      command: 'npm',
      args: ['run', { unit: 'test:unit', integration: 'test:integration' }[name] || name],
    },
  ])
)

export async function runVerify(commands = DEFAULT_COMMANDS) {
  const started = performance.now()
  const stages = NAMES.map((name) => ({ name, status: '未运行', seconds: null }))
  const groups = new Set()
  const workers = String(Math.max(1, Math.floor(availableParallelism() / 2)))
  let uploadsRoot
  let interrupted
  let escalation
  let groupCheck
  let stoppedGroups = Promise.resolve()
  let setupFailed = false

  function signalGroups(signal) {
    for (const pid of groups) {
      try {
        process.kill(-pid, signal)
      } catch (error) {
        if (error.code === 'ESRCH') groups.delete(pid)
        else console.error(`[verify] 进程组 ${pid}: ${error.message}`)
      }
    }
  }

  function interrupt(signal) {
    if (interrupted) return
    interrupted = signal
    signalGroups(signal)
    // npm 的后代也属于独立进程组；等待整组退出，超时再强制终止。
    stoppedGroups = new Promise((resolve) => {
      groupCheck = setInterval(() => {
        signalGroups(0)
        if (groups.size === 0) resolve()
      }, 25)
      escalation = setTimeout(() => {
        signalGroups('SIGKILL')
        resolve()
      }, 5000)
    })
  }
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)

  async function run(name) {
    if (interrupted) return
    const stage = stages.find((item) => item.name === name)
    const { command, args } = commands[name]
    const env = { ...process.env }
    if (name === 'unit' || name === 'integration') env.UPLOADS_PATH = path.join(uploadsRoot, name)
    if (name === 'unit' || name === 'build') env.VERIFY_MAX_WORKERS = workers
    const start = performance.now()
    console.log(`[verify:${name}] 开始：${command} ${args.join(' ')}`)
    await new Promise((resolve) => {
      let errorMessage
      let child
      const finish = (code, signal) => {
        stage.seconds = (performance.now() - start) / 1000
        stage.status = interrupted ? '中断' : code === 0 && !errorMessage ? '通过' : '失败'
        if (stage.status === '失败') {
          stage.error = errorMessage || `退出码 ${code}${signal ? `，信号 ${signal}` : ''}`
          console.error(`[verify:${name}] ${command} ${args.join(' ')}：${stage.error}`)
        }
        console.log(`[verify:${name}] ${stage.status}（${stage.seconds.toFixed(2)} 秒）`)
        resolve()
      }
      try {
        child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit', detached: true })
      } catch (error) {
        errorMessage = error.message
        finish(null, null)
        return
      }
      if (child.pid) groups.add(child.pid)
      child.on('error', (error) => {
        errorMessage = error.message
      })
      child.on('close', finish)
    })
  }

  try {
    uploadsRoot = await mkdtemp(path.join(tmpdir(), 'huangshifu-verify-'))
    await Promise.all(['unit', 'integration'].map((name) => mkdir(path.join(uploadsRoot, name))))
    if (availableParallelism() < 4) {
      for (const name of NAMES) {
        await run(name)
        if (stages.find((stage) => stage.name === name).status !== '通过') break
      }
    } else {
      await Promise.all([
        run('integration'),
        (async () => {
          await run('lint')
          if (stages[0].status === '通过') await Promise.all([run('unit'), run('build')])
        })(),
      ])
    }
  } catch (error) {
    setupFailed = true
    console.error(`[verify] ${error.message}`)
  } finally {
    await stoppedGroups
    clearInterval(groupCheck)
    clearTimeout(escalation)
    try {
      if (uploadsRoot) await rm(uploadsRoot, { recursive: true, force: true })
    } catch (error) {
      setupFailed = true
      console.error(`[verify] 清理上传目录失败：${error.message}`)
    }
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
  }
  const totalSeconds = (performance.now() - started) / 1000
  const exitCode =
    interrupted === 'SIGINT'
      ? 130
      : interrupted === 'SIGTERM'
        ? 143
        : setupFailed || stages.some((stage) => stage.status !== '通过')
          ? 1
          : 0
  console.log('\n阶段 | 结果 | 耗时（秒）')
  for (const stage of stages) {
    console.log(
      `${stage.name} | ${stage.status} | ${stage.seconds === null ? '—' : stage.seconds.toFixed(2)}`
    )
  }
  console.log(`整体耗时：${totalSeconds.toFixed(2)} 秒`)
  return { exitCode, stages, totalSeconds }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = (await runVerify()).exitCode
}
