import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

// 构建阶段运行的 Node 与镜像目标平台一致，保留该平台的 CPU 推理二进制。
const onnxBinDir = 'node_modules/onnxruntime-node/bin/napi-v6'
for (const platform of readdirSync(onnxBinDir)) {
  const platformDir = path.join(onnxBinDir, platform)
  if (platform !== process.platform) {
    rmSync(platformDir, { recursive: true })
    continue
  }
  for (const arch of readdirSync(platformDir)) {
    if (arch !== process.arch) rmSync(path.join(platformDir, arch), { recursive: true })
  }
}

// 服务端通过原生 ONNX 推理；保留 Web 包的 JS 入口，移除浏览器 WASM 和源码映射。
const webDistDir = 'node_modules/onnxruntime-web/dist'
for (const file of readdirSync(webDistDir)) {
  if (file.endsWith('.wasm') || file.endsWith('.map')) rmSync(path.join(webDistDir, file))
}

// Prisma 保留 PostgreSQL 查询编译器，裁剪其他数据库资源和源码映射。
const runtimeDir = 'node_modules/@prisma/client/runtime'
for (const file of readdirSync(runtimeDir)) {
  const isOtherDatabase =
    /^query_compiler_(small|fast)_bg\./.test(file) && !file.includes('.postgresql.')
  if (file.endsWith('.map') || isOtherDatabase) {
    rmSync(path.join(runtimeDir, file))
  }
}
