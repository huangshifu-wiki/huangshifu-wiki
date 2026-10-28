import SparkMD5 from 'spark-md5'

export async function calculateFileMd5Hex(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const binary = e.target?.result
      if (binary) {
        resolve(SparkMD5.ArrayBuffer.hash(binary as ArrayBuffer))
      } else {
        reject(new Error('Failed to read file for MD5 calculation'))
      }
    }
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.readAsArrayBuffer(file)
  })
}

export function md5HexToBase64(md5: string): string {
  const bytes = md5.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16))
  if (!bytes || bytes.length !== 16 || bytes.some((byte) => Number.isNaN(byte))) {
    throw new Error('Invalid MD5 hex digest')
  }

  return btoa(String.fromCharCode(...bytes))
}
