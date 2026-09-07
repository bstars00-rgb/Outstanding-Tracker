import { useMemo } from 'react';
import { useTheme } from '@app/theme/useTheme';

/** Light-theme defaults; the live values come from the CSS variables in styles.css (dark palette included). */
const LIGHT = {
  accent: '#1d4ed8',
  muted: '#94a3b8',
  grid: '#e2e8f0',
  axis: '#cbd5e1',
  text: '#56606f',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dfe4ec',
  cursor: 'rgba(29, 78, 216, 0.08)',
  buckets: {
    CURRENT: '#93c5fd',
    D1_7: '#60a5fa',
    D8_14: '#fcd34d',
    D15_30: '#f59e0b',
    D31_60: '#f97316',
    D61_90: '#ef4444',
    D90_PLUS: '#991b1b',
    UNKNOWN: '#9ca3af',
  } as Record<string, string>,
};

export type ChartColors = typeof LIGHT;

function cssVar(style: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const v = style?.getPropertyValue(name).trim();
  return v && v.length > 0 ? v : fallback;
}

/** Read the chart palette from the CSS variables currently applied to <html>. */
export function readChartColors(): ChartColors {
  const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(document.documentElement) : null;
  const buckets: Record<string, string> = {};
  for (const k of Object.keys(LIGHT.buckets)) buckets[k] = cssVar(style, `--bucket-${k}`, LIGHT.buckets[k]);
  return {
    accent: cssVar(style, '--chart-accent', LIGHT.accent),
    muted: cssVar(style, '--chart-muted', LIGHT.muted),
    grid: cssVar(style, '--chart-grid', LIGHT.grid),
    axis: cssVar(style, '--chart-axis', LIGHT.axis),
    text: cssVar(style, '--chart-text', LIGHT.text),
    tooltipBg: cssVar(style, '--chart-tooltip-bg', LIGHT.tooltipBg),
    tooltipBorder: cssVar(style, '--chart-tooltip-border', LIGHT.tooltipBorder),
    cursor: cssVar(style, '--chart-cursor', LIGHT.cursor),
    buckets,
  };
}

/** Theme-aware chart palette; re-read whenever the theme toggles. */
export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readChartColors(), [theme]);
}

/** Recharts prop bundles so every chart styles axes/grid/tooltip consistently. */
export function chartProps(c: ChartColors) {
  return {
    grid: { stroke: c.grid },
    axis: { stroke: c.axis, tick: { fill: c.text }, tickLine: { stroke: c.axis } },
    tooltip: {
      contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, color: c.text },
      labelStyle: { color: c.text, fontWeight: 600 },
      itemStyle: { color: c.text },
      cursor: { fill: c.cursor },
    },
    legend: { wrapperStyle: { fontSize: 11, color: c.text } },
  };
}
