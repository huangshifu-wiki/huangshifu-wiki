import { Link, MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BackLinkTracker,
  matchBackLabel,
  resetBackLinkOriginForTests,
  SmartBackLink,
} from '../../../src/components/SmartBackLink'

function NavigationProbe() {
  const navigationType = useNavigationType()
  return <div data-testid="nav-type">{navigationType}</div>
}

function HomePage() {
  return (
    <div>
      <h1>首页</h1>
      <Link to="/music/1">进入详情1</Link>
    </div>
  )
}

function SearchPage() {
  return (
    <div>
      <h1>搜索页</h1>
      <Link to="/music/1">搜索歌曲</Link>
    </div>
  )
}

function MusicListPage() {
  return (
    <div>
      <h1>音乐馆</h1>
      <Link to="/music/1">进入详情1</Link>
    </div>
  )
}

function MusicDetailPage() {
  const { pathname } = useLocation()
  return (
    <div>
      <h1>歌曲详情 {pathname}</h1>
      <SmartBackLink fallbackTo="/music" fallbackLabel="返回音乐馆" />
      <Link to="/music/2">进入下一个详情</Link>
      <Link to="/album/2">进入专辑</Link>
    </div>
  )
}

/** 模拟真实详情页：先渲染骨架（无返回链接），数据加载完成后再挂载返回链接 */
function DelayedMusicDetailPage() {
  const { pathname } = useLocation()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(true)
  }, [])
  return (
    <div>
      <h1>歌曲详情 {pathname}</h1>
      {ready ? <SmartBackLink fallbackTo="/music" fallbackLabel="返回音乐馆" /> : <p>加载中</p>}
      <Link to="/album/2">进入专辑</Link>
    </div>
  )
}

function AlbumDetailPage() {
  const { pathname } = useLocation()
  return (
    <div>
      <h1>专辑详情 {pathname}</h1>
      <SmartBackLink fallbackTo="/music" fallbackLabel="返回音乐馆" />
      <Link to="/music/1">进入歌曲</Link>
    </div>
  )
}

function Harness({
  initialEntries,
  delayedDetail = false,
}: {
  initialEntries: string[]
  delayedDetail?: boolean
}) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <NavigationProbe />
      <BackLinkTracker />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/music" element={<MusicListPage />} />
        <Route
          path="/music/:id"
          element={delayedDetail ? <DelayedMusicDetailPage /> : <MusicDetailPage />}
        />
        <Route path="/album/:id" element={<AlbumDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('SmartBackLink 行为', () => {
  beforeEach(() => {
    resetBackLinkOriginForTests()
  })

  it('直接打开详情页时，返回按钮回退到 fallbackTo（replace，不增长历史栈）', () => {
    render(<Harness initialEntries={['/music/1']} />)
    expect(screen.getByText('歌曲详情 /music/1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回音乐馆'))

    expect(screen.getByText('音乐馆')).toBeInTheDocument()
    expect(screen.getByTestId('nav-type')).toHaveTextContent('REPLACE')
  })

  it('站内导航进入详情页时，返回回到来源页（保留列表状态）', () => {
    render(<Harness initialEntries={['/']} />)

    fireEvent.click(screen.getByText('进入详情1'))
    expect(screen.getByText('歌曲详情 /music/1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回首页'))

    expect(screen.getByText('首页')).toBeInTheDocument()
  })

  it('详情页内再前进后返回，只回退一步到上一个详情页', () => {
    render(<Harness initialEntries={['/']} />)

    fireEvent.click(screen.getByText('进入详情1'))
    fireEvent.click(screen.getByText('进入下一个详情'))
    expect(screen.getByText('歌曲详情 /music/2')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回歌曲'))

    expect(screen.getByText('歌曲详情 /music/1')).toBeInTheDocument()
  })
})

describe('SmartBackLink 返回文案随来源推导', () => {
  beforeEach(() => {
    resetBackLinkOriginForTests()
  })

  it('从搜索页进入歌曲详情时，文案为“返回搜索”', () => {
    render(<Harness initialEntries={['/search']} />)

    fireEvent.click(screen.getByText('搜索歌曲'))

    expect(screen.getByText('返回搜索')).toBeInTheDocument()
  })

  it('从音乐馆列表进入时，文案为“返回音乐馆”', () => {
    render(<Harness initialEntries={['/music']} />)

    fireEvent.click(screen.getByText('进入详情1'))

    expect(screen.getByText('返回音乐馆')).toBeInTheDocument()
  })

  it('直接打开详情页时，文案为 fallbackLabel', () => {
    render(<Harness initialEntries={['/music/1']} />)

    expect(screen.getByText('返回音乐馆')).toBeInTheDocument()
  })

  it('同组件跨路由跳转（/music/1 → /music/2）时，文案为“返回歌曲”', () => {
    render(<Harness initialEntries={['/music']} />)

    fireEvent.click(screen.getByText('进入详情1'))
    fireEvent.click(screen.getByText('进入下一个详情'))

    expect(screen.getByText('歌曲详情 /music/2')).toBeInTheDocument()
    expect(screen.getByText('返回歌曲')).toBeInTheDocument()
  })

  it('从专辑页进入歌曲时，文案为“返回专辑”', () => {
    render(<Harness initialEntries={['/album/2']} />)

    fireEvent.click(screen.getByText('进入歌曲'))

    expect(screen.getByText('歌曲详情 /music/1')).toBeInTheDocument()
    expect(screen.getByText('返回专辑')).toBeInTheDocument()
  })

  it('浏览器后退（POP）回到歌曲页时，文案指向更早的来源页', () => {
    render(<Harness initialEntries={['/search']} />)

    fireEvent.click(screen.getByText('搜索歌曲'))
    expect(screen.getByText('返回搜索')).toBeInTheDocument()

    fireEvent.click(screen.getByText('进入专辑'))
    expect(screen.getByText('专辑详情 /album/2')).toBeInTheDocument()
    expect(screen.getByText('返回歌曲')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回歌曲'))
    expect(screen.getByText('歌曲详情 /music/1')).toBeInTheDocument()
    expect(screen.getByText('返回搜索')).toBeInTheDocument()

    fireEvent.click(screen.getByText('返回搜索'))
    expect(screen.getByText('搜索页')).toBeInTheDocument()
  })

  it('返回链接晚于导航挂载（数据加载完成后）时，文案仍指向来源页', async () => {
    render(<Harness initialEntries={['/search']} delayedDetail />)

    fireEvent.click(screen.getByText('搜索歌曲'))

    // 骨架屏阶段无返回链接，数据到达后挂载，文案必须是来源页而非当前页
    expect(await screen.findByText('返回搜索')).toBeInTheDocument()
    expect(screen.queryByText('返回歌曲')).not.toBeInTheDocument()
  })
})

describe('matchBackLabel', () => {
  it('按来源路径推导返回文案，无法识别时为 null', () => {
    expect(matchBackLabel('/search')).toBe('返回搜索')
    expect(matchBackLabel('/search/')).toBe('返回搜索')
    expect(matchBackLabel('/music')).toBe('返回音乐馆')
    expect(matchBackLabel('/music/abc')).toBe('返回歌曲')
    expect(matchBackLabel('/album/1')).toBe('返回专辑')
    expect(matchBackLabel('/events/foo')).toBe('返回活动')
    expect(matchBackLabel('/gallery')).toBe('返回图集列表')
    expect(matchBackLabel('/gallery/1')).toBeNull()
    expect(matchBackLabel('/forum')).toBe('返回论坛列表')
    expect(matchBackLabel('/forum/abc')).toBeNull()
    expect(matchBackLabel('/users/u1/favorites')).toBe('返回收藏')
    expect(matchBackLabel('/users/u1')).toBe('返回个人主页')
    expect(matchBackLabel('/')).toBe('返回首页')
    expect(matchBackLabel('/wiki/foo')).toBe('返回页面')
    expect(matchBackLabel('/wiki')).toBe('返回百科列表')
    expect(matchBackLabel('/wiki/foo/history')).toBeNull()
    expect(matchBackLabel('/wiki/foo/prs')).toBeNull()
    expect(matchBackLabel('/settings')).toBeNull()
  })
})
