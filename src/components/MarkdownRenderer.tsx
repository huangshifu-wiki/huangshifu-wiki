import React, { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { Pluggable } from 'unified'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrism from 'rehype-prism-plus/common'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { remarkAlert } from 'remark-github-blockquote-alert'
import { customSchema, isTrustedIframeDomain } from '../lib/htmlSanitizer'
import { processWikiLinksForPreview } from '../lib/markdownWikiLinks'
import { splitMentionText, type MentionTarget } from '../lib/mentions'
import WikiLinkPreview from './WikiLinkPreview'

interface MarkdownRendererProps {
  content: string
  enableWikiLinks?: boolean
  enableMentions?: boolean
  mentionTargets?: MentionTarget[]
}

interface HastNode {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

interface MdastNode {
  type?: string
  meta?: string | null
  value?: string
  url?: string
  data?: {
    hProperties?: Record<string, unknown>
  }
  children?: MdastNode[]
}

const headingAnchor = {
  behavior: 'append',
  properties: {
    className: ['markdown-heading-anchor'],
    ariaHidden: 'true',
    tabIndex: -1,
  },
  content: {
    type: 'text',
    value: '#',
  },
} as const

const walkHast = (node: HastNode, visitor: (node: HastNode) => void) => {
  visitor(node)
  node.children?.forEach((child) => walkHast(child, visitor))
}

const rehypeRepairHashLinks = () => (tree: HastNode) => {
  const ids = new Set<string>()

  walkHast(tree, (node) => {
    const id = node.properties?.id
    if (typeof id === 'string') {
      ids.add(id)
    }
  })

  walkHast(tree, (node) => {
    if (node.tagName !== 'a') return

    const href = node.properties?.href
    if (typeof href !== 'string' || !href.startsWith('#')) return

    const target = href.slice(1)
    if (ids.has(target)) return

    const prefixedTarget = `user-content-${target}`
    if (ids.has(prefixedTarget)) {
      node.properties = {
        ...node.properties,
        href: `#${prefixedTarget}`,
      }
    }
  })
}

const rehypePreserveCodeMeta = () => (tree: HastNode) => {
  walkHast(tree, (node) => {
    if (node.tagName !== 'code') return

    const data = (node as HastNode & { data?: { meta?: unknown } }).data
    if (typeof data?.meta === 'string') {
      node.properties = {
        ...node.properties,
        dataMeta: data.meta,
      }
    }
  })
}

const rehypeRestoreCodeMeta = () => (tree: HastNode) => {
  walkHast(tree, (node) => {
    if (node.tagName !== 'code') return

    const dataMeta = node.properties?.dataMeta
    if (typeof dataMeta !== 'string') return

    const mutableNode = node as HastNode & { data?: { meta?: string } }
    mutableNode.data = {
      ...(mutableNode.data ?? {}),
      meta: dataMeta,
    }
    delete node.properties?.dataMeta
  })
}

const remarkPreserveCodeMeta = () => (tree: MdastNode) => {
  const walk = (node: MdastNode) => {
    if (node.type === 'code' && node.meta) {
      node.data = {
        ...(node.data ?? {}),
        hProperties: {
          ...(node.data?.hProperties ?? {}),
          metastring: node.meta,
        },
      }
    }

    node.children?.forEach(walk)
  }

  walk(tree)
}

const rehypeRemoveCodeMetaAttribute = () => (tree: HastNode) => {
  walkHast(tree, (node) => {
    if (node.tagName === 'code' && node.properties) {
      delete node.properties.metastring
    }
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const remarkMentions = (targets: MentionTarget[]) => (tree: MdastNode) => {
  const walk = (node: MdastNode, ancestors: MdastNode[]) => {
    if (!node.children?.length) return

    node.children = node.children.flatMap((child) => {
      if (child.type !== 'text' || typeof child.value !== 'string') {
        walk(child, [...ancestors, node])
        return [child]
      }

      const insideIgnoredParent = [...ancestors, node].some((ancestor) =>
        ['link', 'linkReference', 'inlineCode', 'code'].includes(ancestor.type || '')
      )
      if (insideIgnoredParent) return [child]

      const segments = splitMentionText(child.value, targets)
      if (segments.length === 1 && segments[0].type === 'text') return [child]

      return segments.map((segment): MdastNode => {
        if (segment.type === 'text') {
          return { type: 'text', value: segment.text }
        }

        if (segment.target) {
          return {
            type: 'link',
            url: `/users/${segment.target.uid}`,
            children: [{ type: 'text', value: segment.text }],
          }
        }

        return {
          type: 'html',
          value: `<span class="mention-highlight">${escapeHtml(segment.text)}</span>`,
        }
      })
    })
  }

  walk(tree, [])
}

const markdownComponents: Components = {
  iframe: ({
    src,
    width,
    height,
    node: _node,
    ...props
  }: React.IframeHTMLAttributes<HTMLIFrameElement> & { node?: unknown }) => {
    if (!isTrustedIframeDomain(src)) {
      return null
    }

    return <iframe src={src} width={width || '100%'} height={height || '400px'} {...props} />
  },
  a: ({ href, children, className, node: _node, ...props }) => {
    if (href?.startsWith('#')) {
      return (
        <a {...props} href={href} className={className}>
          {children}
        </a>
      )
    }

    if (href?.startsWith('/wiki/')) {
      const rawSlug = href.replace('/wiki/', '')
      const slug = rawSlug.split('?')[0]
      return (
        <WikiLinkPreview slug={slug}>
          <Link
            {...props}
            to={href}
            className="text-brand-gold font-bold hover:underline decoration-brand-gold/30 underline-offset-4"
          >
            {children}
          </Link>
        </WikiLinkPreview>
      )
    }

    if (href?.startsWith('/users/')) {
      return (
        <Link {...props} to={href} className="mention-highlight">
          {children}
        </Link>
      )
    }

    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-gold hover:underline"
      >
        {children}
      </a>
    )
  },
  table: ({ children, node: _node, ...props }) => (
    <div className="overflow-x-auto my-8">
      <table
        {...props}
        className="w-full border-collapse border border-border rounded overflow-hidden"
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, node: _node, ...props }) => (
    <thead {...props} className="bg-surface-alt text-brand-gold">
      {children}
    </thead>
  ),
  th: ({ children, node: _node, ...props }) => (
    <th {...props} className="border border-border px-4 py-3 text-left font-bold">
      {children}
    </th>
  ),
  td: ({ children, node: _node, ...props }) => (
    <td {...props} className="border border-border px-4 py-3">
      {children}
    </td>
  ),
  tr: ({ children, node: _node, ...props }) => (
    <tr {...props} className="hover:bg-surface-alt transition-colors">
      {children}
    </tr>
  ),
}

export default function MarkdownRenderer({
  content,
  enableWikiLinks = false,
  enableMentions = false,
  mentionTargets = [],
}: MarkdownRendererProps) {
  const processedContent = useMemo(() => {
    const raw = content || ''
    return enableWikiLinks ? processWikiLinksForPreview(raw) : raw
  }, [content, enableWikiLinks])
  const mentionPlugins: Pluggable[] = enableMentions ? [[remarkMentions, mentionTargets]] : []

  return (
    <ReactMarkdown
      remarkPlugins={[remarkAlert, remarkPreserveCodeMeta, ...mentionPlugins, remarkGfm]}
      rehypePlugins={[
        rehypeRaw,
        rehypeSlug,
        [rehypeAutolinkHeadings, headingAnchor],
        rehypePreserveCodeMeta,
        [rehypeSanitize, customSchema],
        rehypeRepairHashLinks,
        rehypeRestoreCodeMeta,
        [rehypePrism, { ignoreMissing: true }],
        rehypeRemoveCodeMetaAttribute,
      ]}
      components={markdownComponents}
    >
      {processedContent}
    </ReactMarkdown>
  )
}
