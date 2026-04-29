# 诗扶小筑 - 改进计划

> 创建日期：2026-03-25
> 项目类型：粉丝 Wiki 与社区平台

---

## 一、高优先级改进

### 1. 数据架构统一 ⚠️ 紧急

**问题描述**：
代码库存在 Firebase SDK 和 Prisma/MySQL 两套数据访问模式并存的混乱状态。

| 页面/组件 | 数据访问方式 | 问题 |
|-----------|-------------|------|
| `src/pages/Wiki.tsx` | Firebase SDK | 直接操作 Firestore |
| `src/pages/Forum.tsx` | Firebase SDK | 直接操作 Firestore |
| `src/pages/Admin.tsx` | Firebase SDK | 直接操作 Firestore |
| `src/pages/Music.tsx` | REST API | 通过 `/api/*` 调用后端 |
| `src/pages/Search.tsx` | REST API | 通过 `/api/*` 调用后端 |
| `server.ts` | Prisma/MySQL | 所有 API 实现 |

**影响**：
- 数据不一致风险
- 维护困难
- 权限验证不统一
- 无法在服务端对 Firebase 操作进行权限控制

**建议方案**：选择 **方案 A** - 统一使用 REST API + Prisma/MySQL

**优点**：
- 有利于 SEO
- 生产环境可控
- 减少外部依赖
- 统一的权限验证

**实施步骤**：
```
阶段1: 创建 Wiki API 端点
- POST   /api/wiki              创建百科
- GET    /api/wiki              百科列表
- GET    /api/wiki/:slug        百科详情
- PUT    /api/wiki/:slug        更新百科
- DELETE /api/wiki/:slug        删除百科
- POST   /api/wiki/:slug/submit  提交审核
- POST   /api/wiki/:slug/rollback/:revisionId  回滚
- GET    /api/wiki/:slug/revisions  获取历史版本

阶段2: 创建 Forum API 端点
- POST   /api/posts              创建帖子
- GET    /api/posts              帖子列表
- GET    /api/posts/:id          帖子详情
- PUT    /api/posts/:id          更新帖子
- DELETE /api/posts/:id          删除帖子
- POST   /api/posts/:id/submit   提交审核
- GET    /api/posts/:id/comments 评论列表
- POST   /api/posts/:id/comments 添加评论
- DELETE /api/posts/:id/comments/:commentId 删除评论
- POST   /api/posts/:id/like     点赞
- DELETE /api/posts/:id/like     取消点赞

阶段3: 重构前端页面
- 将 Wiki.tsx 中的 Firebase 调用改为 apiGet/apiPost
- 将 Forum.tsx 中的 Firebase 调用改为 apiGet/apiPost
- 将 Admin.tsx 中的 Firebase 调用改为 apiGet/apiPost
- 保留 apiClient.ts 作为统一的 API 调用层

阶段4: 清理 Firebase 代码
- 删除 firebase.ts 中的 Firestore 相关导出
- 删除不再使用的 Firebase 配置
```

---

### 2. 音乐播放器增强

**当前功能**：
- 播放/暂停
- 上一首/下一首
- 播放列表显示
- 专辑封面

**缺失功能**：
- [ ] 歌词显示 (LRC 格式解析)
- [ ] 播放进度条拖拽
- [ ] 音量控制
- [ ] 随机播放
- [ ] 单曲循环
- [ ] 播放历史记录

**歌词显示方案**：
```typescript
// src/utils/lrcParser.ts
interface LrcLine {
  time: number;  // 秒
  text: string;
}

const parseLRC = (lrcContent: string): LrcLine[] => {
  const lines = lrcContent.split('\n');
  const result: LrcLine[] = [];
  
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
  
  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const time = minutes * 60 + seconds + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      result.push({ time, text });
    }
  }
  
  return result.sort((a, b) => a.time - b.time);
};
```

**组件改进**：
```typescript
// src/components/GlobalMusicPlayer.tsx 增强

interface EnhancedMusicPlayerProps {
  // 现有 props...
  showLyrics?: boolean;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  repeatMode?: 'none' | 'one' | 'all';
  shuffle?: boolean;
}

// 新增歌词同步逻辑
const syncLyrics = (currentTime: number, lyrics: LrcLine[]) => {
  return lyrics.findIndex(line => line.time > currentTime) - 1;
};
```

---


---

### 3. 私信系统

**数据模型**：
```prisma
// prisma/schema.prisma 新增

model PrivateMessage {
  id          String   @id @default(cuid())
  fromUid     String
  toUid       String
  content     String   @db.Text
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
  
  fromUser    User     @relation("SentMessages", fields: [fromUid], references: [uid], onDelete: Cascade)
  toUser      User     @relation("ReceivedMessages", fields: [toUid], references: [uid], onDelete: Cascade)
  
  @@index([toUid, isRead, createdAt])
  @@index([fromUid, createdAt])
}

model User {
  // ... 现有字段
  sentMessages     PrivateMessage[] @relation("SentMessages")
  receivedMessages PrivateMessage[] @relation("ReceivedMessages")
}
```

**API 端点**：
```
GET    /api/messages              获取对话列表
GET    /api/messages/:userId      获取与某用户的对话
POST   /api/messages/:userId      发送私信
PUT    /api/messages/:id/read     标记已读
DELETE /api/messages/:id          删除消息
```

**前端页面**：
```
src/pages/Messages.tsx            消息列表
src/pages/Conversation.tsx        私信对话
src/components/MessageItem.tsx   消息项
```

---

## 二、中优先级改进

### 5. 用户互动增强


#### 5.1 @提及功能
在帖子/评论内容中解析 `@username` 格式，发送通知给被提及的用户。

```typescript
const mentionRegex = /@([^\s@]+)/g;

const extractMentions = (content: string): string[] => {
  const matches = content.matchAll(mentionRegex);
  return [...matches].map(m => m[1]);
};
```

---

### 6. 内容增强

#### 6.1 Wiki 草稿自动保存
```typescript
// src/hooks/useAutoSave.ts
const useAutoSave = (content: string, interval = 30000) => {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  useEffect(() => {
    const timer = setInterval(() => {
      localStorage.setItem(`draft_wiki_${slug}`, JSON.stringify({
        content,
        savedAt: new Date().toISOString()
      }));
      setLastSaved(new Date());
    }, interval);
    
    return () => clearInterval(timer);
  }, [content, interval]);
  
  return lastSaved;
};
```

#### 6.2 内容举报
```prisma
model Report {
  id          String   @id @default(cuid())
  reporterUid String
  targetType  String   // wiki / post / comment / user / gallery
  targetId    String
  reason      String
  status      String   @default("pending") // pending / reviewed / dismissed
  createdAt   DateTime @default(now())
}
```

#### 6.3 Wiki 子分类
```prisma
model WikiCategory {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  parentId  String?  // 支持两级分类
  order     Int      @default(0)
  
  parent    WikiCategory? @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children  WikiCategory[] @relation("CategoryHierarchy")
  pages     WikiPage[]
}
```

---

### 7. 搜索增强

#### 7.1 搜索结果高亮
```typescript
// src/utils/highlight.ts
const highlightMatch = (text: string, query: string): string => {
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
};
```

#### 7.2 搜索历史记录
```typescript
// src/hooks/useSearchHistory.ts
const SEARCH_HISTORY_KEY = 'search_history';
const MAX_HISTORY = 10;

const useSearchHistory = () => {
  const [history, setHistory] = useState<string[]>([]);
  
  const addToHistory = (query: string) => {
    const newHistory = [query, ...history.filter(h => h !== query)].slice(0, MAX_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    setHistory(newHistory);
  };
  
  const clearHistory = () => {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    setHistory([]);
  };
  
  return { history, addToHistory, clearHistory };
};
```

---

### 8. 移动端优化

#### 8.1 PWA 支持
```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\./,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      },
      manifest: {
        name: '诗扶小筑',
        short_name: '诗扶',
        theme_color: '#5A5A40',
        icons: [/* ... */]
      }
    })
  ]
});
```

---



### 10. 内容工具

#### 10.1 协作编辑
使用 Operational Transformation (OT) 或 CRDT 实现多人同时编辑同一百科页面。

#### 10.2 模板系统
```prisma
model WikiTemplate {
  id        String   @id @default(cuid())
  name      String
  content   String   @db.LongText
  category  String
  createdBy String
}
```

#### 10.3 草稿箱
```prisma
model Draft {
  id        String   @id @default(cuid())
  userUid   String
  type      String   // wiki / post
  title     String?
  content   String   @db.LongText
  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## 四、安全改进

### 11. API 安全增强

#### 11.1 添加速率限制
```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 100 次请求
  message: { error: '请求过于频繁，请稍后再试' }
});

app.use('/api/', apiLimiter);

// 登录接口更严格限制
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1小时
  max: 10, // 10 次尝试
  message: { error: '登录尝试次数过多，请稍后再试' }
});

app.use('/api/auth/login', authLimiter);
```

#### 11.2 输入验证增强
```typescript
import { z } from 'zod';

const WikiCreateSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  category: z.enum(['biography', 'music', 'album', 'timeline', 'event']),
  content: z.string().max(100000),
  tags: z.array(z.string()).max(10).optional(),
  eventDate: z.string().optional(),
});
```

#### 11.3 XSS 防护
当前使用 `rehype-raw` 允许原始 HTML，需要严格化：
```typescript
// 替换为更安全的方案
import rehypeSanitize from 'rehype-sanitize';

const sanitizeOptions = {
  strip: ['script', 'iframe', 'object', 'embed'],
  attributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt'],
  }
};
```



## 六、当前缺陷修复

### 紧急 (需立即处理)

| 缺陷 | 影响 | 修复方案 |
|------|------|---------|
| Firebase/Prisma 混用 | 数据不一致 | 统一到 REST API |
| 无测试覆盖 | 质量风险 | 引入 Vitest |
| WECHAT_LOGIN_MOCK 可能误开 | 安全风险 | 检查并强制设置 |

### 重要 (近期修复)

| 缺陷 | 影响 | 修复方案 |
|------|------|---------|
| 播放器无歌词 | 用户体验差 | LRC 解析 + 显示 |
| 无私信功能 | 社交缺失 | 实现私信系统 |
| 搜索无高亮 | 体验一般 | 添加高亮 |
| Admin 直接操作 Firestore | 权限风险 | 改为 API 调用 |

---

## 七、附录

### A. 依赖清单 (新增)
```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@vite-pwa/assets-generator": "^0.2.0",
    "vite-plugin-pwa": "^0.19.0",
    "zod": "^3.22.0",
    "express-rate-limit": "^7.0.0",
    "rehype-sanitize": "^6.0.0"
  }
}
```

### B. 环境变量清单 (新增)
```bash


# 速率限制
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```
