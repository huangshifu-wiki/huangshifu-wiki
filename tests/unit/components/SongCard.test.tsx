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
  it('renders song title and artist', () => {
    renderWithRouter(<SongCard {...defaultProps} />);
    expect(screen.getByText('测试歌曲名')).toBeInTheDocument();
    const artistEl = screen.getByText((content, el) => {
      return el?.tagName === 'P' && content.includes('测试歌手');
    });
    expect(artistEl).toBeInTheDocument();
  });

  it('renders album name within subtitle line', () => {
    renderWithRouter(<SongCard {...defaultProps} />);
    const subtitleEl = screen.getByText((content, el) => {
      return el?.tagName === 'P' && content.includes('测试专辑');
    });
    expect(subtitleEl).toBeInTheDocument();
  });

  it('has article role with correct aria-label', () => {
    const { container } = renderWithRouter(<SongCard {...defaultProps} />);
    const article = container.querySelector('[role="article"]');
    expect(article).toBeInTheDocument();
    expect(article).toHaveAttribute('aria-label', '测试歌曲名 - 测试歌手');
  });

  it('shows play button with correct aria-label', () => {
    renderWithRouter(<SongCard {...defaultProps} />);
    const playBtn = screen.getByLabelText(/播放/);
    expect(playBtn).toBeInTheDocument();
    expect(playBtn).toHaveAttribute('aria-label', '播放 测试歌曲名');
  });

  it('calls onPlay when play button clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SongCard {...defaultProps} />);
    await user.click(screen.getByLabelText(/播放/));
    expect(defaultProps.onPlay).toHaveBeenCalledWith(mockSong);
  });

  it('in batch mode renders a select-style button', () => {
    renderWithRouter(<SongCard {...defaultProps} isBatchMode={true} />);
    const buttons = screen.getAllByRole('button');
    const batchButton = buttons.find((b) =>
      b.className.includes('bg-[#f0ece3]') || b.className.includes('px-3')
    );
    expect(batchButton).toBeInTheDocument();
  });

  it('in batch mode with selected shows highlighted button', () => {
    renderWithRouter(<SongCard {...defaultProps} isBatchMode={true} isSelected={true} />);
    const buttons = screen.getAllByRole('button');
    const selectedButton = buttons.find((b) =>
      b.className.includes('bg-[#c8951e]')
    );
    expect(selectedButton).toBeInTheDocument();
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
    const deleteBtn = screen.getByLabelText(/删除/);
    expect(deleteBtn).toBeInTheDocument();
    expect(deleteBtn).toHaveAttribute('aria-label', '删除 测试歌曲名');
  });

  it('does not show delete button when isAdmin is false', () => {
    renderWithRouter(<SongCard {...defaultProps} isAdmin={false} />);
    expect(screen.queryByLabelText(/删除/)).not.toBeInTheDocument();
  });
});
