// Wiki 关系引擎 — 构建、解析、图算法

import { RELATION_TYPE_LABELS } from '../../lib/relationConstants';
import { CONTENT_LIMITS } from '../../lib/contentLimits';
import type {
  WikiRelationType,
  WikiRelationRecord,
  WikiRelationResolved,
  WikiRelationGraphNode,
  WikiRelationGraphEdge,
  WikiRelationPageLite,
  WikiReverseRelationEntry,
  WikiRelationBundle,
  ApiUser,
} from '../types';
import { WIKI_RELATION_SCAN_LIMIT } from '../types';
import { prisma } from './config';
import { parseBoolean, normalizeWikiSlug } from './parsers';
import { canViewWikiPage, buildWikiVisibilityWhere } from './authorization';
import { EnhancedCache, enhancedCache } from './cache';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const RELATION_LABEL_TO_TYPE: Record<string, WikiRelationType> = Object.fromEntries(
  Object.entries(RELATION_TYPE_LABELS).map(([type, label]) => [label, type as WikiRelationType])
);

// ---------------------------------------------------------------------------
// 关系规范化函数
// ---------------------------------------------------------------------------

export function normalizeWikiRelationType(value: unknown): WikiRelationType | null {
  if (value === 'related_person' || value === 'work_relation' || value === 'timeline_relation' || value === 'custom') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  const mapped = RELATION_LABEL_TO_TYPE[normalized];
  if (mapped) return mapped;
  return null;
}

export function normalizeWikiRelationLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, CONTENT_LIMITS.wiki.relationLabel);
}

export function normalizeWikiRelationList(value: unknown, sourceSlug?: string): WikiRelationRecord[] {
  if (Array.isArray(value)) {
    return doNormalizeArray(value, sourceSlug);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return doNormalizeArray(parsed, sourceSlug);
      }
    } catch {
      // JSON parse failed — fall through to default empty return
    }
  }

  if (value != null && typeof value !== 'string') {
    console.warn('[normalizeWikiRelationList] Unexpected non-array input, data dropped:', typeof value);
  }

  return [] as WikiRelationRecord[];
}

function doNormalizeArray(value: unknown[], sourceSlug: string | undefined): WikiRelationRecord[] {
  const normalizedSourceSlug = normalizeWikiSlug(sourceSlug);
  const deduped = new Set<string>();
  const relations: WikiRelationRecord[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;

    const type = normalizeWikiRelationType(record.type);
    if (!type) return;

    const targetSlug = normalizeWikiSlug(record.targetSlug);
    if (!targetSlug) return;
    if (normalizedSourceSlug && targetSlug === normalizedSourceSlug) return;

    const label = normalizeWikiRelationLabel(record.label);
    const bidirectional = parseBoolean(record.bidirectional, true);

    const dedupeKey = `${type}|${targetSlug}|${(label || '').toLowerCase()}`;
    if (deduped.has(dedupeKey)) return;
    deduped.add(dedupeKey);

    relations.push({
      type,
      targetSlug,
      label,
      bidirectional,
    });
  });

  return relations.slice(0, CONTENT_LIMITS.wiki.relations);
}

export async function normalizeWikiRelationListForWrite(value: unknown, sourceSlug?: string) {
  const normalizedSourceSlug = normalizeWikiSlug(sourceSlug);
  const relations = normalizeWikiRelationList(value, normalizedSourceSlug);
  if (!relations.length) {
    return [] as WikiRelationRecord[];
  }

  const uniqueTargets = [...new Set(relations.map((item) => item.targetSlug))];
  const existingTargets = await prisma.wikiPage.findMany({
    where: {
      deletedAt: null,
      slug: {
        in: uniqueTargets,
      },
    },
    select: {
      slug: true,
    },
  });
  const targetSet = new Set(existingTargets.map((item) => item.slug));
  return relations.filter((item) => targetSet.has(item.targetSlug));
}

export function serializeRelations(value: unknown, sourceSlug?: string) {
  return normalizeWikiRelationList(value, sourceSlug);
}

// ---------------------------------------------------------------------------
// 关系辅助函数
// ---------------------------------------------------------------------------

export function relationTypeLabel(type: WikiRelationType) {
  return RELATION_TYPE_LABELS[type] || '自定义关系';
}

export function relationIdentityKey(relation: Pick<WikiRelationRecord, 'type' | 'targetSlug' | 'label'>) {
  return `${relation.type}|${relation.targetSlug}|${(relation.label || '').toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// 关系构建函数
// ---------------------------------------------------------------------------

export function buildWikiReverseRelationIndex(pages: WikiRelationPageLite[]) {
  const index = new Map<string, WikiReverseRelationEntry[]>();

  pages.forEach((page) => {
    const relations = serializeRelations(page.relations, page.slug);
    relations.forEach((relation) => {
      if (!relation.bidirectional) return;
      const list = index.get(relation.targetSlug) || [];
      list.push({
        sourcePage: page,
        relation,
      });
      index.set(relation.targetSlug, list);
    });
  });

  return index;
}

export function buildResolvedWikiRelations(
  centerPage: WikiRelationPageLite,
  pageMap: Map<string, WikiRelationPageLite>,
  reverseIndex: Map<string, WikiReverseRelationEntry[]>,
) {
  const resolved: WikiRelationResolved[] = [];
  const seen = new Set<string>();

  const centerRelations = serializeRelations(centerPage.relations, centerPage.slug);
  centerRelations.forEach((relation) => {
    const target = pageMap.get(relation.targetSlug);
    if (!target) return;

    const key = relationIdentityKey({
      type: relation.type,
      targetSlug: target.slug,
      label: relation.label,
    });
    if (seen.has(key)) return;
    seen.add(key);

    resolved.push({
      type: relation.type,
      typeLabel: relationTypeLabel(relation.type),
      targetSlug: target.slug,
      targetTitle: target.title,
      targetCategory: target.category,
      label: relation.label,
      bidirectional: relation.bidirectional,
      inferred: false,
      sourceSlug: centerPage.slug,
      sourceTitle: centerPage.title,
    });
  });

  const reverseEntries = reverseIndex.get(centerPage.slug) || [];
  reverseEntries.forEach((entry) => {
    if (entry.sourcePage.slug === centerPage.slug) return;

    const key = relationIdentityKey({
      type: entry.relation.type,
      targetSlug: entry.sourcePage.slug,
      label: entry.relation.label,
    });
    if (seen.has(key)) return;
    seen.add(key);

    resolved.push({
      type: entry.relation.type,
      typeLabel: relationTypeLabel(entry.relation.type),
      targetSlug: entry.sourcePage.slug,
      targetTitle: entry.sourcePage.title,
      targetCategory: entry.sourcePage.category,
      label: entry.relation.label,
      bidirectional: entry.relation.bidirectional,
      inferred: true,
      sourceSlug: entry.sourcePage.slug,
      sourceTitle: entry.sourcePage.title,
    });
  });

  return resolved.sort((a, b) => {
    const typeCompare = a.typeLabel.localeCompare(b.typeLabel, 'zh-CN');
    if (typeCompare !== 0) return typeCompare;
    return a.targetTitle.localeCompare(b.targetTitle, 'zh-CN');
  });
}

export function buildWikiRelationGraph(
  centerPage: WikiRelationPageLite,
  pageMap: Map<string, WikiRelationPageLite>,
  reverseIndex: Map<string, WikiReverseRelationEntry[]>,
) {
  const edges: WikiRelationGraphEdge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (sourceSlug: string, targetSlug: string, relation: WikiRelationRecord, inferred: boolean) => {
    if (sourceSlug === targetSlug) return;
    if (!pageMap.has(sourceSlug) || !pageMap.has(targetSlug)) return;

    const edgeKey = `${sourceSlug}|${targetSlug}|${relation.type}|${(relation.label || '').toLowerCase()}`;
    if (edgeSet.has(edgeKey)) return;
    edgeSet.add(edgeKey);

    edges.push({
      sourceSlug,
      targetSlug,
      type: relation.type,
      typeLabel: relationTypeLabel(relation.type),
      label: relation.label || null,
      inferred,
    });
  };

  const centerRelations = serializeRelations(centerPage.relations, centerPage.slug);
  centerRelations.forEach((relation) => addEdge(centerPage.slug, relation.targetSlug, relation, false));

  const centerReverse = reverseIndex.get(centerPage.slug) || [];
  centerReverse.forEach((entry) => addEdge(entry.sourcePage.slug, centerPage.slug, entry.relation, true));

  const firstLayer = new Set<string>();
  edges.forEach((edge) => {
    if (edge.sourceSlug === centerPage.slug) {
      firstLayer.add(edge.targetSlug);
    }
    if (edge.targetSlug === centerPage.slug) {
      firstLayer.add(edge.sourceSlug);
    }
  });

  firstLayer.forEach((slug) => {
    const page = pageMap.get(slug);
    if (!page) return;

    const relations = serializeRelations(page.relations, page.slug);
    relations.forEach((relation) => addEdge(page.slug, relation.targetSlug, relation, false));

    const reverseEntries = reverseIndex.get(page.slug) || [];
    reverseEntries.forEach((entry) => addEdge(entry.sourcePage.slug, page.slug, entry.relation, true));
  });

  const adjacency = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const sourceNeighbors = adjacency.get(edge.sourceSlug) || new Set<string>();
    sourceNeighbors.add(edge.targetSlug);
    adjacency.set(edge.sourceSlug, sourceNeighbors);

    const targetNeighbors = adjacency.get(edge.targetSlug) || new Set<string>();
    targetNeighbors.add(edge.sourceSlug);
    adjacency.set(edge.targetSlug, targetNeighbors);
  });

  const depthMap = new Map<string, number>();
  depthMap.set(centerPage.slug, 0);
  const queue: string[] = [centerPage.slug];

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const currentDepth = depthMap.get(current);
    if (currentDepth === undefined || currentDepth >= 2) continue;

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    neighbors.forEach((nextSlug) => {
      if (depthMap.has(nextSlug)) return;
      const nextDepth = currentDepth + 1;
      if (nextDepth > 2) return;
      depthMap.set(nextSlug, nextDepth);
      queue.push(nextSlug);
    });
  }

  const nodes: WikiRelationGraphNode[] = [];
  depthMap.forEach((depth, slug) => {
    const page = pageMap.get(slug);
    if (!page) return;

    nodes.push({
      slug,
      title: page.title,
      category: page.category,
      depth: depth as 0 | 1 | 2,
      isCenter: slug === centerPage.slug,
    });
  });

  const nodeSet = new Set(nodes.map((node) => node.slug));
  const filteredEdges = edges.filter((edge) => nodeSet.has(edge.sourceSlug) && nodeSet.has(edge.targetSlug));

  nodes.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.isCenter !== b.isCenter) return a.isCenter ? -1 : 1;
    return a.title.localeCompare(b.title, 'zh-CN');
  });

  return {
    nodes,
    edges: filteredEdges,
  };
}

export async function findWikiRelationCenterPage(slug: string, authUser?: ApiUser) {
  const centerPage = await prisma.wikiPage.findFirst({
    where: { slug, deletedAt: null },
    select: {
      slug: true,
      title: true,
      category: true,
      status: true,
      lastEditorUid: true,
      relations: true,
    },
  });

  if (!centerPage || !canViewWikiPage(centerPage, authUser)) {
    return null;
  }

  return centerPage as WikiRelationPageLite;
}

export function clearWikiRelationCache() {
  enhancedCache.invalidateByPrefix('wiki_relation_bundle:')
}

export async function buildWikiRelationBundle(centerPage: WikiRelationPageLite, authUser?: ApiUser): Promise<WikiRelationBundle> {
  const visibilityKey = authUser ? `user:${authUser.uid}:${authUser.role}:${authUser.status}` : 'public'
  const cacheKey = EnhancedCache.generateKey(
    'wiki_relation_bundle',
    centerPage.slug,
    visibilityKey
  )
  const cached = enhancedCache.get<WikiRelationBundle>(cacheKey)
  if (cached) return cached

  const visibilityWhere = buildWikiVisibilityWhere(authUser);

  const relationPages = await prisma.wikiPage.findMany({
    where: visibilityWhere,
    select: {
      slug: true,
      title: true,
      category: true,
      status: true,
      lastEditorUid: true,
      relations: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: WIKI_RELATION_SCAN_LIMIT,
  });

  const pageMap = new Map<string, WikiRelationPageLite>();
  relationPages.forEach((page) => {
    pageMap.set(page.slug, page as WikiRelationPageLite);
  });

  if (!pageMap.has(centerPage.slug)) {
    pageMap.set(centerPage.slug, centerPage);
  }

  const directTargetSlugs = [...new Set(serializeRelations(centerPage.relations, centerPage.slug).map((item) => item.targetSlug))];
  const missingDirectTargets = directTargetSlugs.filter((slug) => !pageMap.has(slug));

  if (missingDirectTargets.length) {
    const extraPages = await prisma.wikiPage.findMany({
      where: {
        ...visibilityWhere,
        slug: { in: missingDirectTargets },
      },
      select: {
        slug: true,
        title: true,
        category: true,
        status: true,
        lastEditorUid: true,
        relations: true,
      },
    });

    extraPages.forEach((page) => {
      pageMap.set(page.slug, page as WikiRelationPageLite);
    });
  }

  const allPages = [...pageMap.values()];
  const reverseIndex = buildWikiReverseRelationIndex(allPages);
  const relations = buildResolvedWikiRelations(centerPage, pageMap, reverseIndex);
  const graph = buildWikiRelationGraph(centerPage, pageMap, reverseIndex);

  const result = {
    centerPage,
    relations,
    graph,
  }

  enhancedCache.set(cacheKey, result, 300)

  return result
}
