import React from 'react'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Music from '../../src/pages/Music'
import { clearApiCache } from '../../src/lib/apiClient'
import { resetAuthStateForTests } from '../../src/lib/auth'
import { writeStoredPreferences } from '../../src/lib/theme'
import {
  createTagFilterApi,
  filterRows,
  filterResponse,
  renderTagFilterPage,
} from '../setup/tagFilterPage'
import type { LocalApi } from '../setup/localApi'

let api: LocalApi
beforeEach(async () => {
  clearApiCache()
  resetAuthStateForTests()
  localStorage.clear()
  api = await createTagFilterApi()
  vi.stubGlobal('fetch', api.fetch)
})
afterEach(async () => {
  cleanup()
  await api.close()
  vi.unstubAllGlobals()
  clearApiCache()
  resetAuthStateForTests()
})

const resources = [
  { resource: 'music', label: '歌曲', param: 'tag', mode: 'tagMode', page: 'musicPage' },
  { resource: 'albums', label: '专辑', param: 'albumTag', mode: 'albumTagMode', page: 'albumPage' },
] as const
const panel = () => within(screen.getByRole('complementary'))
const location = () =>
  new URL(screen.getByTestId('location').textContent!, 'http://localhost').searchParams

describe('音乐多标签筛选', () => {
  it.each(
    resources.flatMap((item) =>
      (['pagination', 'incremental'] as const).map((loadMode) => ({ ...item, loadMode }))
    )
  )(
    '$resource $loadMode 支持并交集、清空和独立标签状态',
    async ({ resource, label, param, mode, loadMode }) => {
      writeStoredPreferences({ listLoadMode: loadMode })
      const otherParam = resource === 'music' ? 'albumTag' : 'tag'
      renderTagFilterPage(
        <Music />,
        `/music?${resource === 'albums' ? 'tab=albums&' : ''}${otherParam}=现场`
      )
      await waitFor(() => expect(screen.getByTestId('preferences')).toHaveTextContent(loadMode))
      await screen.findByText(`${label}D`)
      const user = userEvent.setup()
      await user.click(await panel().findByRole('button', { name: '古风' }))
      await waitFor(() => expect(screen.queryByText(`${label}B`)).not.toBeInTheDocument())
      expect(await screen.findByText(`${label}A`)).toBeInTheDocument()
      expect(await screen.findByText(`${label}C`)).toBeInTheDocument()
      await user.click(panel().getByRole('button', { name: '现场' }))
      expect(await screen.findByText(`${label}B`)).toBeInTheDocument()
      expect(location().getAll(param)).toEqual(['古风', '现场'])
      expect(location().get(otherParam)).toBe('现场')
      expect(location().has(mode)).toBe(false)
      await user.click(panel().getByRole('button', { name: '交集' }))
      await waitFor(() => expect(screen.queryByText(`${label}A`)).not.toBeInTheDocument())
      expect(screen.queryByText(`${label}B`)).not.toBeInTheDocument()
      expect(screen.getByText(`${label}C`)).toBeInTheDocument()
      expect(location().get(mode)).toBe('all')
      await user.click(panel().getByRole('button', { name: '现场' }))
      expect(await screen.findByText(`${label}A`)).toBeInTheDocument()
      await user.click(panel().getByRole('button', { name: '清空标签' }))
      expect(await screen.findByText(`${label}D`)).toBeInTheDocument()
      expect(location().has(param)).toBe(false)
      expect(location().has(mode)).toBe(false)
      const otherTab = resource === 'music' ? '专辑' : '音乐'
      await user.click(screen.getByRole('button', { name: otherTab }))
      expect(await panel().findByRole('button', { name: '现场' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
  )

  it.each(resources)(
    '$resource 后退等待原范围总数，不丢失第二页',
    async ({ resource, label, param, page }) => {
      let release: (() => void) | undefined
      let returning = false
      api.handlers.set(`/api/${resource}`, (req, res) => {
        const query = new URL(req.url!, 'http://localhost').searchParams
        if (query.has('tag')) {
          res.end(JSON.stringify(filterResponse(resource, req.url!)))
          return
        }
        const send = () =>
          res.end(
            JSON.stringify({
              [resource === 'music' ? 'songs' : 'albums']: [filterRows(resource)[3]],
              total: 100,
            })
          )
        if (returning) release = send
        else send()
      })
      renderTagFilterPage(
        <Music />,
        `/music?${resource === 'albums' ? 'tab=albums&' : ''}${page}=2`
      )
      expect(await screen.findByText(`${label}D`)).toBeInTheDocument()
      const user = userEvent.setup()
      await user.click(await panel().findByRole('button', { name: '古风' }))
      expect(await screen.findByText(`${label}A`)).toBeInTheDocument()
      expect(location().has(page)).toBe(false)
      returning = true
      clearApiCache()
      await user.click(screen.getByRole('button', { name: '后退' }))
      await waitFor(() => expect(release).toBeDefined())
      expect(location().get(page)).toBe('2')
      expect(location().has(param)).toBe(false)
      await act(async () => {
        release!()
      })
      expect(await screen.findByText(`${label}D`)).toBeInTheDocument()
      expect(location().get(page)).toBe('2')
    }
  )

  it.each([200, 500])('候选接口返回 %s 时仍可清除未知专辑标签', async (status) => {
    api.json('/api/albums/tags', { tags: [] }, status)
    renderTagFilterPage(<Music />, '/music?tab=albums&albumTag=旧标签&albumTagMode=all')
    const selected = await within(await screen.findByRole('complementary')).findByRole('button', {
      name: '旧标签',
    })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(panel().getByRole('button', { name: '清空标签' }))
    expect(await screen.findByText('专辑D')).toBeInTheDocument()
    expect(location().has('albumTag')).toBe(false)
    expect(location().has('albumTagMode')).toBe(false)
  })

  it.each(['pending', 'error'] as const)(
    '专辑 %s 状态不会显示成功空态，完成或重试后展示内容',
    async (state) => {
      let release: (() => void) | undefined
      api.handlers.set('/api/albums', (_req, res) => {
        if (state === 'error') {
          res.statusCode = 500
          res.end(JSON.stringify({ error: '专辑暂不可用' }))
        } else {
          release = () => res.end(JSON.stringify({ albums: filterRows('albums'), total: 4 }))
        }
      })
      renderTagFilterPage(<Music />, '/music?tab=albums')
      if (state === 'pending') {
        expect(await screen.findByRole('status', { name: '加载中' })).toBeInTheDocument()
        await waitFor(() => expect(release).toBeDefined())
        expect(screen.queryByText('暂无专辑，快去创建吧')).not.toBeInTheDocument()
        await act(async () => {
          release!()
        })
      } else {
        await screen.findByRole('alert')
        api.json('/api/albums', { albums: filterRows('albums'), total: 4 })
        await userEvent.click(screen.getByRole('button', { name: '重新加载' }))
      }
      expect(await screen.findByText('专辑D')).toBeInTheDocument()
    }
  )
})
