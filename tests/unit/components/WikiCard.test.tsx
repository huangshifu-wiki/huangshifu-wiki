import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WikiCard from '../../../src/components/wiki/WikiCard';

// Mock wiki item data
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
};

// 包装组件：提供 react-router context
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe('WikiCard', () => {
  it('renders wiki title correctly', () => {
    renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={() => {}}
      />
    );

    expect(screen.getByText('测试 Wiki 页面')).toBeInTheDocument();
  });

  it('renders category label', () => {
    renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={() => {}}
      />
    );

    expect(screen.getByText('人物介绍')).toBeInTheDocument();
  });

  it('has article role for accessibility', () => {
    const { container } = renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={() => {}}
      />
    );

    const article = container.querySelector('[role="article"]');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('aria-label', '测试 Wiki 页面 - 人物介绍');
  });

  it('calls onCopyLink when copy button is clicked', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const onCopyLink = vi.fn();

    renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={onCopyLink}
      />
    );

    const copyButton = screen.getByLabelText('复制百科内链');
    await user.click(copyButton);

    // onCopyLink 接收 (event, slug) 两个参数
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledWith(expect.anything(), 'test-wiki-page');
  });
});
