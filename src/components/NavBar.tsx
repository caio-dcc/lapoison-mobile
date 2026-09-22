import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { alpha, colors, family, radius, spacing } from '../theme';
import {
  CalendarDays,
  ClipboardList,
  Hamburger,
  LayoutDashboard,
  ScrollText,
  STROKE,
  Users,
} from './icons';
import type { LucideIcon } from 'lucide-react-native';

export type TabKey =
  | 'dashboard'
  | 'registro'
  | 'clientes'
  | 'calendario'
  | 'produtos'
  | 'auditoria';

interface TabDef {
  key: TabKey;
  Icon: LucideIcon;
  label: string;
}

/** Ícones Lucide alinhados ao assunto de cada aba. */
export const TABS: TabDef[] = [
  { key: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { key: 'registro', Icon: Hamburger, label: 'Registro' },
  { key: 'clientes', Icon: Users, label: 'Clientes' },
  { key: 'calendario', Icon: CalendarDays, label: 'Calendário' },
  { key: 'produtos', Icon: ClipboardList, label: 'Produtos' },
  { key: 'auditoria', Icon: ScrollText, label: 'Auditoria' },
];

const ITEM_SIZE = 44;
/** Respiro entre ícones — pedido explicitamente maior. */
const ITEM_GAP = spacing.md;
/** Eleva a barra acima da borda inferior segura, afastando-a do bordo. */
export const NAV_LIFT = spacing.lg;

/** Anel que se expande e desvanece — a "onda" irradiando do ícone. */
function Ripple({ trigger, delay }: { trigger: number; delay: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (trigger === 0) return;
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }));
  }, [trigger, delay, t]);

  const style = useAnimatedStyle(() => ({
    opacity: trigger === 0 ? 0 : (1 - t.value) * 0.5,
    transform: [{ scale: 0.5 + t.value * 1.3 }],
  }));

  return <Animated.View pointerEvents="none" style={[styles.ripple, style]} />;
}

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
  // Incrementa a cada ativação: dispara as 3 ondas em cascata.
  const [rippleKey, setRippleKey] = useState(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: 240 });
    if (active) setRippleKey((k) => k + 1);
  }, [active, progress]);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.82 + progress.value * 0.18 }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glyphStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + progress.value * 0.5,
    transform: [{ translateY: -progress.value * 1.5 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.88, { damping: 14, stiffness: 340 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 14, stiffness: 340 });
      }}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      hitSlop={8}
      style={styles.itemPressable}
    >
      <Animated.View style={[styles.itemInner, contentStyle]}>
        {/* Ondas irradiando do ícone ao ativar a aba. */}
        <Ripple trigger={rippleKey} delay={0} />
        <Ripple trigger={rippleKey} delay={110} />
        <Ripple trigger={rippleKey} delay={220} />
        {/* Halo difuso do item ativo — porcelain, sem cor. */}
        <Animated.View pointerEvents="none" style={[styles.glow, bgStyle]} />
        {/* Cápsula de fundo translúcida */}
        <Animated.View pointerEvents="none" style={[styles.activeBg, bgStyle]} />
        <Animated.View style={glyphStyle}>
          <tab.Icon
            size={21}
            strokeWidth={STROKE}
            color={active ? colors.text : colors.textMuted}
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
      style={[
        styles.wrapper,
        { paddingBottom: Math.max(insets.bottom, spacing.md) + NAV_LIFT },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        {/*
          Vidro da barra. No Android o blur real exige SDK 31+; sem ele o
          BlurView vira uma View translúcida — por isso a cor de fundo do
          pill já funciona sozinha.
        */}
        <BlurView
          intensity={32}
          tint="dark"
          blurMethod="none"
          style={styles.pillBlur}
        />
        <View pointerEvents="none" style={styles.pillVeil} />
        <View pointerEvents="none" style={styles.pillHighlight} />

        <View style={styles.pillRow}>
          {TABS.map((tab) => (
            <NavItem
              key={tab.key}
              tab={tab}
              active={tab.key === active}
              onPress={() => onChange(tab.key)}
            />
          ))}
        </View>
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
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.navBorder,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  pillBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pillVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.navBar,
  },
  pillHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: alpha.p16,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ITEM_GAP,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
    width: ITEM_SIZE + 22,
    height: ITEM_SIZE + 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
    shadowColor: colors.text,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  ripple: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.accentSoft,
  },
  activeBg: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.navActiveBg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  caption: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontFamily: family.bodySemi,
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
