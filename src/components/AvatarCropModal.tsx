import React, { useCallback, useRef, useState } from 'react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { X, Upload, Loader2 } from 'lucide-react';

import { uploadAvatar, type UploadImageResult } from '../services/imageService';

interface AvatarCropModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (photoURL: string) => void;
}

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
    if (!file.type.startsWith('image/')) { setError('请选择图片文件'); return; }
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result?.toString() || '');
    reader.readAsDataURL(file);
  };

  const getCroppedBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!imgRef.current || !crop) { resolve(null); return; }
      const image = imgRef.current;
      const canvas = document.createElement('canvas');
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      const cropX = (crop.x / 100) * image.width;
      const cropY = (crop.y / 100) * image.height;
      const cropWidth = (crop.width / 100) * image.width;
      const cropHeight = (crop.height / 100) * image.height;
      const size = Math.min(cropWidth, cropHeight);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(
        image,
        cropX + (cropWidth - size) / 2,
        cropY + (cropHeight - size) / 2,
        size, size,
        0, 0, size, size,
      );
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
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
                accept="image/*"
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
