import './tests-setup'
import React from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { render } from '@testing-library/react'
import { AuthProvider } from '../../src/context/AuthContext'
import {
  UserPreferencesProvider,
  useUserPreferences,
} from '../../src/context/UserPreferencesContext'
import { MusicProvider } from '../../src/context/MusicContext'
import { ToastProvider } from '../../src/components/Toast'
import { createLocalApi } from './localApi'

export type FilterResource = 'music' | 'albums' | 'events'

export function filterRows(resource: FilterResource) {
  const label = { music: '歌曲', albums: '专辑', events: '游记' }[resource]
  return [['古风'], ['现场'], ['古风', '现场'], []].map((tags, index) => ({
    id: `${resource}-${index}`,
    docId: `${resource}-${index}`,
    slug: `${100 + index}`,
    title: `${label}${String.fromCharCode(65 + index)}`,
    artists: ['歌手'],
    artist: '歌手',
    album: '',
    cover: '',
    audioUrl: '',
    tags,
    location: '',
    content: '',
    timeSlots: [],
    timeStatus: 'pending',
    ticketPrices: [],
    posters: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }))
}

export function filterResponse(resource: FilterResource, url: string) {
  const query = new URL(url, 'http://localhost').searchParams
  const tags = query.getAll('tag')
  const rows = filterRows(resource).filter(
    (item) =>
      !tags.length ||
      (query.get('tagMode') === 'all'
        ? tags.every((tag) => item.tags.includes(tag))
        : tags.some((tag) => item.tags.includes(tag)))
  )
  const page = Number(query.get('page') || 1)
  const limit = Number(query.get('limit') || 50)
  const key = { music: 'songs', albums: 'albums', events: 'events' }[resource]
  return {
    [key]: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / limit)),
    page,
    limit,
    hasMore: page * limit < rows.length,
  }
}

export async function createTagFilterApi() {
  const api = await createLocalApi()
  api.json('/api/auth/me', { user: null })
  for (const resource of ['music', 'albums', 'events'] as const) {
    api.json(`/api/${resource}/tags`, { tags: ['古风', '现场'] })
    api.handlers.set(`/api/${resource}`, (req, res) => {
      res.end(JSON.stringify(filterResponse(resource, req.url!)))
    })
  }
  return api
}

function Navigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { preferences, loading } = useUserPreferences()
  return (
    <>
      <button onClick={() => navigate(-1)}>后退</button>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <output data-testid="preferences">{loading ? 'loading' : preferences.listLoadMode}</output>
    </>
  )
}

export function renderTagFilterPage(page: React.ReactNode, entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <UserPreferencesProvider>
          <MusicProvider>
            <ToastProvider>
              {page}
              <Navigation />
            </ToastProvider>
          </MusicProvider>
        </UserPreferencesProvider>
      </AuthProvider>
    </MemoryRouter>
  )
}
