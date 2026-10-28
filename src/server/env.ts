import dotenv from 'dotenv'
import { assertSafeProductionEnv, isProductionRuntime, isTestRuntime } from './utils/runtimeEnv'

const isTestEnv = isTestRuntime()

// Load environment variables before any module reads process.env.
if (!isTestEnv && !isProductionRuntime()) {
  dotenv.config({ path: '.env.local' })
}

if (!isTestEnv) {
  dotenv.config()
}

assertSafeProductionEnv()
