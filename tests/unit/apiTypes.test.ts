import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  adminBackupSchema,
  adminBackupsResponseSchema,
  adminReviewQueueItemSchema,
  adminReviewQueueResponseSchema,
  authMeResponseSchema,
  createPaginatedResponseSchema,
  galleryDetailResponseSchema,
  galleryListResponseSchema,
  gallerySchema,
  galleryUploadResponseSchema,
  musicDetailResponseSchema,
  musicListResponseSchema,
  musicPlayUrlResponseSchema,
  postDetailResponseSchema,
  postSchema,
  safeValidateApiResponse,
  sectionSchema,
  songSchema,
  successResponseSchema,
  userSchema,
  validateApiResponse,
  wikiDetailResponseSchema,
  wikiSchema,
} from '../../src/lib/apiTypes';

describe('apiTypes', () => {
  describe('successResponseSchema', () => {
    it('should parse valid success response with all fields', () => {
      const data = { success: true, message: '操作成功' };
      const result = successResponseSchema.parse(data);
      expect(result).toEqual(data);
    });

    it('should parse valid success response without message', () => {
      const data = { success: false };
      const result = successResponseSchema.parse(data);
      expect(result).toEqual(data);
    });

    it('should fail when success is missing', () => {
      expect(() => successResponseSchema.parse({})).toThrow(ZodError);
    });

    it('should fail when success is not a boolean', () => {
      expect(() => successResponseSchema.parse({ success: 'true' })).toThrow(ZodError);
    });
  });

  describe('userSchema', () => {
    const validUser = {
      uid: 'user-123',
      nickname: '测试用户',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'admin',
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    it('should parse valid user with all fields', () => {
      const result = userSchema.parse(validUser);
      expect(result).toEqual(validUser);
    });

    it('should parse valid user without avatarUrl', () => {
      const { avatarUrl, ...userWithoutAvatar } = validUser;
      const result = userSchema.parse(userWithoutAvatar);
      expect(result).toEqual(userWithoutAvatar);
    });

    it('should fail when uid is missing', () => {
      const { uid, ...invalidUser } = validUser;
      expect(() => userSchema.parse(invalidUser)).toThrow(ZodError);
    });

    it('should fail when nickname is missing', () => {
      const { nickname, ...invalidUser } = validUser;
      expect(() => userSchema.parse(invalidUser)).toThrow(ZodError);
    });

    it('should fail when role is missing', () => {
      const { role, ...invalidUser } = validUser;
      expect(() => userSchema.parse(invalidUser)).toThrow(ZodError);
    });

    it('should fail when status is missing', () => {
      const { status, ...invalidUser } = validUser;
      expect(() => userSchema.parse(invalidUser)).toThrow(ZodError);
    });
  });

  describe('authMeResponseSchema', () => {
    it('should parse valid auth response with user', () => {
      const data = {
        user: {
          uid: 'user-456',
          nickname: '管理员',
          role: 'admin',
          status: 'active',
        },
      };
      const result = authMeResponseSchema.parse(data);
      expect(result.user?.uid).toBe('user-456');
      expect(result.user?.role).toBe('admin');
      expect(result.user?.status).toBe('active');
    });

    it('should parse valid auth response with null user', () => {
      const data = { user: null };
      const result = authMeResponseSchema.parse(data);
      expect(result.user).toBeNull();
    });

    it('should parse user with optional fields', () => {
      const data = {
        user: {
          uid: 'user-789',
          nickname: '用户',
          avatarUrl: 'https://example.com/avatar.png',
          role: 'user',
          status: 'active',
          preferences: { theme: 'dark', language: 'zh-CN' },
        },
      };
      const result = authMeResponseSchema.parse(data);
      expect(result.user?.preferences).toEqual({ theme: 'dark', language: 'zh-CN' });
    });

    it('should fail when user role is invalid', () => {
      const data = {
        user: {
          uid: 'user-789',
          nickname: '用户',
          role: 'invalid_role',
          status: 'active',
        },
      };
      expect(() => authMeResponseSchema.parse(data)).toThrow(ZodError);
    });

    it('should fail when user status is invalid', () => {
      const data = {
        user: {
          uid: 'user-789',
          nickname: '用户',
          role: 'user',
          status: 'invalid_status',
        },
      };
      expect(() => authMeResponseSchema.parse(data)).toThrow(ZodError);
    });
  });

  describe('wikiSchema', () => {
    const validWiki = {
      id: 'wiki-1',
      slug: 'test-article',
      title: '测试文章',
      category: '文档',
      content: '# 内容',
      likes: 10,
      dislikes: 2,
      views: 100,
      isPinned: false,
      status: 'approved',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    it('should parse valid wiki with required fields', () => {
      const result = wikiSchema.parse(validWiki);
      expect(result).toEqual(validWiki);
    });

    it('should parse valid wiki with optional fields', () => {
      const wikiWithOptional = {
        ...validWiki,
        summary: '摘要内容',
        tags: ['标签1', '标签2'],
        author: {
          uid: 'author-1',
          nickname: '作者',
          role: 'admin',
          status: 'active',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      };
      const result = wikiSchema.parse(wikiWithOptional);
      expect(result.summary).toBe('摘要内容');
      expect(result.tags).toEqual(['标签1', '标签2']);
      expect(result.author?.uid).toBe('author-1');
    });

    it('should fail when status is invalid', () => {
      const invalidWiki = { ...validWiki, status: 'invalid' };
      expect(() => wikiSchema.parse(invalidWiki)).toThrow(ZodError);
    });

    it('should fail when likes is not a number', () => {
      const invalidWiki = { ...validWiki, likes: '10' };
      expect(() => wikiSchema.parse(invalidWiki)).toThrow(ZodError);
    });
  });

  describe('wikiDetailResponseSchema', () => {
    it('should parse valid wiki detail response', () => {
      const data = {
        wiki: {
          id: 'wiki-1',
          slug: 'test',
          title: '测试',
          category: '分类',
          content: '内容',
          likes: 0,
          dislikes: 0,
          views: 0,
          isPinned: false,
          status: 'approved',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      };
      const result = wikiDetailResponseSchema.parse(data);
      expect(result.wiki.slug).toBe('test');
    });
  });

  describe('sectionSchema', () => {
    it('should parse valid section', () => {
      const data = { id: 'section-1', name: '音乐版块' };
      const result = sectionSchema.parse(data);
      expect(result).toEqual(data);
    });

    it('should fail when id is missing', () => {
      expect(() => sectionSchema.parse({ name: '版块' })).toThrow(ZodError);
    });

    it('should fail when name is missing', () => {
      expect(() => sectionSchema.parse({ id: 'section-1' })).toThrow(ZodError);
    });
  });

  describe('postSchema', () => {
    const validPost = {
      id: 'post-1',
      title: '测试帖子',
      content: '帖子内容',
      sectionId: 'section-1',
      authorId: 'user-1',
      likes: 5,
      dislikes: 1,
      commentsCount: 3,
      views: 50,
      isPinned: false,
      status: 'published',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
    };

    it('should parse valid post with required fields', () => {
      const result = postSchema.parse(validPost);
      expect(result).toEqual(validPost);
    });

    it('should parse valid post with optional author and section', () => {
      const postWithRelations = {
        ...validPost,
        author: {
          uid: 'user-1',
          nickname: '用户',
          role: 'user',
          status: 'active',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        section: { id: 'section-1', name: '音乐' },
      };
      const result = postSchema.parse(postWithRelations);
      expect(result.author?.nickname).toBe('用户');
      expect(result.section?.name).toBe('音乐');
    });
  });

  describe('postDetailResponseSchema', () => {
    it('should parse valid post detail response', () => {
      const data = {
        post: {
          id: 'post-1',
          title: '帖子',
          content: '内容',
          sectionId: 'section-1',
          authorId: 'user-1',
          likes: 0,
          dislikes: 0,
          commentsCount: 0,
          views: 0,
          isPinned: false,
          status: 'published',
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      };
      const result = postDetailResponseSchema.parse(data);
      expect(result.post.id).toBe('post-1');
    });
  });

  describe('songSchema', () => {
    const validSong = {
      id: 'song-1',
      docId: 'doc-1',
      title: '测试歌曲',
      artist: '歌手',
      createdAt: '2024-01-01',
    };

    it('should parse valid song with required fields', () => {
      const result = songSchema.parse(validSong);
      expect(result).toEqual(validSong);
    });

    it('should parse valid song with optional fields', () => {
      const songWithOptional = {
        ...validSong,
        album: '专辑',
        coverUrl: 'https://example.com/cover.png',
        playUrl: 'https://example.com/song.mp3',
        duration: 240,
      };
      const result = songSchema.parse(songWithOptional);
      expect(result.album).toBe('专辑');
      expect(result.duration).toBe(240);
    });

    it('should parse valid song without optional fields', () => {
      const result = songSchema.parse(validSong);
      expect(result.album).toBeUndefined();
      expect(result.playUrl).toBeUndefined();
    });
  });

  describe('musicListResponseSchema', () => {
    it('should parse valid music list response', () => {
      const data = {
        songs: [
          {
            id: 'song-1',
            docId: 'doc-1',
            title: '歌曲1',
            artist: '歌手1',
            createdAt: '2024-01-01',
          },
          {
            id: 'song-2',
            docId: 'doc-2',
            title: '歌曲2',
            artist: '歌手2',
            createdAt: '2024-01-02',
          },
        ],
        total: 2,
      };
      const result = musicListResponseSchema.parse(data);
      expect(result.songs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should parse valid music list with empty songs', () => {
      const data = { songs: [], total: 0 };
      const result = musicListResponseSchema.parse(data);
      expect(result.songs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('musicDetailResponseSchema', () => {
    it('should parse valid music detail response', () => {
      const data = {
        song: {
          id: 'song-1',
          docId: 'doc-1',
          title: '歌曲',
          artist: '歌手',
          createdAt: '2024-01-01',
        },
      };
      const result = musicDetailResponseSchema.parse(data);
      expect(result.song.title).toBe('歌曲');
    });
  });

  describe('musicPlayUrlResponseSchema', () => {
    it('should parse valid music play url response', () => {
      const data = { playUrl: 'https://example.com/play.mp3' };
      const result = musicPlayUrlResponseSchema.parse(data);
      expect(result.playUrl).toBe('https://example.com/play.mp3');
    });

    it('should fail when playUrl is missing', () => {
      expect(() => musicPlayUrlResponseSchema.parse({})).toThrow(ZodError);
    });

    it('should fail when playUrl is not a string', () => {
      expect(() => musicPlayUrlResponseSchema.parse({ playUrl: 123 })).toThrow(ZodError);
    });
  });

  describe('gallerySchema', () => {
    const validGallery = {
      id: 'gallery-1',
      title: '测试画廊',
      description: '画廊描述',
      authorUid: 'user-1',
      authorName: '用户',
      tags: ['现场'],
      locationCode: null,
      locationName: null,
      locationDetail: null,
      copyright: null,
      published: true,
      publishedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
      images: [
        {
          id: 'image-1',
          assetId: 'asset-1',
          url: 'https://example.com/image.png',
          name: 'image.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
        },
      ],
    };

    it('should parse valid gallery with required fields', () => {
      const result = gallerySchema.parse(validGallery);
      expect(result).toEqual(validGallery);
    });

    it('should parse valid gallery with different nullability and empty image set', () => {
      const galleryWithNulls = {
        ...validGallery,
        description: '',
        publishedAt: null,
        images: [],
      };
      const result = gallerySchema.parse(galleryWithNulls);
      expect(result.publishedAt).toBeNull();
      expect(result.images).toHaveLength(0);
    });
  });

  describe('galleryDetailResponseSchema', () => {
    it('should parse valid gallery detail response', () => {
      const data = {
        gallery: {
          id: 'gallery-1',
          title: '画廊',
          description: '画廊描述',
          authorUid: 'user-1',
          authorName: '用户',
          tags: [],
          locationCode: null,
          locationName: null,
          locationDetail: null,
          copyright: null,
          published: false,
          publishedAt: null,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
          images: [],
        },
      };
      const result = galleryDetailResponseSchema.parse(data);
      expect(result.gallery.title).toBe('画廊');
    });
  });

  describe('galleryListResponseSchema', () => {
    it('should parse valid gallery list response', () => {
      const data = {
        galleries: [
          {
            id: 'gallery-1',
            title: '画廊',
            description: '描述',
            authorUid: 'user-1',
            authorName: '用户',
            tags: [],
            locationCode: null,
            locationName: null,
            locationDetail: null,
            copyright: null,
            published: true,
            publishedAt: '2024-01-01T00:00:00.000Z',
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            images: [],
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
      };
      const result = galleryListResponseSchema.parse(data);
      expect(result.galleries).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('galleryUploadResponseSchema', () => {
    it('should parse valid gallery upload response', () => {
      const data = { urls: ['https://example.com/img1.png', 'https://example.com/img2.png'] };
      const result = galleryUploadResponseSchema.parse(data);
      expect(result.urls).toHaveLength(2);
    });

    it('should parse valid gallery upload response with empty urls', () => {
      const data = { urls: [] };
      const result = galleryUploadResponseSchema.parse(data);
      expect(result.urls).toEqual([]);
    });

    it('should fail when urls contains non-string', () => {
      const data = { urls: ['valid', 123] };
      expect(() => galleryUploadResponseSchema.parse(data)).toThrow(ZodError);
    });
  });

  describe('createPaginatedResponseSchema', () => {
    const paginatedSchema = createPaginatedResponseSchema(songSchema);

    it('should parse valid paginated response', () => {
      const data = {
        items: [
          {
            id: 'song-1',
            docId: 'doc-1',
            title: '歌曲1',
            artist: '歌手1',
            createdAt: '2024-01-01',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
      const result = paginatedSchema.parse(data);
      expect(result.items).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should fail when page is missing', () => {
      const data = {
        items: [],
        total: 0,
        limit: 10,
        totalPages: 0,
      };
      expect(() => paginatedSchema.parse(data)).toThrow(ZodError);
    });

    it('should fail when totalPages is not a number', () => {
      const data = {
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: '5',
      };
      expect(() => paginatedSchema.parse(data)).toThrow(ZodError);
    });
  });

  describe('adminBackupSchema', () => {
    it('should parse valid admin backup', () => {
      const data = {
        filename: 'backup-2024-01-01.sql',
        size: 1024000,
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      const result = adminBackupSchema.parse(data);
      expect(result).toEqual(data);
    });

    it('should fail when filename is missing', () => {
      expect(() => adminBackupSchema.parse({ size: 1024, createdAt: '2024-01-01' })).toThrow(ZodError);
    });

    it('should fail when size is not a number', () => {
      const data = { filename: 'backup.sql', size: '1024', createdAt: '2024-01-01' };
      expect(() => adminBackupSchema.parse(data)).toThrow(ZodError);
    });
  });

  describe('adminBackupsResponseSchema', () => {
    it('should parse valid admin backups response', () => {
      const data = {
        backups: [
          { filename: 'backup1.sql', size: 1024, createdAt: '2024-01-01' },
          { filename: 'backup2.sql', size: 2048, createdAt: '2024-01-02' },
        ],
      };
      const result = adminBackupsResponseSchema.parse(data);
      expect(result.backups).toHaveLength(2);
    });

    it('should parse valid admin backups response with empty backups', () => {
      const data = { backups: [] };
      const result = adminBackupsResponseSchema.parse(data);
      expect(result.backups).toEqual([]);
    });
  });

  describe('adminReviewQueueItemSchema', () => {
    const validReviewItem = {
      id: 'review-1',
      type: 'wiki',
      title: '待审核条目',
      author: {
        uid: 'user-1',
        nickname: '用户',
        role: 'user',
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
      submittedAt: '2024-01-01T00:00:00.000Z',
    };

    it('should parse valid review queue item with wiki type', () => {
      const result = adminReviewQueueItemSchema.parse(validReviewItem);
      expect(result.type).toBe('wiki');
    });

    it('should parse valid review queue item with post type', () => {
      const reviewItemPost = { ...validReviewItem, type: 'post' };
      const result = adminReviewQueueItemSchema.parse(reviewItemPost);
      expect(result.type).toBe('post');
    });

    it('should parse valid review queue item with gallery type', () => {
      const reviewItemGallery = { ...validReviewItem, type: 'gallery' };
      const result = adminReviewQueueItemSchema.parse(reviewItemGallery);
      expect(result.type).toBe('gallery');
    });

    it('should fail when type is invalid', () => {
      const invalidItem = { ...validReviewItem, type: 'invalid_type' };
      expect(() => adminReviewQueueItemSchema.parse(invalidItem)).toThrow(ZodError);
    });

    it('should fail when author is missing', () => {
      const { author, ...invalidItem } = validReviewItem;
      expect(() => adminReviewQueueItemSchema.parse(invalidItem)).toThrow(ZodError);
    });
  });

  describe('adminReviewQueueResponseSchema', () => {
    it('should parse valid review queue response', () => {
      const data = {
        items: [
          {
            id: 'review-1',
            type: 'wiki',
            title: '条目1',
            author: {
              uid: 'user-1',
              nickname: '用户1',
              role: 'user',
              status: 'active',
              createdAt: '2024-01-01',
              updatedAt: '2024-01-01',
            },
            submittedAt: '2024-01-01',
          },
        ],
        total: 1,
      };
      const result = adminReviewQueueResponseSchema.parse(data);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should parse valid review queue response with empty items', () => {
      const data = { items: [], total: 0 };
      const result = adminReviewQueueResponseSchema.parse(data);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('validateApiResponse', () => {
    it('should return parsed data for valid input', () => {
      const data = { success: true, message: '成功' };
      const result = validateApiResponse(data, successResponseSchema);
      expect(result).toEqual(data);
    });

    it('should throw ZodError for invalid input', () => {
      const invalidData = { success: '不是布尔值' };
      expect(() => validateApiResponse(invalidData, successResponseSchema)).toThrow(ZodError);
    });

    it('should throw ZodError with correct error count', () => {
      const invalidData = {};
      try {
        validateApiResponse(invalidData, successResponseSchema);
      } catch (error) {
        if (error instanceof ZodError) {
          expect(error.issues).toHaveLength(1);
        }
      }
    });

    it('should work with complex schemas', () => {
      const userData = {
        uid: 'user-1',
        nickname: '用户',
        role: 'admin',
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };
      const result = validateApiResponse(userData, userSchema);
      expect(result.uid).toBe('user-1');
    });
  });

  describe('safeValidateApiResponse', () => {
    it('should return success true for valid input', () => {
      const data = { success: true };
      const result = safeValidateApiResponse(data, successResponseSchema);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should return success false for invalid input', () => {
      const invalidData = { success: '不是布尔值' };
      const result = safeValidateApiResponse(invalidData, successResponseSchema);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should not throw exception for invalid input', () => {
      const invalidData = {};
      expect(() => safeValidateApiResponse(invalidData, successResponseSchema)).not.toThrow();
    });

    it('should return error with issues array on failure', () => {
      const invalidData = { invalid: 'data' };
      const result = safeValidateApiResponse(invalidData, successResponseSchema);
      if (!result.success) {
        expect(result.error.issues).toBeDefined();
        expect(Array.isArray(result.error.issues)).toBe(true);
      }
    });

    it('should work with complex schemas', () => {
      const userData = {
        uid: 'user-1',
        nickname: '用户',
        role: 'user',
        status: 'active',
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };
      const result = safeValidateApiResponse(userData, userSchema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nickname).toBe('用户');
      }
    });
  });
});
