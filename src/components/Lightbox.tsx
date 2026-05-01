import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getFitScale as getFitScaleUtil, computeNextScale } from '../utils/lightbox';

interface LightboxImage {
  id: string;
  url: string;
  name?: string | null;
}

interface LightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

const MIN_PIXEL_SCALE = 0.05;
const MAX_PIXEL_SCALE = 5;
const ZOOM_RATIO = 0.1;

export const Lightbox = ({ images, initialIndex, onClose }: LightboxProps) => {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [pixelScale, setPixelScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [imageNaturalWidth, setImageNaturalWidth] = useState(0);
  const [imageNaturalHeight, setImageNaturalHeight] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const lightboxStateKey = useRef<string | null>(null);

  // Drag refs (avoid stale closures during high-frequency events)
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const initialTranslateXRef = useRef(0);
  const initialTranslateYRef = useRef(0);
  const translateXRef = useRef(0);
  const translateYRef = useRef(0);
  const pixelScaleRef = useRef(1);
  const imageRef = useRef<HTMLImageElement>(null);

  // Pinch refs
  const isPinching = useRef(false);
  const initialPinchDistance = useRef(0);
  const initialPinchScale = useRef(1);

  const activeImage = images[activeIndex];
  const currentImageUrl = activeImage?.url || '';

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const getFitScale = useCallback(() => {
    return getFitScaleUtil(imageNaturalWidth, imageNaturalHeight, window.innerWidth, window.innerHeight);
  }, [imageNaturalWidth, imageNaturalHeight]);

  const resetImageState = useCallback(() => {
    setIsImageLoading(true);
    setImageNaturalWidth(0);
    setImageNaturalHeight(0);
    setPixelScale(1);
    setTranslateX(0);
    setTranslateY(0);
    setIsDragging(false);
  }, []);

  const close = useCallback(() => {
    if (lightboxStateKey.current) {
      lightboxStateKey.current = null;
      window.history.back();
    }
    onCloseRef.current();
  }, []);

  const prev = useCallback(() => {
    if (images.length <= 1) return;
    setActiveIndex((idx) => (idx - 1 + images.length) % images.length);
    resetImageState();
  }, [images.length, resetImageState]);

  const next = useCallback(() => {
    if (images.length <= 1) return;
    setActiveIndex((idx) => (idx + 1) % images.length);
    resetImageState();
  }, [images.length, resetImageState]);

  const prevRef = useRef(prev);
  prevRef.current = prev;
  const nextRef = useRef(next);
  nextRef.current = next;
  const closeRef = useRef(close);
  closeRef.current = close;

  // Mount / unmount effects — run exactly once to avoid duplicate pushState
  useEffect(() => {
    triggerElementRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();
    document.body.style.overflow = 'hidden';

    const key = `lightbox-${Date.now()}`;
    lightboxStateKey.current = key;
    window.history.pushState({ [key]: true, lightboxOpen: true }, '', '');

    const handlePopstate = (e: PopStateEvent) => {
      if (lightboxStateKey.current && !e.state?.[lightboxStateKey.current]) {
        lightboxStateKey.current = null;
        onCloseRef.current();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          prevRef.current();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          nextRef.current();
          break;
        case 'Escape':
          e.preventDefault();
          closeRef.current();
          break;
        case 'Tab': {
          const focusableElements = containerRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (!focusableElements || focusableElements.length === 0) return;
          const firstElement = focusableElements[0];
          const lastElement = focusableElements[focusableElements.length - 1];
          if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
          break;
        }
      }
    };

    window.addEventListener('popstate', handlePopstate);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopstate);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      triggerElementRef.current?.focus();
    };
  }, []);

  // Keep refs in sync with state (for non-drag updates)
  useEffect(() => {
    pixelScaleRef.current = pixelScale;
  }, [pixelScale]);
  useEffect(() => {
    translateXRef.current = translateX;
    translateYRef.current = translateY;
  }, [translateX, translateY]);

  // Apply transform to DOM directly (used during drag to avoid re-renders)
  const applyTransform = useCallback((tx: number, ty: number, ps: number) => {
    const img = imageRef.current;
    if (img) {
      img.style.transform = `scale(${ps}) translate(${tx / ps}px, ${ty / ps}px)`;
    }
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setPixelScale((scale) => computeNextScale(scale, e.deltaY < 0, ZOOM_RATIO, MIN_PIXEL_SCALE, MAX_PIXEL_SCALE));
  }, []);

  // Mouse drag — use refs + direct DOM to avoid re-renders on every pixel
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    initialTranslateXRef.current = translateXRef.current;
    initialTranslateYRef.current = translateYRef.current;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;
    const tx = initialTranslateXRef.current + dx;
    const ty = initialTranslateYRef.current + dy;
    translateXRef.current = tx;
    translateYRef.current = ty;
    applyTransform(tx, ty, pixelScaleRef.current);
  }, [isDragging, applyTransform]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setTranslateX(translateXRef.current);
      setTranslateY(translateYRef.current);
    }
  }, [isDragging]);

  // Touch handling
  const getPinchDistance = (touches: React.TouchList) => {
    const touch0 = touches[0];
    const touch1 = touches[1];
    const dx = touch0.clientX - touch1.clientX;
    const dy = touch0.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLImageElement>) => {
    if (e.touches.length === 2) {
      isPinching.current = true;
      initialPinchDistance.current = getPinchDistance(e.touches);
      initialPinchScale.current = pixelScaleRef.current;
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      dragStartX.current = touch.clientX;
      dragStartY.current = touch.clientY;
      initialTranslateXRef.current = translateXRef.current;
      initialTranslateYRef.current = translateYRef.current;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLImageElement>) => {
    if (e.touches.length === 2 && isPinching.current) {
      e.preventDefault();
      const distance = getPinchDistance(e.touches);
      const pinchScale = distance / initialPinchDistance.current;
      const newScale = Math.min(MAX_PIXEL_SCALE, Math.max(MIN_PIXEL_SCALE, initialPinchScale.current * pinchScale));
      setPixelScale(newScale);
    } else if (e.touches.length === 1 && isDragging) {
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartX.current;
      const dy = touch.clientY - dragStartY.current;
      const tx = initialTranslateXRef.current + dx;
      const ty = initialTranslateYRef.current + dy;
      translateXRef.current = tx;
      translateYRef.current = ty;
      applyTransform(tx, ty, pixelScaleRef.current);
    }
  }, [isDragging, applyTransform]);

  const handleTouchEnd = useCallback(() => {
    isPinching.current = false;
    if (isDragging) {
      setIsDragging(false);
      setTranslateX(translateXRef.current);
      setTranslateY(translateYRef.current);
    }
  }, [isDragging]);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalWidth(img.naturalWidth);
    setImageNaturalHeight(img.naturalHeight);
    setIsImageLoading(false);
    const fit = getFitScaleUtil(img.naturalWidth, img.naturalHeight, window.innerWidth, window.innerHeight);
    setPixelScale(fit);
    setTranslateX(0);
    setTranslateY(0);
  }, []);

  // Toolbar actions
  const zoomIn = useCallback(() => {
    setPixelScale((s) => computeNextScale(s, true, ZOOM_RATIO, MIN_PIXEL_SCALE, MAX_PIXEL_SCALE));
  }, []);

  const zoomOut = useCallback(() => {
    setPixelScale((s) => computeNextScale(s, false, ZOOM_RATIO, MIN_PIXEL_SCALE, MAX_PIXEL_SCALE));
  }, []);

  const zoomToFit = useCallback(() => {
    setPixelScale(getFitScale());
    setTranslateX(0);
    setTranslateY(0);
  }, [getFitScale]);

  const zoomToActual = useCallback(() => {
    setPixelScale(1);
    setTranslateX(0);
    setTranslateY(0);
  }, []);

  const displayScale = isImageLoading ? null : Math.round(pixelScale * 100);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 select-none"
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Close button */}
      <button
        ref={closeButtonRef}
        onClick={close}
        className="absolute top-4 right-4 z-30 p-2 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"
        aria-label="关闭"
      >
        <X size={24} />
      </button>

      {/* Image counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/60 text-sm z-30">
        {activeIndex + 1} / {images.length}
      </div>

      {/* Prev / Next buttons */}
      {images.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="上一张"
          >
            <ChevronLeft size={28} />
          </button>
          <button
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="下一张"
          >
            <ChevronRight size={28} />
          </button>
        </>
      )}

      {/* Backdrop click to close */}
      <div className="absolute inset-0 z-0" onClick={close} />

      {/* Image container */}
      <div className="relative z-10 flex items-center justify-center pointer-events-none shrink-0">
        {activeImage && (
          <img
            ref={imageRef}
            key={currentImageUrl}
            src={currentImageUrl}
            alt={activeImage.name || ''}
            className={[
              'object-contain pointer-events-auto max-w-none max-h-none shrink-0',
              isDragging ? 'cursor-grabbing' : 'cursor-grab',
            ].join(' ')}
            style={
              isImageLoading
                ? { visibility: 'hidden' }
                : {
                    width: `${imageNaturalWidth}px`,
                    height: `${imageNaturalHeight}px`,
                    transform: `scale(${pixelScale}) translate(${translateX / pixelScale}px, ${translateY / pixelScale}px)`,
                  }
            }
            draggable={false}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onLoad={onImageLoad}
          />
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/40 rounded px-4 py-2 z-30">
        <button
          onClick={zoomOut}
          className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center transition-colors"
          title="缩小"
        >
          <ZoomOut size={20} />
        </button>

        <div className="text-white/80 text-sm min-w-[60px] text-center font-mono">
          {displayScale !== null ? `${displayScale}%` : '-'}
        </div>

        <button
          onClick={zoomIn}
          className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center transition-colors"
          title="放大"
        >
          <ZoomIn size={20} />
        </button>

        <div className="w-px h-5 bg-white/20 mx-1" />

        <button
          onClick={zoomToActual}
          className="text-white/70 hover:text-white px-2 h-8 flex items-center justify-center transition-colors text-sm font-medium"
          title="实际大小 (1:1)"
        >
          1:1
        </button>

        <button
          onClick={zoomToFit}
          className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center transition-colors"
          title="适应屏幕"
        >
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
};
