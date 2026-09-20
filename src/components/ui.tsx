import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { brl, colors, font, radius, spacing } from '../theme';
import { STROKE, TriangleAlert } from './icons';
import type { LucideIcon } from 'lucide-react-native';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent';
}) {
  return (
    <View style={[styles.tile, tone === 'accent' && styles.tileAccent]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text
        style={[styles.tileValue, tone === 'accent' && { color: colors.accent }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.primaryBtn,
        off && styles.primaryBtnOff,
        pressed && !off && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Barra horizontal proporcional — usada no mix de categorias. */
export function MiniBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max(0.02, value / max) : 0;
  return (
    <View style={styles.miniBarRow}>
      <Text style={styles.miniBarLabel}>{label}</Text>
      <View style={styles.miniBarTrack}>
        <View
          style={[
            styles.miniBarFill,
            { width: `${pct * 100}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.miniBarValue}>{brl(value)}</Text>
    </View>
  );
}

export function EmptyState({
  Icon,
  title,
  subtitle,
}: {
  Icon: LucideIcon;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      <Icon
        size={30}
        strokeWidth={STROKE}
        color={colors.textFaint}
        style={styles.emptyIcon}
      />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <TriangleAlert
        size={30}
        strokeWidth={STROKE}
        color={colors.danger}
        style={styles.emptyIcon}
      />
      <Text style={styles.emptyTitle}>Não foi possível carregar</Text>
      <Text style={styles.emptySubtitle}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>Tentar novamente</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Placeholder de carregamento (skeleton) para telas com dados remotos. */
export function Skeleton({ height = 80, style }: { height?: number; style?: ViewStyle }) {
  return <View style={[styles.skeleton, { height }, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: font.small,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    minHeight: 92,
    justifyContent: 'center',
  },
  tileAccent: {
    borderColor: 'rgba(43,168,74,0.35)',
    backgroundColor: colors.navActiveBg,
  },
  tileLabel: {
    color: colors.textMuted,
    fontSize: font.tiny,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  tileValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  tileHint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: 2,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.navActiveBg,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: font.small,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: colors.accent,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnOff: {
    backgroundColor: colors.surfaceAlt,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: font.body,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  miniBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  miniBarLabel: {
    color: colors.textMuted,
    fontSize: font.small,
    width: 62,
  },
  miniBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  miniBarValue: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: '600',
    width: 86,
    textAlign: 'right',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '600',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: colors.textMuted,
    fontSize: font.small,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  retryText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: font.small,
  },
  skeleton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    opacity: 0.6,
  },
});
