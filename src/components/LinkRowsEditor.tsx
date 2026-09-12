import { Plus, Trash2 } from '@/src/components/icons'
import { Button, IconButton, Input } from '@/src/components/ui'
import type { ContentLink } from '../types/entities'

/** 名称 + 地址两列的链接行编辑器 */
export const LinkRowsEditor = ({
  title,
  values,
  labelMaxLength,
  urlPlaceholder,
  onChange,
}: {
  title: string
  values: ContentLink[]
  labelMaxLength: number
  urlPlaceholder: string
  onChange: (values: ContentLink[]) => void
}) => {
  const appendItem = () => onChange([...values, { label: '', url: '' }])
  const updateItem = (index: number, patch: Partial<ContentLink>) => {
    onChange(
      values.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item))
    )
  }
  const removeItem = (index: number) =>
    onChange(values.filter((_, currentIndex) => currentIndex !== index))

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<Plus size={13} />}
          onClick={appendItem}
          aria-label={`添加${title}`}
        >
          添加
        </Button>
      </div>
      {values.length ? (
        <div className="space-y-3">
          {values.map((item, index) => (
            <div
              key={index}
              className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <Input
                value={item.label}
                onChange={(event) => updateItem(index, { label: event.target.value })}
                maxLength={labelMaxLength}
                placeholder="链接名称"
                aria-label={`${title}名称`}
              />
              <Input
                value={item.url}
                onChange={(event) => updateItem(index, { url: event.target.value })}
                placeholder={urlPlaceholder}
                aria-label={`${title}地址`}
              />
              <IconButton
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`删除${title}`}
                onClick={() => removeItem(index)}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted">暂无{title}，点击「添加」新增一条。</p>
      )}
    </>
  )
}
