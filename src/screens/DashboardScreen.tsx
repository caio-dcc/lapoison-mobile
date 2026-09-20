import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchDashboard } from '../lib/api';
import type { DashboardOverview } from '../lib/types';
import { formatMeat } from '../lib/types';
import { brl, brlCompact, colors, font, radius, spacing } from '../theme';
import {
  Beef,
  Croissant,
  STROKE,
  TrendingDown,
  TrendingUp,
} from '../components/icons';
import {
  Card,
  ErrorState,
  MiniBar,
  SectionTitle,
  Skeleton,
  StatTile,
} from '../components/ui';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function TrendBars({ data }: { data: { sale_date: string; total: number }[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <View style={styles.trendRow}>
      {data.map((d) => {
        const pct = d.total / max;
        const day = new Date(`${d.sale_date}T12:00:00`);
        const isToday = d.sale_date === data[data.length - 1]?.sale_date;
        return (
          <View key={d.sale_date} style={styles.trendCol}>
            <Text style={styles.trendValue} numberOfLines={1}>
              {d.total > 0 ? brlCompact(d.total).replace('R$ ', '') : '–'}
            </Text>
            <View style={styles.trendTrack}>
              <View
                style={[
                  styles.trendFill,
                  {
                    height: `${Math.max(3, pct * 100)}%`,
                    backgroundColor: isToday ? colors.accent : colors.surfaceAlt,
                  },
                ]}
              />
            </View>
            <Text style={[styles.trendDay, isToday && { color: colors.accent }]}>
              {WEEKDAYS[day.getDay()]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      setError(null);
      const result = await fetchDashboard(force);
      setData(result);
    } catch (e: any) {
      setError(e?.message ?? 'Erro desconhecido');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  if (error && !data) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Header />
        <ErrorState message={error} onRetry={() => load(true)} />
      </ScrollView>
    );
  }

  if (!data) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Header />
        <View style={styles.row}>
          <Skeleton height={92} style={{ flex: 1 }} />
          <Skeleton height={92} style={{ flex: 1 }} />
        </View>
        <Skeleton height={92} style={{ marginTop: spacing.md }} />
        <Skeleton height={180} style={{ marginTop: spacing.xl }} />
      </ScrollView>
    );
  }

  const maxMix = Math.max(
    data.month_food,
    data.month_drink,
    data.month_extra,
    1
  );

  const delta =
    data.prev_month_total > 0
      ? ((data.month_total - data.prev_month_total) / data.prev_month_total) * 100
      : null;

  return (
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
      <Header />

      {/* Faturamento mensal em destaque */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Faturamento do mês</Text>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
          {brl(data.month_total)}
        </Text>
        <View style={styles.heroMeta}>
          <Text style={styles.heroMetaText}>
            {data.month_count} {data.month_count === 1 ? 'venda' : 'vendas'}
          </Text>
          <Text style={styles.heroDot}>•</Text>
          <Text style={styles.heroMetaText}>
            ticket {brl(data.avg_ticket_month)}
          </Text>
          {delta !== null ? (
            <>
              <Text style={styles.heroDot}>•</Text>
              <View style={styles.heroDelta}>
                {delta >= 0 ? (
                  <TrendingUp size={13} strokeWidth={2.1} color={colors.success} />
                ) : (
                  <TrendingDown size={13} strokeWidth={2.1} color={colors.danger} />
                )}
                <Text
                  style={[
                    styles.heroMetaText,
                    { color: delta >= 0 ? colors.success : colors.danger },
                  ]}
                >
                  {Math.abs(delta).toFixed(0)}% vs mês ant.
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      {/* Semanal + Diário */}
      <View style={styles.row}>
        <StatTile
          label="Semana"
          value={brl(data.week_total)}
          hint={`${data.week_count} ${data.week_count === 1 ? 'venda' : 'vendas'}`}
        />
        <StatTile
          label="Hoje"
          value={brl(data.today_total)}
          hint={`${data.today_count} ${data.today_count === 1 ? 'venda' : 'vendas'}`}
          tone="accent"
        />
      </View>

      {/* Consumo de insumos */}
      <View style={styles.block}>
        <SectionTitle>Consumo de insumos</SectionTitle>
        <Card>
          <View style={styles.insumoHead}>
            <Text style={styles.insumoHeadCell} />
            <Text style={styles.insumoHeadCell}>Hoje</Text>
            <Text style={styles.insumoHeadCell}>Semana</Text>
            <Text style={styles.insumoHeadCell}>Mês</Text>
          </View>

          <View style={styles.insumoLine}>
            <View style={styles.insumoNameCell}>
              <Beef size={15} strokeWidth={STROKE} color={colors.accent} />
              <Text style={styles.insumoName}>Carne</Text>
            </View>
            <Text style={styles.insumoCell}>{formatMeat(data.today_meat)}</Text>
            <Text style={styles.insumoCell}>{formatMeat(data.week_meat)}</Text>
            <Text style={[styles.insumoCell, styles.insumoCellStrong]}>
              {formatMeat(data.month_meat)}
            </Text>
          </View>

          <View style={[styles.insumoLine, { borderBottomWidth: 0 }]}>
            <View style={styles.insumoNameCell}>
              <Croissant size={15} strokeWidth={STROKE} color={colors.accent} />
              <Text style={styles.insumoName}>Pães</Text>
            </View>
            <Text style={styles.insumoCell}>{data.today_buns}</Text>
            <Text style={styles.insumoCell}>{data.week_buns}</Text>
            <Text style={[styles.insumoCell, styles.insumoCellStrong]}>
              {data.month_buns}
            </Text>
          </View>
        </Card>
      </View>

      {/* Tendência 7 dias */}
      <View style={styles.block}>
        <SectionTitle>Últimos 7 dias</SectionTitle>
        <Card>
          <TrendBars data={data.last_7_days ?? []} />
        </Card>
      </View>

      {/* Mix de categorias */}
      <View style={styles.block}>
        <SectionTitle>Mix do mês</SectionTitle>
        <Card>
          <MiniBar
            label="Comida"
            value={data.month_food}
            max={maxMix}
            color={colors.accent}
          />
          <MiniBar
            label="Bebida"
            value={data.month_drink}
            max={maxMix}
            color={colors.info}
          />
          <MiniBar
            label="Extra"
            value={data.month_extra}
            max={maxMix}
            color={colors.success}
          />
        </Card>
      </View>

      {/* Top produtos */}
      {data.top_products?.length ? (
        <View style={styles.block}>
          <SectionTitle>Mais vendidos no mês</SectionTitle>
          <Card>
            {data.top_products.map((p, idx) => (
              <View
                key={`${p.name}-${idx}`}
                style={[
                  styles.topRow,
                  idx === data.top_products.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <Text style={styles.topRank}>{idx + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.topName} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.topQty}>{p.qty} un.</Text>
                </View>
                <Text style={styles.topTotal}>{brl(p.total)}</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {/* Preferências (mussarela vs cheddar, zero vs normal) */}
      {data.top_options?.length ? (
        <View style={styles.block}>
          <SectionTitle>Preferências do mês</SectionTitle>
          <Card>
            {Object.entries(
              data.top_options.reduce<Record<string, typeof data.top_options>>(
                (acc, o) => {
                  (acc[o.group_name] ??= []).push(o);
                  return acc;
                },
                {}
              )
            ).map(([groupName, options], gi, arr) => {
              const groupTotal = options.reduce((s, o) => s + o.qty, 0);
              return (
                <View
                  key={groupName}
                  style={[
                    styles.prefGroup,
                    gi === arr.length - 1 && { borderBottomWidth: 0, marginBottom: 0 },
                  ]}
                >
                  <Text style={styles.prefGroupName}>{groupName}</Text>
                  {options.map((o) => {
                    const pct = groupTotal > 0 ? (o.qty / groupTotal) * 100 : 0;
                    return (
                      <View key={o.value_name} style={styles.prefRow}>
                        <Text style={styles.prefName} numberOfLines={1}>
                          {o.value_name}
                        </Text>
                        <View style={styles.prefTrack}>
                          <View
                            style={[styles.prefFill, { width: `${pct}%` }]}
                          />
                        </View>
                        <Text style={styles.prefQty}>
                          {o.qty} · {pct.toFixed(0)}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </Card>
        </View>
      ) : null}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

function Header() {
  const now = new Date();
  const month = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>
        {month.charAt(0).toUpperCase() + month.slice(1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: font.h1,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: font.small,
    marginTop: 2,
  },
  heroCard: {
    backgroundColor: colors.navActiveBg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(43,168,74,0.3)',
    padding: spacing.xl,
    marginBottom: spacing.md,
  },
  heroLabel: {
    color: colors.accentSoft,
    fontSize: font.tiny,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  heroValue: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '800',
    marginTop: spacing.sm,
    letterSpacing: -1,
  },
  heroMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  heroMetaText: {
    color: colors.textMuted,
    fontSize: font.small,
  },
  heroDelta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroDot: {
    color: colors.textFaint,
    fontSize: font.small,
    marginHorizontal: 2,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  block: {
    marginTop: spacing.xl,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 130,
    gap: spacing.xs,
  },
  trendCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
  },
  trendValue: {
    color: colors.textFaint,
    fontSize: 9,
    marginBottom: 4,
  },
  trendTrack: {
    flex: 1,
    width: '100%',
    maxWidth: 26,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  trendFill: {
    width: '100%',
    borderRadius: radius.sm,
    minHeight: 4,
  },
  trendDay: {
    color: colors.textMuted,
    fontSize: font.tiny,
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  topRank: {
    color: colors.accent,
    fontSize: font.small,
    fontWeight: '700',
    width: 18,
  },
  topName: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '600',
  },
  topQty: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: 2,
  },
  topTotal: {
    color: colors.text,
    fontSize: font.body,
    fontWeight: '700',
  },
  insumoHead: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  insumoHeadCell: {
    flex: 1,
    color: colors.textFaint,
    fontSize: font.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'right',
  },
  insumoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  insumoNameCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  insumoName: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: '600',
  },
  insumoCell: {
    flex: 1,
    color: colors.textMuted,
    fontSize: font.small,
    textAlign: 'right',
  },
  insumoCellStrong: {
    color: colors.accent,
    fontWeight: '700',
  },
  prefGroup: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prefGroupName: {
    color: colors.textMuted,
    fontSize: font.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  prefName: {
    color: colors.text,
    fontSize: font.small,
    width: 96,
  },
  prefTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  prefFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  prefQty: {
    color: colors.textMuted,
    fontSize: font.tiny,
    width: 66,
    textAlign: 'right',
  },
});
