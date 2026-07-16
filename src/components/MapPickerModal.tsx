import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, MapPin, Search, Loader2 } from '@/src/components/icons'
import { apiGet } from '../lib/apiClient'
import { loadAmapJsApi } from '../lib/amapLoader'
import { useFloatingPresence } from '../hooks/useFloatingPresence'

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

interface AddressSearchResult {
  name: string
  address: string
  coordinate: { lng: number; lat: number }
  adcode: string
}

export const MapPickerModal = ({
  open,
  onClose,
  onConfirm,
  initialLocation,
}: MapPickerModalProps) => {
  const presence = useFloatingPresence(open)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMap.Map | null>(null)
  const markerRef = useRef<AMap.Marker | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<AddressSearchResult[]>([])
  const [selectedLocation, setSelectedLocation] = useState<PickedLocation | null>(null)

  const initMap = useCallback(async () => {
    if (!containerRef.current || !open) return
    try {
      setLoading(true)
      setError(null)
      const amap = await loadAmapJsApi()
      const defaultCenter = initialLocation || { lng: 116.397428, lat: 39.90923 }
      const map = new amap.Map(containerRef.current, {
        zoom: 13,
        center: [defaultCenter.lng, defaultCenter.lat],
        viewMode: '2D',
      })
      mapRef.current = map
      map.on('click', async (event: { lnglat: AMap.LngLat }) => {
        const [lng, lat] = event.lnglat.toArray()
        await handleLocationSelect(lng, lat)
      })
      if (initialLocation) {
        await handleLocationSelect(initialLocation.lng, initialLocation.lat)
      }
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
      markerRef.current = null
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
        result: {
          formattedAddress: string
          province: string
          city: string
          district: string
          adcode: string
        }
      }>('/api/regions/resolve', { lng, lat })
      setSelectedLocation({
        lng,
        lat,
        address: data.result.formattedAddress,
        province: data.result.province,
        city: data.result.city,
        district: data.result.district,
        adcode: data.result.adcode,
      })
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
    const query = searchInputRef.current?.value.trim()
    if (!query || !mapRef.current) return
    setSearching(true)
    try {
      const data = await apiGet<{ results: AddressSearchResult[] }>('/api/regions/search/address', {
        q: query.trim(),
      })
      setSearchResults(data.results)
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleResultSelect = async (result: AddressSearchResult) => {
    const { coordinate } = result
    if (!mapRef.current) return
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

  if (typeof document === 'undefined' || !presence.mounted) return null

  return createPortal(
    <div
      className="floating-overlay fixed inset-0 z-[1200] flex items-center justify-center"
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
    </div>,
    document.body
  )
}

export type { PickedLocation }
