'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { clsx } from 'clsx'
import { apiGet } from '../lib/apiClient'

interface WikiLinkPreviewProps {
  slug: string
  children: React.ReactNode
}

interface WikiPageSummary {
  title: string
  content: string
  category: string
  updatedAt: string
}

interface WikiPageResponse {
  page: WikiPageSummary
  backlinks?: Array<{ slug: string; title: string }>
  relations?: Record<string, unknown>
  relationGraph?: Record<string, unknown>
}

export default function WikiLinkPreview({ slug, children }: WikiLinkPreviewProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [preview, setPreview] = useState<WikiPageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom')

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchPreview = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setLoading(true)
    try {
      const data = await apiGet<WikiPageResponse>(`/api/wiki/${slug}`)
      setPreview({
        title: data.page.title,
        content: data.page.content || '',
        category: data.page.category,
        updatedAt: data.page.updatedAt,
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setPreview(null)
      }
    } finally {
      setLoading(false)
    }
  }, [slug])

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true)
      fetchPreview()
    }, 300)
  }, [fetchPreview])

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsVisible(false)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isVisible || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setPosition(spaceBelow < 200 ? 'top' : 'bottom')
  }, [isVisible])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  const getExcerpt = (content: string, maxLength = 150) => {
    const cleaned = (content || '').replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, p1, p2) => p2 || p1
    )
    if (cleaned.length <= maxLength) return cleaned
    return cleaned.slice(0, maxLength).trim() + '…'
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <div
          className={clsx(
            'absolute z-50 left-0 w-72 p-4 rounded border border-[var(--book-ink-line)] text-sm text-text-secondary',
            'bg-[var(--book-panel-bg-strong)] shadow-[0_14px_36px_rgba(72,53,25,0.08)] backdrop-blur-[12px]',
            position === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
          )}
        >
          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-brand-gold border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && preview && (
            <>
              <h4 className="text-wrap-anywhere font-semibold text-text-primary mb-2 line-clamp-2 tracking-[0.02em]">
                {preview.title}
              </h4>
              <p className="text-text-secondary text-xs leading-relaxed line-clamp-3">
                {getExcerpt(preview.content)}
              </p>
              <div className="mt-2 pt-2 border-t border-[var(--book-ink-line)] flex items-center gap-2 text-xs text-text-muted">
                <span className="px-1.5 py-0.5 rounded theme-tag">{preview.category}</span>
              </div>
            </>
          )}
          {!loading && !preview && (
            <p className="text-text-muted text-center py-2 italic">无法加载预览</p>
          )}
        </div>
      )}
    </div>
  )
}
