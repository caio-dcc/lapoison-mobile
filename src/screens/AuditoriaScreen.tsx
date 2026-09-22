/**
 * Auditoria — trilha de CRUD. Lê a tabela audit_log (mantida por
 * triggers em products, customers, sales, day_notes e day_photos).
 *
 * O operador (Kaio/Matheus) só é confiável em vendas — ver comentário
 * em supabase/migrations/0008_auditoria.sql sobre por que clientes e
 * produtos ainda não carregam o operador.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchAuditCount, fetchAuditFeed, type AuditEntry } from '../lib/api';
import { alpha, colors, family, font, radius, spacing } from '../theme';
import { Card, EmptyState, ErrorState, Skeleton } from '../components/ui';
import {
  CalendarDays,
  ClipboardList,
  Pencil,
  Plus,
  ScrollText,
  STROKE,
  Trash2,
  User,
  Users,
} from '../components/icons';
import type { LucideIcon } from 'lucide-react-native';

const PAGE_SIZE = 40;

const TABLE_LABELS: Record<string, string> = {
  products: 'Produto',
  customers: 'Cliente',
  sales: 'Venda',
  day_notes: 'Nota do dia',
  day_photos: 'Foto do dia',
};

const TABLE_ICONS: Record<string, LucideIcon> = {
  products: ClipboardList,
  customers: Users,
  sales: ScrollText,
  day_notes: CalendarDays,
  day_photos: CalendarDays,
};

const OP_LABELS: Record<AuditEntry['operation'], string> = {
  INSERT: 'Criado',
  UPDATE: 'Editado',
  DELETE: 'Removido',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OpIcon({ operation }: { operation: AuditEntry['operation'] }) {
  if (operation === 'INSERT') {
    return <Plus size={13} strokeWidth={STROKE} color={colors.textMuted} />;
  }
  if (operation === 'DELETE') {
    return <Trash2 size={13} strokeWidth={STROKE} color={colors.danger} />;
  }
  return <Pencil size={13} strokeWidth={STROKE} color={colors.textMuted} />;
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const Icon = TABLE_ICONS[entry.table_name] ?? ScrollText;
  const tableLabel = TABLE_LABELS[entry.table_name] ?? entry.table_name;

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon size={16} strokeWidth={STROKE} color={colors.textMuted} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <OpIcon operation={entry.operation} />
          <Text style={styles.rowTitle} numberOfLines={1}>
            {OP_LABELS[entry.operation]} · {tableLabel}
          </Text>
        </View>
        {entry.summary ? (
          <Text style={styles.rowSummary} numberOfLines={1}>
            {entry.summary}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Text style={styles.rowWhen}>{formatWhen(entry.at)}</Text>
          {entry.operator ? (
            <View style={styles.operatorChip}>
              <User size={10} strokeWidth={STROKE} color={colors.textMuted} />
              <Text style={styles.operatorText}>{entry.operator}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function AuditoriaScreen() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [feed, count] = await Promise.all([
        fetchAuditFeed(PAGE_SIZE, 0),
        fetchAuditCount(),
      ]);
      setEntries(feed);
      setTotal(count);
      setHasMore(feed.length < count);
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar auditoria');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!entries || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchAuditFeed(PAGE_SIZE, entries.length);
      setEntries((prev) => [...(prev ?? []), ...next]);
      setHasMore(entries.length + next.length < total);
    } catch {
      // silencioso: a lista já carregada continua utilizável
    } finally {
      setLoadingMore(false);
    }
  }, [entries, loadingMore, hasMore, total]);

  if (error && !entries) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Auditoria</Text>
        <ErrorState message={error} onRetry={load} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Auditoria</Text>
        <Text style={styles.subtitle}>
          {total > 0 ? `${total} registro${total === 1 ? '' : 's'}` : '—'}
        </Text>
      </View>

      {entries === null ? (
        <View style={styles.content}>
          <Skeleton height={64} style={{ marginBottom: spacing.sm }} />
          <Skeleton height={64} style={{ marginBottom: spacing.sm }} />
          <Skeleton height={64} />
        </View>
      ) : entries.length === 0 ? (
        <EmptyState
          Icon={ScrollText}
          title="Nenhum registro ainda"
          subtitle="Cada venda, cadastro de cliente ou produto aparece aqui assim que acontecer."
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.text}
            />
          }
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <AuditRow entry={item} />
            </Card>
          )}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListFooterComponent={
            loadingMore ? (
              <Skeleton height={64} style={{ marginTop: spacing.sm }} />
            ) : (
              <View style={{ height: 120 }} />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  title: {
    fontFamily: family.displayBold,
    fontSize: font.h1,
    color: colors.text,
  },
  subtitle: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  content: { paddingHorizontal: spacing.lg },
  card: { padding: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha.p06,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowTitle: {
    fontFamily: family.bodySemi,
    fontSize: font.small,
    color: colors.text,
    flexShrink: 1,
  },
  rowSummary: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  rowWhen: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
  },
  operatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: alpha.p08,
  },
  operatorText: {
    fontFamily: family.bodyMedium,
    fontSize: font.tiny,
    color: colors.textMuted,
  },
});
