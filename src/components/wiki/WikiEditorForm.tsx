import React from 'react'
import { BookEditorSection, BookFormField, bookInputClass } from '../../components/BookEditor'
import { CharacterCount } from '../../components/CharacterCount'
import MarkdownEditor from '../../components/MarkdownEditor'
import { LocationTagInput } from '../../components/LocationTagInput'
import { CONTENT_LIMITS, WIKI_MAX_CONTENT_SIZE } from '../../lib/contentLimits'
import type { WikiRelationRecord } from './types'
import type { WikiCategoryItem } from '../../types/entities'

type FormData = {
  title: string
  slug: string
  category: string
  content: string
  tags: string
  eventDate: string
  relations: WikiRelationRecord[]
  locationCode: string
  locationName: string
}

interface WikiEditorFormProps {
  formData: FormData
  categories: WikiCategoryItem[]
  onFormDataChange: (data: Partial<FormData> | ((prev: FormData) => FormData)) => void
}

const WikiEditorForm = React.memo(
  ({ formData, categories, onFormDataChange }: WikiEditorFormProps) => {
    const handleLocationChange = (locationName: string, locationCode: string) => {
      onFormDataChange({ locationName, locationCode })
    }

    const handleLocationClear = () => {
      onFormDataChange({ locationName: '', locationCode: '' })
    }

    return (
      <>
        <BookEditorSection title="条目信息" className="border-t-0 pt-0">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <BookFormField
              label="标题"
              htmlFor="wiki-title"
              required
              counter={
                <CharacterCount current={formData.title.length} max={CONTENT_LIMITS.wiki.title} />
              }
            >
              <input
                id="wiki-title"
                type="text"
                required
                value={formData.title}
                onChange={(e) => onFormDataChange({ title: e.target.value })}
                maxLength={CONTENT_LIMITS.wiki.title}
                placeholder="例如：黄诗扶"
                className={bookInputClass}
              />
            </BookFormField>
            <BookFormField label="分类" htmlFor="wiki-category">
              <select
                id="wiki-category"
                value={formData.category}
                onChange={(e) => onFormDataChange({ category: e.target.value })}
                className={`${bookInputClass} appearance-none`}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </BookFormField>
            <BookFormField
              label="事件日期 (可选)"
              htmlFor="wiki-event-date"
              counter={
                <CharacterCount
                  current={formData.eventDate.length}
                  max={CONTENT_LIMITS.wiki.eventDate}
                />
              }
            >
              <input
                id="wiki-event-date"
                type="date"
                value={formData.eventDate}
                onChange={(e) => onFormDataChange({ eventDate: e.target.value })}
                maxLength={CONTENT_LIMITS.wiki.eventDate}
                className={bookInputClass}
              />
            </BookFormField>
          </div>
        </BookEditorSection>

        <BookEditorSection title="正文">
          <BookFormField
            label="内容 (Markdown)"
            htmlFor="wiki-content"
            required
            counter={
              <CharacterCount current={formData.content.length} max={WIKI_MAX_CONTENT_SIZE} />
            }
          >
            <div id="wiki-content">
              <MarkdownEditor
                value={formData.content}
                onChange={(content) =>
                  onFormDataChange((prev) =>
                    prev.content === content ? prev : { ...prev, content }
                  )
                }
                height="500px"
                placeholder="在这里输入百科内容，支持 Markdown 语法..."
                ariaLabel="内容 (Markdown)"
                enableWikiLinks={true}
                maxLength={WIKI_MAX_CONTENT_SIZE}
                variant="book"
              />
            </div>
          </BookFormField>
        </BookEditorSection>

        <BookEditorSection title="附加信息">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <BookFormField
              label="标签 (逗号分隔)"
              htmlFor="wiki-tags"
              counter={
                <CharacterCount
                  current={formData.tags.length}
                  max={CONTENT_LIMITS.wiki.tag * CONTENT_LIMITS.wiki.tags}
                />
              }
            >
              <input
                id="wiki-tags"
                type="text"
                value={formData.tags}
                onChange={(e) => onFormDataChange({ tags: e.target.value })}
                maxLength={CONTENT_LIMITS.wiki.tag * CONTENT_LIMITS.wiki.tags}
                placeholder="例如：古风, 原创, 歌手"
                className={bookInputClass}
              />
            </BookFormField>

            <BookFormField label="地点">
              <LocationTagInput
                value={formData.locationName || null}
                locationCode={formData.locationCode || null}
                onChange={handleLocationChange}
                onClear={handleLocationClear}
                variant="book"
              />
            </BookFormField>
          </div>
        </BookEditorSection>
      </>
    )
  }
)

WikiEditorForm.displayName = 'WikiEditorForm'

export default WikiEditorForm
