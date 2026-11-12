import { Suspense, useEffect, useRef, useState } from 'react'
import { apiGet } from '../lib/apiClient'
import { dismissAnnouncement, isAnnouncementDismissed } from '../lib/announcementDismissal'
import type { AnnouncementItem } from '../types/entities'
import { ErrorBoundary } from './ErrorBoundary'
import { useRouteActive } from '../lib/routeActivity'

import { routeLoaders } from '../lib/routePrefetch'

const AnnouncementBanner = routeLoaders.AnnouncementBanner.Component

export const AnnouncementBar = () => {
  const active = useRouteActive()
  const refreshRef = useRef<() => void>(() => {})
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

    refreshRef.current = fetchAnnouncement
    void fetchAnnouncement()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => refreshRef.current(), 300000)
    return () => window.clearInterval(timer)
  }, [active])

  const handleDismiss = () => {
    if (announcement) {
      dismissAnnouncement(announcement.id, announcement.updatedAt)
    }
    setIsVisible(false)
  }

  if (!announcement) return null

  return (
    <ErrorBoundary fallback={<></>}>
      <Suspense fallback={null}>
        <AnnouncementBanner
          announcement={announcement}
          visible={isVisible}
          onDismiss={handleDismiss}
          onClose={() => setIsVisible(false)}
        />
      </Suspense>
    </ErrorBoundary>
  )
}
