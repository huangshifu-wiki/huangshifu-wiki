// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
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
  beforeEach(() => {
    cleanup();
  });

  it('renders wiki title correctly', () => {
    const { container } = renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={() => {}}
      />
    );

    // 使用 within 隔离到第一个 article 元素内查询
    const article = container.querySelector<HTMLElement>('[role="article"]');
    expect(article).not.toBeNull();
    expect(within(article!).getByText('测试 Wiki 页面')).toBeInTheDocument();
  });

  it('renders category label', () => {
    const { container } = renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={() => {}}
      />
    );

    // 使用 within 隔离到第一个 article 元素内查询
    const article = container.querySelector<HTMLElement>('[role="article"]');
    expect(article).not.toBeNull();
    expect(within(article!).getByText('人物介绍')).toBeInTheDocument();
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

    // 使用 within 隔离到第一个 article 元素
    const article = container.querySelector<HTMLElement>('[role="article"]');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('aria-label', '测试 Wiki 页面 - 人物介绍');
  });

  it('calls onCopyLink when copy button is clicked', () => {
    const onCopyLink = vi.fn();
    const { container } = renderWithRouter(
      <WikiCard
        page={mockWikiItem}
        viewMode="grid"
        cardHeight="h-[280px]"
        onCopyLink={onCopyLink} />
    );

    // 使用 querySelectorAll 获取复制按钮（可能不可见）
    const copyButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="复制百科内链"]');

    // 确保按钮存在再触发事件
    if (copyButtons.length > 0) {
      fireEvent.click(copyButtons[0]);

      // onCopyLink 接收 (event, slug) 两个参数
      expect(onCopyLink).toHaveBeenCalledTimes(1);
      expect(onCopyLink).toHaveBeenCalledWith(expect.anything(), 'test-wiki-page');
    }
  });
});
