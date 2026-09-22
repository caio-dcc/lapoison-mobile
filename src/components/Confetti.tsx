/**
 * Confetes em Reanimated puro.
 *
 * Por que não uma lib: o Expo Go não carrega módulos nativos próprios, e
 * as libs de confete conhecidas são pré-Fabric e sem manutenção. Aqui são
 * ~80 linhas rodando 100% na UI thread, sem dependência nova.
 *
 * Paleta monocromática (porcelain com alfas), coerente com o resto do app.
 */
import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { alpha, brand } from '../theme';

const COUNT = 44;
const DURATION = 2100;

const TINTS = [
  brand.porcelain,
  alpha.p80,
  alpha.p60,
  alpha.p40,
  alpha.p24,
];

interface Piece {
  startX: number;
  driftX: number;
  size: number;
  ratio: number;
  color: string;
  delay: number;
  spin: number;
  round: boolean;
}

function buildPieces(width: number): Piece[] {
  return Array.from({ length: COUNT }, (): Piece => {
    const size = 5 + Math.random() * 7;
    return {
      startX: Math.random() * width,
      driftX: (Math.random() - 0.5) * width * 0.6,
      size,
      // Retângulos alongados caem mais como papel picado.
      ratio: 0.4 + Math.random() * 1.4,
      color: TINTS[Math.floor(Math.random() * TINTS.length)],
      delay: Math.random() * 380,
      spin: (Math.random() - 0.5) * 1080,
      round: Math.random() > 0.72,
    };
  });
}

function ConfettiPiece({ piece, height }: { piece: Piece; height: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      piece.delay,
      withTiming(1, { duration: DURATION, easing: Easing.out(Easing.quad) })
    );
  }, [piece.delay, t]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    return {
      opacity: p < 0.08 ? p / 0.08 : p > 0.75 ? (1 - p) / 0.25 : 1,
      transform: [
        { translateY: -40 + p * (height + 80) },
        // Deriva lateral senoidal: parece flutuar, não cair reto.
        { translateX: piece.driftX * Math.sin(p * Math.PI) },
        { rotate: `${piece.spin * p}deg` },
        { scale: 0.6 + (1 - Math.abs(p - 0.5) * 2) * 0.4 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: piece.startX,
          top: 0,
          width: piece.size,
          height: piece.size * piece.ratio,
          backgroundColor: piece.color,
          borderRadius: piece.round ? piece.size : 1.5,
        },
        style,
      ]}
    />
  );
}

/** Dispara ao mudar `fireKey` para um valor novo e diferente de 0. */
export default function Confetti({ fireKey }: { fireKey: number }) {
  const { width, height } = Dimensions.get('window');
  const pieces = useMemo(() => buildPieces(width), [width, fireKey]);

  if (!fireKey) return null;

  return (
    <View pointerEvents="none" style={styles.layer}>
      {pieces.map((p, i) => (
        <ConfettiPiece key={`${fireKey}-${i}`} piece={p} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
});
