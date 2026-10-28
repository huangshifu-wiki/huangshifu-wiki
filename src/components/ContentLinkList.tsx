import { ExternalLink } from '@/src/components/icons'
import { Link } from 'react-router-dom'
import { isInternalLinkPath } from '../lib/contentLinks'
import type { ReactNode } from 'react'
import type { ContentLink } from '../types/entities'

/** 站内路径走 SPA 跳转，站外地址新窗口打开 */
export const ContentLinkList = ({
  title,
  links,
  emptyText,
}: {
  title: ReactNode
  links: ContentLink[]
  emptyText?: string
}) => (
  <div className="border-y border-[var(--book-ink-line)] py-5">
    <div className="mb-3">{title}</div>
    {links.length ? (
      <div className="flex flex-col">
        {links.map((link, index) =>
          isInternalLinkPath(link.url) ? (
            <Link
              key={index}
              to={link.url}
              data-press-feedback="inline"
              className="flex items-center gap-2.5 border-b border-[var(--book-ink-line)] py-2.5 text-sm text-text-secondary transition-all hover:pl-1 hover:text-brand-gold last:border-0"
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold opacity-60"
              />
              {link.label}
            </Link>
          ) : (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              data-press-feedback="inline"
              className="flex items-center gap-2.5 border-b border-[var(--book-ink-line)] py-2.5 text-sm text-text-secondary transition-all hover:pl-1 hover:text-brand-gold last:border-0"
            >
              <ExternalLink size={15} className="shrink-0 text-text-muted" />
              {link.label}
            </a>
          )
        )}
      </div>
    ) : (
      <p className="py-2 text-sm italic tracking-[0.06em] text-text-muted">{emptyText}</p>
    )}
  </div>
)
