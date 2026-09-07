import { useMemo } from 'react'
import { EChart } from './EChart'
import type { ChartOption } from './EChart'
import { hexToRgba, useChartTheme } from './useChartTheme'
import type { ChartThemeTokens } from './useChartTheme'
import type { AdminDashboardTrends } from '../../types/api'

type TrendSeriesKey = keyof AdminDashboardTrends['series']
type TrendColorToken = 'brandGold' | 'info' | 'success' | 'error'

const SERIES_DEFS: { key: TrendSeriesKey; label: string; colorToken: TrendColorToken }[] = [
  { key: 'posts', label: '文章', colorToken: 'brandGold' },
  { key: 'galleries', label: '图库', colorToken: 'info' },
  { key: 'wiki', label: '百科', colorToken: 'success' },
  { key: 'users', label: '用户', colorToken: 'error' },
]

export interface TrendChartProps {
  dates: string[]
  series: AdminDashboardTrends['series']
}

export function TrendChart({ dates, series }: TrendChartProps) {
  const tokens = useChartTheme()

  const option = useMemo<ChartOption>(() => {
    return {
      grid: { left: 8, right: 16, top: 40, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 3,
        itemGap: 16,
        textStyle: { color: tokens.textSecondary, fontSize: 12 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: tokens.surface,
        borderColor: tokens.border,
        textStyle: { color: tokens.textPrimary, fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: tokens.border } },
        axisTick: { show: false },
        axisLabel: {
          color: tokens.textMuted,
          fontSize: 11,
          formatter: (value: string) => value.slice(5),
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: tokens.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: hexToRgba(tokens.border, 0.55) } },
      },
      series: SERIES_DEFS.map(({ key, label, colorToken }) => {
        const color = tokens[colorToken]
        return {
          name: label,
          type: 'line' as const,
          data: series[key],
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          emphasis: { focus: 'series' as const },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexToRgba(color, 0.16) },
                { offset: 1, color: hexToRgba(color, 0.02) },
              ],
            },
          },
        }
      }),
    }
  }, [dates, series, tokens])

  return <EChart option={option} height={300} ariaLabel="近 30 天内容新增趋势折线图" />
}

export default TrendChart
