import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BottomNav } from '../../../src/components/BottomNav'
import More from '../../../src/pages/More'

function LocationProbe() {
  const { pathname } = useLocation()
  return <output data-testid="pathname">{pathname}</output>
}

function Harness({ initialPath = '/' }: { initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <BottomNav />
      <Routes>
        <Route path="/more" element={<More />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  )
}

describe('移动端底部导航', () => {
  it('从详情页切换栏目时同步路由与唯一选中项，并能返回首页', () => {
    render(<Harness initialPath="/events/example" />)
    const nav = within(screen.getByRole('navigation', { name: '底部导航' }))
    expect(nav.getByRole('link', { name: '游记' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: '首页' })).not.toHaveAttribute('aria-current')

    fireEvent.click(nav.getByRole('link', { name: '游记' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/events$/)
    expect(nav.getAllByRole('link', { current: 'page' })).toEqual([
      nav.getByRole('link', { name: '游记' }),
    ])

    fireEvent.click(nav.getByRole('link', { name: '音乐' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/music$/)
    expect(nav.getAllByRole('link', { current: 'page' })).toEqual([
      nav.getByRole('link', { name: '音乐' }),
    ])

    fireEvent.click(nav.getByRole('link', { name: '更多' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/more$/)
    expect(screen.getByRole('navigation', { name: '更多功能入口' })).toBeInTheDocument()
    expect(nav.getAllByRole('link', { current: 'page' })).toEqual([
      nav.getByRole('link', { name: '更多' }),
    ])

    fireEvent.click(nav.getByRole('link', { name: '首页' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/$/)
    expect(nav.getAllByRole('link', { current: 'page' })).toEqual([
      nav.getByRole('link', { name: '首页' }),
    ])
  })

  it.each([
    ['百科', '/wiki'],
    ['论坛', '/forum'],
    ['搜索', '/search'],
  ])('从更多入口抵达%s', (label, pathname) => {
    render(<Harness />)
    const nav = within(screen.getByRole('navigation', { name: '底部导航' }))
    fireEvent.click(nav.getByRole('link', { name: '更多' }))
    const entries = within(screen.getByRole('navigation', { name: '更多功能入口' }))
    fireEvent.click(entries.getByRole('link', { name: label }))
    expect(screen.getByTestId('pathname').textContent).toBe(pathname)
    expect(nav.queryByRole('link', { current: 'page' })).not.toBeInTheDocument()
  })
})
