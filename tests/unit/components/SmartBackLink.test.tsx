import { Link, MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SmartBackLink } from '../../../src/components/SmartBackLink'

function NavigationProbe() {
  const navigationType = useNavigationType()
  return <div data-testid="nav-type">{navigationType}</div>
}

function ListPage() {
  return (
    <div>
      <h1>列表页</h1>
      <Link to="/music/1">进入详情1</Link>
      <Link to="/music/2">进入详情2</Link>
    </div>
  )
}

function FallbackListPage() {
  return (
    <div>
      <h1>音乐列表页</h1>
    </div>
  )
}

function DetailPage() {
  const { pathname } = useLocation()
  return (
    <div>
      <h1>详情页 {pathname}</h1>
      <SmartBackLink fallbackTo="/music">返回</SmartBackLink>
      <Link to="/music/next">进入下一个详情</Link>
    </div>
  )
}

function Harness({ initialEntries }: { initialEntries: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <NavigationProbe />
      <Routes>
        <Route path="/" element={<ListPage />} />
        <Route path="/music" element={<FallbackListPage />} />
        <Route path="/music/:id" element={<DetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('SmartBackLink', () => {
  it('直接打开详情页时，返回按钮回退到 fallbackTo（replace，不增长历史栈）', () => {
    render(<Harness initialEntries={['/music/1']} />)
    expect(screen.getByText('详情页 /music/1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回'))

    expect(screen.getByText('音乐列表页')).toBeInTheDocument()
    expect(screen.getByTestId('nav-type')).toHaveTextContent('REPLACE')
  })

  it('站内导航进入详情页时，返回回到来源页（保留列表状态）', () => {
    render(<Harness initialEntries={['/']} />)

    fireEvent.click(screen.getByText('进入详情1'))
    expect(screen.getByText('详情页 /music/1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回'))

    expect(screen.getByText('列表页')).toBeInTheDocument()
  })

  it('详情页内再前进后返回，只回退一步到上一个详情页', () => {
    render(<Harness initialEntries={['/']} />)

    fireEvent.click(screen.getByText('进入详情1'))
    fireEvent.click(screen.getByText('进入下一个详情'))
    expect(screen.getByText('详情页 /music/next')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回'))

    expect(screen.getByText('详情页 /music/1')).toBeInTheDocument()
  })
})
