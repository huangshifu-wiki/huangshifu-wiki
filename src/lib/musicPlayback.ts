export type PlayableSongLike = {
  audioUrl?: string | null
  sources?: unknown[] | null
  externalSources?: unknown[] | null
  playable?: boolean | null
}

export function isPlayableSong(song: PlayableSongLike) {
  return (
    song.playable !== false &&
    Boolean(song.audioUrl || song.sources?.length || song.externalSources?.length)
  )
}
