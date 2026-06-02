export function processWikiLinksForPreview(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, p1, p2) => {
    const display = p1.trim()
    const slug = p2 ? p2.trim() : p1.trim()
    return `[${display}](/wiki/${slug})`
  })
}
