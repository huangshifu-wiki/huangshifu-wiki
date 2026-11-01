import React, { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { MobileTagFilters } from '../../../src/components/MobileTagFilters'
import type { TagFilter } from '../../../src/lib/tagFilters'

function Filters() {
  const [filter, setFilter] = useState<TagFilter>({ tags: ['深链接标签'], mode: 'any' })
  return (
    <MobileTagFilters
      scopeKey="songs"
      tags={['古风', '现场']}
      value={filter}
      onToggleTag={(tag) =>
        setFilter((current) => ({
          ...current,
          tags: current.tags.includes(tag)
            ? current.tags.filter((item) => item !== tag)
            : [...current.tags, tag],
        }))
      }
      onModeChange={(mode) => setFilter((current) => ({ ...current, mode }))}
      onClear={() => setFilter({ tags: [], mode: 'any' })}
    />
  )
}

it('手机菜单连续多选、切换交集并在关闭后保留条件和焦点', async () => {
  const user = userEvent.setup()
  render(<Filters />)
  const trigger = screen.getByRole('button', { name: /^筛选/ })
  await user.click(trigger)
  const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!
  await user.click(within(panel).getByRole('button', { name: '古风' }))
  await user.click(within(panel).getByRole('button', { name: '现场' }))
  await user.click(within(panel).getByRole('button', { name: '交集' }))
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(within(panel).getByRole('button', { name: '深链接标签' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(within(panel).getByRole('button', { name: '交集' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
  expect(panel).toHaveAttribute('inert')
  expect(panel).toHaveAttribute('aria-hidden', 'true')
  await waitFor(() => expect(document.getElementById(panel.id)).toBeNull())
  await user.click(trigger)
  const reopened = document.getElementById(trigger.getAttribute('aria-controls')!)!
  expect(within(reopened).getByRole('button', { name: '现场' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.click(within(reopened).getByRole('button', { name: '清空标签' }))
  expect(within(reopened).getByRole('button', { name: '现场' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  expect(within(reopened).getByRole('button', { name: '并集' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
