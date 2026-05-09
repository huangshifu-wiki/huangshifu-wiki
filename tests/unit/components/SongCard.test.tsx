// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SongCard } from '../../../src/components/Music/SongCard';

vi.mock('../../../src/components/SmartImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/components/SmartImage')>();
  return {
    ...actual,
    default: function MockSmartImage({ alt }: { alt?: string }) {
      return <div data-testid="smart-image" aria-label={alt} />;
    },
  };
});

vi.mock('../../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'music.play': '播放',
        'music.favorite': '收藏',
        'music.select': '选择',
        'music.selected': '已选',
        'music.openOriginalLink': '打开原链接',
        'music.copyInternalLink': '复制内链',
        'music.viewPosts': '查看帖子',
        'music.deleteSong': '删除',
      };
      return map[key] || key;
    },
  }),
}));

const mockSong = {
  docId: 'song-001',
  id: '12345',
  title: '测试歌曲名',
  artist: '测试歌手',
  album: '测试专辑',
  cover: '',
  audioUrl: '',
  primaryPlatform: 'netease' as const,
  favoritedByMe: false,
};

const defaultProps = {
  song: mockSong,
  isBatchMode: false,
  isSelected: false,
  isCurrentSong: false,
  isFavoriting: false,
  isAdmin: false,
  isPostsSelected: false,
  onPlay: vi.fn(),
  onToggleSelect: vi.fn(),
  onToggleFavorite: vi.fn(),
  onCopyLink: vi.fn(),
  onDelete: vi.fn(),
  onShowPosts: vi.fn(),
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('SongCard', () => {
  it('renders song title', () => {
    renderWithRouter(<SongCard {...defaultProps} />);
    expect(screen.getByText('测试歌曲名')).toBeInTheDocument();
  });

  it('renders artist and album in subtitle', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} />);
    // 歌手和专辑在同一<p>标签内，使用 container 查询验证文本存在
    const html = container.innerHTML;
    expect(html).toContain('测试歌手');
    expect(html).toContain('测试专辑');
  });

  it('has article role with correct aria-label', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} />);
    const article = container.querySelector('[role="article"]');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('aria-label', '测试歌曲名 - 测试歌手');
  });

  it('shows play button with correct aria-label (desktop)', () => {
    renderWithRouter(<SongCard {...defaultProps} />);
    // 组件同时渲染了desktop和mobile的按钮，所以会有多个"播放"按钮
    const playButtons = screen.getAllByLabelText(/播放/);
    expect(playButtons.length).toBeGreaterThanOrEqual(1);
    expect(playButtons[0]).toHaveAttribute('aria-label', '播放 测试歌曲名');
  });

  it('calls onPlay when play button clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SongCard {...defaultProps} />);
    // 点击第一个播放按钮（desktop版本）
    const playButtons = screen.getAllByLabelText(/播放/);
    await user.click(playButtons[0]);
    expect(defaultProps.onPlay).toHaveBeenCalledWith(mockSong);
  });

  it('in batch mode renders a select-style button', () => {
    renderWithRouter(<SongCard {...defaultProps} isBatchMode={true} />);
    expect(screen.getByText('选择')).toBeInTheDocument();
  });

  it('in batch mode with selected shows selected text', () => {
    renderWithRouter(<SongCard {...defaultProps} isBatchMode={true} isSelected={true} />);
    expect(screen.getByText('已选')).toBeInTheDocument();
  });

  it('highlights current song with highlight background class', () => {
    const { container } = renderWithRouter(
      <SongCard {...defaultProps} isCurrentSong={true} />
    );
    const row = container.firstElementChild;
    expect(row?.className).toContain('bg-[#fdf5d8]');
  });

  it('shows delete button when isAdmin is true', () => {
    renderWithRouter(<SongCard {...defaultProps} isAdmin={true} />);
    const deleteButtons = screen.getAllByLabelText(/删除/);
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    expect(deleteButtons[0]).toHaveAttribute('aria-label', '删除 测试歌曲名');
  });
});
