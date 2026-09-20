/**
 * Paleta da marca:
 *   Shadow Grey   #272727  — base escura
 *   Forest Green  #248232  — verde profundo
 *   Medium Jungle #2BA84A  — verde de acento (item ativo, destaques)
 *   Porcelain     #FCFFFC  — texto/claro
 */
export const brand = {
  shadowGrey: '#272727',
  forestGreen: '#248232',
  mediumJungle: '#2BA84A',
  porcelain: '#FCFFFC',
} as const;

export const colors = {
  bg: '#1C1C1C',
  bgElevated: '#222222',
  surface: brand.shadowGrey,
  surfaceAlt: '#333333',

  navBar: '#232323',
  navBorder: '#3A3A3A',
  navActiveBg: '#16301C',

  accent: brand.mediumJungle,
  accentDeep: brand.forestGreen,
  accentSoft: '#4FC96C',
  accentGlow: 'rgba(43, 168, 74, 0.35)',

  text: brand.porcelain,
  textMuted: '#9A9A9A',
  textFaint: '#6B6B6B',

  success: brand.mediumJungle,
  danger: '#E05B5B',
  info: '#7FB77E',

  border: '#3A3A3A',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const font = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

/** Formata valores em reais. */
export function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value ?? 0);
}

export function brlCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `R$ ${(value / 1000).toFixed(1).replace('.', ',')}k`;
  }
  return brl(value);
}
