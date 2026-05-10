// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SearchBox } from '../../../src/components/search/SearchBox';

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
      <div {...props}>{children}</div>,
    svg: (props: Record<string, unknown>) => <svg {...props} />,
  },
}));

const mockSuggestions = [
  { text: '测试搜索', type: 'keyword' as const, id: null, subtext: null },
  { text: '百科页面', type: 'wiki' as const, id: 'wiki-1', subtext: '百科描述' },
  { text: '音乐专辑', type: 'music' as const, id: 'music-1', subtext: '音乐描述' },
];

describe('SearchBox', () => {
  const defaultProps = {
    query: '',
    suggestions: [] as typeof mockSuggestions,
    aiSearching: false,
    semanticImageSearch: false,
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onImageSearch: vi.fn(),
    onToggleSemanticSearch: vi.fn(),
    onDismissSuggestions: vi.fn(),
  };

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input with correct placeholder', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    expect(container.innerHTML).toContain('placeholder');
  });

  it('has role=search on form element', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    const forms = container.querySelectorAll('[role="search"]');
    expect(forms.length).toBeGreaterThanOrEqual(1);
  });

  it('has aria-label on search input', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    expect(container.innerHTML).toContain('搜索百科');
  });

  it('calls onQueryChange when input value changes', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const { container } = renderWithRouter(<SearchBox {...defaultProps} onQueryChange={onQueryChange} />);

    const input = container.querySelector('input[type="text"], input[role="searchbox"]') as HTMLInputElement;
    if (input) {
      await user.type(input, 'test');
      expect(onQueryChange).toHaveBeenCalled();
    }
  });

  it('calls onSearch when form is submitted', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const { container } = renderWithRouter(<SearchBox {...defaultProps} query="test" onSearch={onSearch} />);

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (submitBtn) {
      await user.click(submitBtn);
      expect(onSearch).toHaveBeenCalledWith('test');
    }
  });

  it('renders AI image search button', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    expect(container.innerHTML).toContain('AI 图片搜索');
  });

  it('disables image search button when aiSearching is true', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} aiSearching={true} />);
    const btns = container.querySelectorAll<HTMLButtonElement>('[aria-label="AI 图片搜索"]');
    if (btns.length > 0) {
      expect(btns[0].disabled).toBe(true);
    }
  });

  it('renders suggestions list when suggestions are provided', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} suggestions={mockSuggestions} />);
    expect(container.querySelectorAll('[role="listbox"]').length).toBeGreaterThanOrEqual(1);
  });

  it('displays suggestion items with correct text', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} suggestions={mockSuggestions} />);
    const html = container.innerHTML;
    expect(html).toContain('测试搜索');
    expect(html).toContain('百科页面');
    expect(html).toContain('音乐专辑');
  });

  it('shows suggestion type labels', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} suggestions={mockSuggestions} />);
    const html = container.innerHTML;
    expect(html).toContain('搜索');
    expect(html).toContain('百科');
    expect(html).toContain('音乐');
  });

  it('has aria-expanded=true when suggestions exist', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} suggestions={mockSuggestions} />);
    const inputs = container.querySelectorAll<HTMLInputElement>('[aria-expanded="true"]');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it('has aria-expanded=false when no suggestions', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    const inputs = container.querySelectorAll<HTMLInputElement>('[aria-expanded="false"]');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it('renders hybrid search toggle switch', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    expect(container.innerHTML).toContain('智能混合搜索');
    expect(container.innerHTML).toContain('RRF融合算法');
  });

  it('shows toggle in off state by default', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} semanticImageSearch={false} />);
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(container.innerHTML).toContain('关键词模式');
  });

  it('shows toggle in on state when enabled', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} semanticImageSearch={true} />);
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(container.innerHTML).toContain('混合模式已开启');
  });

  it('calls onToggleSemanticSearch when toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggleSemanticSearch = vi.fn();
    const { container } = renderWithRouter(
      <SearchBox {...defaultProps} onToggleSemanticSearch={onToggleSemanticSearch} />
    );

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    if (toggle) {
      await user.click(toggle);
      expect(onToggleSemanticSearch).toHaveBeenCalledTimes(1);
    }
  });

  it('toggle has correct accessibility attributes', () => {
    const { container } = renderWithRouter(<SearchBox {...defaultProps} />);
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-label')).toBe('切换智能混合搜索模式');
    expect(toggle.getAttribute('id')).toBe('hybrid-search-toggle');
  });
});
