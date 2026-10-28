import { lazy, Suspense, useEffect, useState } from 'react'
import { apiGet } from '../lib/apiClient'
import { dismissAnnouncement, isAnnouncementDismissed } from '../lib/announcementDismissal'
import type { AnnouncementItem } from '../types/entities'

const AnnouncementBanner = lazy(() => import('./AnnouncementBanner'))

export const AnnouncementBar = () => {
  const [isVisible, setIsVisible] = useState(true)
  const [announcement, setAnnouncement] = useState<AnnouncementItem | null>(null)
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

  if (!announcement) return null

  return (
    <Suspense fallback={null}>
      <AnnouncementBanner
        announcement={announcement}
        visible={isVisible}
        onDismiss={handleDismiss}
        onClose={() => setIsVisible(false)}
      />
    </Suspense>
  )
}
