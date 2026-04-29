import React from 'react';
import { MapPin, Check, X, Loader2 } from 'lucide-react';

interface RegionSuggestion {
  code: string;
  name: string;
  fullName: string;
  level: number;
  levelName: string;
  parentCode: string | null;
}

interface LocationConfirmDialogProps {
  open: boolean;
  detectedLocation: RegionSuggestion | null;
  onConfirm: () => void;
  onChange: () => void;
  onSkip: () => void;
  loading?: boolean;
}

export const LocationConfirmDialog = ({
  open,
  detectedLocation,
  onConfirm,
  onChange,
  onSkip,
  loading,
}: LocationConfirmDialogProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onSkip} />
      <div className="relative bg-white rounded border border-[#e0dcd3] w-[90vw] max-w-md overflow-hidden">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded bg-[#fdf5d8]">
              <MapPin size={18} className="text-[#c8951e]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#2c2c2c]">检测到拍摄地点</h3>
              <p className="text-sm text-[#9e968e]">是否使用从图片中提取的地点？</p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={22} className="animate-spin text-[#c8951e]" />
              <span className="ml-2 text-sm text-[#6b6560]">正在解析地点...</span>
            </div>
          ) : detectedLocation ? (
            <div className="space-y-4">
              <div className="p-3 rounded border border-[#e0dcd3] bg-[#f7f5f0]">
                <div className="text-sm font-medium text-[#2c2c2c]">{detectedLocation.fullName}</div>
                <div className="text-xs text-[#9e968e] mt-1">{detectedLocation.levelName}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onConfirm}
                  className="flex-1 px-4 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Check size={15} />
                  使用该地点
                </button>
                <button
                  onClick={onChange}
                  className="flex-1 px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
                >
                  更换地点
                </button>
              </div>
              <button
                onClick={onSkip}
                className="w-full px-4 py-2 text-[#9e968e] hover:text-[#c8951e] text-sm transition-colors"
              >
                暂不设置地点
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded border border-[#e0dcd3] bg-[#f7f5f0] text-center">
                <p className="text-sm text-[#9e968e]">未能在图片中检测到有效的 GPS 信息</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onChange}
                  className="flex-1 px-4 py-2 rounded bg-[#c8951e] text-white font-medium hover:bg-[#dca828] transition-all text-sm"
                >
                  手动选择地点
                </button>
                <button
                  onClick={onSkip}
                  className="flex-1 px-4 py-2 rounded border border-[#e0dcd3] text-[#6b6560] hover:border-[#c8951e] hover:text-[#c8951e] transition-all text-sm"
                >
                  跳过
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export type { RegionSuggestion };
