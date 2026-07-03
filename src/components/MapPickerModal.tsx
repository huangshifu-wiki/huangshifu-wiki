import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, MapPin, Search, Loader2 } from '@/src/components/icons'
import { apiGet } from '../lib/apiClient'
import { useFloatingPresence } from '../hooks/useFloatingPresence'

declare global {
  interface Window {
    AMap: any
    _AMapSecurityConfig: {
      securityJsCode?: string
      serviceHost?: string
    }
  }
}

interface PickedLocation {
  lng: number
  lat: number
  address: string
  province: string
  city: string
  district: string
  adcode: string
}

interface MapPickerModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (location: PickedLocation) => void
  initialLocation?: { lng: number; lat: number } | null
}

const AMAP_JS_API_KEY = import.meta.env.VITE_AMAP_JS_API_KEY as string | undefined
const AMAP_SECURITY_JS_CODE = import.meta.env.VITE_AMAP_SECURITY_JS_CODE as string | undefined

let amapLoaded = false
let amapLoadPromise: Promise<void> | null = null
let amapCallbackSeq = 0

function isAmapReady(): boolean {
  return Boolean(window.AMap?.Map)
}

function waitForAmapReady(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const check = () => {
      if (isAmapReady()) {
        amapLoaded = true
        resolve()
        return
      }

      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error('AMap JS API loaded but AMap is unavailable'))
        return
      }

      window.setTimeout(check, 50)
    }

    check()
  })
}

async function loadAmap(): Promise<void> {
  if (amapLoaded && isAmapReady()) return
  if (isAmapReady()) {
    amapLoaded = true
    return
  }
  if (amapLoadPromise) return amapLoadPromise
  amapLoadPromise = new Promise((resolve, reject) => {
    if (!AMAP_JS_API_KEY) {
      reject(new Error('AMAP_JS_API_KEY is not configured'))
      return
    }
    if (!AMAP_SECURITY_JS_CODE) {
      reject(new Error('VITE_AMAP_SECURITY_JS_CODE is not configured'))
      return
    }

    const callbackName = `__onAmapJsApiLoaded_${Date.now()}_${++amapCallbackSeq}`
    const callbackRegistry = window as unknown as Record<string, unknown>
    const cleanupCallback = () => {
      delete callbackRegistry[callbackName]
    }
    const timeoutId = window.setTimeout(() => {
      cleanupCallback()
      amapLoadPromise = null
      reject(
        new Error(
          '高德地图脚本加载超时。请检查 VITE_AMAP_JS_API_KEY、VITE_AMAP_SECURITY_JS_CODE、域名白名单，以及是否允许加载 https://webapi.amap.com'
        )
      )
    }, 10000)

    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_JS_CODE }

    callbackRegistry[callbackName] = () => {
      window.clearTimeout(timeoutId)
      waitForAmapReady()
        .then(() => {
          cleanupCallback()
          resolve()
        })
        .catch((err) => {
          cleanupCallback()
          amapLoadPromise = null
          reject(err)
        })
    }

    const script = document.createElement('script')
    const url = new URL('https://webapi.amap.com/maps')
    url.searchParams.set('v', '2.0')
    url.searchParams.set('key', AMAP_JS_API_KEY)
    url.searchParams.set('callback', callbackName)
    script.src = url.toString()
    script.async = true
    script.onerror = () => {
      window.clearTimeout(timeoutId)
      cleanupCallback()
      amapLoadPromise = null
      reject(new Error('Failed to load AMap JS API'))
    }
    document.head.appendChild(script)
  })
  return amapLoadPromise
}

export const MapPickerModal = ({
  open,
  onClose,
  onConfirm,
  initialLocation,
}: MapPickerModalProps) => {
  const presence = useFloatingPresence(open)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [selectedLocation, setSelectedLocation] = useState<PickedLocation | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const initMap = useCallback(async () => {
    if (!containerRef.current || !open) return
    try {
      setLoading(true)
      setError(null)
      await loadAmap()
      const defaultCenter = initialLocation || { lng: 116.397428, lat: 39.90923 }
      const map = new window.AMap.Map(containerRef.current, {
        zoom: 13,
        center: [defaultCenter.lng, defaultCenter.lat],
        viewMode: '2D',
      })
      mapRef.current = map
      map.on('click', async (e: any) => {
        const { lng, lat } = e.lnglat
        await handleLocationSelect(lng, lat)
      })
      if (initialLocation) {
        await handleLocationSelect(initialLocation.lng, initialLocation.lat)
      }
      setMapReady(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '地图加载失败')
    } finally {
      setLoading(false)
    }
  }, [open, initialLocation])

  useEffect(() => {
    if (open) {
      initMap()
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
      }
      setMapReady(false)
    }
  }, [open, initMap])

  const handleLocationSelect = async (lng: number, lat: number) => {
    if (!mapRef.current) return
    if (markerRef.current) {
      markerRef.current.setMap(null)
    }
    const marker = new window.AMap.Marker({ position: [lng, lat] })
    markerRef.current = marker
    mapRef.current.add(marker)
    try {
      const data = await apiGet<{
        result?: {
          formattedAddress: string
          province: string
          city: string
          district: string
          adcode: string
        }
      }>(`/api/regions/resolve?lng=${lng}&lat=${lat}`)
      if (data.result) {
        setSelectedLocation({
          lng,
          lat,
          address: data.result.formattedAddress,
          province: data.result.province,
          city: data.result.city,
          district: data.result.district,
          adcode: data.result.adcode,
        })
      }
    } catch (err) {
      console.error('Failed to resolve location:', err)
      setSelectedLocation({
        lng,
        lat,
        address: `${lng.toFixed(6)}, ${lat.toFixed(6)}`,
        province: '',
        city: '',
        district: '',
        adcode: '',
      })
    }
  }

  const handleSearch = async () => {
    const query = searchInputRef.current?.value
    if (!query || !mapRef.current) return
    setSearching(true)
    try {
      const data = await apiGet<{ results?: any[] }>(
        `/api/regions/search/address?q=${encodeURIComponent(query)}`
      )
      setSearchResults(data.results || [])
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleResultSelect = async (result: any) => {
    const { coordinate } = result
    if (!coordinate || !mapRef.current) return
    mapRef.current.setCenter([coordinate.lng, coordinate.lat])
    mapRef.current.setZoom(15)
    await handleLocationSelect(coordinate.lng, coordinate.lat)
    setSearchResults([])
  }

  const handleConfirm = () => {
    if (selectedLocation) {
      onConfirm(selectedLocation)
      onClose()
    }
  }

  if (!presence.mounted) return null

  return (
    <div
      className="floating-overlay fixed inset-0 z-[100] flex items-center justify-center"
      data-state={presence.state}
      aria-hidden={!open}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="floating-panel relative bg-surface rounded border border-border w-[90vw] h-[80vh] max-w-4xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-bold text-text-primary">选择地点</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="搜索地址..."
              className="theme-input w-full pl-9 pr-4 py-2 text-sm rounded"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key !== 'Enter') return
                e.preventDefault()
                handleSearch()
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 rounded theme-button-primary text-sm font-medium transition-all disabled:opacity-50"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : '搜索'}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="absolute top-[7.5rem] left-4 right-4 bg-surface rounded border border-border z-10 max-h-60 overflow-y-auto">
            {searchResults.map((result, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleResultSelect(result)}
                className="w-full px-4 py-3 text-left border-b border-border last:border-b-0 hover:bg-surface-alt transition-colors"
              >
                <div className="text-sm font-medium text-text-primary">{result.name}</div>
                <div className="text-xs text-text-muted">{result.address}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-alt">
              <div className="text-center">
                <Loader2 size={28} className="animate-spin text-brand-gold mx-auto" />
                <p className="mt-2 text-sm text-text-muted">地图加载中...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-alt">
              <div className="text-center">
                <MapPin size={28} className="text-text-muted mx-auto" />
                <p className="mt-2 text-sm theme-text-error">{error}</p>
                {!AMAP_JS_API_KEY && (
                  <p className="mt-1 text-xs text-text-muted">
                    请在 .env.local 中配置 VITE_AMAP_JS_API_KEY
                  </p>
                )}
              </div>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </div>

        {selectedLocation && (
          <div className="px-4 py-3 border-t border-border bg-surface-alt">
            <div className="flex items-start gap-2">
              <MapPin size={18} className="text-brand-gold mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {selectedLocation.province}
                  {selectedLocation.city}
                  {selectedLocation.district}
                </div>
                <div className="text-xs text-text-muted">{selectedLocation.address}</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border pb-safe">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded theme-button-secondary transition-all text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedLocation}
            className="px-4 py-2 rounded theme-button-primary font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            确认选择
          </button>
        </div>
      </div>
    </div>
  )
}

export type { PickedLocation }
