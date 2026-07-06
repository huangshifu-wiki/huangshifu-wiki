export const THEME_META_COLOR = {
  default: '#b07b17',
  dark: '#0c0c12',
} as const

export const CHART_COLOR_TOKENS = {
  series: {
    brandGold: '#b07b17',
    brandOlive: '#6b6560',
    success: '#22C55E',
    info: '#3B82F6',
    accent: '#5856D6',
  },
  axis: '#E5DED1',
  label: '#6B7280',
  splitLine: '#F5F5F5',
  tooltipBackground: 'rgba(255, 255, 255, 0.95)',
  tooltipBorder: '#E5DED1',
  tooltipText: '#111827',
  white: '#fff',
  linePrimary: '#3B82F6',
  linePrimarySoft: 'rgba(59, 130, 246, 0.3)',
  linePrimarySoftEnd: 'rgba(59, 130, 246, 0.05)',
  barStart: '#d4a843',
  barEnd: '#b07b17',
} as const

export const RELATION_GRAPH_COLOR_TOKENS = {
  common: {
    fontLight: '#ffffff',
    fontDark: '#2F2F2F',
    borderWarm: '#D2B48C',
    highlightWarm: '#DAA520',
    layerWarm: '#DEB887',
    layerWarmHighlight: '#E6C89C',
  },
  relatedPerson: {
    edge: '#6B8E23',
    background: '#6B8E23',
    border: '#556B2F',
    highlightBackground: '#8FBC8F',
    highlightBorder: '#6B8E23',
  },
  workRelation: {
    edge: '#CD853F',
    background: '#F4A460',
    highlightBackground: '#FFA07A',
  },
  timelineRelation: {
    edge: '#4682B4',
  },
  custom: {
    edge: '#9370DB',
  },
  shadows: {
    node: 'rgba(0,0,0,0.2)',
    edge: 'rgba(0,0,0,0.1)',
    edgeStroke: '#ffffff',
    label: '0 1px 2px rgba(255,255,255,0.8)',
    nodeFilter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))',
    centerText: '0 1px 2px rgba(0,0,0,0.2)',
  },
} as const
