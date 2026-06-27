import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

process.env.RTL_SKIP_AUTO_CLEANUP = 'true'

const { cleanup } = await import('@testing-library/react')

const flushScheduler = async () => {
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

afterEach(async () => {
  await flushScheduler()
  cleanup()
  await flushScheduler()
})
