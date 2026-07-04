export const DEFAULT_WIKI_CATEGORIES = [
  {
    id: 'biography',
    name: '人物介绍',
    description: '人物相关百科页面',
    order: 10,
    requiresAdminEdit: false,
  },
  {
    id: 'music',
    name: '音乐作品',
    description: '音乐作品相关百科页面',
    order: 20,
    requiresAdminEdit: true,
  },
  {
    id: 'album',
    name: '专辑一览',
    description: '专辑相关百科页面',
    order: 30,
    requiresAdminEdit: false,
  },
  {
    id: 'event',
    name: '活动记录',
    description: '活动与演出相关百科页面',
    order: 50,
    requiresAdminEdit: false,
  },
]

export const DEFAULT_WIKI_CATEGORY_ID = DEFAULT_WIKI_CATEGORIES[0].id

const DEFAULT_WIKI_CATEGORY_MAP = new Map(
  DEFAULT_WIKI_CATEGORIES.map((category) => [category.id, category])
)

export function getDefaultWikiCategoryLabel(category: string) {
  return DEFAULT_WIKI_CATEGORY_MAP.get(category)?.name || category
}
