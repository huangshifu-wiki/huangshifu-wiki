import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

// CLI 与应用保持相同的环境优先级；测试命令不得回退到开发数据库。
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test', quiet: true })
} else {
  if (process.env.NODE_ENV !== 'production') {
    dotenv.config({ path: '.env.local', quiet: true })
  }
  dotenv.config({ quiet: true })
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // generate 不需要数据库或占位连接串；数据库命令会要求实际 URL。
  datasource: { url: process.env.DATABASE_URL },
})
