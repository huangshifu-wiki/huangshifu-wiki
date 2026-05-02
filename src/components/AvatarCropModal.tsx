import React, { useCallback, useRef, useState } from 'react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { X, Upload, Loader2 } from 'lucide-react';

import { uploadAvatar, type UploadImageResult } from '../services/imageService';

interface AvatarCropModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (photoURL: string) => void;
}

// 限制头像最大输出边长（足以覆盖 2x DPR 的 256 显示），避免超大 canvas 浪费内存
const MAX_AVATAR_SIZE = 512;
// 客户端允许的图片 MIME 白名单，与服务端保持一致
const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);

function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

export const AvatarCropModal = ({ open, onClose, onSuccess }: AvatarCropModalProps) => {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [crop, setCrop] = useState<Crop>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // 记录原图 MIME，用于决定输出格式（PNG 保留透明，JPG/WEBP 用有损）
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const imgRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setCrop(centerAspectCrop(naturalWidth, naturalHeight, 1));
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const mime = (file.type || '').toLowerCase();
    if (!ALLOWED_AVATAR_MIME.has(mime)) {
      setError('仅支持 JPG、PNG、WEBP、GIF、BMP 图片');
      return;
    }
    setImageMime(mime);
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result?.toString() || '');
    reader.readAsDataURL(file);
  };

  const getCroppedBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!imgRef.current || !crop) { resolve(null); return; }
      const image = imgRef.current;
      // 使用原图自然像素而不是 CSS 显示尺寸做裁剪坐标，避免高分辨率原图被压成 256px 模糊头像
      const naturalW = image.naturalWidth;
      const naturalH = image.naturalHeight;
      // crop 单位为百分比时直接乘以原图自然像素
      const cropX = (crop.x / 100) * naturalW;
      const cropY = (crop.y / 100) * naturalH;
      const cropWidth = (crop.width / 100) * naturalW;
      const cropHeight = (crop.height / 100) * naturalH;
      // aspect=1 强制 1:1 裁剪，因此 cropWidth === cropHeight
      const sourceSize = Math.min(cropWidth, cropHeight);
      // 但仍设置上限以避免过大 canvas
      const outputSize = Math.min(Math.round(sourceSize), MAX_AVATAR_SIZE);
      if (outputSize <= 0) { resolve(null); return; }

      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      // 提升缩放质量
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(
        image,
        cropX,
        cropY,
        sourceSize,
        sourceSize,
        0,
        0,
        outputSize,
        outputSize,
      );
      // PNG 保留透明通道，其它格式用 webp/jpeg 压缩
      const outputMime = imageMime === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = outputMime === 'image/png' ? undefined : 0.9;
      canvas.toBlob((blob) => resolve(blob), outputMime, quality);
    });
  };

  const handleConfirm = async () => {
    if (!crop) return;
    setUploading(true);
    setError('');
    try {
      const blob = await getCroppedBlob();
      if (!blob) { setError('裁剪图片失败'); setUploading(false); return; }
      const result: UploadImageResult = await uploadAvatar(blob);
      onSuccess(result.url);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setImageSrc('');
    setCrop(undefined);
    setError('');
    setImageMime('image/jpeg');
    if (inputRef.current) inputRef.current.value = '';
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 p-4 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded border border-[#e0dcd3] flex flex-col overflow-hidden">
        <header className="px-5 py-4 border-b border-[#e0dcd3] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#2c2c2c]">修改头像</h3>
            <p className="text-xs text-[#9e968e] mt-0.5">选择图片并调整裁剪区域</p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded text-[#9e968e] hover:text-[#2c2c2c] hover:bg-[#f7f5f0] transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          {!imageSrc ? (
            <div className="flex flex-col items-center justify-center py-8">
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                onChange={handleFileSelect}
                className="hidden"
                id="avatar-file-input"
              />
              <label
                htmlFor="avatar-file-input"
                className="flex flex-col items-center justify-center gap-3 w-32 h-32 rounded-full border-2 border-dashed border-[#e0dcd3] cursor-pointer hover:border-[#c8951e] transition-colors"
              >
                <Upload size={28} className="text-[#9e968e]" />
                <span className="text-sm text-[#9e968e]">选择图片</span>
              </label>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-64 h-64 overflow-hidden rounded-full border-2 border-[#e0dcd3]">
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  aspect={1}
                  circularCrop
                >
                  <img
                    ref={imgRef}
                    src={imageSrc}
                    alt="待裁剪"
                    onLoad={onImageLoad}
                    className="max-w-none"
                    style={{ width: 256, height: 256, objectFit: 'cover' }}
                  />
                </ReactCrop>
              </div>
              <p className="text-xs text-[#9e968e]">拖动裁剪框调整头像区域</p>
              <button
                onClick={() => { setImageSrc(''); if (inputRef.current) inputRef.current.value = ''; }}
                className="text-sm text-[#6b6560] hover:text-[#c8951e] underline"
              >
                重新选择
              </button>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500 text-center bg-red-50 rounded px-3 py-2">{error}</p>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-[#e0dcd3] bg-[#f7f5f0]/50 flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!imageSrc || !crop || uploading}
            className="px-5 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] disabled:opacity-50 inline-flex items-center gap-2 text-sm transition-all"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : null}
            {uploading ? '上传中...' : '确认'}
          </button>
        </footer>
      </div>
    </div>
  );
};
