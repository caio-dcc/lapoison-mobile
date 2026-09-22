import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import NavBar, { TABS, type TabKey } from './src/components/NavBar';
import Confetti from './src/components/Confetti';
import DashboardScreen from './src/screens/DashboardScreen';
import RegistroScreen from './src/screens/RegistroScreen';
import ClientesScreen from './src/screens/ClientesScreen';
import CalendarioScreen from './src/screens/CalendarioScreen';
import ProdutosScreen from './src/screens/ProdutosScreen';
import LockScreen from './src/screens/LockScreen';
import { colors, spacing } from './src/theme';
import { LogOut, STROKE } from './src/components/icons';
import { initCelebration, celebrate, tapLight } from './src/lib/celebrate';
import { hasActiveSession, logout, markUnlocked } from './src/lib/auth';

// Mantém o splash até as fontes carregarem: evita o flash de texto sem fonte.
void SplashScreen.preventAutoHideAsync();

const ORDER: TabKey[] = TABS.map((t) => t.key);
/** Distância mínima para o swipe virar troca de aba. */
const SWIPE_THRESHOLD = 60;

/** Botão discreto no canto superior, fixo em todas as abas. */
function LogoutButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Sair"
      style={[styles.logoutBtn, { top: insets.top + spacing.sm }]}
    >
      <LogOut size={18} strokeWidth={STROKE} color={colors.textMuted} />
    </Pressable>
  );
}

export default function App() {
  const { width } = useWindowDimensions();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const [locked, setLocked] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const [tab, setTab] = useState<TabKey>('dashboard');
  // Telas já visitadas permanecem montadas: trocar de aba não recarrega nada.
  const [mounted, setMounted] = useState<Set<TabKey>>(new Set(['dashboard']));
  const [dashboardKey, setDashboardKey] = useState(0);
  const [confettiKey, setConfettiKey] = useState(0);
  const calendarKey = useRef(0);
  const clientesKey = useRef(0);

  // Posição do trilho em "páginas": 0 = primeira aba.
  const index = useSharedValue(0);
  // Arraste em curso, em pixels.
  const drag = useSharedValue(0);

  useEffect(() => {
    void (async () => {
      const hasSession = await hasActiveSession();
      setLocked(!hasSession);
      setAuthChecked(true);
    })();
    void initCelebration();
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Sair', 'Deseja sair? Será preciso digitar a senha de novo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          void logout();
          setLocked(true);
        },
      },
    ]);
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && authChecked) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, authChecked]);

  const changeTab = useCallback(
    (next: TabKey, haptic = true) => {
      setMounted((prev) => {
        if (prev.has(next)) return prev;
        const copy = new Set(prev);
        copy.add(next);
        return copy;
      });
      setTab(next);
      if (haptic) tapLight();

      const target = ORDER.indexOf(next);
      drag.value = 0;
      index.value = withTiming(target, {
        duration: 320,
        easing: Easing.out(Easing.cubic),
      });
    },
    [drag, index]
  );

  /** Vai para a aba vizinha — usado pelo swipe. */
  const step = useCallback(
    (dir: 1 | -1) => {
      const current = ORDER.indexOf(tab);
      const next = current + dir;
      if (next < 0 || next >= ORDER.length) {
        // Sem vizinho: volta o trilho para o lugar.
        index.value = withTiming(current, { duration: 220 });
        drag.value = withTiming(0, { duration: 220 });
        return;
      }
      changeTab(ORDER[next]);
    },
    [tab, changeTab, index, drag]
  );

  const settle = useCallback(() => {
    const current = ORDER.indexOf(tab);
    index.value = withTiming(current, { duration: 240 });
    drag.value = withTiming(0, { duration: 240 });
  }, [tab, index, drag]);

  const handleSaved = useCallback(() => {
    // Remonta as telas de leitura para refletir a venda recém-criada
    // (o cache já foi invalidado em createSale).
    setDashboardKey((k) => k + 1);
    calendarKey.current += 1;
    clientesKey.current += 1;
    setConfettiKey((k) => k + 1);
    celebrate();
    changeTab('dashboard', false);
  }, [changeTab]);

  // Swipe horizontal para trocar de página. activeOffsetX/failOffsetY
  // impedem que o gesto roube a rolagem vertical das listas.
  const pan = Gesture.Pan()
    .activeOffsetX([-18, 18])
    .failOffsetY([-24, 24])
    .onUpdate((e) => {
      drag.value = e.translationX;
    })
    .onEnd((e) => {
      const far = Math.abs(e.translationX) > SWIPE_THRESHOLD;
      const fast = Math.abs(e.velocityX) > 550;
      if (far || fast) {
        runOnJS(step)(e.translationX < 0 ? 1 : -1);
      } else {
        runOnJS(settle)();
      }
    });

  // O trilho desliza; cada página ocupa uma largura de tela.
  const railStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -index.value * width + drag.value }],
  }));

  if (!fontsLoaded && !fontError) return null;

  if (locked) {
    return (
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <LockScreen
            onUnlock={() => {
              void markUnlocked();
              setLocked(false);
            }}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SafeAreaView style={styles.root} edges={['top']}>
          <GestureDetector gesture={pan}>
            <View style={styles.stack}>
              <Animated.View
                style={[styles.rail, { width: width * ORDER.length }, railStyle]}
              >
                {ORDER.map((key) => (
                  <View key={key} style={[styles.page, { width }]}>
                    {mounted.has(key) ? (
                      key === 'dashboard' ? (
                        <DashboardScreen key={dashboardKey} />
                      ) : key === 'registro' ? (
                        <RegistroScreen onSaved={handleSaved} />
                      ) : key === 'clientes' ? (
                        <ClientesScreen key={clientesKey.current} />
                      ) : key === 'calendario' ? (
                        <CalendarioScreen key={calendarKey.current} />
                      ) : (
                        <ProdutosScreen />
                      )
                    ) : null}
                  </View>
                ))}
              </Animated.View>
            </View>
          </GestureDetector>

          <Confetti fireKey={confettiKey} />

          <LogoutButton onPress={handleLogout} />

          <NavBar active={tab} onChange={changeTab} />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stack: {
    flex: 1,
    overflow: 'hidden',
  },
  rail: {
    flex: 1,
    flexDirection: 'row',
  },
  page: {
    flex: 1,
  },
  logoutBtn: {
    position: 'absolute',
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(39, 39, 39, 0.6)',
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 20,
  },
});
