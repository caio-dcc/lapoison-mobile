/**
 * Superfície de vidro translúcido.
 *
 * Atenção (Expo SDK 57): no Android o BlurView só desfoca de verdade a
 * partir do SDK 31 e apenas com blurMethod explícito — sem isso ele
 * renderiza uma View semitransparente. Por isso a cor de fundo abaixo
 * é escolhida para ficar boa MESMO sem desfoque nenhum.
 */
import React from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { alpha, colors, radius } from '../theme';

interface GlassProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** 0-100. Menor = mais translúcido. */
  intensity?: number;
  /** Borda superior clara imitando reflexo de vidro. */
  highlight?: boolean;
  rounded?: number;
}

export default function Glass({
  children,
  style,
  intensity = 24,
  highlight = true,
  rounded = radius.lg,
}: GlassProps) {
  return (
    <View style={[styles.wrap, { borderRadius: rounded }, style]}>
      <BlurView
        intensity={intensity}
        tint="dark"
        // Renomeado de experimentalBlurMethod no SDK 57. 'dimezisBlurViewSdk31Plus'
        // exige um blurTarget (ref) que não configuramos, e sem ele o próprio
        // Expo já cai para 'none' com warning — então usamos 'none' direto.
        blurMethod="none"
        style={[StyleSheet.absoluteFill as ViewStyle, { borderRadius: rounded }]}
      />
      {/* Véu que garante contraste quando o blur não está disponível. */}
      <View
        pointerEvents="none"
        style={[
          styles.veil,
          { borderRadius: rounded },
          Platform.OS === 'android' && styles.veilAndroid,
        ]}
      />
      {highlight ? (
        <View
          pointerEvents="none"
          style={[styles.highlight, { borderTopLeftRadius: rounded, borderTopRightRadius: rounded }]}
        />
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: alpha.p04,
  },
  /** Android sem blur real precisa de um pouco mais de corpo. */
  veilAndroid: {
    backgroundColor: 'rgba(39, 39, 39, 0.55)',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: alpha.p16,
  },
  content: {
    position: 'relative',
  },
});
