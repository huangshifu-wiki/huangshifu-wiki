import React from 'react'

import { Search, RotateCcw } from '@/src/components/icons'
import { Button, Checkbox, Field, Input, Select } from '@/src/components/ui'
import { isMusicPlatform, MUSIC_PLATFORM_OPTIONS } from '../lib/musicPlatformUrls'
import type { Platform } from '../types/common'

export type MusicAdminFilterState = {
  query: string
  platform: 'all' | Platform
  cover: 'all' | 'with' | 'without'
  displayAlbum: 'all' | 'linked' | 'manual' | 'none'
  sortBy: 'updatedAt' | 'releaseDate' | 'title' | 'artist'
  sortOrder: 'asc' | 'desc'
  includeDeleted: boolean
}

export interface AdminMusicFiltersProps {
  resource: 'songs' | 'albums'
  value: MusicAdminFilterState
  onChange: (next: MusicAdminFilterState) => void
  onSearch: () => void
  onReset: () => void
}

const coverOptions = [
  { value: 'all', label: '全部封面' },
  { value: 'with', label: '有封面' },
  { value: 'without', label: '无封面' },
] as const
const displayAlbumOptions = [
  { value: 'all', label: '全部模式' },
  { value: 'linked', label: '关联专辑' },
  { value: 'manual', label: '手动专辑' },
  { value: 'none', label: '不展示专辑' },
] as const
const sortOptions = [
  { value: 'updatedAt', label: '更新时间' },
  { value: 'releaseDate', label: '发行日期' },
  { value: 'title', label: '标题' },
  { value: 'artist', label: '艺术家' },
] as const
const sortOrderOptions = [
  { value: 'desc', label: '降序' },
  { value: 'asc', label: '升序' },
] as const
const isOptionValue = <T extends string>(
  options: readonly { value: T }[],
  value: string
): value is T => options.some((option) => option.value === value)

export const AdminMusicFilters = ({
  resource,
  value,
  onChange,
  onSearch,
  onReset,
}: AdminMusicFiltersProps) => {
  const setValue = <K extends keyof MusicAdminFilterState>(
    key: K,
    nextValue: MusicAdminFilterState[K]
  ) => onChange({ ...value, [key]: nextValue })

  return (
    <section className="rounded border border-border bg-surface p-4" aria-label="音乐筛选">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(16rem,1fr)_11rem_11rem_11rem_auto]">
        <Field label="关键词" description="按标题、专辑名、来源 ID 或艺术家搜索">
          <Input
            value={value.query}
            onChange={(event) => setValue('query', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSearch()
              }
            }}
            placeholder={resource === 'songs' ? '搜索歌曲、艺人或来源 ID' : '搜索专辑、艺人或简介'}
          />
        </Field>
        <Field label="平台">
          <Select
            value={value.platform}
            onChange={(event) => {
              const platform = event.target.value
              if (platform === 'all' || isMusicPlatform(platform)) setValue('platform', platform)
            }}
          >
            <option value="all">全部平台</option>
            {MUSIC_PLATFORM_OPTIONS.map((platform) => (
              <option key={platform.value} value={platform.value}>
                {platform.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="封面">
          <Select
            value={value.cover}
            onChange={(event) => {
              if (isOptionValue(coverOptions, event.target.value))
                setValue('cover', event.target.value)
            }}
          >
            {coverOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {resource === 'songs' ? (
          <Field label="展示专辑">
            <Select
              value={value.displayAlbum}
              onChange={(event) => {
                if (isOptionValue(displayAlbumOptions, event.target.value))
                  setValue('displayAlbum', event.target.value)
              }}
            >
              {displayAlbumOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="排序字段">
            <Select
              value={value.sortBy}
              onChange={(event) => {
                if (isOptionValue(sortOptions, event.target.value))
                  setValue('sortBy', event.target.value)
              }}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={onSearch}
            leftIcon={<Search size={15} />}
          >
            搜索
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onReset}
            leftIcon={<RotateCcw size={15} />}
          >
            重置
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
        {resource === 'albums' && (
          <Field label="排序方向" className="flex items-center gap-2 space-y-0">
            <Select
              value={value.sortOrder}
              onChange={(event) => {
                if (isOptionValue(sortOrderOptions, event.target.value))
                  setValue('sortOrder', event.target.value)
              }}
            >
              {sortOrderOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {resource === 'songs' && (
          <Field label="排序字段" className="flex items-center gap-2 space-y-0">
            <Select
              value={value.sortBy}
              onChange={(event) => {
                if (isOptionValue(sortOptions, event.target.value))
                  setValue('sortBy', event.target.value)
              }}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {resource === 'songs' && (
          <Field label="排序方向" className="flex items-center gap-2 space-y-0">
            <Select
              value={value.sortOrder}
              onChange={(event) => {
                if (isOptionValue(sortOrderOptions, event.target.value))
                  setValue('sortOrder', event.target.value)
              }}
            >
              {sortOrderOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Checkbox
          checked={value.includeDeleted}
          onCheckedChange={(checked) => setValue('includeDeleted', checked === true)}
          label={<span className="text-sm text-text-secondary">显示已删除</span>}
        />
      </div>
    </section>
  )
}

export default AdminMusicFilters
