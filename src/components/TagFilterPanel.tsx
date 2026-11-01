import React from 'react'
import { Check } from '@/src/components/icons'
import { Button, cn } from '@/src/components/ui'
import { normalizeStringListInput } from '../lib/musicCredits'
import type { TagFilter, TagFilterMode } from '../lib/tagFilters'

export interface TagFilterPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tags: readonly string[]
  value: TagFilter
  onToggleTag: (tag: string) => void
  onModeChange: (mode: TagFilterMode) => void
  onClear: () => void
}

const MODE_OPTIONS = [
  { value: 'any', label: '并集' },
  { value: 'all', label: '交集' },
] as const

export const TagFilterPanel = React.forwardRef<HTMLDivElement, TagFilterPanelProps>(
  ({ tags, value, onToggleTag, onModeChange, onClear, className, ...props }, ref) => {
    // 深链接中的已选标签也保留入口，不依赖候选接口是否返回它。
    const candidates = normalizeStringListInput([...tags, ...value.tags])
    return (
      <div ref={ref} className={cn('min-w-0 space-y-3 py-4', className)} {...props}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium tracking-wider text-text-primary">标签筛选</h3>
            <div role="group" aria-label="标签匹配方式" className="inline-flex items-center">
              {MODE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={value.mode === option.value}
                  onClick={() => onModeChange(option.value)}
                  className={cn(
                    'px-1.5 font-normal',
                    value.mode === option.value
                      ? 'text-text-primary underline decoration-[var(--book-ink-line)] underline-offset-4'
                      : 'text-text-muted'
                  )}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="清空标签"
            disabled={!value.tags.length && value.mode === 'any'}
            onClick={onClear}
          >
            清空
          </Button>
        </div>
        <div
          role="group"
          aria-label="可选标签"
          className="flex max-h-[60dvh] flex-wrap items-start gap-2 overflow-y-auto"
        >
          {candidates.map((tag) => {
            const selected = value.tags.includes(tag)
            return (
              <Button
                key={tag}
                type="button"
                variant={selected ? 'info' : 'secondary'}
                appearance="plain"
                soft
                size="sm"
                aria-pressed={selected}
                onClick={() => onToggleTag(tag)}
                leftIcon={
                  selected ? <Check size={12} className="shrink-0" aria-hidden="true" /> : undefined
                }
                className="min-w-0 max-w-full whitespace-normal text-left"
              >
                <span className="min-w-0 text-wrap-anywhere">{tag}</span>
              </Button>
            )
          })}
          {!candidates.length && <p className="text-sm text-text-muted">暂无可选标签</p>}
        </div>
      </div>
    )
  }
)
TagFilterPanel.displayName = 'TagFilterPanel'
