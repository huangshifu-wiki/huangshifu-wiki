import { useEffect, useState } from 'react'

export interface ChartThemeTokens {
  textPrimary: string
  textSecondary: string
  textMuted: string
  border: string
  surface: string
  brandGold: string
  success: string
  warning: string
  error: string
  info: string
}

// 图表配色统一取自主题语义 CSS 变量，不在组件里写死颜色
const CHART_TOKEN_VARS: Record<keyof ChartThemeTokens, string> = {
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textMuted: '--color-text-muted',
  border: '--color-border',
  surface: '--color-surface',
  brandGold: '--color-brand-gold',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
  info: '--color-info',
}

export function hexToRgba(color: string, alpha: number): string {
  const hex = color.trim().replace(/^#/, '')
  const fullHex =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) return color
  const r = parseInt(fullHex.slice(0, 2), 16)
  const g = parseInt(fullHex.slice(2, 4), 16)
  const b = parseInt(fullHex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function readChartTokens(): ChartThemeTokens {
  const styles = getComputedStyle(document.documentElement)
  return (Object.keys(CHART_TOKEN_VARS) as (keyof ChartThemeTokens)[]).reduce((tokens, key) => {
    tokens[key] = styles.getPropertyValue(CHART_TOKEN_VARS[key]).trim()
    return tokens
  }, {} as ChartThemeTokens)
}

// 读取主题语义 CSS 变量作为图表配色，并跟随 data-theme 属性切换明暗两套配色
export function useChartTheme(): ChartThemeTokens {
  const [tokens, setTokens] = useState<ChartThemeTokens>(readChartTokens)

  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(readChartTokens()))
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return tokens
}
