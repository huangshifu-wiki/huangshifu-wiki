import React from 'react'

import type { MusicExternalSource } from '../types/entities'
import {
  SongFormModal,
  buildSourcesPatchFromPlatformSourceIds,
  type PlatformSourceIds,
} from './SongFormModal'

type CustomPlatformLink = {
  label: string
  url: string
}

type SongItem = {
  docId: string
  title: string
  artists: string[]
  lyricists?: string[]
  composers?: string[]
  arrangers?: string[]
  vocals?: string[]
  album: string
  cover: string
  audioUrl: string
  lyric?: string | null
  description?: string | null
  releaseDate?: string | null
  durationMs?: number | null
  favoritedByMe?: boolean
  sources?: MusicExternalSource[]
  customPlatformLinks?: CustomPlatformLink[]
}

interface SongEditModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  song: SongItem
}

export { buildSourcesPatchFromPlatformSourceIds, type PlatformSourceIds }

export const SongEditModal = ({ open, onClose, onSuccess, song }: SongEditModalProps) => (
  <SongFormModal open={open} onClose={onClose} onSuccess={onSuccess} mode="edit" song={song} />
)
