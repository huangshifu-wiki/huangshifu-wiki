import { PrismaClient } from '@prisma/client'
import { DEFAULT_WIKI_CATEGORIES } from '../src/lib/wikiCategories'

const prisma = new PrismaClient()

async function main() {
  const [sectionCount, userCount, wikiPageCount] = await Promise.all([
    prisma.section.count(),
    prisma.user.count(),
    prisma.wikiPage.count(),
  ])
  const isPristineInstall = sectionCount === 0 && userCount === 0 && wikiPageCount === 0

  if (sectionCount === 0) {
    await prisma.section.createMany({
      data: [
        { id: 'music', name: '音乐讨论', description: '作品、翻唱与现场讨论', order: 1 },
        { id: 'news', name: '动态资讯', description: '活动与官方动态', order: 2 },
        { id: 'fanart', name: '同人创作', description: '绘画、视频与二创', order: 3 },
        { id: 'qa', name: '问答区', description: '新手提问与经验分享', order: 4 },
      ],
    })
  }

  if (isPristineInstall) {
    const defaultCategoryIds = DEFAULT_WIKI_CATEGORIES.map((category) => category.id)

    await prisma.$transaction([
      prisma.wikiCategory.deleteMany({
        where: {
          id: { notIn: defaultCategoryIds },
          pages: { none: {} },
        },
      }),
      ...DEFAULT_WIKI_CATEGORIES.map((category) =>
        prisma.wikiCategory.upsert({
          where: { id: category.id },
          update: {
            name: category.name,
            description: category.description,
            order: category.order,
            requiresAdminEdit: category.requiresAdminEdit,
          },
          create: {
            id: category.id,
            name: category.name,
            description: category.description,
            order: category.order,
            requiresAdminEdit: category.requiresAdminEdit,
          },
        })
      ),
    ])
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
