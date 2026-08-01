import { Image as ImageIcon } from '@/src/components/icons'
import { clsx } from 'clsx'
import { SmartImage } from '../SmartImage'
import { CoverPlaceholder } from '../CoverPlaceholder'
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
    <CoverPlaceholder
      icon={<ImageIcon size={22} />}
      label={getGalleryThumbnailPlaceholderLabel(image)}
      labelClassName="max-w-[8rem]"
      className={className}
    />
  )
}
