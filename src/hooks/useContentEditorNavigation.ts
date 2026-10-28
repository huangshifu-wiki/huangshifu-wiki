import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getContentBackgroundLocation, getContentEditorRoute } from '../lib/contentEditorRoutes'
import type { Location } from 'react-router-dom'
import { invalidateApiCacheByPrefix } from '../lib/apiClient'

export const useContentEditorNavigation = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const editorRoute = getContentEditorRoute(location.pathname)
  const backgroundLocation = getContentBackgroundLocation(location)
  const state = location.state as { editorBackground?: Location } | null
  const hasEditorBackground = Boolean(editorRoute && state?.editorBackground === backgroundLocation)

  const closeEditor = useCallback(() => {
    if (!editorRoute) return
    if (hasEditorBackground) {
      navigate(-1)
      return
    }
    navigate(editorRoute.fallbackPath, { replace: true })
  }, [editorRoute, hasEditorBackground, navigate])

  const navigateAfterSave = useCallback(
    (to: string) => {
      const targetRoute = getContentEditorRoute(to.split(/[?#]/, 1)[0])
      if (targetRoute) {
        navigate(to, {
          replace: true,
          state: hasEditorBackground ? { editorBackground: backgroundLocation } : null,
        })
        return
      }
      if (
        hasEditorBackground &&
        /^\/admin\/(?:wiki|posts|galleries|ticket-listings|events)\/?$/.test(
          backgroundLocation.pathname
        )
      ) {
        invalidateApiCacheByPrefix(`/api${backgroundLocation.pathname.replace(/\/$/, '')}`)
        const backgroundState = backgroundLocation.state
        const savedState = {
          ...(backgroundState !== null &&
          typeof backgroundState === 'object' &&
          !Array.isArray(backgroundState)
            ? backgroundState
            : {}),
          editorSaved: true,
        }
        delete savedState.editorBackground
        navigate(backgroundLocation, { replace: true, state: savedState })
        return
      }
      navigate(to, { replace: true, state: { editorSaved: true } })
    },
    [backgroundLocation, hasEditorBackground, navigate]
  )

  return { closeEditor, navigateAfterSave }
}
