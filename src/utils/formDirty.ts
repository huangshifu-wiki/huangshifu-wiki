/**
 * 表单脏检查：将两份表单数据做键序无关的深度比较。
 * undefined 属性与缺失键视为相同，避免"字段未设置"与"字段为 undefined"误报差异。
 */
function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalize)
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key]
    if (item === undefined) continue
    result[key] = normalize(item)
  }
  return result
}

export function hasFormChanges(current: unknown, baseline: unknown): boolean {
  return JSON.stringify(normalize(current)) !== JSON.stringify(normalize(baseline))
}
