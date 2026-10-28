import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Megaphone, X, ChevronRight } from '@/src/components/icons'
import { motion, AnimatePresence } from 'motion/react'
import { apiGet } from '../lib/apiClient'
import { dismissAnnouncement, isAnnouncementDismissed } from '../lib/announcementDismissal'
import type { AnnouncementItem } from '../types/entities'
import { Button, IconButton } from '@/src/components/ui'

export const AnnouncementBar = () => {
  const [isVisible, setIsVisible] = useState(true)
  const [announcement, setAnnouncement] = useState<AnnouncementItem | null>(null)
  const announcementRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let cancelled = false

    const fetchAnnouncement = async () => {
      try {
        const data = await apiGet<{ announcement: AnnouncementItem | null }>(
          '/api/announcements/latest'
        )
        if (!cancelled) {
          const latest = data.announcement
          setAnnouncement(
            latest && !isAnnouncementDismissed(latest.id, latest.updatedAt) ? latest : null
          )
        }
      } catch (error) {
        console.error('Fetch latest announcement failed:', error)
      }
    }

    fetchAnnouncement()
    const intervalId = window.setInterval(fetchAnnouncement, 300000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const handleDismiss = () => {
    if (announcement) {
      dismissAnnouncement(announcement.id, announcement.updatedAt)
    }
    setIsVisible(false)
  }

  useLayoutEffect(() => {
    const root = document.documentElement
    const element = announcementRef.current

    if (!element || !announcement || !isVisible) {
      root.style.removeProperty('--announcement-bar-offset')
      return
    }

    const updateOffset = () => {
      const visibleHeight = element.getBoundingClientRect().height
      const offset = Math.max(visibleHeight - window.scrollY, 0)
      root.style.setProperty('--announcement-bar-offset', `${offset}px`)
    }

    updateOffset()
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateOffset) : null
    resizeObserver?.observe(element)
    window.addEventListener('scroll', updateOffset, { passive: true })
    window.addEventListener('resize', updateOffset)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', updateOffset)
      window.removeEventListener('resize', updateOffset)
      root.style.removeProperty('--announcement-bar-offset')
    }
  }, [announcement?.id, isVisible])

  return (
    <AnimatePresence>
      {isVisible && announcement && (
        <motion.div
          ref={announcementRef}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="py-2 px-4 relative overflow-hidden bg-[var(--color-theme-accent)] text-white"
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
              onClick={handleDismiss}
              className="h-auto min-h-0 px-2 py-1 text-xs text-white hover:bg-black/10 hover:text-white"
              aria-label="不再显示此公告"
            >
              不再显示
            </Button>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsVisible(false)}
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
