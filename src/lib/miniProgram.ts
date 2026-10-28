export interface MiniProgramLoginPayload {
  code: string
  displayName?: string
  photoURL?: string
}

const CODE_PARAM = 'wx_code'
const DISPLAY_NAME_PARAM = 'wx_display_name'
const PHOTO_URL_PARAM = 'wx_photo_url'

function getTrimmedSearchParam(params: URLSearchParams, key: string) {
  const value = params.get(key)
  return value ? value.trim() : ''
}

export function getMiniProgramLoginPayload(): MiniProgramLoginPayload | null {
  if (typeof window === 'undefined') {
    return null
  }

  const params = new URLSearchParams(window.location.search)
  const code = getTrimmedSearchParam(params, CODE_PARAM)

  if (!code) {
    return null
  }

  const displayName = getTrimmedSearchParam(params, DISPLAY_NAME_PARAM)
  const photoURL = getTrimmedSearchParam(params, PHOTO_URL_PARAM)

  return {
    code,
    displayName: displayName || undefined,
    photoURL: photoURL || undefined,
  }
}

export function clearMiniProgramLoginParams() {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  const before = url.toString()
  url.searchParams.delete(CODE_PARAM)
  url.searchParams.delete(DISPLAY_NAME_PARAM)
  url.searchParams.delete(PHOTO_URL_PARAM)
  const next = url.toString()

  if (before !== next) {
    window.history.replaceState({}, '', next)
  }
}

export function isMiniProgramWebView() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const wxEnv = (window as Window & { __wxjs_environment?: string }).__wxjs_environment
  if (wxEnv === 'miniprogram') {
    return true
  }

  return /miniProgram/i.test(navigator.userAgent)
}
