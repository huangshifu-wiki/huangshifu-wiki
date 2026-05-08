import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../../../src/components/Toast';

function TestComponent({ message = '测试消息' }: { message?: string }) {
  const toast = useToast();
  return (
    <button onClick={() => toast.show(message)} data-testid="toast-trigger">
      显示提示
    </button>
  );
}

function renderToast() {
  return render(
    <ToastProvider>
      <TestComponent />
    </ToastProvider>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show toast initially', () => {
    renderToast();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows toast message after calling show()', () => {
    renderToast();
    fireEvent.click(screen.getByTestId('toast-trigger'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('测试消息')).toBeInTheDocument();
  });

  it('toast has role="status" and aria-live="polite"', () => {
    renderToast();
    fireEvent.click(screen.getByTestId('toast-trigger'));
    const statusEl = screen.getByRole('status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
  });

  it('displays success variant with brand color styling', () => {
    renderToast();
    fireEvent.click(screen.getByTestId('toast-trigger'));
    const toastBox = screen.getByRole('status');
    expect(toastBox.className).toContain('border-[#c8951e]');
    expect(toastBox.className).not.toContain('red');
  });

  it('displays error variant with red styling', () => {
    function ErrorTest() {
      const toast = useToast();
      return (
        <button
          onClick={() => toast.show('出错了', { variant: 'error' })}
          data-testid="error-trigger"
        >
          错误
        </button>
      );
    }

    render(
      <ToastProvider>
        <ErrorTest />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('error-trigger'));
    const toastBox = screen.getByRole('status');
    expect(toastBox.className).toContain('text-red-600');
    expect(toastBox.className).toContain('border-red-200');
  });

  it('shows the exact message text', () => {
    function CustomMsg() {
      const toast = useToast();
      return (
        <button
          onClick={() => toast.show('自定义消息内容')}
          data-testid="custom-trigger"
        >
          自定义
        </button>
      );
    }

    render(
      <ToastProvider>
        <CustomMsg />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('custom-trigger'));
    expect(screen.getByText('自定义消息内容')).toBeInTheDocument();
  });

  it('indicator dot has aria-hidden="true"', () => {
    renderToast();
    fireEvent.click(screen.getByTestId('toast-trigger'));
    const dot = screen.getByRole('status').querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
  });

  it('auto-dismisses after duration', () => {
    renderToast();
    fireEvent.click(screen.getByTestId('toast-trigger'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('replaces previous toast when new one shown', () => {
    function MultiToast() {
      const toast = useToast();
      return (
        <>
          <button onClick={() => toast.show('第一条')} data-testid="first">
            第一条
          </button>
          <button onClick={() => toast.show('第二条')} data-testid="second">
            第二条
          </button>
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiToast />
      </ToastProvider>
    );

    fireEvent.click(screen.getByTestId('first'));

    // 检查 Toast 区域内显示"第一条"（排除按钮文本）
    const statusEl = screen.getByRole('status');
    expect(statusEl.textContent).toContain('第一条');

    fireEvent.click(screen.getByTestId('second'));

    // 替换后应显示"第二条"，且不再有"第一条"
    expect(statusEl.textContent).toContain('第二条');
    expect(statusEl.textContent).not.toContain('第一条');
  });
});
