import {defineTheme} from '@astryxdesign/core/theme';

// astryx 의 디자인 값 이름을 tokens.css 변수에 연결합니다. 여기에는 색·크기 값을 적지 않습니다.
const v = (name: string) => `var(--${name})`;
const all = (names: string[], value: string) => Object.fromEntries(names.map(n => [n, value]));
const hues = ['blue', 'cyan', 'gray', 'green', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow'];
const series = ['blue', 'gray', 'orange', 'pink', 'purple', 'red', 'shamrock', 'teal', 'yellow'];
const categorical = ['blue', 'brown', 'cyan', 'green', 'indigo', 'orange', 'pink', 'purple', 'red', 'teal'];
const calm = ['info', 'success', 'warning'];

const colors = {
  ...all(hues.flatMap(h => [`--color-text-${h}`, `--color-icon-${h}`, `--color-border-${h}`]), v('navy')),
  ...all(hues.map(h => `--color-background-${h}`), v('tint')),
  ...all(series.flatMap(s => [1, 2, 3, 4, 5].map(n => `--color-data-${s}-${n}`)), v('navy')),
  ...all(categorical.map(c => `--color-data-categorical-${c}`), v('navy')),
  ...all(calm.flatMap(c => [`--color-${c}`, `--color-text-${c}`, `--color-icon-${c}`, `--color-border-${c}`, `--color-on-${c}-muted`]), v('navy')),
  ...all(calm.map(c => `--color-${c}-muted`), v('tint')),
  ...all(calm.map(c => `--color-on-${c}`), v('white')),
  ...all(['--color-accent', '--color-text-primary', '--color-text-accent', '--color-icon-primary', '--color-icon-accent',
    '--color-on-light', '--color-background-inverted', '--color-tint-hover', '--color-data-neutral', '--focus-outline-color'], v('navy')),
  ...all(['--color-on-accent', '--color-on-dark', '--color-on-error', '--color-background-surface', '--color-background-body',
    '--color-background-card', '--color-background-popover', '--color-error-muted'], v('white')),
  ...all(['--color-text-secondary', '--color-text-disabled', '--color-icon-secondary', '--color-icon-disabled'], v('text-sub')),
  ...all(['--color-border', '--color-border-emphasized', '--color-border-error', '--color-skeleton', '--color-track'], v('line')),
  ...all(['--color-accent-muted', '--color-neutral', '--color-background-muted', '--color-overlay', '--color-overlay-hover', '--color-overlay-pressed'], v('tint')),
  ...all(['--color-error', '--color-text-error', '--color-icon-error', '--color-on-error-muted', '--color-background-error-inverted'], v('error')),
  '--color-shadow': 'transparent',
};

const sizes = {
  ...all(['--font-size-4xs', '--font-size-3xs', '--font-size-2xs', '--font-size-xs', '--font-size-sm',
    '--text-supporting-size', '--text-heading-5-size', '--text-heading-6-size'], v('size-s')),
  ...all(['--font-size-base', '--text-body-size', '--text-label-size', '--text-code-size',
    '--text-heading-3-size', '--text-heading-4-size'], v('size-m')),
  ...all(['--font-size-lg', '--font-size-xl', '--text-large-size', '--text-heading-2-size'], v('size-l')),
  ...all(['--font-size-2xl', '--text-heading-1-size'], v('size-xl')),
  ...all(['--font-size-3xl', '--font-size-4xl', '--font-size-5xl', '--text-display-1-size', '--text-display-2-size', '--text-display-3-size'], v('size-xxl')),
};

const spacing = {
  ...all(['--spacing-0-5', '--spacing-1'], v('sp-1')),
  ...all(['--spacing-1-5', '--spacing-2'], v('sp-2')),
  '--spacing-3': v('sp-3'),
  ...all(['--spacing-4', '--spacing-5'], v('sp-4')),
  ...all(['--spacing-6', '--spacing-7'], v('sp-6')),
  ...all(['--spacing-8', '--spacing-9', '--spacing-10'], v('sp-8')),
  ...all(['--spacing-11', '--spacing-12'], v('sp-12')),
};

const shape = {
  ...all(['--radius-inner', '--radius-element', '--radius-container', '--radius-page', '--radius-chat', '--radius-full'], v('radius')),
  ...all(['--size-element-sm', '--size-element-md', '--size-element-lg'], v('control-h')),
  ...all(['--shadow-low', '--shadow-med', '--shadow-high', '--shadow-inset-hover', '--shadow-inset-selected',
    '--shadow-inset-success', '--shadow-inset-warning', '--shadow-inset-error'], 'none'),
  ...all(['--font-family-body', '--font-family-heading'], v('font')),
  '--border-width': v('border-w'),
};

export const theme = defineTheme({name: 'avenuel', tokens: {...colors, ...sizes, ...spacing, ...shape}});
