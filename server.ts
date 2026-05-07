import dotenv from 'dotenv';

// 立即加载环境变量，确保在导入其他模块之前
// 其他模块可能依赖于 process.env
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.local' });
}
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import { initSensitiveWords } from './src/lib/sensitiveWordFilter';
import { prisma } from './src/server/prisma';
import { authMiddleware } from './src/server/middleware/auth';
import { requestLoggerMiddleware } from './src/server/middleware/requestLogger';
import { registerRegionRoutes } from './src/server/location/routes';
import { registerExifRoutes } from './src/server/location/exifRoutes';
import { registerBirthdayRoutes } from './src/server/birthday/routes';
import { registerAuthRoutes } from './src/server/routes/auth.routes';
import { registerUsersRoutes } from './src/server/routes/users.routes';
import { registerWikiRoutes } from './src/server/routes/wiki.routes';
import { registerPostsRoutes } from './src/server/routes/posts.routes';
import { registerGalleriesRoutes } from './src/server/routes/galleries.routes';
import { registerMusicRoutes } from './src/server/routes/music.routes';
import { registerAlbumsRoutes } from './src/server/routes/albums.routes';
import { registerSearchRoutes } from './src/server/routes/search.routes';
import { registerEmbeddingsRoutes } from './src/server/routes/embeddings.routes';
import { registerAdminRoutes } from './src/server/routes/admin.routes';
import { registerNotificationsRoutes } from './src/server/routes/notifications.routes';
import { registerFavoritesRoutes } from './src/server/routes/favorites.routes';
import { registerSectionsRoutes } from './src/server/routes/sections.routes';
import { registerAnnouncementsRoutes } from './src/server/routes/announcements.routes';
import { registerImageMapsRoutes } from './src/server/routes/image-maps.routes';
import { registerConfigRoutes } from './src/server/routes/config.routes';
import { registerS3Routes } from './src/server/routes/s3.routes';
import { registerMusicSongRoutes } from './src/server/routes/music-song.routes';
import { registerUploadRoutes } from './src/server/routes/uploads.routes';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const backupsDir = path.join(__dirname, 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

// ============================================================================
// CORS 配置 - 优化预检请求性能
// ============================================================================
// 配置 Access-Control-Max-Age 缓存预检结果，减少 OPTIONS 请求次数
// 浏览器默认缓存时间：Chrome 10分钟，Firefox 24小时，Safari 5分钟
// 设置为 86400 秒 (24小时) 以最大化缓存效果
const CORS_MAX_AGE = 86400; // 24小时

if (CORS_ORIGIN) {
  app.use(cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // 只保留必要的请求头，减少预检请求复杂度
    // Content-Type: application/json 会触发预检，但这是必需的
    // Authorization 用于认证，也是必需的
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: CORS_MAX_AGE, // 缓存预检结果 24 小时
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }));
} else {
  // 开发环境或同源部署：允许所有来源，但仍配置 maxAge 优化性能
  app.use(cors({
    origin: true,
    credentials: true,
    maxAge: CORS_MAX_AGE,
  }));
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));

// 启用 gzip 压缩 - 优化传输性能
app.use(compression({
  level: 6, // 压缩级别 (1-9)，6 是性能和压缩率的平衡
  filter: (req, res) => {
    // 不压缩已经压缩的内容类型
    if (req.headers['x-no-compression']) {
      return false;
    }
    // 使用默认的压缩过滤器
    return compression.filter(req, res);
  },
  threshold: 1024, // 只有大于 1KB 的响应才压缩
}));

// 生产环境静态资源服务 - 必须在 compression 之后
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath, {
    maxAge: '1y', // 静态资源缓存1年
    immutable: true, // 文件名带hash，内容不变则永不失效
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(authMiddleware);
app.use(requestLoggerMiddleware);

// 静态文件服务 - 必须在路由注册之前
app.use('/uploads', express.static(uploadsDir));

registerRegionRoutes(app);
registerExifRoutes(app);
registerBirthdayRoutes(app);
registerAuthRoutes(app);
registerUsersRoutes(app);
registerWikiRoutes(app);
registerPostsRoutes(app);
registerGalleriesRoutes(app);
registerMusicRoutes(app);
registerAlbumsRoutes(app);
registerSearchRoutes(app);
registerEmbeddingsRoutes(app);
registerAdminRoutes(app);
registerNotificationsRoutes(app);
registerFavoritesRoutes(app);
registerSectionsRoutes(app);
registerAnnouncementsRoutes(app);
registerImageMapsRoutes(app);
registerConfigRoutes(app);
registerS3Routes(app);
registerMusicSongRoutes(app);
registerUploadRoutes(app);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '单张图片不能超过 20MB' });
      return;
    }
    res.status(400).json({ error: err.message || '上传参数不合法' });
    return;
  }

  if (err.message?.includes('仅支持')) {
    res.status(400).json({ error: err.message });
    return;
  }

  console.error('Unhandled server error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

async function startServer() {
  await initSensitiveWords();

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: https://*.amap.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com; font-src 'self' data:; img-src 'self' data: blob: https://*.amap.com https://*.gaode.com http://*.music.126.net https://*.music.126.net http://music.163.com https://music.163.com http://*.music.163.com https://*.music.163.com https://picsum.photos https://*.picsum.photos https://fastly.picsum.photos https://*.googleusercontent.com; connect-src 'self' https://*.amap.com http://music.163.com https://music.163.com http://*.music.163.com https://*.music.163.net http://*.music.126.net https://*.music.126.net https://analysis.chatglm.cn https://gator.volces.com https://picsum.photos https://*.picsum.photos https://fastly.picsum.photos https://*.googleusercontent.com; worker-src 'self' blob:; media-src 'self' http://music.163.com https://music.163.com http://*.music.163.com https://*.music.163.com http://*.music.126.net https://*.music.126.net;"
    );
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // SPA fallback - 所有未匹配的路由返回 index.html
    app.get('*', (_req, res) => {
      const distPath = path.join(process.cwd(), 'dist');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

export { app, prisma, uploadsDir, backupsDir };
