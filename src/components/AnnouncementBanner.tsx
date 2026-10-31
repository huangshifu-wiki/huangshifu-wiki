import { useLayoutEffect, useRef, type ComponentProps } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { clsx } from 'clsx'
import { Megaphone, X, ChevronRight } from '@/src/components/icons'
import { Button, IconButton } from '@/src/components/ui'
import type { AnnouncementItem } from '../types/entities'

type AnnouncementBannerProps = ComponentProps<typeof motion.div> & {
  announcement: AnnouncementItem
  visible: boolean
  onDismiss: () => void
  onClose: () => void
}

export default function AnnouncementBanner({
  announcement,
  visible,
  onDismiss,
  onClose,
  className,
  ref,
  ...props
}: AnnouncementBannerProps) {
  const announcementRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const root = document.documentElement
    const element = announcementRef.current
    if (!element || !visible) {
      root.style.removeProperty('--announcement-bar-offset')
      return
    }

    const updateOffset = () => {
      const visibleHeight = element.getBoundingClientRect().height
      root.style.setProperty(
        '--announcement-bar-offset',
        `${Math.max(visibleHeight - window.scrollY, 0)}px`
      )
    }
    updateOffset()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateOffset) : null
    observer?.observe(element)
    window.addEventListener('scroll', updateOffset, { passive: true })
    window.addEventListener('resize', updateOffset)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', updateOffset)
      window.removeEventListener('resize', updateOffset)
      root.style.removeProperty('--announcement-bar-offset')
    }
  }, [announcement.id, visible])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          {...props}
          ref={(element) => {
            announcementRef.current = element
            if (typeof ref === 'function') return ref(element)
            if (ref) ref.current = element
          }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className={clsx(
            'py-2 px-4 relative overflow-hidden bg-[var(--color-theme-accent)] text-white',
            className
          )}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-3">
            <Megaphone size={16} className="animate-bounce shrink-0" />
            <p className="text-sm font-bold truncate pr-24">{announcement.content}</p>
            {announcement.link && (
              <a
                href={announcement.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-bold hover:underline shrink-0"
              >
                立即查看 <ChevronRight size={14} />
              </a>
            )}
          </div>
          <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="text-white hover:bg-black/10 hover:text-white"
              aria-label="不再显示此公告"
            >
              不再显示
            </Button>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-white hover:bg-black/10 hover:text-white"
              aria-label="关闭公告"
            >
              <X size={16} />
            </IconButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
