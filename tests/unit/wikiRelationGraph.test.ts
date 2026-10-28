import { describe, expect, it } from 'vitest'
import {
  RELATION_GRAPH_TYPE_COLORS,
  buildMiniRelationGraphData,
  getRelationGraphEdgeColor,
  getRelationGraphEdgeLabel,
  layoutRelationGraphRadial,
  truncateGraphLabel,
} from '../../src/lib/wikiRelationGraph'

describe('wikiRelationGraph', () => {
  it('truncates graph labels with ASCII ellipsis', () => {
    expect(truncateGraphLabel('黄师傅百科关系图谱', 5)).toBe('黄师傅百科...')
    expect(truncateGraphLabel('短标题', 5)).toBe('短标题')
  })

  it('falls back from explicit edge label to relation type label', () => {
    expect(
      getRelationGraphEdgeLabel({
        type: 'work_relation',
        typeLabel: '作品关联',
        label: '合作作品',
      })
    ).toBe('合作作品')
    expect(
      getRelationGraphEdgeLabel({
        type: 'work_relation',
        typeLabel: '作品关联',
        label: ' ',
      })
    ).toBe('作品关联')
  })

  it('uses one shared color palette for relation types', () => {
    expect(getRelationGraphEdgeColor('related_person')).toBe(
      RELATION_GRAPH_TYPE_COLORS.related_person
    )
    expect(getRelationGraphEdgeColor('timeline_relation')).toBe('#4682B4')
  })

  it('builds mini graph data from editor relations and metadata', () => {
    const metadata = new Map([['album-a', { slug: 'album-a', title: '专辑 A', category: 'music' }]])

    const graph = buildMiniRelationGraphData({
      relations: [
        { type: 'work_relation', targetSlug: 'album-a', label: ' ' },
        { type: 'custom', targetSlug: 'missing-page', label: '补充资料' },
      ],
      metadata,
      currentSlug: 'center-page',
      currentTitle: '中心页面',
    })

    expect(graph.nodes).toEqual([
      {
        slug: 'center-page',
        title: '中心页面',
        category: '',
        depth: 0,
        isCenter: true,
      },
      {
        slug: 'album-a',
        title: '专辑 A',
        category: 'music',
        depth: 1,
        isCenter: false,
      },
      {
        slug: 'missing-page',
        title: '补充资料',
        category: '',
        depth: 1,
        isCenter: false,
      },
    ])
    expect(graph.edges[0]).toMatchObject({
      sourceSlug: 'center-page',
      targetSlug: 'album-a',
      type: 'work_relation',
      typeLabel: '作品关联',
      label: null,
      inferred: false,
    })
  })

  it('lays out graph nodes radially from the center', () => {
    const nodes = layoutRelationGraphRadial(
      {
        nodes: [
          {
            slug: 'center',
            title: 'Center',
            category: '',
            depth: 0,
            isCenter: true,
          },
          {
            slug: 'a',
            title: 'A',
            category: '',
            depth: 1,
            isCenter: false,
          },
          {
            slug: 'b',
            title: 'B',
            category: '',
            depth: 1,
            isCenter: false,
          },
        ],
        edges: [],
      },
      { width: 600, height: 300, pan: { x: 10, y: -20 } }
    )

    expect(nodes[0]).toMatchObject({ slug: 'center', x: 310, y: 130 })
    expect(nodes[1].x).toBeCloseTo(310)
    expect(nodes[1].y).toBeCloseTo(10)
    expect(nodes[2].x).toBeCloseTo(310)
    expect(nodes[2].y).toBeCloseTo(250)
  })
})
