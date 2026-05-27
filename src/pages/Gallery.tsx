import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Image as ImageIcon, Plus, Folder, X, Upload, Clock, User as UserIcon, Link2, Trash2 } from 'lucide-react';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { ViewModeSelector } from '../components/ViewModeSelector';
import { VIEW_MODE_CONFIG } from '../lib/viewModes';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { SmartImage } from '../components/SmartImage';
import { useToast } from '../components/Toast';
import { copyToClipboard, toAbsoluteInternalUrl } from '../lib/copyLink';
import { apiDelete, apiGet, apiPost, apiUpload } from '../lib/apiClient';
import { UPLOAD_MAX_FILE_SIZE_BYTES, formatUploadLimit, formatUploadLimitWithSize } from '../lib/uploadLimits';
import { getImagePreference } from '../services/imageService';
import { toDateValue } from '../lib/dateUtils';
import { LocationTagInput } from '../components/LocationTagInput';
import Pagination from '../components/Pagination';
import { extractGpsFromMultipleFiles, findMostFrequentGpsCoordinates } from '../services/exifService';
import { usePagination } from '../hooks/usePagination';
import type { GalleryItem } from '../types/entities';
import type { GalleryCreateResponse, GalleryListResponse, UploadFileResponse, UploadSessionResponse } from '../types/api';

const DEFAULT_PAGE_SIZE = 24;
const GALLERY_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/bmp';
const GALLERY_UPLOAD_ALLOWED_TYPES = new Set(GALLERY_UPLOAD_ACCEPT.split(','));
const GALLERY_UPLOAD_TYPE_LABEL = 'JPG、PNG、GIF、WebP、BMP';

type LocalPreviewFile = {
  file: File;
  previewUrl: string;
};

const hasDraggedFiles = (event: Pick<React.DragEvent<HTMLElement>, 'dataTransfer'>) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

interface GalleryCardProps {
  gallery: GalleryItem;
  viewMode: string;
  isAdmin: boolean;
  deletingGalleryId: string | null;
  onCopyLink: (event: React.MouseEvent<HTMLButtonElement>, galleryId: string) => void;
  onRequestDelete: (event: React.MouseEvent<HTMLButtonElement>, gallery: { id: string; title?: string | null }) => void;
}

const GalleryCard = React.memo(({ gallery, viewMode, isAdmin, deletingGalleryId, onCopyLink, onRequestDelete }: GalleryCardProps) => (
  <div className={clsx('relative group', viewMode === 'list' && 'flex')}>
    <Link
      to={`/gallery/${gallery.id}`}
      className={clsx(
        viewMode === 'list'
          ? 'flex gap-4 p-3 bg-surface border border-border rounded overflow-hidden hover:border-brand-gold transition-all w-full'
          : 'block bg-surface border border-border rounded overflow-hidden hover:border-brand-gold transition-all'
      )}
    >
      {viewMode === 'list' ? (
        <>
          <div className="w-20 h-20 bg-surface-alt rounded overflow-hidden flex-shrink-0">
            <SmartImage
              src={(Array.isArray(gallery.images) && gallery.images[0]?.thumbnailUrl) || ''}
              alt={gallery.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-medium text-text-primary group-hover:text-brand-gold transition-colors truncate">{gallery.title}</h3>
              <span className="px-1.5 py-0.5 bg-surface-alt text-text-muted text-[10px] font-medium rounded flex-shrink-0">
                {Array.isArray(gallery.images) ? gallery.images.length : 0} 张
              </span>
            </div>
            <p className="text-text-muted text-xs line-clamp-1">
              {gallery.description || '暂无描述'}
            </p>
            <div className="flex items-center gap-3 text-text-muted text-[11px] mt-1">
              <span className="flex items-center gap-1"><Clock size={10} /> {toDateValue(gallery.createdAt) ? format(toDateValue(gallery.createdAt)!, 'yyyy-MM-dd') : '刚刚'}</span>
              <span className="flex items-center gap-1"><UserIcon size={10} /> {gallery.authorUid?.substring(0, 6)}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={clsx('relative overflow-hidden', VIEW_MODE_CONFIG[viewMode].cardHeight)}>
            <SmartImage
              src={(Array.isArray(gallery.images) && gallery.images[0]?.thumbnailUrl) || ''}
              alt={gallery.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              useOriginal={false}
            />
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/40 text-white text-[10px] font-medium rounded">
              {Array.isArray(gallery.images) ? gallery.images.length : 0} 张
            </div>
          </div>
          <div className="p-3">
            <h3 className="text-sm font-medium text-text-primary mb-1 group-hover:text-brand-gold transition-colors truncate">{gallery.title}</h3>
            <div className="flex flex-wrap gap-1 mb-2">
              {gallery.tags?.slice(0, 3).map((tag: string) => (
                <span key={tag} className="text-[10px] text-brand-gold bg-surface-alt px-1.5 py-0.5 rounded">{tag}</span>
              ))}
            </div>
            <div className="flex items-center justify-between text-text-muted text-[11px]">
              <span className="flex items-center gap-1"><Clock size={10} /> {toDateValue(gallery.createdAt) ? format(toDateValue(gallery.createdAt)!, 'yyyy-MM-dd') : '刚刚'}</span>
              <span className="flex items-center gap-1"><UserIcon size={10} /> {gallery.authorUid?.substring(0, 6)}</span>
            </div>
          </div>
        </>
      )}
    </Link>
    {isAdmin ? (
      <button
        onClick={(event) => onRequestDelete(event, gallery)}
        disabled={deletingGalleryId === gallery.id}
        className="absolute top-2 left-2 p-2.5 rounded bg-surface/90 border border-border text-text-muted theme-icon-button-danger transition-all disabled:cursor-not-allowed disabled:opacity-60"
        title="删除图集"
        aria-label="删除图集"
      >
        <Trash2 size={12} />
      </button>
    ) : null}
    <button
      onClick={(event) => onCopyLink(event, gallery.id)}
      className={clsx(
        'p-2.5 rounded bg-surface/90 border border-border text-text-muted hover:text-brand-gold transition-all',
        viewMode === 'list' ? 'absolute top-2 right-2' : 'absolute bottom-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
      )}
      title="复制内链"
      aria-label="复制图集内链"
    >
      <Link2 size={12} />
    </button>
  </div>
));

const GalleryList = () => {
  const [galleries, setGalleries] = useState<GalleryItem[]>([]);
  const { user, isAdmin, isBanned } = useAuth();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isGalleryAdminOnly, setIsGalleryAdminOnly] = useState(false);
  const [galleryAccessLoaded, setGalleryAccessLoaded] = useState(false);
  const [galleryToDelete, setGalleryToDelete] = useState<{ id: string; title: string } | null>(null);
  const [deletingGalleryId, setDeletingGalleryId] = useState<string | null>(null);
  const [totalGalleries, setTotalGalleries] = useState(0);
  const { show } = useToast();
  const { preferences, setViewMode } = useUserPreferences();
  const viewMode = preferences.viewMode;

  const galleryPagination = usePagination({
    totalCount: totalGalleries,
    defaultPageSize: DEFAULT_PAGE_SIZE,
  });

  useEffect(() => {
    const fetchGalleries = async () => {
      try {
        const data = await apiGet<GalleryListResponse>('/api/galleries', {
          page: galleryPagination.page,
          limit: galleryPagination.pageSize,
        });
        setGalleries(data.galleries || []);
        setTotalGalleries(data.total ?? 0);
      } catch (error) {
        console.error('Fetch galleries error:', error);
        setGalleries([]);
        setTotalGalleries(0);
      }
    };

    fetchGalleries();
  }, [galleryPagination.page, galleryPagination.pageSize]);

  useEffect(() => {
    const fetchGalleryAccess = async () => {
      try {
        const data = await apiGet<{ adminOnly: boolean }>('/api/config/gallery-access');
        setIsGalleryAdminOnly(Boolean(data.adminOnly));
      } catch (error) {
        console.error('Fetch gallery access error:', error);
        setIsGalleryAdminOnly(false);
      } finally {
        setGalleryAccessLoaded(true);
      }
    };

    fetchGalleryAccess();
  }, []);

  const handleCopyGalleryLink = async (event: React.MouseEvent<HTMLButtonElement>, galleryId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyToClipboard(toAbsoluteInternalUrl(`/gallery/${galleryId}`));
    if (copied) {
      show('图集内链已复制');
      return;
    }
    show('复制链接失败，请稍后重试', { variant: 'error' });
  };

  const handleRequestDeleteGallery = (
    event: React.MouseEvent<HTMLButtonElement>,
    gallery: { id: string; title?: string | null },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setGalleryToDelete({
      id: gallery.id,
      title: gallery.title?.trim() || '未命名图集',
    });
  };

  const handleConfirmDeleteGallery = async () => {
    if (!galleryToDelete || deletingGalleryId) return;

    try {
      setDeletingGalleryId(galleryToDelete.id);
      await apiDelete(`/api/galleries/${galleryToDelete.id}`);
      setGalleries((prev) => {
        const next = prev.filter((gallery) => gallery.id !== galleryToDelete.id);
        // 如果当前页删空了且不是第一页，自动回退一页
        if (next.length === 0 && galleryPagination.page > 1) {
          galleryPagination.setPage(galleryPagination.page - 1);
        }
        return next;
      });
      setTotalGalleries((prev) => Math.max(0, prev - 1));
      show('图集已删除');
      setGalleryToDelete(null);
    } catch (error) {
      console.error('Delete gallery from list error:', error);
      show('删除图集失败', { variant: 'error' });
    } finally {
      setDeletingGalleryId(null);
    }
  };

  return (
    <div
      className="min-h-[calc(100vh-60px)] bg-bg-primary"
      style={{
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 gallery-page">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-bold text-text-primary tracking-[0.12em]">图集馆</h1>
            <div className="flex items-center gap-3">
              <ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
              {user && !isBanned && galleryAccessLoaded && (!isGalleryAdminOnly || isAdmin) && (
                <button
                  onClick={() => setIsUploadModalOpen(true)}
                  className="px-5 py-2 theme-button-primary text-sm rounded active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <Plus size={15} /> 上传图集
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        {galleries.length > 0 ? (
          <>
            <div
              className={clsx(
                'grid',
                VIEW_MODE_CONFIG[viewMode].gridCols,
                VIEW_MODE_CONFIG[viewMode].gap
              )}
            >
              {galleries.map((gallery) => (
                <GalleryCard
                  key={gallery.id}
                  gallery={gallery}
                  viewMode={viewMode}
                  isAdmin={isAdmin}
                  deletingGalleryId={deletingGalleryId}
                  onCopyLink={handleCopyGalleryLink}
                  onRequestDelete={handleRequestDeleteGallery}
                />
              ))}
            </div>
            {galleryPagination.totalPages > 1 && (
              <div className="mt-8">
                <Pagination
                  page={galleryPagination.page}
                  totalPages={galleryPagination.totalPages}
                  onPageChange={galleryPagination.handlePageChange}
                  pageSize={galleryPagination.pageSize}
                  onPageSizeChange={galleryPagination.handlePageSizeChange}
                  showPageSizeSelector
                />
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center text-text-muted italic tracking-[0.1em]">
            <ImageIcon size={48} className="mx-auto text-border mb-6" />
            暂无图集，快来上传吧！
          </div>
        )}

        {/* Upload Modal */}
        <AnimatePresence>
          {isUploadModalOpen && galleryAccessLoaded && (!isGalleryAdminOnly || isAdmin) && (
            <UploadModal
              onClose={() => setIsUploadModalOpen(false)}
              isGalleryAdminOnly={isGalleryAdminOnly}
            />
          )}
        </AnimatePresence>

        {/* Delete Confirm */}
        <AnimatePresence>
          {galleryToDelete && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-surface rounded p-8 max-w-md w-full border border-border"
              >
                <h3 className="text-xl font-semibold text-text-primary mb-4 tracking-wide">确认删除</h3>
                <p className="text-text-secondary mb-8 text-[0.9375rem]">
                  您确定要删除图集《{galleryToDelete.title}》吗？此操作无法撤销。
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setGalleryToDelete(null)}
                    disabled={Boolean(deletingGalleryId)}
                    className="flex-1 px-6 py-3 bg-surface-alt text-text-secondary rounded font-semibold hover:bg-bg-tertiary active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmDeleteGallery}
                    disabled={Boolean(deletingGalleryId)}
                    className="flex-1 px-6 py-3 theme-button-danger rounded font-semibold active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingGalleryId ? '删除中...' : '确定删除'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const UploadModal = ({
  onClose,
  isGalleryAdminOnly,
}: {
  onClose: () => void;
  isGalleryAdminOnly: boolean;
}) => {
  const { user, isAdmin, isBanned } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [locationName, setLocationName] = useState<string | null>(null);
  const [locationCode, setLocationCode] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalPreviewFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragDepth, setDragDepth] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<LocalPreviewFile[]>([]);
  const { show } = useToast();

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const handleClose = () => {
    files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setFiles([]);
    onClose();
  };

  const extractLocationFromImages = async (imageFiles: File[]) => {
    if (locationName) return;

    try {
      const gpsResults = await extractGpsFromMultipleFiles(imageFiles);
      const mostFrequentGps = findMostFrequentGpsCoordinates(gpsResults);

      if (mostFrequentGps) {
        const data = await apiPost<{
          result?: {
            adcode: string;
            province: string;
            city: string;
            district: string;
          }
        }>('/api/regions/resolve', {
          lng: mostFrequentGps.longitude,
          lat: mostFrequentGps.latitude,
        });

        if (data.result) {
          const { adcode, province, city, district } = data.result;
          const fullName = `${province}${city}${district}`.replace(/^(内蒙古自治区|宁夏回族自治区|广西壮族自治区|新疆维吾尔自治区|西藏自治区|特别行政区)/g, (m: string) => m);

          setLocationName(fullName);
          setLocationCode(adcode);
          show(`已自动识别地点：${fullName}`, { variant: 'success' });
        }
      }
    } catch (error) {
      console.error('Failed to extract location from images:', error);
    }
  };

  const appendFiles = (fileList: FileList | File[]) => {
    if (uploading) return;

    const maxSize = UPLOAD_MAX_FILE_SIZE_BYTES;
    const validFiles: { file: File; previewUrl: string }[] = [];
    const invalidFiles: string[] = [];

    Array.from(fileList).forEach((file: File) => {
      if (!GALLERY_UPLOAD_ALLOWED_TYPES.has(file.type)) {
        invalidFiles.push(`${file.name} (不支持的文件类型)`);
      } else if (file.size > maxSize) {
        invalidFiles.push(`${file.name} (文件过大，${formatUploadLimitWithSize(maxSize)})`);
      } else {
        validFiles.push({
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }
    });

    if (invalidFiles.length > 0) {
      show(`以下文件无法上传：${invalidFiles.slice(0, 3).join(', ')}${invalidFiles.length > 3 ? '...' : ''}`, { variant: 'error' });
    }

    if (validFiles.length === 0) return;

    setFiles((prev) => [...prev, ...validFiles]);

    if (!title && validFiles[0]?.file && (validFiles[0].file as any).webkitRelativePath) {
      const path = (validFiles[0].file as any).webkitRelativePath;
      const folderName = path.split('/')[0];
      if (folderName) setTitle(folderName);
    }

    extractLocationFromImages(validFiles.map((file) => file.file));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    e.target.value = '';

    if (!fileList?.length) return;
    appendFiles(fileList);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth((prev) => prev + 1);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth((prev) => Math.max(0, prev - 1));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (uploading || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth(0);

    if (!event.dataTransfer.files?.length) return;
    appendFiles(event.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles(prev => {
      const target = prev[index];
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
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

  const handleUpload = async () => {
    if (!user || files.length === 0) return show('请选择图片', { variant: 'error' });
    if (isBanned) return show('账号已被封禁，无法上传图集', { variant: 'error' });
    if (isGalleryAdminOnly && !isAdmin) return show('当前图集已临时限制为仅管理员可操作', { variant: 'error' });

    const groups: { [key: string]: File[] } = {};
    files.forEach((entry) => {
      const path = (entry.file as any).webkitRelativePath || '';
      const folderName = path.split('/')[0] || '默认图集';
      if (!groups[folderName]) groups[folderName] = [];
      groups[folderName].push(entry.file);
    });

    setUploading(true);
    setProgress(0);

    const MAX_CONCURRENT = 3;

    const uploadFilesWithConcurrency = async (
      sessionId: string,
      fileList: File[],
      onFileComplete: () => void
    ): Promise<string[]> => {
      const results: string[] = [];

      for (let i = 0; i < fileList.length; i += MAX_CONCURRENT) {
        const batch = fileList.slice(i, i + MAX_CONCURRENT);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            const uploadData = await uploadFileToSession(sessionId, file);
            onFileComplete();
            return uploadData.asset.id;
          })
        );
        results.push(...batchResults);
      }

      return results;
    };

    try {
      const groupNames = Object.keys(groups);
      const totalFiles = files.length;
      let uploadedCount = 0;

      for (const groupName of groupNames) {
        const groupFiles = groups[groupName];
        const sessionData = await apiPost<UploadSessionResponse>('/api/uploads/sessions', {
          maxFiles: groupFiles.length,
        });
        const sessionId = sessionData.session.id;

        const galleryTitle = groupNames.length === 1 && title ? title : groupName;

        const uploadedAssetIds = await uploadFilesWithConcurrency(
          sessionId,
          groupFiles,
          () => {
            uploadedCount++;
            setProgress(Math.round((uploadedCount / totalFiles) * 100));
          }
        );

        await apiPost(`/api/uploads/sessions/${sessionId}/finalize`);

        const galleryResponse = await apiPost<GalleryCreateResponse>('/api/galleries', {
          title: galleryTitle,
          description: description || `来自 ${groupName} 的图集`,
          uploadSessionId: sessionId,
          assetIds: uploadedAssetIds,
          tags: tags.split(',').map(t => t.trim()).filter(t => t),
          locationCode: locationCode,
          locationDetail: locationName,
        });

        if (galleryResponse.gallery?.id) {
          navigate(`/gallery/${galleryResponse.gallery.id}`);
        }
      }

      handleClose();
    } catch (e) {
      console.error("Error uploading gallery:", e);
      show('上传失败，请重试', { variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clsx(
          'relative bg-surface rounded w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border transition-colors',
          dragDepth > 0 ? 'border-brand-gold' : 'border-border'
        )}
      >
        {dragDepth > 0 ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-bg-primary/80 px-4">
            <div className="w-full max-w-2xl rounded border-2 border-dashed border-brand-gold bg-surface/95 px-8 py-12 text-center">
              <p className="text-lg font-bold text-text-primary">松开鼠标上传图片</p>
              <p className="mt-2 text-sm text-text-muted">支持 {GALLERY_UPLOAD_TYPE_LABEL}，单张不超过 {formatUploadLimit()}</p>
            </div>
          </div>
        ) : null}
        <div className="p-6 border-b border-border flex justify-between items-center">
          <h2 className="text-[1.5rem] font-bold text-text-primary tracking-[0.12em]">上传新图集</h2>
          <button onClick={handleClose} className="p-2 text-text-muted theme-icon-button-danger transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">图集标题 <span className="theme-text-error">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例如：2024 Live 现场返图"
              className="theme-input w-full px-4 py-3 rounded text-base"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-muted">标签 (逗号分隔)</label>
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="例如：Live, 绝色, 2024"
                className="theme-input w-full px-4 py-3 rounded text-base"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-muted">地点</label>
              <LocationTagInput
                value={locationName}
                locationCode={locationCode}
                onChange={(name, code) => {
                  setLocationName(name);
                  setLocationCode(code);
                }}
                onClear={() => {
                  setLocationName(null);
                  setLocationCode(null);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">描述 (可选)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="简单介绍一下这个图集..."
              rows={3}
              className="theme-input w-full px-4 py-3 rounded resize-none text-base"
            />
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 min-w-[160px] p-6 border-2 border-dashed border-border rounded hover:border-brand-gold hover:bg-surface-alt active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2 group disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Upload size={28} className="text-text-muted group-hover:text-brand-gold" />
                <span className="text-sm text-text-secondary group-hover:text-brand-gold">选择多张图片</span>
                <input
                  type="file"
                  multiple
                  accept={GALLERY_UPLOAD_ACCEPT}
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </button>

              <button
                onClick={() => folderInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 min-w-[160px] p-6 border-2 border-dashed border-border rounded hover:border-brand-gold hover:bg-surface-alt active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2 group disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Folder size={28} className="text-text-muted group-hover:text-brand-gold" />
                <span className="text-sm text-text-secondary group-hover:text-brand-gold">上传整个文件夹</span>
                <input
                  type="file"
                  // @ts-ignore
                  webkitdirectory=""
                  directory=""
                  multiple
                  className="hidden"
                  ref={folderInputRef}
                  onChange={handleFileChange}
                />
              </button>
            </div>

            {files.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 p-3 bg-surface-alt border border-border rounded">
                {files.map((item, i) => (
                  <div key={i} className="relative aspect-square rounded overflow-hidden group">
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 p-1 theme-button-danger rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-border flex items-center justify-between">
          <div className="flex-grow mr-6">
            {uploading && (
              <div className="w-full h-2 bg-surface-alt rounded overflow-hidden">
                <div
                  className="h-full bg-[var(--color-theme-accent)] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            )}
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading || files.length === 0}
            className="px-8 py-3 theme-button-primary rounded font-medium active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {uploading ? `上传中 ${progress}%` : '开始上传'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GalleryList;
