import pino from 'pino'
import { isProductionRuntime, isTestRuntime } from './runtimeEnv'

const isTest = isTestRuntime()
const verboseIntegrationLogging = process.env.DEBUG_INTEGRATION === '1'

export const logger = pino({
  level: isTest && !verboseIntegrationLogging ? 'error' : 'info',
  transport:
    !isProductionRuntime() && !(isTest && !verboseIntegrationLogging)
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
    log: (object) => {
      if (object.password || object.pass) object.password = '[REDACTED]'
      if (object.email && typeof object.email === 'string')
        object.email = object.email.substring(0, 3) + '***'
      return object
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

/**
 * 运行时调整日志级别（pino 支持动态切换），由 runtimeConfigService 驱动。
 */
export function setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
  if (isTest && !verboseIntegrationLogging) {
    logger.level = 'error'
    return
  }
  logger.level = level
}
