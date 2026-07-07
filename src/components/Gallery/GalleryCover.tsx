import { Image as ImageIcon } from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartImage } from '../SmartImage'
import {
  getFirstGalleryImage,
  getGalleryThumbnailPlaceholderLabel,
} from '../../lib/galleryThumbnails'
import type { GalleryItem } from '../../types/entities'

interface GalleryCoverProps {
  gallery: GalleryItem
  className?: string
  imageClassName?: string
  priority?: boolean
}

const COVER_FILTER = 'brightness(0.97) saturate(0.92)'

export const GalleryCover = ({
  gallery,
  className,
  imageClassName,
  priority = false,
}: GalleryCoverProps) => {
  const image = getFirstGalleryImage(gallery)

  if (image?.thumbnailUrl) {
    return (
      <SmartImage
        src={image.thumbnailUrl}
        alt={gallery.title}
        className={clsx('h-full w-full object-cover', imageClassName)}
        style={{ filter: COVER_FILTER }}
        fetchpriority={priority ? 'high' : 'auto'}
        lazy={!priority}
      />
    )
  }

  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-alt text-text-muted',
        className
      )}
    >
      <ImageIcon size={22} className="text-brand-gold/50" aria-hidden="true" />
      <span className="max-w-[8rem] px-2 text-center text-[0.6875rem] leading-relaxed text-text-muted/70">
        {getGalleryThumbnailPlaceholderLabel(image)}
      </span>
    </div>
  )
}
