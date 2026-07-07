import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Network, DataSet } from 'vis-network/standalone'
import type { WikiRelationType } from './types'
import { RELATION_TYPE_LABELS } from './types'
import {
  RELATION_GRAPH_TYPE_COLORS,
  getRelationGraphEdgeColor,
  getRelationGraphEdgeLabel,
  getRelationGraphNodeStyle,
  isRelationGraphNodeClickable,
  truncateGraphLabel,
  type RelationGraphData,
} from '../../lib/wikiRelationGraph'
import { RELATION_GRAPH_COLOR_TOKENS } from '../../lib/colorTokens'

export type {
  RelationGraphData,
  RelationGraphEdge,
  RelationGraphNode,
} from '../../lib/wikiRelationGraph'

type RelationGraphProps = {
  graph: RelationGraphData
  currentSlug: string
  onNodeClick?: (slug: string) => void
}

const RELATION_GRAPH_SHADOWS = {
  node: RELATION_GRAPH_COLOR_TOKENS.shadows.node,
  edge: RELATION_GRAPH_COLOR_TOKENS.shadows.edge,
  edgeStroke: RELATION_GRAPH_COLOR_TOKENS.shadows.edgeStroke,
} as const

const RelationGraph = ({ graph, currentSlug, onNodeClick }: RelationGraphProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const [cursor, setCursor] = useState<string>('grab')

  const handleClick = useCallback(
    (slug: string) => {
      if (isRelationGraphNodeClickable(slug, currentSlug) && onNodeClick) {
        onNodeClick(slug)
      }
    },
    [currentSlug, onNodeClick]
  )

  useEffect(() => {
    if (!containerRef.current || !graph.nodes.length) return

    const nodes = new DataSet(
      graph.nodes.map((node) => {
        const isCenter = node.slug === currentSlug || node.isCenter
        const nodeStyle = getRelationGraphNodeStyle({ ...node, isCenter })

        return {
          id: node.slug,
          label: truncateGraphLabel(node.title, nodeStyle.labelLength),
          title: node.title,
          color: {
            background: nodeStyle.background,
            border: nodeStyle.border,
            highlight: {
              background: nodeStyle.highlightBackground,
              border: nodeStyle.highlightBorder,
            },
          },
          shape: 'dot',
          size: nodeStyle.size,
          font: {
            color: nodeStyle.fontColor,
            size: nodeStyle.fontSize,
            face: 'serif',
            strokeWidth: 0,
          },
          shadow: {
            enabled: true,
            color: RELATION_GRAPH_SHADOWS.node,
            size: 10,
            x: 0,
            y: 0,
          },
          borderWidth: nodeStyle.borderWidth,
          fixed: isCenter,
        }
      })
    )

    const edges = new DataSet(
      graph.edges.map((edge) => {
        const edgeColor = getRelationGraphEdgeColor(edge.type)

        return {
          id: `${edge.sourceSlug}-${edge.targetSlug}-${edge.type}-${edge.label || 'none'}`,
          from: edge.sourceSlug,
          to: edge.targetSlug,
          label: truncateGraphLabel(getRelationGraphEdgeLabel(edge), 12),
          color: {
            color: edgeColor,
            highlight: edgeColor,
          },
          dashes: edge.inferred,
          arrows: 'to',
          font: {
            color: edgeColor,
            size: 12,
            face: 'sans',
            strokeWidth: 2,
            strokeColor: RELATION_GRAPH_SHADOWS.edgeStroke,
            align: 'middle',
          },
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0,
          },
          shadow: {
            enabled: true,
            color: RELATION_GRAPH_SHADOWS.edge,
            size: 4,
          },
        }
      })
    )

    const options = {
      nodes: {
        shape: 'dot',
        scaling: {
          min: 20,
          max: 50,
        },
      },
      edges: {
        width: 2,
        smooth: {
          enabled: true,
          type: 'continuous',
          roundness: 0.5,
        },
      },
      layout: {
        randomSeed: 42,
      },
      physics: {
        enabled: true,
        barnesHut: {
          gravitationalConstant: -3000,
          centralGravity: 0.3,
          springLength: 150,
          springConstant: 0.04,
          damping: 0.09,
        },
        stabilization: {
          enabled: true,
          iterations: 150,
          updateInterval: 50,
        },
      },
      interaction: {
        hover: true,
        dragNodes: true,
        dragView: true,
        zoomView: true,
        zoomSpeed: 0.5,
        hideEdgesOnZoom: true,
        keyboard: false,
        tooltipDelay: 200,
      },
      manipulation: false,
    }

    const network = new Network(containerRef.current, { nodes, edges }, options)
    networkRef.current = network

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0] as string
        handleClick(nodeId)
      }
    })

    if (containerRef.current) {
      setCursor('grab')
    }
    network.on('hoverNode', (params) => {
      if (containerRef.current) {
        const nodeId = String(params.node)
        setCursor(isRelationGraphNodeClickable(nodeId, currentSlug) ? 'pointer' : 'grab')
      }
    })
    network.on('blurNode', () => {
      setCursor('grab')
    })
    network.on('dragStart', () => {
      setCursor('grabbing')
    })
    network.on('dragEnd', () => {
      setCursor('grab')
    })

    return () => {
      network.off('click')
      network.off('hoverNode')
      network.off('blurNode')
      network.off('dragStart')
      network.off('dragEnd')
      setCursor('grab')
      network.destroy()
      networkRef.current = null
    }
  }, [graph, currentSlug, handleClick])

  if (!graph.nodes.length) {
    return <div className="text-sm text-text-muted">暂无可展示的关系图谱。</div>
  }

  return (
    <div className="border-y border-[var(--book-ink-line)] bg-transparent py-6 sm:py-8">
      <div
        ref={containerRef}
        className={`w-full h-[400px] sm:h-[500px] cursor-${cursor}`}
        role="img"
        aria-label="Wiki 关系图谱"
      />

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        {(Object.entries(RELATION_TYPE_LABELS) as [WikiRelationType, string][]).map(
          ([type, label]) => (
            <div
              key={type}
              className="inline-flex items-center gap-2 rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-3 py-1.5"
            >
              <span
                className={`inline-block h-3 w-3 rounded`}
                style={{ backgroundColor: RELATION_GRAPH_TYPE_COLORS[type] }}
              />
              <span className="text-text-secondary font-medium">{label}</span>
            </div>
          )
        )}
        <div className="inline-flex items-center gap-2 rounded-sm border border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] px-3 py-1.5">
          <span className="text-text-muted font-medium">虚线表示反向推断关系</span>
        </div>
      </div>
    </div>
  )
}

export default RelationGraph
