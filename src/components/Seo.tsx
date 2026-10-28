import { useSeo } from '../lib/seo'
import type { SeoMetadata } from '../lib/seo'

// 无 UI 输出的 headless 组件，只负责把元数据写入 document head
export const Seo = ({ metadata }: { metadata: SeoMetadata }): null => {
  useSeo(metadata)
  return null
}
