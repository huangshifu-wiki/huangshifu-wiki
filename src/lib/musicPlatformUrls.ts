export function getPlatformExternalUrl(platform: string, id: string): string | null {
  if (!id || !id.trim()) return null
  switch (platform) {
    case 'netease':
      return `https://music.163.com/song?id=${id}`
    case 'tencent':
      return `https://y.qq.com/n/ryqq/songDetail/${id}`
    case 'kugou':
      return `https://www.kugou.com/song/#hash=${id}`
    case 'baidu':
      return `https://music.91q.com/#/song/${id}`
    case 'kuwo':
      return `https://www.kuwo.cn/play_detail/${id}`
    default:
      return null
  }
}
