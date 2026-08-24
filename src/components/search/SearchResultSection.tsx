import React from 'react'
import { motion } from 'motion/react'
import type { UsePaginationReturn } from '../../hooks/usePagination'
import { Pagination } from '../Pagination'

interface SearchResultSectionBaseProps<T> {
  title: string
  icon: React.ReactNode
  items: T[]
  pagination: UsePaginationReturn
  dockGroup: string
  onPageChange?: (page: number) => void
}

type SearchResultSectionProps<T> =
  | (SearchResultSectionBaseProps<T> & {
      renderGrid?: true
      resultGridClassName: string
      getItemKey: (item: T, index: number) => React.Key
      renderItem: (item: T, index: number) => React.ReactNode
    })
  | (SearchResultSectionBaseProps<T> & {
      renderGrid: false
      renderItems: (items: T[]) => React.ReactNode
    })

export function SearchResultSection<T>(props: SearchResultSectionProps<T>) {
  const { title, icon, items, pagination, dockGroup, onPageChange } = props
  const sectionRef = React.useRef<HTMLElement | null>(null)
  const totalPages = Math.max(1, pagination.totalPages)
  const page = Math.max(1, Math.min(pagination.page, totalPages))

  return (
    <motion.section
      ref={sectionRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="space-y-4"
    >
      <h2 className="mb-4 flex items-center gap-2 text-[0.875rem] font-semibold uppercase tracking-[0.12em] text-text-secondary">
        {icon} {title}
      </h2>
      {props.renderGrid === false ? (
        props.renderItems(items)
      ) : (
        <div className={props.resultGridClassName}>
          {items.map((item, index) => (
            <React.Fragment key={props.getItemKey(item, index)}>
              {props.renderItem(item, index)}
            </React.Fragment>
          ))}
        </div>
      )}
      {pagination.hasMultiplePages && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={(nextPage) => {
            pagination.setPage(nextPage)
            onPageChange?.(nextPage)
          }}
          dockGroup={dockGroup}
          dockLabel={title}
          dockSectionRef={sectionRef}
        />
      )}
    </motion.section>
  )
}
