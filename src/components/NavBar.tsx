import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';
import {
  CalendarDays,
  ClipboardList,
  Hamburger,
  LayoutDashboard,
  STROKE,
} from './icons';
import type { LucideIcon } from 'lucide-react-native';

export type TabKey = 'dashboard' | 'registro' | 'calendario' | 'produtos';

interface TabDef {
  key: TabKey;
  Icon: LucideIcon;
  label: string;
}

/** Ícones Lucide alinhados ao assunto de cada aba. */
export const TABS: TabDef[] = [
  { key: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { key: 'registro', Icon: Hamburger, label: 'Registro' },
  { key: 'calendario', Icon: CalendarDays, label: 'Calendário' },
  { key: 'produtos', Icon: ClipboardList, label: 'Produtos' },
];

const ITEM_SIZE = 46;
const ITEM_GAP = spacing.xs;

function NavItem({
  tab,
  active,
  onPress,
}: {
  tab: TabDef;
  active: boolean;
  onPress: () => void;
}) {
  const progress = useSharedValue(active ? 1 : 0);
  const scale = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: 220 });
  }, [active, progress]);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.8 + progress.value * 0.2 }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glyphStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + progress.value * 0.45,
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.9, { damping: 14, stiffness: 320 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 320 });
      }}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={styles.itemPressable}
    >
      <Animated.View style={[styles.itemInner, contentStyle]}>
        {/* Glow externo do item ativo (halo verde difuso) */}
        <Animated.View pointerEvents="none" style={[styles.glow, bgStyle]} />
        {/* Cápsula de fundo do item ativo */}
        <Animated.View pointerEvents="none" style={[styles.activeBg, bgStyle]} />
        <Animated.View style={glyphStyle}>
          <tab.Icon
            size={22}
            strokeWidth={STROKE}
            color={active ? colors.accent : colors.textMuted}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export default function NavBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        {TABS.map((tab) => (
          <NavItem
            key={tab.key}
            tab={tab}
            active={tab.key === active}
            onPress={() => onChange(tab.key)}
          />
        ))}
      </View>
      <Text style={styles.caption} numberOfLines={1}>
        {TABS.find((t) => t.key === active)?.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ITEM_GAP,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.navBar,
    borderWidth: 1,
    borderColor: colors.navBorder,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  itemPressable: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInner: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: ITEM_SIZE + 26,
    height: ITEM_SIZE + 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
    shadowColor: colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  activeBg: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.navActiveBg,
    borderWidth: 1,
    borderColor: 'rgba(43, 168, 74, 0.45)',
  },
  glyph: {
    fontSize: 20,
    lineHeight: 26,
  },
  caption: {
    marginTop: spacing.sm,
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
