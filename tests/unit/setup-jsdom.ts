import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

process.env.RTL_SKIP_AUTO_CLEANUP = 'true'
Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: () => {},
})

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: () => {},
})
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(),
})

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
