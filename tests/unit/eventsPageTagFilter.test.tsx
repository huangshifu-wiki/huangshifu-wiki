import React from 'react'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Events from '../../src/pages/Events'
import { clearApiCache } from '../../src/lib/apiClient'
import { resetAuthStateForTests } from '../../src/lib/auth'
import {
  createTagFilterApi,
  filterResponse,
  filterRows,
  renderTagFilterPage,
} from '../setup/tagFilterPage'
import type { LocalApi } from '../setup/localApi'
import { deferred } from '../setup/deferred'

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

it('游记手机筛选多标签即时生效，交集、清空与后退恢复同一范围', async () => {
  renderTagFilterPage(<Events />, '/events')
  expect(await screen.findByText('游记D')).toBeInTheDocument()
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: /^筛选/ })
  await user.click(trigger)
  const controls = within(document.getElementById(trigger.getAttribute('aria-controls')!)!)
  await user.click(controls.getByRole('button', { name: '古风' }))
  expect(await screen.findByText('游记A')).toBeInTheDocument()
  await user.click(controls.getByRole('button', { name: '现场' }))
  expect(await screen.findByText('游记B')).toBeInTheDocument()
  expect(screen.getByText('游记C')).toBeInTheDocument()
  expect(screen.queryByText('游记D')).not.toBeInTheDocument()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await user.click(controls.getByRole('button', { name: '交集' }))
  await waitFor(() => expect(screen.queryByText('游记A')).not.toBeInTheDocument())
  expect(screen.queryByText('游记B')).not.toBeInTheDocument()
  expect(screen.getByText('游记C')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('tagMode=all')
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '后退' }))
  expect(await screen.findByText('游记A')).toBeInTheDocument()
  expect(await screen.findByText('游记B')).toBeInTheDocument()
  await user.click(trigger)
  await user.click(
    within(document.getElementById(trigger.getAttribute('aria-controls')!)!).getByRole('button', {
      name: '清空标签',
    })
  )
  expect(await screen.findByText('游记D')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('/events')
  expect(screen.getByTestId('location')).not.toHaveTextContent('tag=')
})

it('游记后退等待当前范围总数，不丢失深链接页码', async () => {
  let release: (() => void) | undefined
  let returning = false
  api.handlers.set('/api/events', (req, res) => {
    const query = new URL(req.url!, 'http://localhost').searchParams
    if (query.has('tag')) {
      res.end(JSON.stringify(filterResponse('events', req.url!)))
    } else {
      const send = () =>
        res.end(JSON.stringify({ events: [filterRows('events')[3]], totalPages: 2 }))
      if (returning) release = send
      else send()
    }
  })
  renderTagFilterPage(<Events />, '/events?page=2')
  expect(await screen.findByText('游记D')).toBeInTheDocument()
  await userEvent.click(
    await within(screen.getByRole('complementary')).findByRole('button', { name: '古风' })
  )
  expect(await screen.findByText('游记A')).toBeInTheDocument()
  expect(screen.getByTestId('location')).not.toHaveTextContent('page=2')
  returning = true
  clearApiCache()
  await userEvent.click(screen.getByRole('button', { name: '后退' }))
  await waitFor(() => expect(release).toBeDefined())
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
  await act(async () => {
    release!()
  })
  expect(await screen.findByText('游记D')).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
})

it('游记请求失败时保留深链接页码', async () => {
  api.json('/api/events', { error: '游记暂不可用' }, 500)
  renderTagFilterPage(<Events />, '/events?page=2')
  await screen.findByRole('alert')
  expect(screen.getByTestId('location')).toHaveTextContent('page=2')
})

it('游记当前范围总数返回后修正越界页', async () => {
  const { promise, resolve } = deferred<unknown>()
  api.handlers.set('/api/events', (_req, res) => {
    void promise.then((body) => res.end(JSON.stringify(body)))
  })
  renderTagFilterPage(<Events />, '/events?page=99')
  expect(screen.getByTestId('location')).toHaveTextContent('page=99')
  await act(async () => {
    resolve({ events: [filterRows('events')[3]], totalPages: 2 })
  })
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('page=2'))
  expect(await screen.findByText('游记D')).toBeInTheDocument()
})
