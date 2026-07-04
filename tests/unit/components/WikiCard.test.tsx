// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, within, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiCard from '../../../src/components/wiki/WikiCard'

const noop = () => {}

const mockWikiItem = {
  id: '1',
  slug: 'test-wiki-page',
  title: '测试 Wiki 页面',
  category: 'biography',
  content: '# 测试内容\n\n这是一段测试内容。',
  status: 'published' as const,
  isPinned: false,
  tags: [],
  likesCount: 5,
  favoritesCount: 3,
  commentsCount: 0,
  createdAt: new Date('2024-01-01').toISOString(),
  updatedAt: new Date('2024-06-15').toISOString(),
  lastEditorUid: '',
  lastEditorName: '',
  coverImage: null,
}

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const renderWikiCard = (onCopyLink = noop) =>
  renderWithRouter(
    <WikiCard
      page={mockWikiItem}
      viewMode="medium"
      cardHeight="h-[280px]"
      categoryLabel="人物介绍"
      onCopyLink={onCopyLink}
    />
  )

describe('WikiCard', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders wiki title correctly', () => {
    const { container } = renderWikiCard()

    const article = container.querySelector<HTMLElement>('[role="article"]')
    expect(article).not.toBeNull()
    expect(within(article!).getByText('测试 Wiki 页面')).toBeInTheDocument()
  })

  it('renders category label', () => {
    const { container } = renderWikiCard()

    const article = container.querySelector<HTMLElement>('[role="article"]')
    expect(article).not.toBeNull()
    expect(within(article!).getByText('人物介绍')).toBeInTheDocument()
  })

  it('has article role for accessibility', () => {
    const { container } = renderWikiCard()

    const article = container.querySelector<HTMLElement>('[role="article"]')
    expect(article).toBeInTheDocument()
    expect(article).toHaveAttribute('aria-label', '测试 Wiki 页面 - 人物介绍')
  })

  it('calls onCopyLink when copy button is clicked', () => {
    const onCopyLink = vi.fn()
    const { container } = renderWikiCard(onCopyLink)

    const copyButton = container.querySelector<HTMLButtonElement>('[aria-label="复制链接"]')

    expect(copyButton).toBeInTheDocument()
    fireEvent.click(copyButton!)
    expect(onCopyLink).toHaveBeenCalledTimes(1)
    expect(onCopyLink).toHaveBeenCalledWith(expect.anything(), 'test-wiki-page')
  })
})
