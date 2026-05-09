import React, { useState, useEffect } from 'react';
import { decodeBlurhashToDataURL } from '../hooks/useBlurhash';

export interface BlurhashImageProps {
  blurhash?: string | null;
  src?: string | null;
  alt?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  placeholderClassName?: string;
  placeholderStyle?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: (error: Error) => void;
  decodeOptions?: {
    width?: number;
    height?: number;
    punch?: number;
  };
  transitionDuration?: number;
}

interface DecodeOptions {
  width?: number;
  height?: number;
  punch?: number;
}

const defaultDecodeOptions: DecodeOptions = {};

export const BlurhashImage: React.FC<BlurhashImageProps> = ({
  blurhash,
  src,
  alt = '',
  width,
  height,
  className = '',
  style = {},
  placeholderClassName = '',
  placeholderStyle = {},
  loading = 'lazy',
  onLoad,
  onError,
  decodeOptions = defaultDecodeOptions,
  transitionDuration = 300,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [blurhashDataUrl, setBlurhashDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (blurhash && blurhash.length > 0) {
      const dataUrl = decodeBlurhashToDataURL(
        blurhash,
        decodeOptions.width || 32,
        decodeOptions.height || 32,
        decodeOptions.punch
      );
      setBlurhashDataUrl(dataUrl);
    } else {
      setBlurhashDataUrl(null);
    }
  }, [blurhash, decodeOptions.width, decodeOptions.height, decodeOptions.punch]);

  const handleLoad = () => {
    setImageLoaded(true);
    setImageError(false);
    onLoad?.();
  };

  const handleError = (error: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setImageError(true);
    setImageLoaded(false);
    const err = error instanceof Error ? error : new Error('Image load failed');
    onError?.(err);
  };

  const shouldShowPlaceholder = blurhashDataUrl && !imageLoaded && !imageError;

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    width: width || 'auto',
    height: height || 'auto',
    overflow: 'hidden',
    ...style,
  };

  const placeholderStyleFinal: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: `opacity ${transitionDuration}ms ease-in-out`,
    opacity: shouldShowPlaceholder ? 1 : 0,
    ...placeholderStyle,
  };

  const imageStyleFinal: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: `opacity ${transitionDuration}ms ease-in-out`,
    opacity: imageLoaded ? 1 : 0,
  };

  return (
    <div className={`blurhash-image-container ${className}`} style={containerStyle}>
      {blurhashDataUrl && (
        <img
          src={blurhashDataUrl}
          alt=""
          className={`blurhash-placeholder ${placeholderClassName}`}
          style={placeholderStyleFinal}
          aria-hidden="true"
        />
      )}

      {src && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          onLoad={handleLoad}
          onError={handleError}
          className="blurhash-image"
          style={imageStyleFinal}
        />
      )}

      {imageError && !blurhashDataUrl && (
        <div
          className="blurhash-error-placeholder"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: '#f0f0f0',
            color: '#999',
            fontSize: '14px',
          }}
        >
          图片加载失败
        </div>
      )}
    </div>
  );
};

export interface SmartImageProps {
  imageId?: string;
  imageUrl?: string | null;
  blurhash?: string | null;
  alt?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: (error: Error) => void;
}

export const SmartImage: React.FC<SmartImageProps> = ({
  imageUrl,
  blurhash,
  alt = '',
  width,
  height,
  className = '',
  style = {},
  loading = 'lazy',
  onLoad,
  onError,
}) => {
  return (
    <BlurhashImage
      blurhash={blurhash}
      src={imageUrl}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
      loading={loading}
      onLoad={onLoad}
      onError={onError}
    />
  );
};
