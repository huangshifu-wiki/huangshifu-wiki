import React, { useEffect, useRef, useCallback } from 'react';
import { Network, DataSet } from 'vis-network/standalone';
import { clsx } from 'clsx';
import type { WikiRelationType } from './types';
import { RELATION_TYPE_LABELS } from './types';

export type RelationGraphNode = {
  slug: string;
  title: string;
  category: string;
  depth: 0 | 1 | 2;
  isCenter: boolean;
};

export type RelationGraphEdge = {
  sourceSlug: string;
  targetSlug: string;
  type: WikiRelationType;
  typeLabel: string;
  label: string | null;
  inferred: boolean;
};

export type RelationGraphData = {
  nodes: RelationGraphNode[];
  edges: RelationGraphEdge[];
};

type RelationGraphProps = {
  graph: RelationGraphData;
  currentSlug: string;
  onNodeClick?: (slug: string) => void;
};

const NODE_COLORS: Record<WikiRelationType, string> = {
  related_person: '#6B8E23',
  work_relation: '#CD853F',
  timeline_relation: '#4682B4',
  custom: '#9370DB',
};

const EDGE_COLORS: Record<WikiRelationType, string> = {
  related_person: '#6B8E23',
  work_relation: '#CD853F',
  timeline_relation: '#4682B4',
  custom: '#9370DB',
};

const RelationGraph = ({ graph, currentSlug, onNodeClick }: RelationGraphProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);

  const handleClick = useCallback((slug: string) => {
    if (slug !== currentSlug && onNodeClick) {
      onNodeClick(slug);
    }
  }, [currentSlug, onNodeClick]);

  useEffect(() => {
    if (!containerRef.current || !graph.nodes.length) return;

    const nodes = new DataSet(
      graph.nodes.map((node) => {
        const isCenter = node.slug === currentSlug || node.isCenter;
        const baseColor = isCenter ? '#6B8E23' : node.depth === 1 ? '#F4A460' : '#DEB887';
        
        return {
          id: node.slug,
          label: node.title.length > 12 ? node.title.slice(0, 12) + '...' : node.title,
          title: node.title,
          color: {
            background: baseColor,
            border: isCenter ? '#556B2F' : '#D2B48C',
            highlight: {
              background: isCenter ? '#8FBC8F' : node.depth === 1 ? '#FFA07A' : '#E6C89C',
              border: isCenter ? '#6B8E23' : '#DAA520',
            },
          },
          shape: 'dot',
          size: isCenter ? 40 : node.depth === 1 ? 30 : 25,
          font: {
            color: isCenter ? '#ffffff' : '#2F2F2F',
            size: isCenter ? 16 : 14,
            face: 'serif',
            strokeWidth: 0,
          },
          shadow: {
            enabled: true,
            color: 'rgba(0,0,0,0.2)',
            size: 10,
            x: 0,
            y: 0,
          },
          borderWidth: isCenter ? 3 : 2,
          fixed: isCenter,
        };
      })
    );

    const edges = new DataSet(
      graph.edges.map((edge) => {
        const edgeColor = EDGE_COLORS[edge.type] || '#7b8a70';
        
        return {
          id: `${edge.sourceSlug}-${edge.targetSlug}-${edge.type}-${edge.label || 'none'}`,
          from: edge.sourceSlug,
          to: edge.targetSlug,
          label: edge.label || edge.typeLabel,
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
            strokeColor: '#ffffff',
            align: 'middle',
          },
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0,
          },
          shadow: {
            enabled: true,
            color: 'rgba(0,0,0,0.1)',
            size: 4,
          },
        };
      })
    );

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
        hover: false,
        dragNodes: true,
        dragView: true,
        zoomView: true,
        zoomSpeed: 0.5,
        hideEdgesOnZoom: true,
        keyboard: false,
        tooltipDelay: 200,
      },
      manipulation: false,
    };

    const network = new Network(containerRef.current, { nodes, edges }, options);
    networkRef.current = network;

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0] as string;
        handleClick(nodeId);
      }
    });

    // Set a consistent grab cursor for drag interactions
    if (containerRef.current) {
      containerRef.current.style.cursor = 'grab';
    }
    network.on('dragStart', () => {
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grabbing';
      }
    });
    network.on('dragEnd', () => {
      if (containerRef.current) {
        containerRef.current.style.cursor = 'grab';
      }
    });

    return () => {
      network.destroy();
      networkRef.current = null;
    };
  }, [graph, currentSlug, handleClick]);

  if (!graph.nodes.length) {
    return <div className="text-sm text-[#9e968e]">暂无可展示的关系图谱。</div>;
  }

  return (
    <div className="rounded border border-[#c8951e]/20 bg-gradient-to-br from-[#f7f5f0] to-white p-6 sm:p-8">
      <div
        ref={containerRef}
        className="w-full h-[400px] sm:h-[500px]"
        role="img"
        aria-label="Wiki 关系图谱"
      />

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        {(Object.entries(RELATION_TYPE_LABELS) as [WikiRelationType, string][]).map(([type, label]) => (
          <div key={type} className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#f7f5f0] rounded">
            <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: NODE_COLORS[type] }} />
            <span className="text-[#6b6560] font-medium">{label}</span>
          </div>
        ))}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#f7f5f0]/50 rounded">
          <span className="text-[#9e968e] font-medium">虚线表示反向推断关系</span>
        </div>
      </div>
    </div>
  );
};

export default RelationGraph;
