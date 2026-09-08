import sharp from 'sharp'
import { runtimeConfigService } from '../services/runtimeConfig.service'

// 输入像素硬闸默认值：约 5000×5000，RGBA 解码约 100MB，用于拒绝像素炸弹
const DEFAULT_MAX_INPUT_PIXELS = 25_000_000

function resolveEnvPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

// 模块加载即生效：小内存部署下 libvips 默认按宿主机核数开 worker、缓存操作结果，
// 两者都会放大内存峰值，这里统一收紧；大内存部署可用 SHARP_CONCURRENCY 调回
sharp.cache(false)
sharp.concurrency(resolveEnvPositiveInt('SHARP_CONCURRENCY', 1))

/**
 * 计算 sharp 输入像素上限：取 env 硬闸（SHARP_MAX_INPUT_PIXELS）与
 * 运行时配置 variantSharpMemoryLimitMb 推导值（按 RGBA 4 字节/像素）中的较小者
 */
export function resolveSharpInputPixelLimit(hardCap: number, memoryLimitMb: number): number {
  const fromRuntimeConfig = (memoryLimitMb * 1024 * 1024) / 4
  return Math.floor(Math.min(hardCap, fromRuntimeConfig))
}

export function getSharpInputPixelLimit(): number {
  return resolveSharpInputPixelLimit(
    resolveEnvPositiveInt('SHARP_MAX_INPUT_PIXELS', DEFAULT_MAX_INPUT_PIXELS),
    runtimeConfigService.getConfig().variantSharpMemoryLimitMb
  )
}
