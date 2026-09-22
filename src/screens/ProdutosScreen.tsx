import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import {
  deactivateProduct,
  fetchProducts,
  groupByCategory,
  upsertProduct,
} from '../lib/api';
import type { Product, ProductCategory } from '../lib/types';
import { formatMeat } from '../lib/types';
import { alpha, brl, colors, family, font, radius, spacing } from '../theme';
import {
  Beef,
  Beer,
  Croissant,
  Hamburger,
  Pencil,
  Plus,
  STROKE,
} from '../components/icons';
import type { LucideIcon } from 'lucide-react-native';
import {
  Card,
  ErrorState,
  PrimaryButton,
  SectionTitle,
  Skeleton,
} from '../components/ui';

const CATEGORY_META: Record<ProductCategory, { label: string; Icon: LucideIcon }> = {
  comida: { label: 'Comida', Icon: Hamburger },
  bebida: { label: 'Bebida', Icon: Beer },
  extra: { label: 'Extra', Icon: Plus },
};

const CATEGORY_ORDER: ProductCategory[] = ['comida', 'bebida', 'extra'];

/** Converte "18,50" ou "18.50" em número. */
function parseNum(text: string): number {
  const n = parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function ProductForm({
  visible,
  editing,
  defaultCategory,
  onClose,
  onSaved,
}: {
  visible: boolean;
  editing: Product | null;
  defaultCategory: ProductCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProductCategory>(defaultCategory);
  const [price, setPrice] = useState('');
  const [meat, setMeat] = useState('');
  const [buns, setBuns] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setName(editing.name);
      setCategory(editing.category);
      setPrice(String(editing.price).replace('.', ','));
      setMeat(editing.meat_grams ? String(editing.meat_grams) : '');
      setBuns(editing.bun_count ? String(editing.bun_count) : '');
    } else {
      setName('');
      setCategory(defaultCategory);
      setPrice('');
      setMeat('');
      setBuns('');
    }
  }, [visible, editing, defaultCategory]);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Nome obrigatório', 'Informe o nome do produto.');
      return;
    }
    setSaving(true);
    try {
      await upsertProduct({
        id: editing?.id,
        name: name.trim(),
        category,
        price: parseNum(price),
        meat_grams: Math.round(parseNum(meat)),
        bun_count: Math.round(parseNum(buns)),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Erro ao salvar', e?.message ?? 'Tente novamente.');
    } finally {
      setSaving(false);
    }
  }, [name, category, price, meat, buns, editing, onSaved, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {editing ? 'Editar produto' : 'Novo produto'}
            </Text>

            <ScrollView
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>Nome</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Ex.: A La Cheese"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>Categoria</Text>
              <View style={styles.catRow}>
                {CATEGORY_ORDER.map((cat) => {
                  const active = cat === category;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setCategory(cat)}
                      style={[styles.catBtn, active && styles.catBtnActive]}
                    >
                      {React.createElement(CATEGORY_META[cat].Icon, {
                        size: 20,
                        strokeWidth: STROKE,
                        color: active ? colors.accent : colors.textMuted,
                        style: styles.catIcon,
                      })}
                      <Text
                        style={[
                          styles.catLabel,
                          active && { color: colors.accent },
                        ]}
                      >
                        {CATEGORY_META[cat].label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Preço (R$)</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="0,00"
                placeholderTextColor={colors.textFaint}
                keyboardType="decimal-pad"
                style={styles.input}
              />

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Carne (g)</Text>
                  <TextInput
                    value={meat}
                    onChangeText={setMeat}
                    placeholder="0"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Pães</Text>
                  <TextInput
                    value={buns}
                    onChangeText={setBuns}
                    placeholder="0"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>
              </View>

              <Text style={styles.fieldHint}>
                Carne e pães alimentam a contagem de insumos do dashboard.
              </Text>

              <View style={{ height: spacing.lg }} />
            </ScrollView>

            <PrimaryButton
              label={editing ? 'Salvar alterações' : 'Cadastrar produto'}
              onPress={submit}
              loading={saving}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ProdutosScreen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ProductCategory>('comida');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      setError(null);
      setProducts(await fetchProducts(force));
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar produtos');
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

  const groups = useMemo(
    () => (products ? groupByCategory(products) : null),
    [products]
  );

  const confirmRemove = useCallback(
    (product: Product) => {
      Alert.alert(
        'Remover produto',
        `"${product.name}" deixará de aparecer no registro de vendas. O histórico é preservado.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Remover',
            style: 'destructive',
            onPress: async () => {
              try {
                await deactivateProduct(product.id);
                await load(true);
              } catch (e: any) {
                Alert.alert('Erro', e?.message ?? 'Falha ao remover.');
              }
            },
          },
        ]
      );
    },
    [load]
  );

  if (error && !products) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Produtos</Text>
        <ErrorState message={error} onRetry={() => load(true)} />
      </ScrollView>
    );
  }

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
          <Text style={styles.title}>Produtos</Text>
          <Text style={styles.subtitle}>
            Cadastre itens e a ficha técnica de insumos
          </Text>
        </View>

        <View style={styles.block}>
          <View style={styles.catRow}>
            {CATEGORY_ORDER.map((cat) => {
              const active = cat === category;
              const count = groups?.[cat].length ?? 0;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[styles.catBtn, active && styles.catBtnActive]}
                >
                  {React.createElement(CATEGORY_META[cat].Icon, {
                    size: 20,
                    strokeWidth: STROKE,
                    color: active ? colors.accent : colors.textMuted,
                    style: styles.catIcon,
                  })}
                  <Text
                    style={[styles.catLabel, active && { color: colors.accent }]}
                  >
                    {CATEGORY_META[cat].label}
                  </Text>
                  {count > 0 ? (
                    <Text style={styles.catCount}>{count}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.block}>
          <SectionTitle>{CATEGORY_META[category].label}</SectionTitle>
          {!groups ? (
            <>
              <Skeleton height={64} style={{ marginBottom: spacing.sm }} />
              <Skeleton height={64} style={{ marginBottom: spacing.sm }} />
              <Skeleton height={64} />
            </>
          ) : groups[category].length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                Nenhum produto nesta categoria.
              </Text>
            </Card>
          ) : (
            groups[category].map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  setEditing(p);
                  setFormOpen(true);
                }}
                onLongPress={() => confirmRemove(p)}
                style={styles.productRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <View style={styles.productMetaRow}>
                    <Text style={styles.productMeta}>{brl(p.price)}</Text>
                    {p.meat_grams > 0 ? (
                      <View style={styles.metaChip}>
                        <Beef size={12} strokeWidth={STROKE} color={colors.textMuted} />
                        <Text style={styles.productMeta}>
                          {formatMeat(p.meat_grams)}
                        </Text>
                      </View>
                    ) : null}
                    {p.bun_count > 0 ? (
                      <View style={styles.metaChip}>
                        <Croissant size={12} strokeWidth={STROKE} color={colors.textMuted} />
                        <Text style={styles.productMeta}>{p.bun_count}</Text>
                      </View>
                    ) : null}
                  </View>
                  {(p.option_groups ?? []).length > 0 ? (
                    <Text style={styles.productOpts} numberOfLines={1}>
                      {(p.option_groups ?? []).map((g) => g.name).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <Pencil size={15} strokeWidth={STROKE} color={colors.textFaint} />
              </Pressable>
            ))
          )}
          <Text style={styles.hint}>
            Toque para editar · segure para remover
          </Text>
        </View>

        <View style={{ height: 150 }} />
      </ScrollView>

      {/* Botão flutuante de novo produto */}
      <Pressable
        onPress={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        style={styles.fab}
      >
        <Plus size={26} strokeWidth={2.2} color="#fff" />
      </Pressable>

      <ProductForm
        visible={formOpen}
        editing={editing}
        defaultCategory={category}
        onClose={() => setFormOpen(false)}
        onSaved={() => load(true)}
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
    fontFamily: family.displayBold,
    letterSpacing: -0.5,
  },
  subtitle: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  block: { marginBottom: spacing.xl },
  catRow: { flexDirection: 'row', gap: spacing.sm },
  catBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catBtnActive: {
    backgroundColor: colors.navActiveBg,
    borderColor: colors.accent,
  },
  catIcon: { marginBottom: 4 },
  catLabel: { color: colors.textMuted, fontSize: font.small, fontFamily: family.bodySemi },
  catCount: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  productName: { color: colors.text, fontSize: font.body, fontFamily: family.bodySemi },
  productMeta: { color: colors.textMuted, fontSize: font.small },
  productMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 3,
  },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  productOpts: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  emptyText: {
    color: colors.textMuted,
    fontSize: font.small,
    textAlign: 'center',
  },
  hint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 130,
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.h3,
    fontFamily: family.displayBold,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: font.tiny,
    fontFamily: family.displayBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  fieldHint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: font.body,
  },
  rowFields: { flexDirection: 'row', gap: spacing.md },
});
