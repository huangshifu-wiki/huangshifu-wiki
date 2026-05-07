import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Link2,
  Plus,
  Save,
  Trash2,
  User as UserIcon,
  Eye,
  EyeOff,
  Clock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../context/AuthContext';
import { SmartImage } from '../components/SmartImage';
import { Lightbox } from '../components/Lightbox';
import { useToast } from '../components/Toast';
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '../lib/apiClient';
import { splitTagsInput } from '../lib/contentUtils';
import { formatDateTime, toDateValue } from '../lib/dateUtils';
import { DEFAULT_AVATAR, handleAvatarError } from '../lib/defaultAvatar';
import { getImagePreference } from '../services/imageService';

type GalleryImage = {
  id: string;
  assetId: string | null;
  url: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

type GalleryItem = {
  id: string;
  title: string;
  description: string;
  authorUid: string;
  authorName: string;
  tags: string[];
  copyright?: string | null;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  images: GalleryImage[];
};

type EditableGalleryImage = GalleryImage & {
  clientId: string;
  pendingFile?: File;
  isPending?: boolean;
};

type GalleryDraft = {
  title: string;
  description: string;
  tagsText: string;
  copyrightText: string;
  published: boolean;
  images: EditableGalleryImage[];
};

type UploadSessionResponse = {
  session: {
    id: string;
  };
};

type UploadFileResponse = {
  asset: {
    id: string;
  };
};

type CommentItem = {
  id: string;
  galleryId: string | null;
  authorUid: string;
  authorName: string;
  authorPhoto: string | null;
  content: string;
  parentId: string | null;
  createdAt: string;
};

const toEditableImage = (image: GalleryImage): EditableGalleryImage => ({
  ...image,
  clientId: image.id,
});

const createPendingImage = (file: File): EditableGalleryImage => ({
  clientId: `pending-${Math.random().toString(36).slice(2, 10)}`,
  assetId: null,
  id: '',
  url: URL.createObjectURL(file),
  name: file.name,
  mimeType: file.type || null,
  sizeBytes: file.size,
  pendingFile: file,
  isPending: true,
});

const releasePendingImageUrls = (images: EditableGalleryImage[]) => {
  images.forEach((image) => {
    if (image.isPending) {
      URL.revokeObjectURL(image.url);
    }
  });
};

const createDraftFromGallery = (item: GalleryItem): GalleryDraft => ({
  title: item.title || '',
  description: item.description || '',
  tagsText: (item.tags || []).join(', '),
  copyrightText: item.copyright || '',
  published: item.published,
  images: item.images.map(toEditableImage),
});

const hasDraggedFiles = (event: Pick<React.DragEvent<HTMLElement>, 'dataTransfer'>) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

const GalleryDetail = () => {
  const { galleryId } = useParams();
  const navigate = useNavigate();
  const { user, profile, isBanned } = useAuth();
  const { show } = useToast();

  const [gallery, setGallery] = useState<GalleryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GalleryDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [pageDragDepth, setPageDragDepth] = useState(0);

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const addImagesInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<GalleryDraft | null>(null);

  const applyDraft = (updater: GalleryDraft | null | ((prev: GalleryDraft | null) => GalleryDraft | null)) => {
    const previous = draftRef.current;
    const next = typeof updater === 'function'
      ? (updater as (value: GalleryDraft | null) => GalleryDraft | null)(previous)
      : updater;
    draftRef.current = next;
    setDraft(next);
  };

  const fetchGallery = async () => {
    if (!galleryId) return;
    try {
      setLoading(true);
      const data = await apiGet<{ gallery: GalleryItem }>(`/api/galleries/${galleryId}`);
      setGallery(data.gallery);
      applyDraft((prev) => {
        if (prev) {
          releasePendingImageUrls(prev.images);
        }
        return null;
      });
      setEditing(false);
    } catch (error) {
      console.error('Fetch gallery detail error:', error);
      setGallery(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGallery();
  }, [galleryId]);

  const fetchComments = async () => {
    if (!galleryId) return;
    try {
      const data = await apiGet<{ comments: CommentItem[] }>(`/api/galleries/${galleryId}/comments`);
      setComments(data.comments || []);
    } catch (error) {
      console.error('Fetch gallery comments error:', error);
    }
  };

  useEffect(() => {
    if (gallery?.published && galleryId) {
      fetchComments();
    }
  }, [gallery?.published, galleryId]);

  useEffect(() => () => {
    if (draftRef.current) {
      releasePendingImageUrls(draftRef.current.images);
    }
  }, []);

  const images = useMemo<EditableGalleryImage[]>(
    () => (editing ? draft?.images || [] : (gallery?.images || []).map(toEditableImage)),
    [draft?.images, editing, gallery?.images],
  );

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const canManage = Boolean(user && gallery && !isBanned && (gallery.authorUid === user.uid || isAdmin));

  const handleOpenLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleCopyLink = async () => {
    if (!gallery?.id) return;
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/gallery/${gallery.id}`));
    if (copied) {
      show('图集内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
  };

  const handleEnterEditMode = () => {
    if (!gallery || !canManage || saving || uploading) return;
    applyDraft((prev) => {
      if (prev) {
        releasePendingImageUrls(prev.images);
      }
      return createDraftFromGallery(gallery);
    });
    setEditing(true);
  };

  const handleCancelEdit = () => {
    applyDraft((prev) => {
      if (prev) {
        releasePendingImageUrls(prev.images);
      }
      return null;
    });
    setEditing(false);
    setPageDragDepth(0);
    setDraggingIndex(null);
  };

  const handleSaveMeta = async () => {
    const currentDraft = draftRef.current;
    if (!gallery || !currentDraft || !canManage || saving || uploading) return;
    if (currentDraft.images.length === 0) {
      show('图集至少需要保留一张图片', { variant: 'error' });
      return;
    }
    try {
      setSaving(true);
      const pendingImages = currentDraft.images.filter((image) => image.isPending && image.pendingFile);
      let assetIdByClientId = new Map<string, string>();

      if (pendingImages.length) {
        setUploading(true);
        const sessionData = await apiPost<UploadSessionResponse>('/api/uploads/sessions', {
          maxFiles: pendingImages.length,
        });
        const sessionId = sessionData.session.id;

        for (const image of pendingImages) {
          const uploadResult = await uploadFileToSession(sessionId, image.pendingFile!);
          assetIdByClientId.set(image.clientId, uploadResult.asset.id);
        }

        await apiPost(`/api/uploads/sessions/${sessionId}/finalize`);
      }

      const result = await apiPatch<{ gallery: GalleryItem }>(`/api/galleries/${gallery.id}`, {
        title: currentDraft.title,
        description: currentDraft.description,
        tags: splitTagsInput(currentDraft.tagsText),
        copyright: currentDraft.copyrightText.trim() || null,
        published: currentDraft.published,
        images: currentDraft.images.map((image) => (
          image.isPending
            ? { assetId: assetIdByClientId.get(image.clientId) }
            : { imageId: image.id }
        )),
      });
      releasePendingImageUrls(currentDraft.images);
      setGallery(result.gallery);
      applyDraft(null);
      setEditing(false);
      show('图集修改已保存');
    } catch (error) {
      console.error('Save gallery meta error:', error);
      show('保存失败，请稍后重试', { variant: 'error' });
    } finally {
      setUploading(false);
      setSaving(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!editing || !canManage || saving) return;
    applyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        published: !prev.published,
      };
    });
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!galleryId || !user || !newComment.trim()) return;
    if (isBanned) {
      show('账号已被封禁，无法评论', { variant: 'error' });
      return;
    }
    if (!gallery?.published) {
      show('仅已发布内容可评论', { variant: 'error' });
      return;
    }

    try {
      setSubmittingComment(true);
      const data = await apiPost<{ comment: CommentItem }>(`/api/galleries/${galleryId}/comments`, {
        content: newComment,
        parentId: replyTo?.id || null,
      });

      if (data.comment) {
        setComments((prev) => [...prev, data.comment]);
      }

      setNewComment('');
      setReplyTo(null);
    } catch (error) {
      console.error('Error adding comment:', error);
      show('发表评论失败，请稍后重试', { variant: 'error' });
    } finally {
      setSubmittingComment(false);
    }
  };

  const uploadFileToSession = async (sessionId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const preference = await getImagePreference();
    const useTripleStorage = preference.strategy === 's3' || preference.strategy === 'external';

    const url = new URL(`/api/uploads/sessions/${sessionId}/files`, window.location.origin);
    if (useTripleStorage) {
      url.searchParams.set('tripleStorage', 'true');
    }

    const data = await apiUpload<UploadFileResponse>(url.toString(), formData);
    return data;
  };

  const appendPendingFiles = (fileList: FileList | File[]) => {
    if (!editing || !draftRef.current || !canManage || uploading) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    const maxSize = 10 * 1024 * 1024;
    const files = Array.from(fileList);
    const invalidFiles: string[] = [];
    const validImages: EditableGalleryImage[] = [];

    files.forEach((file) => {
      if (!allowedTypes.includes(file.type)) {
        invalidFiles.push(`${file.name} (不支持的文件类型)`);
        return;
      }
      if (file.size > maxSize) {
        invalidFiles.push(`${file.name} (文件过大，最大 10MB)`);
        return;
      }
      validImages.push(createPendingImage(file));
    });

    if (invalidFiles.length) {
      show(`以下文件无法加入：${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '...' : ''}`, { variant: 'error' });
    }
    if (!validImages.length) return;

    applyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        images: [...prev.images, ...validImages],
      };
    });
    show(`已加入 ${validImages.length} 张待上传图片`);
  };

  const handleAddImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    event.target.value = '';

    if (!fileList?.length) return;
    appendPendingFiles(fileList);
  };

  const handleDeleteImage = async (index: number) => {
    const currentDraft = draftRef.current;
    if (!editing || !currentDraft || !canManage) return;
    const image = currentDraft.images[index];
    if (!image?.clientId) {
      show('无法删除该图片', { variant: 'error' });
      return;
    }

    if (image.isPending) {
      URL.revokeObjectURL(image.url);
    }

    const nextImages = currentDraft.images.filter((_, currentIndex) => currentIndex !== index);
    applyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        images: nextImages,
      };
    });
    show(image.isPending ? '已移除待上传图片' : '已加入待删除列表');
  };

  const handleReorder = async (fromIndex: number, toIndex: number) => {
    const currentDraft = draftRef.current;
    if (!editing || !currentDraft || !canManage || fromIndex === toIndex) return;
    const next = [...currentDraft.images];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);

    applyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        images: next,
      };
    });
  };

  const onThumbDragStart = (event: React.DragEvent<HTMLDivElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDraggingIndex(index);
  };

  const onThumbDrop = async (targetIndex: number) => {
    if (draggingIndex === null) return;
    const sourceIndex = draggingIndex;
    setDraggingIndex(null);
    await handleReorder(sourceIndex, targetIndex);
  };

  const handlePageDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !canManage || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setPageDragDepth((prev) => prev + 1);
  };

  const handlePageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !canManage || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handlePageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !canManage || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setPageDragDepth((prev) => Math.max(0, prev - 1));
  };

  const handlePageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!editing || !canManage || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setPageDragDepth(0);
    if (!event.dataTransfer.files?.length) return;
    appendPendingFiles(event.dataTransfer.files);
  };

  if (loading) {
    return (
      <div
        className="min-h-[calc(100vh-60px)]"
        style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}
      >
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <div className="h-48 bg-[#f0ece3] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div
        className="min-h-[calc(100vh-60px)]"
        style={{ backgroundColor: '#f7f5f0', fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif" }}
      >
        <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32">
          <Link to="/gallery" className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors">
            <ArrowLeft size={16} /> 返回图集列表
          </Link>
          <div className="mt-6 bg-white rounded border border-[#e0dcd3] p-10 text-center text-[#9e968e] italic tracking-[0.1em]">
            图集不存在或已被删除
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-[calc(100vh-60px)]"
      style={{
        backgroundColor: '#f7f5f0',
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {editing && canManage && pageDragDepth > 0 ? (
        <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-[#f7f5f0]/80 px-4">
          <div className="w-full max-w-3xl rounded border-2 border-dashed border-[#c8951e] bg-white/95 px-8 py-12 text-center">
            <p className="text-lg font-bold text-[#2c2c2c]">松开鼠标即可加入待上传列表</p>
            <p className="mt-2 text-sm text-[#9e968e]">整个图集页面都可以拖入图片，保存时统一上传并生效</p>
          </div>
        </div>
      ) : null}

      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 gallery-detail-page">
        {/* Breadcrumb + Actions */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <Link to="/gallery" className="inline-flex items-center gap-2 text-sm text-[#9e968e] hover:text-[#c8951e] transition-colors">
            <ArrowLeft size={16} /> 返回图集列表
          </Link>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button
                    onClick={handleSaveMeta}
                    disabled={saving || uploading}
                    className="px-4 py-2 text-[0.9375rem] rounded bg-[#c8951e] text-white hover:bg-[#dca828] transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={16} /> {saving || uploading ? '保存中...' : '保存修改'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={saving || uploading}
                    className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all disabled:opacity-50"
                  >
                    取消编辑
                  </button>
                </>
              ) : (
                <button
                  onClick={handleEnterEditMode}
                  className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
                >
                  <Save size={16} /> 打开编辑模式
                </button>
              )}
              <button
                onClick={handleTogglePublish}
                disabled={!editing || saving || uploading}
                className={clsx(
                  'px-3 py-2 rounded text-sm font-medium transition-all disabled:opacity-50 flex items-center gap-1.5',
                  (editing ? draft?.published : gallery.published)
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200',
                )}
              >
                {(editing ? draft?.published : gallery.published) ? <Eye size={14} /> : <EyeOff size={14} />}
                {editing ? ((draft?.published ? '设为草稿' : '设为发布') as string) : (gallery.published ? '已发布' : '草稿中')}
              </button>
              <button
                onClick={handleCopyLink}
                className="px-4 py-2 text-[0.9375rem] rounded border border-[#e0dcd3] text-[#6b6560] hover:text-[#c8951e] hover:border-[#c8951e] transition-all flex items-center gap-2"
                title="复制内链"
              >
                <Link2 size={16} /> 复制内链
              </button>
              <input ref={addImagesInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleAddImages} />
            </div>
          )}
        </div>

        {/* Header */}
        <header className="mb-6">
          {editing && draft ? (
            <div className="space-y-4 max-w-2xl">
              <div className="space-y-1.5">
                <label htmlFor="gallery-title" className="block text-sm font-medium text-[#6b6560]">
                  图集标题
                </label>
                <input
                  id="gallery-title"
                  type="text"
                  value={draft.title}
                  onChange={(event) => applyDraft((prev) => prev ? { ...prev, title: event.target.value } : prev)}
                  className="w-full px-4 py-2.5 rounded border border-[#e0dcd3] bg-white focus:outline-none focus:border-[#c8951e] text-base"
                  placeholder="图集标题"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="gallery-description" className="block text-sm font-medium text-[#6b6560]">
                  图集描述
                </label>
                <textarea
                  id="gallery-description"
                  value={draft.description}
                  onChange={(event) => applyDraft((prev) => prev ? { ...prev, description: event.target.value } : prev)}
                  className="w-full px-4 py-2.5 rounded border border-[#e0dcd3] bg-white focus:outline-none focus:border-[#c8951e] resize-none text-base"
                  rows={3}
                  placeholder="图集描述"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="gallery-tags" className="block text-sm font-medium text-[#6b6560]">
                    标签
                  </label>
                  <input
                    id="gallery-tags"
                    type="text"
                    value={draft.tagsText}
                    onChange={(event) => applyDraft((prev) => prev ? { ...prev, tagsText: event.target.value } : prev)}
                    className="w-full px-4 py-2.5 rounded border border-[#e0dcd3] bg-white focus:outline-none focus:border-[#c8951e] text-base"
                    placeholder="标签，逗号分隔"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="gallery-copyright" className="block text-sm font-medium text-[#6b6560]">
                    版权标识
                  </label>
                  <input
                    id="gallery-copyright"
                    type="text"
                    value={draft.copyrightText}
                    onChange={(event) => applyDraft((prev) => prev ? { ...prev, copyrightText: event.target.value } : prev)}
                    className="w-full px-4 py-2.5 rounded border border-[#e0dcd3] bg-white focus:outline-none focus:border-[#c8951e] text-base"
                    placeholder="版权信息，如：© 2024 作者名"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em] mb-2">
                {gallery.title}
              </h1>
              <p className="text-[#6b6560] leading-relaxed">
                {gallery.description || '暂无描述'}
              </p>
              {gallery.copyright && (
                <p className="text-xs text-[#9e968e] mt-1">{gallery.copyright}</p>
              )}
            </div>
          )}
        </header>

        {/* Info bar */}
        <div className="flex items-end justify-between border-b border-[#e0dcd3] mb-6 pb-2">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[1.125rem] pb-2 relative tracking-[0.05em] text-[#c8951e] font-semibold after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#c8951e] after:rounded-[1px]">
              {images.length} 张图片
            </span>
            {!editing && gallery.tags?.map((tag) => (
              <span key={tag} className="text-[11px] text-[#c8951e] bg-[#f7f5f0] border border-[#e0dcd3] px-2 py-0.5 rounded">
                #{tag}
              </span>
            ))}
            {!editing && (
              <span
                className={clsx(
                  'text-[11px] px-2 py-0.5 rounded font-medium',
                  gallery.published ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200',
                )}
              >
                {gallery.published ? '已发布' : '草稿'}
              </span>
            )}
            {editing ? (
              <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-[#f0ece3] text-[#6b6560] border border-[#e0dcd3]">
                编辑模式
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 pb-2 text-[0.8125rem] text-[#9e968e]">
            <span className="flex items-center gap-1"><Clock size={14} /> {formatDateTime(gallery.createdAt)}</span>
            <span className="flex items-center gap-1"><UserIcon size={14} /> {gallery.authorName || gallery.authorUid?.slice(0, 8)}</span>
            {gallery.publishedAt ? <span>发布于 {formatDateTime(gallery.publishedAt)}</span> : null}
          </div>
        </div>

        {/* Images Grid */}
        <section className="mb-10">
          {editing ? (
            <p className="mb-3 text-xs text-[#9e968e]">
              直接拖拽图片可调整顺序，点击图片左上角的删除按钮可移除。也可以把图片拖到整个页面中加入待上传列表。
            </p>
          ) : null}

          <div className={clsx(
            'grid gap-4',
            editing ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-3'
          )}>
            {images.map((image, index) => (
              <div
                key={image.clientId || image.id}
                draggable={editing && canManage}
                onDragStart={(event) => onThumbDragStart(event, index)}
                onDragOver={(event) => {
                  if (!editing || !canManage) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onThumbDrop(index);
                }}
                className={clsx(
                  'relative overflow-hidden rounded group',
                  editing ? 'aspect-square cursor-grab active:cursor-grabbing' : 'cursor-zoom-in aspect-[3/4]',
                  draggingIndex === index && 'opacity-60',
                )}
              >
                <button
                  onClick={() => !editing && handleOpenLightbox(index)}
                  className="w-full h-full"
                  type="button"
                >
                  <SmartImage
                    src={image.url}
                    alt={image.name || ''}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                </button>

                {!editing && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 pointer-events-none">
                    <div className="absolute bottom-3 right-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 bg-black/40 text-white text-xs px-2 py-1 rounded">
                      查看大图
                    </div>
                  </div>
                )}

                {editing && canManage && (
                  <>
                    <button
                      onClick={() => handleDeleteImage(index)}
                      className="absolute top-1.5 left-1.5 z-10 p-1 rounded bg-black/50 text-white hover:bg-red-500/80 transition-colors"
                      title="删除图片"
                    >
                      <Trash2 size={11} />
                    </button>
                    {image.isPending ? (
                      <span className="absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[#c8951e] text-white">
                        待上传
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ))}

            {editing && canManage ? (
              <button
                type="button"
                onClick={() => addImagesInputRef.current?.click()}
                disabled={uploading || saving}
                className="flex aspect-square items-center justify-center rounded border border-dashed border-[#c8951e]/40 bg-[#f7f5f0] text-[#c8951e] transition-colors hover:border-[#c8951e] hover:bg-[#f7f5f0] disabled:opacity-50"
                title={uploading ? '上传中' : '加入图片'}
              >
                <Plus size={24} />
              </button>
            ) : null}
          </div>
        </section>

        {/* Comments */}
        {gallery.published && (
          <section className="border-t border-[#e0dcd3] pt-8">
            <h2 className="text-base font-semibold text-[#2c2c2c] tracking-[0.12em] mb-6 pb-2.5 border-b border-[#e0dcd3] flex items-center gap-2">
              <span className="w-[3px] h-4 bg-[#c8951e] rounded-[1px] opacity-60 inline-block" />
              评论
            </h2>

            {user && !isBanned && (
              <form onSubmit={handleAddComment} className="mb-8">
                {replyTo && (
                  <div className="flex items-center gap-2 mb-2 text-xs text-[#9e968e]">
                    <span>回复给 {replyTo.authorName}</span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="text-[#c8951e] hover:underline"
                    >
                      取消
                    </button>
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded bg-[#f0ece3] flex-shrink-0 overflow-hidden">
                    <img
                      src={user.photoURL || DEFAULT_AVATAR}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={handleAvatarError}
                    />
                  </div>
                  <div className="flex-grow">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="写下你的评论..."
                      className="w-full px-4 py-3 rounded border border-[#e0dcd3] bg-white focus:outline-none focus:border-[#c8951e] resize-none text-base"
                      rows={3}
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        type="submit"
                        disabled={!newComment.trim() || submittingComment}
                        className="px-5 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-all disabled:opacity-50"
                      >
                        {submittingComment ? '发送中...' : '发送'}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {user && isBanned && (
              <p className="text-center text-[#9e968e] italic mb-8">账号已被封禁，无法评论</p>
            )}

            {!user && (
              <p className="text-center text-[#9e968e] italic mb-8">登录后可参与评论</p>
            )}

            <div className="space-y-6">
              {comments.length > 0 ? comments.filter((c) => !c.parentId).map((comment) => (
                <div key={comment.id} className="space-y-4">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded bg-[#f0ece3] flex-shrink-0 overflow-hidden">
                      <img
                        src={comment.authorPhoto || DEFAULT_AVATAR}
                        alt=""
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={handleAvatarError}
                      />
                    </div>
                    <div className="flex-grow">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-[#2c2c2c]">{comment.authorName || '匿名用户'}</span>
                        <span className="text-[10px] text-[#9e968e]">{formatDateTime(comment.createdAt)}</span>
                      </div>
                      <p className="text-[#6b6560] text-sm leading-relaxed mb-2">{comment.content}</p>
                      {user && !isBanned && (
                        <button
                          onClick={() => {
                            setReplyTo(comment);
                            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                          }}
                          className="text-[10px] font-medium text-[#c8951e] hover:underline"
                        >
                          回复
                        </button>
                      )}
                    </div>
                  </div>

                  {comments.filter((c) => c.parentId === comment.id).length > 0 && (
                    <div className="ml-14 space-y-4 border-l-2 border-[#e0dcd3] pl-6">
                      {comments.filter((c) => c.parentId === comment.id).map((reply) => (
                        <div key={reply.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded bg-[#f0ece3] flex-shrink-0 overflow-hidden">
                            <img
                              src={reply.authorPhoto || DEFAULT_AVATAR}
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={handleAvatarError}
                            />
                          </div>
                          <div className="flex-grow">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-[#2c2c2c]">{reply.authorName || '匿名用户'}</span>
                              <span className="text-[10px] text-[#9e968e]">{formatDateTime(reply.createdAt)}</span>
                            </div>
                            <p className="text-[#6b6560] text-xs leading-relaxed">{reply.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )) : (
                <p className="text-center text-[#9e968e] italic py-8">暂无评论，快来抢沙发吧！</p>
              )}
            </div>
          </section>
        )}

        {/* Back to list */}
        <div className="mt-10 pt-6 border-t border-[#e0dcd3] text-right">
          <button onClick={() => navigate('/gallery')} className="text-xs text-[#9e968e] hover:text-[#c8951e] transition-colors">
            返回图集列表
          </button>
        </div>
      </div>

      {lightboxOpen && (
        <Lightbox
          images={images.map((img) => ({ id: img.clientId || img.id, url: img.url, name: img.name }))}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
};

export default GalleryDetail;
