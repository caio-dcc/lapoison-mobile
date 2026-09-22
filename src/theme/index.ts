/**
 * Paleta: monocromática por decisão de design.
 *   Shadow Grey #272727 — fundo
 *   Porcelain   #FCFFFC — detalhes, ícones e fontes
 * Sem verde. A hierarquia vem de opacidade e transparência, não de cor.
 */
export const brand = {
  shadowGrey: '#272727',
  porcelain: '#FCFFFC',
} as const;

/** Porcelain com alfa — a base de quase todo detalhe do app. */
export const alpha = {
  p04: 'rgba(252, 255, 252, 0.04)',
  p06: 'rgba(252, 255, 252, 0.06)',
  p08: 'rgba(252, 255, 252, 0.08)',
  p12: 'rgba(252, 255, 252, 0.12)',
  p16: 'rgba(252, 255, 252, 0.16)',
  p24: 'rgba(252, 255, 252, 0.24)',
  p40: 'rgba(252, 255, 252, 0.40)',
  p60: 'rgba(252, 255, 252, 0.60)',
  p80: 'rgba(252, 255, 252, 0.80)',
} as const;

export const colors = {
  bg: brand.shadowGrey,
  bgElevated: '#2E2E2E',
  /** Superfícies de vidro: translúcidas sobre o fundo. */
  surface: alpha.p06,
  surfaceAlt: alpha.p08,
  surfaceStrong: alpha.p12,

  navBar: 'rgba(39, 39, 39, 0.72)',
  navBorder: alpha.p12,
  navActiveBg: alpha.p12,

  /** Acento = porcelain. Intensidade se resolve por opacidade. */
  accent: brand.porcelain,
  accentSoft: alpha.p60,
  accentGlow: alpha.p08,

  text: brand.porcelain,
  textMuted: alpha.p60,
  textFaint: alpha.p40,

  success: brand.porcelain,
  danger: '#E88C8C',
  info: alpha.p60,

  border: alpha.p12,
  borderStrong: alpha.p24,
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

/**
 * Famílias carregadas em App.tsx.
 *   Space Grotesk — títulos e números (geométrica, moderna)
 *   Inter         — texto corrido (legível em corpo pequeno)
 */
export const family = {
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
} as const;

export { brl, brlCompact } from '../lib/metrics';
