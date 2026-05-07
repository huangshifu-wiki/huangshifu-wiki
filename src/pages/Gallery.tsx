import React, { useEffect, useState, useRef, useMemo } from 'react';
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
import { getImagePreference } from '../services/imageService';
import { toDateValue } from '../lib/dateUtils';
import { LocationTagInput } from '../components/LocationTagInput';
import Pagination from '../components/Pagination';
import { extractGpsFromMultipleFiles, findMostFrequentGpsCoordinates } from '../services/exifService';
import type { GalleryItem } from '../types/entities';
import type { UploadSessionResponse, UploadFileResponse, GalleryCreateResponse } from '../types/api';

const DEFAULT_PAGE_SIZE = 24;

type LocalPreviewFile = {
  file: File;
  previewUrl: string;
};

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
          ? 'flex gap-4 p-3 bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all w-full'
          : 'block bg-white border border-[#e0dcd3] rounded overflow-hidden hover:border-[#c8951e] transition-all'
      )}
    >
      {viewMode === 'list' ? (
        <>
          <div className="w-20 h-20 bg-[#f7f5f0] rounded overflow-hidden flex-shrink-0">
            <SmartImage
              src={(Array.isArray(gallery.images) && gallery.images[0]?.url) || ''}
              alt={gallery.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-medium text-[#2c2c2c] group-hover:text-[#c8951e] transition-colors truncate">{gallery.title}</h3>
              <span className="px-1.5 py-0.5 bg-[#f7f5f0] text-[#9e968e] text-[10px] font-medium rounded flex-shrink-0">
                {Array.isArray(gallery.images) ? gallery.images.length : 0} 张
              </span>
            </div>
            <p className="text-[#9e968e] text-xs line-clamp-1">
              {gallery.description || '暂无描述'}
            </p>
            <div className="flex items-center gap-3 text-[#9e968e] text-[11px] mt-1">
              <span className="flex items-center gap-1"><Clock size={10} /> {toDateValue(gallery.createdAt) ? format(toDateValue(gallery.createdAt)!, 'yyyy-MM-dd') : '刚刚'}</span>
              <span className="flex items-center gap-1"><UserIcon size={10} /> {gallery.authorUid?.substring(0, 6)}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={clsx('relative overflow-hidden', VIEW_MODE_CONFIG[viewMode].cardHeight)}>
            <SmartImage
              src={(Array.isArray(gallery.images) && gallery.images[0]?.url) || ''}
              alt={gallery.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/40 text-white text-[10px] font-medium rounded">
              {Array.isArray(gallery.images) ? gallery.images.length : 0} 张
            </div>
          </div>
          <div className="p-3">
            <h3 className="text-sm font-medium text-[#2c2c2c] mb-1 group-hover:text-[#c8951e] transition-colors truncate">{gallery.title}</h3>
            <div className="flex flex-wrap gap-1 mb-2">
              {gallery.tags?.slice(0, 3).map((tag: string) => (
                <span key={tag} className="text-[10px] text-[#c8951e] bg-[#f7f5f0] px-1.5 py-0.5 rounded">{tag}</span>
              ))}
            </div>
            <div className="flex items-center justify-between text-[#9e968e] text-[11px]">
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
        className="absolute top-2 left-2 p-1.5 rounded bg-white/90 border border-[#e0dcd3] text-[#9e968e] hover:text-red-500 transition-all disabled:cursor-not-allowed disabled:opacity-60"
        title="删除图集"
        aria-label="删除图集"
      >
        <Trash2 size={12} />
      </button>
    ) : null}
    <button
      onClick={(event) => onCopyLink(event, gallery.id)}
      className={clsx(
        'p-1.5 rounded bg-white/90 border border-[#e0dcd3] text-[#9e968e] hover:text-[#c8951e] transition-all',
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
  const [galleryToDelete, setGalleryToDelete] = useState<{ id: string; title: string } | null>(null);
  const [deletingGalleryId, setDeletingGalleryId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { show } = useToast();
  const { preferences, setViewMode } = useUserPreferences();
  const viewMode = preferences.viewMode;

  const totalGalleryPages = Math.ceil(galleries.length / pageSize);
  const paginatedGalleries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return galleries.slice(start, start + pageSize);
  }, [galleries, page, pageSize]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  useEffect(() => {
    const fetchGalleries = async () => {
      try {
        const data = await apiGet<{ galleries: GalleryItem[] }>('/api/galleries');
        setGalleries(data.galleries || []);
      } catch (error) {
        console.error('Fetch galleries error:', error);
        setGalleries([]);
      }
    };

    fetchGalleries();
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
      setGalleries((prev) => prev.filter((gallery) => gallery.id !== galleryToDelete.id));
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
      className="min-h-[calc(100vh-60px)]"
      style={{
        backgroundColor: '#f7f5f0',
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <style>{`
        .gallery-page ::selection {
          background-color: #fdf5d8;
          color: #c8951e;
        }
      `}</style>

      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 gallery-page">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">图集馆</h1>
            <div className="flex items-center gap-3">
              <ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
              {user && !isBanned && (
                <button
                  onClick={() => setIsUploadModalOpen(true)}
                  className="px-5 py-2 bg-[#c8951e] text-white text-sm rounded hover:bg-[#dca828] transition-all flex items-center gap-2"
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
            <div className={clsx('grid', VIEW_MODE_CONFIG[viewMode].gridCols, 'gap-3')}>
              {paginatedGalleries.map((gallery) => (
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
            {totalGalleryPages > 1 && (
              <div className="mt-8">
                <Pagination
                  page={page}
                  totalPages={totalGalleryPages}
                  onPageChange={handlePageChange}
                  pageSize={pageSize}
                  onPageSizeChange={handlePageSizeChange}
                  showPageSizeSelector
                />
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center text-[#9e968e] italic tracking-[0.1em]">
            <ImageIcon size={48} className="mx-auto text-[#e0dcd3] mb-6" />
            暂无图集，快来上传吧！
          </div>
        )}

        {/* Upload Modal */}
        <AnimatePresence>
          {isUploadModalOpen && (
            <UploadModal onClose={() => setIsUploadModalOpen(false)} />
          )}
        </AnimatePresence>

        {/* Delete Confirm */}
        <AnimatePresence>
          {galleryToDelete && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded p-8 max-w-md w-full border border-[#e0dcd3]"
              >
                <h3 className="text-xl font-semibold text-[#2c2c2c] mb-4 tracking-wide">确认删除</h3>
                <p className="text-[#6b6560] mb-8 text-[0.9375rem]">
                  您确定要删除图集《{galleryToDelete.title}》吗？此操作无法撤销。
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => setGalleryToDelete(null)}
                    disabled={Boolean(deletingGalleryId)}
                    className="flex-1 px-6 py-3 bg-[#f0ece3] text-[#6b6560] rounded font-semibold hover:bg-[#e0dcd3] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmDeleteGallery}
                    disabled={Boolean(deletingGalleryId)}
                    className="flex-1 px-6 py-3 bg-red-500 text-white rounded font-semibold hover:bg-red-600 transition-all disabled:cursor-not-allowed disabled:opacity-60"
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

const UploadModal = ({ onClose }: { onClose: () => void }) => {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const maxSize = 10 * 1024 * 1024;

      const validFiles: { file: File; previewUrl: string }[] = [];
      const invalidFiles: string[] = [];

      Array.from(e.target.files!).forEach((file: File) => {
        if (!allowedTypes.includes(file.type)) {
          invalidFiles.push(`${file.name} (不支持的文件类型)`);
        } else if (file.size > maxSize) {
          invalidFiles.push(`${file.name} (文件过大，最大 10MB)`);
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

      if (validFiles.length > 0) {
        setFiles((prev) => [...prev, ...validFiles]);

        if (!title && validFiles[0]?.file && (validFiles[0].file as any).webkitRelativePath) {
          const path = (validFiles[0].file as any).webkitRelativePath;
          const folderName = path.split('/')[0];
          if (folderName) setTitle(folderName);
        }

        extractLocationFromImages(validFiles.map(f => f.file));
      }
    }
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-white rounded w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border border-[#e0dcd3]"
      >
        <div className="p-6 border-b border-[#e0dcd3] flex justify-between items-center">
          <h2 className="text-[1.5rem] font-bold text-[#2c2c2c] tracking-[0.12em]">上传新图集</h2>
          <button onClick={handleClose} className="p-2 text-[#9e968e] hover:text-red-500 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#9e968e]">图集标题 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例如：2024 Live 现场返图"
              className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] text-base"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#9e968e]">标签 (逗号分隔)</label>
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="例如：Live, 绝色, 2024"
                className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] text-base"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#9e968e]">地点</label>
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
            <label className="text-xs font-medium text-[#9e968e]">描述 (可选)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="简单介绍一下这个图集..."
              rows={3}
              className="w-full px-4 py-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded focus:outline-none focus:border-[#c8951e] resize-none text-base"
            />
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 min-w-[160px] p-6 border-2 border-dashed border-[#e0dcd3] rounded hover:border-[#c8951e] hover:bg-[#f7f5f0] transition-all flex flex-col items-center justify-center gap-2 group"
              >
                <Upload size={28} className="text-[#9e968e] group-hover:text-[#c8951e]" />
                <span className="text-sm text-[#6b6560] group-hover:text-[#c8951e]">选择多张图片</span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
              </button>

              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex-1 min-w-[160px] p-6 border-2 border-dashed border-[#e0dcd3] rounded hover:border-[#c8951e] hover:bg-[#f7f5f0] transition-all flex flex-col items-center justify-center gap-2 group"
              >
                <Folder size={28} className="text-[#9e968e] group-hover:text-[#c8951e]" />
                <span className="text-sm text-[#6b6560] group-hover:text-[#c8951e]">上传整个文件夹</span>
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
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 p-3 bg-[#f7f5f0] border border-[#e0dcd3] rounded">
                {files.map((item, i) => (
                  <div key={i} className="relative aspect-square rounded overflow-hidden group">
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-[#e0dcd3] flex items-center justify-between">
          <div className="flex-grow mr-6">
            {uploading && (
              <div className="w-full h-2 bg-[#f0ece3] rounded overflow-hidden">
                <div
                  className="h-full bg-[#c8951e] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            )}
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading || files.length === 0}
            className="px-8 py-3 bg-[#c8951e] text-white rounded font-medium hover:bg-[#dca828] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {uploading ? `上传中 ${progress}%` : '开始上传'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GalleryList;
