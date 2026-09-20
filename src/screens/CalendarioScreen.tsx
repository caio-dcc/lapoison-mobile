import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  addDayNote,
  addDayPhoto,
  deleteDayNote,
  deleteDayPhoto,
  fetchDayDetail,
  fetchMonthCalendar,
  photoUrl,
  todayISO,
} from '../lib/api';
import type { DailySummary, DayDetail } from '../lib/types';
import { PAYMENT_LABELS, formatMeat } from '../lib/types';
import { brl, colors, font, radius, spacing } from '../theme';
import {
  Beef,
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  Croissant,
  ImageIcon,
  NotebookPen,
  STROKE,
  Send,
  X,
} from '../components/icons';
import { Card, EmptyState, ErrorState, Skeleton } from '../components/ui';

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function monthISO(year: number, month: number) {
  return `${year}-${pad(month + 1)}-01`;
}

function dateISO(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function buildGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();

  const cells: (number | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type DayTab = 'vendas' | 'diario';

/** Folha de detalhe do dia: vendas + diário (notas e fotos). */
function DayDetailSheet({
  date,
  onClose,
  onChanged,
}: {
  date: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DayTab>('vendas');
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!date) return;
      try {
        setError(null);
        setDetail(await fetchDayDetail(date, force));
      } catch (e: any) {
        setError(e?.message ?? 'Erro ao carregar');
      }
    },
    [date]
  );

  useEffect(() => {
    if (!date) {
      setDetail(null);
      setError(null);
      setTab('vendas');
      setNoteText('');
      return;
    }
    setDetail(null);
    load();
  }, [date, load]);

  const label = date
    ? (() => {
        const [y, m, d] = date.split('-').map(Number);
        return `${pad(d)} de ${MONTH_NAMES[m - 1]} de ${y}`;
      })()
    : '';

  const submitNote = useCallback(async () => {
    if (!date || !noteText.trim()) return;
    setBusy(true);
    try {
      await addDayNote(date, noteText.trim());
      setNoteText('');
      await load(true);
      onChanged();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível salvar a nota.');
    } finally {
      setBusy(false);
    }
  }, [date, noteText, load, onChanged]);

  const pickPhoto = useCallback(
    async (fromCamera: boolean) => {
      if (!date) return;

      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        Alert.alert(
          'Permissão necessária',
          fromCamera
            ? 'Autorize o acesso à câmera para tirar fotos.'
            : 'Autorize o acesso às fotos para anexar imagens.'
        );
        return;
      }

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.6,
          });

      if (result.canceled || !result.assets?.[0]) return;

      setBusy(true);
      try {
        await addDayPhoto(date, result.assets[0].uri);
        await load(true);
        onChanged();
      } catch (e: any) {
        Alert.alert('Erro', e?.message ?? 'Não foi possível enviar a foto.');
      } finally {
        setBusy(false);
      }
    },
    [date, load, onChanged]
  );

  const confirmDeleteNote = useCallback(
    (id: string) => {
      if (!date) return;
      Alert.alert('Excluir nota', 'Deseja remover esta anotação?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDayNote(id, date);
              await load(true);
              onChanged();
            } catch (e: any) {
              Alert.alert('Erro', e?.message ?? 'Falha ao excluir.');
            }
          },
        },
      ]);
    },
    [date, load, onChanged]
  );

  const confirmDeletePhoto = useCallback(
    (id: string, path: string) => {
      if (!date) return;
      Alert.alert('Excluir foto', 'Deseja remover esta foto?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDayPhoto(id, date, path);
              await load(true);
              onChanged();
            } catch (e: any) {
              Alert.alert('Erro', e?.message ?? 'Falha ao excluir.');
            }
          },
        },
      ]);
    },
    [date, load, onChanged]
  );

  const summary = detail?.summary;

  return (
    <Modal
      visible={!!date}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{label}</Text>
                {summary ? (
                  <Text style={styles.modalSubtitle}>
                    {summary.sales_count}{' '}
                    {summary.sales_count === 1 ? 'venda' : 'vendas'}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                <X size={16} strokeWidth={2.2} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.modalTotalBox}>
              <Text style={styles.modalTotalLabel}>Faturamento do dia</Text>
              <Text style={styles.modalTotalValue}>
                {brl(Number(summary?.total ?? 0))}
              </Text>
              {summary && (summary.meat_grams > 0 || summary.bun_count > 0) ? (
                <View style={styles.modalInsumos}>
                  <View style={styles.modalInsumoItem}>
                    <Beef size={14} strokeWidth={STROKE} color={colors.textMuted} />
                    <Text style={styles.modalInsumoText}>
                      {formatMeat(summary.meat_grams)}
                    </Text>
                  </View>
                  <View style={styles.modalInsumoItem}>
                    <Croissant size={14} strokeWidth={STROKE} color={colors.textMuted} />
                    <Text style={styles.modalInsumoText}>
                      {summary.bun_count}{' '}
                      {summary.bun_count === 1 ? 'pão' : 'pães'}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Abas: vendas | diário */}
            <View style={styles.tabRow}>
              {(['vendas', 'diario'] as DayTab[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      tab === t && { color: colors.accent },
                    ]}
                  >
                    {t === 'vendas' ? 'Vendas' : 'Diário'}
                    {t === 'diario' && summary
                      ? ` (${summary.notes_count + summary.photos_count})`
                      : ''}
                  </Text>
                </Pressable>
              ))}
            </View>

            <ScrollView
              style={{ maxHeight: 320 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {error ? (
                <ErrorState message={error} onRetry={() => load(true)} />
              ) : !detail ? (
                <View style={{ paddingVertical: spacing.xl }}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : tab === 'vendas' ? (
                detail.sales.length === 0 ? (
                  <EmptyState
                    Icon={Calendar}
                    title="Sem vendas neste dia"
                    subtitle="Nenhum registro foi lançado nesta data."
                  />
                ) : (
                  detail.sales.map((sale) => (
                    <View key={sale.id} style={styles.saleCard}>
                      <View style={styles.saleHeader}>
                        <Text style={styles.saleCustomer} numberOfLines={1}>
                          {sale.customer_name || 'Sem nome'}
                        </Text>
                        <Text style={styles.saleTotal}>
                          {brl(Number(sale.total))}
                        </Text>
                      </View>
                      <Text style={styles.saleMeta}>
                        {new Date(sale.sold_at).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {sale.payment_method
                          ? ` • ${PAYMENT_LABELS[sale.payment_method]}`
                          : ''}
                      </Text>
                      {sale.items?.length ? (
                        <View style={styles.saleItems}>
                          {sale.items.map((item, idx) => (
                            <View key={idx}>
                              <Text style={styles.saleItem} numberOfLines={1}>
                                {item.quantity}× {item.name}
                              </Text>
                              {item.options?.length ? (
                                <Text style={styles.saleItemOpt} numberOfLines={1}>
                                  {item.options
                                    .map((o) => o.value_name)
                                    .join(' · ')}
                                </Text>
                              ) : null}
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ))
                )
              ) : (
                <View>
                  {/* Fotos */}
                  {detail.photos.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginBottom: spacing.md }}
                    >
                      {detail.photos.map((photo) => (
                        <Pressable
                          key={photo.id}
                          onLongPress={() =>
                            confirmDeletePhoto(photo.id, photo.storage_path)
                          }
                          style={styles.photoWrap}
                        >
                          <Image
                            source={{ uri: photoUrl(photo.storage_path) }}
                            style={styles.photo}
                          />
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}

                  <View style={styles.photoActions}>
                    <Pressable
                      onPress={() => pickPhoto(true)}
                      style={styles.photoBtn}
                      disabled={busy}
                    >
                      <Camera size={16} strokeWidth={STROKE} color={colors.textMuted} />
                      <Text style={styles.photoBtnText}>Câmera</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => pickPhoto(false)}
                      style={styles.photoBtn}
                      disabled={busy}
                    >
                      <ImageIcon size={16} strokeWidth={STROKE} color={colors.textMuted} />
                      <Text style={styles.photoBtnText}>Galeria</Text>
                    </Pressable>
                  </View>

                  {/* Nova nota */}
                  <View style={styles.noteInputRow}>
                    <TextInput
                      value={noteText}
                      onChangeText={setNoteText}
                      placeholder="Escreva uma observação do dia…"
                      placeholderTextColor={colors.textFaint}
                      style={styles.noteInput}
                      multiline
                    />
                    <Pressable
                      onPress={submitNote}
                      disabled={busy || !noteText.trim()}
                      style={[
                        styles.noteSend,
                        (busy || !noteText.trim()) && { opacity: 0.4 },
                      ]}
                    >
                      <Send size={17} strokeWidth={2.1} color="#fff" />
                    </Pressable>
                  </View>

                  {busy ? (
                    <ActivityIndicator
                      color={colors.accent}
                      style={{ marginVertical: spacing.md }}
                    />
                  ) : null}

                  {/* Notas */}
                  {detail.notes.length === 0 && detail.photos.length === 0 ? (
                    <EmptyState
                      Icon={NotebookPen}
                      title="Diário vazio"
                      subtitle="Adicione fotos e observações sobre este dia."
                    />
                  ) : (
                    detail.notes.map((note) => (
                      <Pressable
                        key={note.id}
                        onLongPress={() => confirmDeleteNote(note.id)}
                        style={styles.noteCard}
                      >
                        <Text style={styles.noteBody}>{note.body}</Text>
                        <Text style={styles.noteTime}>
                          {new Date(note.created_at).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </Pressable>
                    ))
                  )}

                  <Text style={styles.hint}>
                    Toque e segure em uma foto ou nota para excluir.
                  </Text>
                </View>
              )}
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function CalendarioScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [summaries, setSummaries] = useState<DailySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (force = false) => {
      try {
        setError(null);
        setSummaries(await fetchMonthCalendar(monthISO(year, month), force));
      } catch (e: any) {
        setError(e?.message ?? 'Erro ao carregar calendário');
      }
    },
    [year, month]
  );

  useEffect(() => {
    setSummaries(null);
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, DailySummary>();
    for (const s of summaries ?? []) map.set(s.sale_date, s);
    return map;
  }, [summaries]);

  const monthTotal = useMemo(
    () => (summaries ?? []).reduce((s, x) => s + Number(x.total), 0),
    [summaries]
  );

  const monthMeat = useMemo(
    () => (summaries ?? []).reduce((s, x) => s + Number(x.meat_grams ?? 0), 0),
    [summaries]
  );

  const maxDay = useMemo(
    () => Math.max(...(summaries ?? []).map((s) => Number(s.total)), 1),
    [summaries]
  );

  const grid = useMemo(() => buildGrid(year, month), [year, month]);
  const today = todayISO();

  const goPrev = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };

  const goNext = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Calendário</Text>
          <Text style={styles.subtitle}>Toque em um dia para ver os detalhes</Text>
        </View>

        <View style={styles.monthNav}>
          <Pressable onPress={goPrev} style={styles.navBtn} hitSlop={8}>
            <ChevronLeft size={22} strokeWidth={STROKE} color={colors.text} />
          </Pressable>
          <View style={styles.monthInfo}>
            <Text style={styles.monthName}>{MONTH_NAMES[month]}</Text>
            <Text style={styles.monthYear}>{year}</Text>
          </View>
          <Pressable onPress={goNext} style={styles.navBtn} hitSlop={8}>
            <ChevronRight size={22} strokeWidth={STROKE} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.monthTotalBox}>
          <Text style={styles.monthTotalLabel}>Total do mês</Text>
          <Text style={styles.monthTotalValue}>{brl(monthTotal)}</Text>
          {monthMeat > 0 ? (
            <View style={styles.monthMeatRow}>
              <Beef size={13} strokeWidth={STROKE} color={colors.textMuted} />
              <Text style={styles.monthMeat}>{formatMeat(monthMeat)} de carne</Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <ErrorState message={error} onRetry={() => load(true)} />
        ) : (
          <Card style={{ marginTop: spacing.lg }}>
            <View style={styles.weekRow}>
              {WEEKDAY_LABELS.map((w, i) => (
                <Text key={i} style={styles.weekLabel}>
                  {w}
                </Text>
              ))}
            </View>

            {!summaries ? (
              <Skeleton height={220} style={{ marginTop: spacing.sm }} />
            ) : (
              <View style={styles.grid}>
                {grid.map((day, idx) => {
                  if (day === null) {
                    return <View key={`e${idx}`} style={styles.cell} />;
                  }
                  const iso = dateISO(year, month, day);
                  const summary = byDate.get(iso);
                  const hasSales = !!summary && Number(summary.total) > 0;
                  const hasMedia =
                    !!summary &&
                    (summary.notes_count > 0 || summary.photos_count > 0);
                  const intensity = hasSales
                    ? 0.25 + (Number(summary!.total) / maxDay) * 0.75
                    : 0;
                  const isToday = iso === today;

                  return (
                    <Pressable
                      key={iso}
                      onPress={() => setSelected(iso)}
                      style={styles.cell}
                    >
                      <View
                        style={[
                          styles.dayBox,
                          hasSales && {
                            backgroundColor: `rgba(43, 168, 74, ${intensity})`,
                          },
                          isToday && styles.dayBoxToday,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNum,
                            hasSales && { color: colors.text, fontWeight: '700' },
                            isToday && { color: colors.accent },
                          ]}
                        >
                          {day}
                        </Text>
                        {hasSales ? (
                          <Text style={styles.dayValue} numberOfLines={1}>
                            {Number(summary!.total) >= 1000
                              ? `${(Number(summary!.total) / 1000).toFixed(1)}k`
                              : Math.round(Number(summary!.total))}
                          </Text>
                        ) : null}
                        {hasMedia ? <View style={styles.mediaDot} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>
        )}

        <View style={styles.legend}>
          <Text style={styles.legendText}>Menor</Text>
          {[0.2, 0.4, 0.6, 0.8, 1].map((o) => (
            <View
              key={o}
              style={[
                styles.legendBox,
                { backgroundColor: `rgba(43, 168, 74, ${o})` },
              ]}
            />
          ))}
          <Text style={styles.legendText}>Maior</Text>
          <View style={styles.legendDivider} />
          <View style={styles.mediaDotStatic} />
          <Text style={styles.legendText}>Diário</Text>
        </View>

        <View style={{ height: 130 }} />
      </ScrollView>

      <DayDetailSheet
        date={selected}
        onClose={() => setSelected(null)}
        onChanged={() => load(true)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: spacing.sm },
  header: { marginBottom: spacing.xl },
  title: {
    color: colors.text,
    fontSize: font.h1,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthInfo: { alignItems: 'center' },
  monthName: { color: colors.text, fontSize: font.h3, fontWeight: '700' },
  monthYear: { color: colors.textMuted, fontSize: font.tiny },
  monthTotalBox: {
    marginTop: spacing.md,
    backgroundColor: colors.navActiveBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(43,168,74,0.3)',
    padding: spacing.lg,
  },
  monthTotalLabel: {
    color: colors.accentSoft,
    fontSize: font.tiny,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  monthTotalValue: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 4,
  },
  monthMeat: { color: colors.textMuted, fontSize: font.small },
  monthMeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  weekRow: { flexDirection: 'row', marginBottom: spacing.sm },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: font.tiny,
    fontWeight: '700',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  dayBox: {
    flex: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBoxToday: { borderWidth: 1.5, borderColor: colors.accent },
  dayNum: { color: colors.textMuted, fontSize: font.small },
  dayValue: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },
  mediaDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accentSoft,
  },
  mediaDotStatic: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accentSoft,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.lg,
  },
  legendBox: { width: 16, height: 10, borderRadius: 3 },
  legendText: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginHorizontal: spacing.xs,
  },
  legendDivider: {
    width: 1,
    height: 12,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: font.h3, fontWeight: '700' },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: font.small,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTotalBox: {
    backgroundColor: colors.navActiveBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(43,168,74,0.3)',
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  modalTotalLabel: {
    color: colors.accentSoft,
    fontSize: font.tiny,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  modalTotalValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  modalInsumos: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  modalInsumoText: { color: colors.textMuted, fontSize: font.small },
  modalInsumoItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabBtnActive: {
    backgroundColor: colors.navActiveBg,
    borderColor: colors.accent,
  },
  tabText: { color: colors.textMuted, fontSize: font.small, fontWeight: '600' },
  saleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  saleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  saleCustomer: {
    flex: 1,
    color: colors.text,
    fontSize: font.body,
    fontWeight: '600',
  },
  saleTotal: { color: colors.accent, fontSize: font.body, fontWeight: '700' },
  saleMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  saleItems: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saleItem: { color: colors.textMuted, fontSize: font.small, lineHeight: 20 },
  saleItemOpt: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginLeft: spacing.md,
    marginBottom: 2,
  },
  photoWrap: { marginRight: spacing.sm },
  photo: {
    width: 110,
    height: 110,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  photoActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  photoBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoBtnText: {
    color: colors.textMuted,
    fontSize: font.small,
    fontWeight: '600',
  },
  noteInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  noteInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    color: colors.text,
    fontSize: font.small,
    maxHeight: 100,
  },
  noteSend: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noteBody: { color: colors.text, fontSize: font.small, lineHeight: 20 },
  noteTime: { color: colors.textFaint, fontSize: font.tiny, marginTop: 4 },
  hint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
