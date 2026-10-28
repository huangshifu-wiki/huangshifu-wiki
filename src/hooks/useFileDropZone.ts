import { useEffect, useState } from 'react'
import type { DragEvent, DragEventHandler } from 'react'

const FILE_DROP_ZONE_ATTR = 'data-file-drop-zone'

const resolveZone = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) return null
  const zone = target.closest(`[${FILE_DROP_ZONE_ATTR}]`)
  return zone?.getAttribute(FILE_DROP_ZONE_ATTR) ?? null
}

type DropZoneState = { depth: number; zone: string | null }

const IDLE: DropZoneState = { depth: 0, zone: null }

export type UseFileDropZoneOptions = {
  /** 松手时回调，zone 取自命中的 [data-file-drop-zone] 祖先，未命中为 null */
  onFiles: (files: File[], zone: string | null) => void
  enabled?: boolean
}

/** 整页文件拖拽投放；配套的提示层必须 pointer-events-none，否则会抢走 event.target 让投放区判定失效 */
export const useFileDropZone = ({ onFiles, enabled = true }: UseFileDropZoneOptions) => {
  const [dragState, setDragState] = useState(IDLE)

  useEffect(() => {
    if (!enabled) setDragState(IDLE)
  }, [enabled])

  // 页面内部的排序拖拽只带 text/plain，用 types 把它和文件拖拽区分开
  const isFileDrag = (event: DragEvent<HTMLDivElement>) =>
    enabled && event.dataTransfer.types.includes('Files')

  const onDragEnter: DragEventHandler<HTMLDivElement> = (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    setDragState((prev) => ({ depth: prev.depth + 1, zone: resolveZone(event.target) }))
  }

  const onDragOver: DragEventHandler<HTMLDivElement> = (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const zone = resolveZone(event.target)
    setDragState((prev) => (prev.zone === zone ? prev : { ...prev, zone }))
  }

  const onDragLeave: DragEventHandler<HTMLDivElement> = (event) => {
    if (!isFileDrag(event)) return
    setDragState((prev) => {
      const depth = Math.max(0, prev.depth - 1)
      return depth === 0 ? IDLE : { depth, zone: prev.zone }
    })
  }

  const onDrop: DragEventHandler<HTMLDivElement> = (event) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    setDragState(IDLE)
    const files = Array.from(event.dataTransfer.files)
    if (files.length) onFiles(files, resolveZone(event.target))
  }

  return {
    isDraggingFiles: dragState.depth > 0,
    activeZone: dragState.zone,
    rootHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
