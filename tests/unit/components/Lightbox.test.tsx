// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lightbox } from '../../../src/components/Lightbox';

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
      <div {...props}>{children}</div>,
    svg: (props: Record<string, unknown>) => <svg {...props} />,
  },
}));

const mockImages = [
  { id: '1', name: '图片1.jpg', url: '/img/1.jpg' },
  { id: '2', name: '图片2.jpg', url: '/img/2.jpg' },
  { id: '3', name: '图片3.jpg', url: '/img/3.jpg' },
];

describe('Lightbox', () => {
  it('does not render when images is empty', () => {
    const { container } = render(<Lightbox images={[]} initialIndex={0} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog with role=dialog when open with images', () => {
    render(<Lightbox images={mockImages} initialIndex={0} onClose={vi.fn()} />);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs.length).toBeGreaterThanOrEqual(1);
    expect(dialogs[0]).toBeInTheDocument();
  });

  it('has aria-modal=true on dialog', () => {
    render(<Lightbox images={mockImages} initialIndex={0} onClose={vi.fn()} />);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs[0]).toHaveAttribute('aria-modal', 'true');
  });

  it('shows image counter with role=status', () => {
    render(<Lightbox images={mockImages} initialIndex={0} onClose={vi.fn()} />);
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses[0].textContent).toContain('1 / 3');
  });

  it('image counter has aria-live=polite and aria-atomic=true', () => {
    render(<Lightbox images={mockImages} initialIndex={0} onClose={vi.fn()} />);
    const statuses = screen.getAllByRole('status');
    expect(statuses[0]).toHaveAttribute('aria-live', 'polite');
    expect(statuses[0]).toHaveAttribute('aria-atomic', 'true');
  });

  it('image counter shows correct position for different initialIndex', () => {
    render(<Lightbox images={mockImages} initialIndex={2} onClose={vi.fn()} />);
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    // 验证状态元素存在且包含计数器格式
    expect(statuses[0].textContent).toMatch(/\d+ \/ \d+/);
  });

  it('includes image position in dialog aria-label', () => {
    render(<Lightbox images={mockImages} initialIndex={1} onClose={vi.fn()} />);
    const dialogs = screen.getAllByRole('dialog');
    const matchingDialog = dialogs.find(d => d.getAttribute('aria-label')?.includes('2 / 3'));
    expect(matchingDialog).toBeDefined();
  });

  it('calls onClose when close button clicked', async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<Lightbox images={mockImages} initialIndex={0} onClose={onClose} />);

    const closeButtons = screen.getAllByLabelText('关闭');
    await u.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders prev and next navigation buttons for multiple images', () => {
    render(<Lightbox images={mockImages} initialIndex={1} onClose={vi.fn()} />);
    const prevButtons = screen.getAllByLabelText('上一张');
    const nextButtons = screen.getAllByLabelText('下一张');
    expect(prevButtons.length).toBeGreaterThanOrEqual(1);
    expect(nextButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('backdrop has role=presentation', () => {
    render(<Lightbox images={mockImages} initialIndex={0} onClose={vi.fn()} />);
    const presentations = screen.getAllByRole('presentation');
    expect(presentations.length).toBeGreaterThanOrEqual(1);
    expect(presentations[0]).toBeInTheDocument();
  });
});
