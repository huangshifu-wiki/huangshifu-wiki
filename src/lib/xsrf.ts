export function getXsrfToken(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined
  }

  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : undefined
}
