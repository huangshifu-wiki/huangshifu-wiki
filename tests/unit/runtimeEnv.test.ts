import { describe, expect, it } from 'vitest'
import {
  assertSafeProductionEnv,
  isProductionRuntime,
  isTestRuntime,
  isTruthyEnvFlag,
  isWechatLoginMockEnabled,
} from '../../src/server/utils/runtimeEnv'

describe('runtimeEnv', () => {
  it('parses explicit truthy environment flags', () => {
    expect(isTruthyEnvFlag(true)).toBe(true)
    expect(isTruthyEnvFlag(1)).toBe(true)
    expect(isTruthyEnvFlag('true')).toBe(true)
    expect(isTruthyEnvFlag('TRUE')).toBe(true)
    expect(isTruthyEnvFlag('1')).toBe(true)
    expect(isTruthyEnvFlag(' false ')).toBe(false)
    expect(isTruthyEnvFlag('0')).toBe(false)
    expect(isTruthyEnvFlag(undefined)).toBe(false)
  })

  it('detects test and production runtimes from the provided env', () => {
    expect(isTestRuntime({ NODE_ENV: 'test' })).toBe(true)
    expect(isTestRuntime({ VITEST: 'true' })).toBe(true)
    expect(isTestRuntime({ VITEST_WORKER_ID: '1' })).toBe(true)
    expect(isTestRuntime({ NODE_ENV: 'development' })).toBe(false)

    expect(isProductionRuntime({ NODE_ENV: 'production' })).toBe(true)
    expect(isProductionRuntime({ NODE_ENV: 'development' })).toBe(false)
  })

  it('keeps WeChat mock login disabled by default', () => {
    expect(isWechatLoginMockEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(isWechatLoginMockEnabled({ NODE_ENV: 'test' })).toBe(false)
  })

  it('allows WeChat mock login only outside production', () => {
    expect(
      isWechatLoginMockEnabled({
        NODE_ENV: 'development',
        WECHAT_LOGIN_MOCK: 'true',
      })
    ).toBe(true)
    expect(
      isWechatLoginMockEnabled({
        NODE_ENV: 'test',
        WECHAT_LOGIN_MOCK: '1',
      })
    ).toBe(true)
    expect(
      isWechatLoginMockEnabled({
        NODE_ENV: 'production',
        WECHAT_LOGIN_MOCK: 'true',
      })
    ).toBe(false)
  })

  it('rejects production startup when WeChat mock login is enabled', () => {
    expect(() =>
      assertSafeProductionEnv({
        NODE_ENV: 'production',
        WECHAT_LOGIN_MOCK: 'true',
      })
    ).toThrow('WECHAT_LOGIN_MOCK must be false or unset when NODE_ENV=production')

    expect(() =>
      assertSafeProductionEnv({
        NODE_ENV: 'production',
        WECHAT_LOGIN_MOCK: '1',
      })
    ).toThrow('WECHAT_LOGIN_MOCK must be false or unset when NODE_ENV=production')
  })

  it('allows safe production and non-production WeChat mock settings', () => {
    expect(() => assertSafeProductionEnv({ NODE_ENV: 'production' })).not.toThrow()
    expect(() =>
      assertSafeProductionEnv({
        NODE_ENV: 'production',
        WECHAT_LOGIN_MOCK: 'false',
      })
    ).not.toThrow()
    expect(() =>
      assertSafeProductionEnv({
        NODE_ENV: 'development',
        WECHAT_LOGIN_MOCK: 'true',
      })
    ).not.toThrow()
    expect(() =>
      assertSafeProductionEnv({
        NODE_ENV: 'test',
        WECHAT_LOGIN_MOCK: 'true',
      })
    ).not.toThrow()
  })
})
