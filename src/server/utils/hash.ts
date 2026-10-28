import crypto from 'crypto'
import fs from 'fs'

/**
 * 计算文件的 MD5 哈希值
 * @param filePath 文件路径
 * @returns MD5 哈希值（十六进制字符串）
 */
export async function calculateFileMD5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5')
    const stream = fs.createReadStream(filePath)

    stream.on('error', (err) => {
      reject(new Error(`读取文件失败: ${err.message}`))
    })

    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk)
    })

    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}
