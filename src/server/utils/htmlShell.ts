const HTML_BOOTSTRAP_AUTH_UID_PLACEHOLDER = '"__HSF_BOOTSTRAP_AUTH_UID_VALUE__"'
export const SPA_FALLBACK_PATH = '/{*splat}'

export function injectHtmlBootstrapState(
  html: string,
  options: { authUid: string | null; nonce?: string | null }
): string {
  let nextHtml = html.replaceAll(
    HTML_BOOTSTRAP_AUTH_UID_PLACEHOLDER,
    JSON.stringify(options.authUid)
  )

  if (options.nonce) {
    nextHtml = nextHtml.replace(/<script/g, `<script nonce="${options.nonce}"`)
  }

  return nextHtml
}

export function shouldBypassProductionStaticHtml(reqPath: string): boolean {
  return reqPath === '/index.html'
}
