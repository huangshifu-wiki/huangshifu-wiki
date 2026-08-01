import type { MusicPlayableOverride } from '../types/entities'

export type PlayableSongLike = {
  audioUrl?: string | null
  sources?: unknown[] | null
  externalSources?: unknown[] | null
  playable?: boolean | null
  playableOverride?: MusicPlayableOverride | null
}

export function isPlayableSong(song: PlayableSongLike) {
  const hasSource = Boolean(song.audioUrl || song.sources?.length || song.externalSources?.length)
  if (song.playableOverride === 'disabled') return false
  if (song.playableOverride === 'enabled') return hasSource
  return song.playable !== false && hasSource
}
