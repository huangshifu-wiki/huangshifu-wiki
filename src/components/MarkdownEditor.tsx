import React from 'react'
import MDEditor from '@uiw/react-md-editor/nohighlight'
import '@uiw/react-md-editor/markdown-editor.css'
import { clsx } from 'clsx'
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
}) => {
  const { resolvedTheme } = useUserPreferences()

  return (
    <div
      className={clsx(
        'overflow-hidden rounded border',
        variant === 'book'
          ? 'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] shadow-[inset_0_1px_0_rgba(138,109,47,0.05)]'
          : 'border-border bg-surface'
      )}
      onPasteCapture={handleMarkdownTextPasteCapture}
      data-color-mode={resolvedTheme === 'dark' ? 'dark' : 'light'}
    >
      <MDEditor
        value={value}
        onChange={(val) => onChange(val || '')}
        height={parseInt(height)}
        preview="live"
        components={{
          preview: (source) => (
            <div className="prose max-w-none font-body leading-relaxed text-text-primary">
              <MarkdownRenderer content={source} enableWikiLinks={enableWikiLinks} />
            </div>
          ),
        }}
        textareaProps={{
          placeholder,
          'aria-label': ariaLabel,
          maxLength,
        }}
        visibleDragbar={false}
      />
    </div>
  )
}

export default MarkdownEditor
