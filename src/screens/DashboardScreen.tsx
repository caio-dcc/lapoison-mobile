import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  customerPhotoUrl,
  fetchCustomerRankings,
  fetchDashboard,
} from '../lib/api';
import type {
  CustomerRankings,
  DashboardOverview,
  TopByProduct,
  TopSpender,
} from '../lib/types';
import { formatMeat } from '../lib/types';
import { alpha, brl, brlCompact, colors, family, font, radius, spacing } from '../theme';
import {
  Beef,
  Croissant,
  Crown,
  Medal,
  Receipt,
  TrendingDown,
  TrendingUp,
  Users,
  STROKE,
} from '../components/icons';
import {
  Avatar,
  Card,
  EmptyState,
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
  const [ranks, setRanks] = useState<CustomerRankings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      setError(null);
      // Em paralelo: os rankings não atrasam o resto do dashboard.
      const [result, rankResult] = await Promise.all([
        fetchDashboard(force),
        fetchCustomerRankings(force).catch(() => null),
      ]);
      setData(result);
      setRanks(rankResult);
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
          <View style={styles.heroDot} />
          <Text style={styles.heroMetaText}>
            ticket {brl(data.avg_ticket_month)}
          </Text>
          {delta !== null ? (
            <>
              <View style={styles.heroDot} />
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
            color={alpha.p80}
          />
          <MiniBar
            label="Bebida"
            value={data.month_drink}
            max={maxMix}
            color={alpha.p40}
          />
          <MiniBar
            label="Extra"
            value={data.month_extra}
            max={maxMix}
            color={alpha.p24}
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

      {/* Clientes: quem gastou mais e quem mais consumiu cada item */}
      <CustomerRanks ranks={ranks} />

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

/**
 * Duas abas: ranking por valor gasto e, por item, o cliente que mais
 * consumiu. Tudo pré-agregado no banco — aqui é só render.
 */
function CustomerRanks({ ranks }: { ranks: CustomerRankings | null }) {
  const [view, setView] = useState<'gasto' | 'item'>('gasto');

  if (!ranks) return null;

  const spenders = ranks.top_spenders ?? [];
  const byProduct = ranks.top_by_product ?? [];

  if (spenders.length === 0 && byProduct.length === 0) {
    return (
      <View style={styles.block}>
        <SectionTitle>Clientes</SectionTitle>
        <Card>
          <EmptyState
            Icon={Users}
            title="Nenhuma venda com cliente ainda"
            subtitle="Cadastre clientes e associe-os às vendas para ver os rankings aqui."
          />
        </Card>
      </View>
    );
  }

  const maxSpent = spenders.length > 0 ? spenders[0].total_spent : 0;

  return (
    <View style={styles.block}>
      <SectionTitle>Clientes</SectionTitle>

      <View style={styles.rankTabs}>
        <Pressable
          onPress={() => setView('gasto')}
          style={[styles.rankTab, view === 'gasto' && styles.rankTabOn]}
        >
          <Crown
            size={14}
            strokeWidth={STROKE}
            color={view === 'gasto' ? colors.text : colors.textMuted}
          />
          <Text style={[styles.rankTabText, view === 'gasto' && styles.rankTabTextOn]}>
            Quem gastou mais
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('item')}
          style={[styles.rankTab, view === 'item' && styles.rankTabOn]}
        >
          <Medal
            size={14}
            strokeWidth={STROKE}
            color={view === 'item' ? colors.text : colors.textMuted}
          />
          <Text style={[styles.rankTabText, view === 'item' && styles.rankTabTextOn]}>
            Por item
          </Text>
        </Pressable>
      </View>

      <Card>
        {view === 'gasto' ? (
          spenders.length === 0 ? (
            <Text style={styles.rankEmpty}>Nenhuma venda associada a cliente.</Text>
          ) : (
            spenders.map((c, idx) => (
              <View
                key={c.id}
                style={[
                  styles.rankRow,
                  idx === spenders.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <Text style={styles.rankPos}>{idx + 1}</Text>
                <Avatar name={c.name} uri={customerPhotoUrl(c.photo_path)} size={34} />
                <View style={styles.rankBody}>
                  <Text style={styles.rankName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <View style={styles.rankTrack}>
                    <View
                      style={[
                        styles.rankFill,
                        {
                          width: `${
                            maxSpent > 0 ? (c.total_spent / maxSpent) * 100 : 0
                          }%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.rankMeta}>
                    {c.sales_count} venda{c.sales_count === 1 ? '' : 's'} · ticket{' '}
                    {brl(c.avg_ticket)}
                  </Text>
                </View>
                <Text style={styles.rankValue}>{brl(c.total_spent)}</Text>
              </View>
            ))
          )
        ) : byProduct.length === 0 ? (
          <Text style={styles.rankEmpty}>Nenhum item vendido a cliente cadastrado.</Text>
        ) : (
          byProduct.map((r, idx) => (
            <View
              key={`${r.product_name}-${r.customer_id}`}
              style={[
                styles.rankRow,
                idx === byProduct.length - 1 && { borderBottomWidth: 0 },
              ]}
            >
              <Avatar
                name={r.customer_name}
                uri={customerPhotoUrl(r.photo_path)}
                size={34}
              />
              <View style={styles.rankBody}>
                <Text style={styles.rankName} numberOfLines={1}>
                  {r.product_name}
                </Text>
                <Text style={styles.rankMeta} numberOfLines={1}>
                  {r.customer_name}
                </Text>
              </View>
              <View style={styles.rankQtyBox}>
                <Text style={styles.rankValue}>{r.qty}x</Text>
                <Text style={styles.rankMetaRight}>{brl(r.total)}</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
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
  rankTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rankTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rankTabOn: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.borderStrong,
  },
  rankTabText: {
    fontFamily: family.bodySemi,
    fontSize: font.tiny,
    color: colors.textMuted,
  },
  rankTabTextOn: { color: colors.text },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: alpha.p06,
  },
  rankPos: {
    fontFamily: family.displayBold,
    fontSize: font.small,
    color: colors.textFaint,
    width: 14,
  },
  rankBody: { flex: 1 },
  rankName: {
    fontFamily: family.bodySemi,
    fontSize: font.small,
    color: colors.text,
  },
  rankTrack: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: alpha.p08,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  rankFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: alpha.p60,
  },
  rankMeta: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
    marginTop: 2,
  },
  rankMetaRight: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
    textAlign: 'right',
  },
  rankValue: {
    fontFamily: family.displayBold,
    fontSize: font.small,
    color: colors.text,
    textAlign: 'right',
  },
  rankQtyBox: { alignItems: 'flex-end' },
  rankEmpty: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textFaint,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
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
    fontFamily: family.displayBold,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: font.small,
    marginTop: 2,
  },
  heroCard: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.xl,
    marginBottom: spacing.md,
  },
  heroLabel: {
    color: colors.textMuted,
    fontSize: font.tiny,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: family.bodySemi,
  },
  heroValue: {
    color: colors.text,
    fontSize: 36,
    fontFamily: family.displayBold,
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
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textFaint,
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
    fontFamily: family.bodySemi,
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
    fontFamily: family.displayBold,
    width: 18,
  },
  topName: {
    color: colors.text,
    fontSize: font.body,
    fontFamily: family.bodySemi,
  },
  topQty: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: 2,
  },
  topTotal: {
    color: colors.text,
    fontSize: font.body,
    fontFamily: family.displayBold,
  },
  insumoHead: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  insumoHeadCell: {
    flex: 1,
    color: colors.textFaint,
    fontSize: font.tiny,
    fontFamily: family.displayBold,
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
    fontFamily: family.bodySemi,
  },
  insumoCell: {
    flex: 1,
    color: colors.textMuted,
    fontSize: font.small,
    textAlign: 'right',
  },
  insumoCellStrong: {
    color: colors.accent,
    fontFamily: family.displayBold,
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
    fontFamily: family.displayBold,
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
