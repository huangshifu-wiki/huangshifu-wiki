import React, { useCallback, useMemo, useRef, useState } from 'react'
import MDEditor from '@uiw/react-md-editor/nohighlight'
import type { ICommand, PreviewType, RefMDEditor } from '@uiw/react-md-editor/nohighlight'
import '@uiw/react-md-editor/markdown-editor.css'
import { clsx } from 'clsx'
import { FullscreenSurface } from '@/src/components/ui'
import { handleMarkdownTextPasteCapture } from '../lib/markdownEditorPaste'
import { useUserPreferences } from '../context/UserPreferencesContext'
import MarkdownRenderer from './MarkdownRenderer'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
  placeholder?: string
  ariaLabel?: string
  enableWikiLinks?: boolean
  maxLength?: number
  variant?: 'default' | 'book'
  id?: string
}

const FULLSCREEN_BUTTON_LABEL = '全屏编辑'
const FULLSCREEN_BUTTON_HINT = '全屏编辑（Ctrl+0）'

/** 切换内联与全屏时编辑器会重新挂载，用它在切换前后搬运光标和滚动位置 */
interface EditorViewState {
  selectionStart: number
  selectionEnd: number
  textScrollTop: number
  previewScrollTop: number
}

/** 还原光标与滚动位置；外壳里还没有编辑器时返回 false，留待下一次挂载再还原 */
const applyViewState = (shell: HTMLElement, view: EditorViewState): boolean => {
  const textarea = shell.querySelector('textarea')
  if (!textarea) return false
  textarea.focus()
  textarea.setSelectionRange(view.selectionStart, view.selectionEnd)
  // 聚焦会把视图带到光标处，显式滚动要放在后面
  textarea.scrollTop = view.textScrollTop
  const preview = shell.querySelector('.w-md-editor-preview')
  if (preview) preview.scrollTop = view.previewScrollTop
  return true
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  height = '400px',
  placeholder = '输入内容...',
  ariaLabel,
  enableWikiLinks = false,
  maxLength,
  variant = 'default',
  id,
}) => {
  const { resolvedTheme } = useUserPreferences()
  const [fullscreen, setFullscreen] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewType>('live')
  const editorRef = useRef<RefMDEditor>(null)
  const activeShellRef = useRef<HTMLDivElement | null>(null)
  const pendingViewState = useRef<EditorViewState | null>(null)

  const changeFullscreen = (next: boolean | ((current: boolean) => boolean)) => {
    const shell = activeShellRef.current
    const textarea = shell?.querySelector('textarea')
    if (shell && textarea) {
      pendingViewState.current = {
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        // 文本区由 textarea 自身滚动，.w-md-editor-area 在本项目样式下永远不会溢出
        textScrollTop: textarea.scrollTop,
        previewScrollTop: shell.querySelector('.w-md-editor-preview')?.scrollTop ?? 0,
      }
    }
    setPreviewMode(editorRef.current?.preview ?? 'live')
    setFullscreen(next)
  }

  // 内联与全屏两个外壳共用这个 ref：进入全屏时浮层内容要等 Radix Portal 的第二次提交才挂载，
  // 退出时内联外壳因 key 变化重新挂载，两条路径都在这里还原
  const handleShellRef = useCallback((shell: HTMLDivElement | null) => {
    if (!shell) return
    activeShellRef.current = shell
    const view = pendingViewState.current
    if (view && applyViewState(shell, view)) pendingViewState.current = null
  }, [])

  // 编辑器会把首次渲染的命令对象存进内部 state，execute 只能引用稳定值：ref 加函数式 setState
  const filterCommand = (command: ICommand, isExtra: boolean): ICommand =>
    isExtra && command.keyCommand === 'fullscreen'
      ? {
          ...command,
          buttonProps: { 'aria-label': FULLSCREEN_BUTTON_LABEL, title: FULLSCREEN_BUTTON_HINT },
          execute: () => changeFullscreen((current) => !current),
        }
      : command

  // 仅预览模式下库不挂载输入区，命令的 execute 不会被调用；这里在捕获阶段接管，
  // 同时阻止库自己翻转内部 fullscreen 状态导致两边不一致
  const handleShellClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest?.('button[data-name="fullscreen"]')
    if (!button) return
    event.stopPropagation()
    changeFullscreen((current) => !current)
  }

  const components = useMemo(
    () => ({
      preview: () => (
        <div className="prose max-w-none font-body leading-relaxed text-text-primary">
          <MarkdownRenderer content={value} enableWikiLinks={enableWikiLinks} />
        </div>
      ),
    }),
    [value, enableWikiLinks]
  )

  const shellProps = {
    ref: handleShellRef,
    onPasteCapture: handleMarkdownTextPasteCapture,
    onClickCapture: handleShellClickCapture,
    'data-color-mode': resolvedTheme === 'dark' ? 'dark' : 'light',
  }

  const editor = (
    <MDEditor
      ref={editorRef}
      value={value}
      onChange={(val) => onChange(val || '')}
      height={parseInt(height)}
      preview={previewMode}
      // 铺满视口由库的 .w-md-editor-fullscreen 负责，浮层只提供一个不受祖先裁切和层叠限制的挂载点
      fullscreen={fullscreen}
      // 库的 body 滚动锁在重新挂载时会把 hidden 当成原始值永久缓存，滚动锁交给浮层负责
      overflow={false}
      commandsFilter={filterCommand}
      components={components}
      textareaProps={{ id, placeholder, 'aria-label': ariaLabel, maxLength }}
      visibleDragbar={false}
    />
  )

  return (
    <>
      {/* key 让内联外壳在切换时重新挂载，从而触发还原；全屏时它退化为等高占位，避免页面跳动 */}
      <div
        {...shellProps}
        key={fullscreen ? 'fullscreen-placeholder' : 'inline'}
        className={clsx(
          'overflow-hidden rounded border',
          variant === 'book'
            ? 'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] shadow-[inset_0_1px_0_rgba(138,109,47,0.05)]'
            : 'border-border bg-surface'
        )}
        style={fullscreen ? { height } : undefined}
      >
        {fullscreen ? null : editor}
      </div>
      <FullscreenSurface
        open={fullscreen}
        onOpenChange={changeFullscreen}
        onOpenAutoFocus={(event) => {
          // Radix 默认把焦点交给浮层里第一个可聚焦元素（工具栏按钮），让位给还原逻辑
          event.preventDefault()
        }}
        label={ariaLabel || 'Markdown 编辑器'}
      >
        <div {...shellProps}>{editor}</div>
      </FullscreenSurface>
    </>
  )
}

export default MarkdownEditor
