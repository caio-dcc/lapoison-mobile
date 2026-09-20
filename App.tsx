import React, { useCallback, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import NavBar, { type TabKey } from './src/components/NavBar';
import DashboardScreen from './src/screens/DashboardScreen';
import RegistroScreen from './src/screens/RegistroScreen';
import CalendarioScreen from './src/screens/CalendarioScreen';
import ProdutosScreen from './src/screens/ProdutosScreen';
import { colors } from './src/theme';

export default function App() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  // Telas já visitadas permanecem montadas: trocar de aba não recarrega nada.
  const [mounted, setMounted] = useState<Set<TabKey>>(new Set(['dashboard']));
  // Muda a key do Dashboard para forçar recarga após registrar uma venda.
  const [dashboardKey, setDashboardKey] = useState(0);
  const calendarKey = useRef(0);

  const changeTab = useCallback((next: TabKey) => {
    setMounted((prev) => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
    setTab(next);
  }, []);

  const handleSaved = useCallback(() => {
    // Remonta as telas de leitura para refletir a venda recém-criada
    // (o cache já foi invalidado em createSale).
    setDashboardKey((k) => k + 1);
    calendarKey.current += 1;
    changeTab('dashboard');
  }, [changeTab]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SafeAreaView style={styles.root} edges={['top']}>
          <View style={styles.stack}>
            {mounted.has('dashboard') ? (
              <View
                style={[styles.page, tab !== 'dashboard' && styles.hidden]}
                pointerEvents={tab === 'dashboard' ? 'auto' : 'none'}
              >
                <DashboardScreen key={dashboardKey} />
              </View>
            ) : null}

            {mounted.has('registro') ? (
              <View
                style={[styles.page, tab !== 'registro' && styles.hidden]}
                pointerEvents={tab === 'registro' ? 'auto' : 'none'}
              >
                <RegistroScreen onSaved={handleSaved} />
              </View>
            ) : null}

            {mounted.has('calendario') ? (
              <View
                style={[styles.page, tab !== 'calendario' && styles.hidden]}
                pointerEvents={tab === 'calendario' ? 'auto' : 'none'}
              >
                <CalendarioScreen key={calendarKey.current} />
              </View>
            ) : null}

            {mounted.has('produtos') ? (
              <View
                style={[styles.page, tab !== 'produtos' && styles.hidden]}
                pointerEvents={tab === 'produtos' ? 'auto' : 'none'}
              >
                <ProdutosScreen />
              </View>
            ) : null}
          </View>

          <NavBar active={tab} onChange={changeTab} />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stack: {
    flex: 1,
  },
  page: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hidden: {
    opacity: 0,
    zIndex: -1,
  },
});
