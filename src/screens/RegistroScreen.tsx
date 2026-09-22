import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createSale,
  customerPhotoUrl,
  fetchCustomers,
  fetchProducts,
  groupByCategory,
  itemMeatGrams,
  itemUnitPrice,
  upsertCustomer,
} from '../lib/api';
import type {
  ChosenOption,
  Customer,
  OptionValue,
  PaymentMethod,
  Product,
  ProductCategory,
  SaleItem,
} from '../lib/types';
import { PAYMENT_LABELS, formatMeat, formatPhone } from '../lib/types';
import { alpha, brl, colors, family, font, radius, spacing } from '../theme';
import {
  Beef,
  Beer,
  Check,
  Croissant,
  Hamburger,
  Minus,
  Plus,
  STROKE,
  Search,
  User,
  UserPlus,
  X,
} from '../components/icons';
import type { LucideIcon } from 'lucide-react-native';
import {
  Avatar,
  Card,
  Chip,
  ErrorState,
  PrimaryButton,
  SectionTitle,
  Skeleton,
} from '../components/ui';
import Glass from '../components/Glass';

const CATEGORY_META: Record<ProductCategory, { label: string; Icon: LucideIcon }> = {
  comida: { label: 'Comida', Icon: Hamburger },
  bebida: { label: 'Bebida', Icon: Beer },
  extra: { label: 'Extra', Icon: Plus },
};

const CATEGORY_ORDER: ProductCategory[] = ['comida', 'bebida', 'extra'];

/** Chave local que distingue o mesmo produto com opções diferentes. */
function cartKey(productId: string, options: ChosenOption[]): string {
  const sig = options
    .map((o) => `${o.group_name}=${o.value_name}`)
    .sort()
    .join('|');
  return sig ? `${productId}::${sig}` : productId;
}

/** Folha de escolha de opções (queijo, versão, blend…). */
function OptionSheet({
  product,
  onCancel,
  onConfirm,
}: {
  product: Product | null;
  onCancel: () => void;
  onConfirm: (options: ChosenOption[]) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, OptionValue>>({});

  useEffect(() => {
    if (!product) {
      setChosen({});
      return;
    }
    // Pré-seleciona a primeira opção dos grupos obrigatórios.
    const initial: Record<string, OptionValue> = {};
    for (const g of product.option_groups ?? []) {
      if (g.required && g.values[0]) initial[g.name] = g.values[0];
    }
    setChosen(initial);
  }, [product]);

  if (!product) return null;

  const groups = product.option_groups ?? [];
  const missing = groups.filter((g) => g.required && !chosen[g.name]);

  const extra = Object.values(chosen).reduce(
    (sum, v) => sum + (v.price_delta ?? 0),
    0
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{product.name}</Text>
          <Text style={styles.sheetSubtitle}>
            {brl(product.price)}
            {product.meat_grams > 0
              ? ` · ${formatMeat(product.meat_grams)} de carne`
              : ''}
          </Text>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {groups.map((group) => (
              <View key={group.id} style={styles.sheetGroup}>
                <Text style={styles.sheetGroupName}>
                  {group.name}
                  {group.required ? (
                    <Text style={{ color: colors.accent }}> *</Text>
                  ) : (
                    <Text style={styles.sheetOptional}> (opcional)</Text>
                  )}
                </Text>
                <View style={styles.sheetOptions}>
                  {group.values.map((value) => {
                    const selected = chosen[group.name]?.id === value.id;
                    return (
                      <Pressable
                        key={value.id}
                        onPress={() =>
                          setChosen((prev) => {
                            const copy = { ...prev };
                            // Toca de novo em grupo opcional = desmarca
                            if (selected && !group.required) {
                              delete copy[group.name];
                            } else {
                              copy[group.name] = value;
                            }
                            return copy;
                          })
                        }
                        style={[
                          styles.optionBtn,
                          selected && styles.optionBtnSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            selected && { color: colors.accent },
                          ]}
                        >
                          {value.name}
                        </Text>
                        {value.price_delta > 0 ? (
                          <Text style={styles.optionDelta}>
                            +{brl(value.price_delta)}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <View style={{ height: spacing.md }} />
          </ScrollView>

          <View style={styles.sheetFooter}>
            <View>
              <Text style={styles.sheetFooterLabel}>Valor do item</Text>
              <Text style={styles.sheetFooterValue}>
                {brl(product.price + extra)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="Adicionar"
                disabled={missing.length > 0}
                onPress={() =>
                  onConfirm(
                    Object.entries(chosen).map(([groupName, value]) => ({
                      group_name: groupName,
                      value_name: value.name,
                      price_delta: value.price_delta ?? 0,
                      meat_delta: value.meat_delta ?? 0,
                    }))
                  )
                }
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ProductRow({
  product,
  quantity,
  onPress,
  onRemove,
}: {
  product: Product;
  quantity: number;
  onPress: () => void;
  onRemove: () => void;
}) {
  const selected = quantity > 0;
  const hasOptions = (product.option_groups ?? []).length > 0;

  return (
    <View style={[styles.productRow, selected && styles.productRowSelected]}>
      <Pressable onPress={onPress} style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.productMeta}>
          {brl(product.price)}
          {product.meat_grams > 0 ? ` · ${formatMeat(product.meat_grams)}` : ''}
          {hasOptions ? ' · opções' : ''}
        </Text>
      </Pressable>

      {selected ? (
        <View style={styles.stepper}>
          <Pressable onPress={onRemove} style={styles.stepBtn} hitSlop={6}>
            <Minus size={16} strokeWidth={2.4} color="#fff" />
          </Pressable>
          <Text style={styles.stepQty}>{quantity}</Text>
          <Pressable onPress={onPress} style={styles.stepBtn} hitSlop={6}>
            <Plus size={16} strokeWidth={2.4} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onPress} style={styles.addBtn} hitSlop={6}>
          <Plus size={18} strokeWidth={2.2} color={colors.text} />
        </Pressable>
      )}
    </View>
  );
}

export default function RegistroScreen({ onSaved }: { onSaved?: () => void }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ProductCategory>('comida');
  const [cart, setCart] = useState<SaleItem[]>([]);
  // Cliente é cadastrado antes da venda e associado a ela.
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setProducts(await fetchProducts());
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar produtos');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(
    () => (products ? groupByCategory(products) : null),
    [products]
  );

  /** Soma das quantidades de um produto, somando todas as variantes. */
  const qtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) {
      map.set(item.product_id, (map.get(item.product_id) ?? 0) + item.quantity);
    }
    return map;
  }, [cart]);

  const addToCart = useCallback(
    (product: Product, options: ChosenOption[]) => {
      const key = cartKey(product.id, options);
      setCart((prev) => {
        const idx = prev.findIndex((i) => i.key === key);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
          return copy;
        }
        return [
          ...prev,
          {
            key,
            product_id: product.id,
            name: product.name,
            category: product.category,
            unit_price: product.price,
            quantity: 1,
            meat_grams: product.meat_grams,
            bun_count: product.bun_count,
            options,
          },
        ];
      });
    },
    []
  );

  const handleProductPress = useCallback(
    (product: Product) => {
      if ((product.option_groups ?? []).length > 0) {
        setSheetProduct(product);
      } else {
        addToCart(product, []);
      }
    },
    [addToCart]
  );

  /** Remove uma unidade da última variante adicionada do produto. */
  const removeOne = useCallback((productId: string) => {
    setCart((prev) => {
      const idx = [...prev]
        .reverse()
        .findIndex((i) => i.product_id === productId);
      if (idx < 0) return prev;
      const realIdx = prev.length - 1 - idx;
      const copy = [...prev];
      if (copy[realIdx].quantity > 1) {
        copy[realIdx] = {
          ...copy[realIdx],
          quantity: copy[realIdx].quantity - 1,
        };
      } else {
        copy.splice(realIdx, 1);
      }
      return copy;
    });
  }, []);

  const total = useMemo(
    () => cart.reduce((sum, i) => sum + itemUnitPrice(i) * i.quantity, 0),
    [cart]
  );

  const totalMeat = useMemo(
    () => cart.reduce((sum, i) => sum + itemMeatGrams(i) * i.quantity, 0),
    [cart]
  );

  const totalBuns = useMemo(
    () => cart.reduce((sum, i) => sum + i.bun_count * i.quantity, 0),
    [cart]
  );

  const reset = useCallback(() => {
    setCart([]);
    setCustomer(null);
    setPayment(null);
    setCategory('comida');
  }, []);

  const submit = useCallback(async () => {
    if (cart.length === 0) return;
    setSaving(true);
    try {
      await createSale({
        customerName: customer?.name ?? '',
        customerId: customer?.id ?? null,
        items: cart,
        paymentMethod: payment,
      });
      reset();
      onSaved?.();
      Alert.alert('Venda registrada', `Total ${brl(total)} salvo com sucesso.`);
    } catch (e: any) {
      Alert.alert('Erro ao salvar', e?.message ?? 'Tente novamente.');
    } finally {
      setSaving(false);
    }
  }, [cart, customer, payment, total, reset, onSaved]);

  if (error && !products) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Registro de venda</Text>
        <ErrorState message={error} onRetry={load} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Registro de venda</Text>
          <Text style={styles.subtitle}>
            Selecione os itens e confirme o pedido
          </Text>
        </View>

        <View style={styles.block}>
          <SectionTitle>Cliente</SectionTitle>
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={styles.customerBtn}
            accessibilityRole="button"
            accessibilityLabel="Escolher cliente"
          >
            {customer ? (
              <>
                <Avatar
                  name={customer.name}
                  uri={customerPhotoUrl(customer.photo_path)}
                  size={38}
                />
                <View style={styles.customerBody}>
                  <Text style={styles.customerName} numberOfLines={1}>
                    {customer.name}
                  </Text>
                  {customer.phone ? (
                    <Text style={styles.customerMeta}>
                      {formatPhone(customer.phone)}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setCustomer(null)}
                  hitSlop={10}
                  accessibilityLabel="Remover cliente da venda"
                >
                  <X size={17} strokeWidth={STROKE} color={colors.textMuted} />
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.customerEmptyIcon}>
                  <User size={18} strokeWidth={STROKE} color={colors.textMuted} />
                </View>
                <Text style={styles.customerPlaceholder}>
                  Associar a um cliente (opcional)
                </Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.block}>
          <SectionTitle>Categoria</SectionTitle>
          <View style={styles.catRow}>
            {CATEGORY_ORDER.map((cat) => {
              const meta = CATEGORY_META[cat];
              const active = cat === category;
              const count = cart
                .filter((i) => i.category === cat)
                .reduce((s, i) => s + i.quantity, 0);
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[styles.catBtn, active && styles.catBtnActive]}
                >
                  <meta.Icon
                    size={20}
                    strokeWidth={STROKE}
                    color={active ? colors.accent : colors.textMuted}
                    style={styles.catIcon}
                  />
                  <Text
                    style={[styles.catLabel, active && { color: colors.accent }]}
                  >
                    {meta.label}
                  </Text>
                  {count > 0 ? (
                    <View style={styles.catBadge}>
                      <Text style={styles.catBadgeText}>{count}</Text>
                    </View>
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
              <Skeleton height={56} style={{ marginBottom: spacing.sm }} />
              <Skeleton height={56} style={{ marginBottom: spacing.sm }} />
              <Skeleton height={56} />
            </>
          ) : groups[category].length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                Nenhum produto cadastrado nesta categoria.
              </Text>
            </Card>
          ) : (
            groups[category].map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                quantity={qtyByProduct.get(p.id) ?? 0}
                onPress={() => handleProductPress(p)}
                onRemove={() => removeOne(p.id)}
              />
            ))
          )}
        </View>

        <View style={styles.block}>
          <SectionTitle>Pagamento</SectionTitle>
          <View style={styles.payRow}>
            {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
              <Chip
                key={m}
                label={PAYMENT_LABELS[m]}
                selected={payment === m}
                onPress={() => setPayment(payment === m ? null : m)}
              />
            ))}
          </View>
        </View>

        {cart.length > 0 ? (
          <View style={styles.block}>
            <SectionTitle>Resumo</SectionTitle>
            <Card>
              {cart.map((item) => (
                <View key={item.key} style={styles.summaryRow}>
                  <Text style={styles.summaryQty}>{item.quantity}×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.summaryName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.options.length > 0 ? (
                      <Text style={styles.summaryOptions} numberOfLines={1}>
                        {item.options.map((o) => o.value_name).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.summaryValue}>
                    {brl(itemUnitPrice(item) * item.quantity)}
                  </Text>
                </View>
              ))}

              {(totalMeat > 0 || totalBuns > 0) && (
                <View style={styles.insumoRow}>
                  {totalMeat > 0 ? (
                    <View style={styles.insumoItem}>
                      <Beef size={14} strokeWidth={STROKE} color={colors.textMuted} />
                      <Text style={styles.insumoText}>{formatMeat(totalMeat)}</Text>
                    </View>
                  ) : null}
                  {totalBuns > 0 ? (
                    <View style={styles.insumoItem}>
                      <Croissant size={14} strokeWidth={STROKE} color={colors.textMuted} />
                      <Text style={styles.insumoText}>
                        {totalBuns} {totalBuns === 1 ? 'pão' : 'pães'}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{brl(total)}</Text>
              </View>
            </Card>
          </View>
        ) : null}

        <View style={{ height: 160 }} />
      </ScrollView>

      {cart.length > 0 ? (
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerCount}>
              {cart.reduce((s, i) => s + i.quantity, 0)} itens
            </Text>
            <Text style={styles.footerTotal}>{brl(total)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label="Registrar venda"
              onPress={submit}
              loading={saving}
            />
          </View>
        </View>
      ) : null}

      <OptionSheet
        product={sheetProduct}
        onCancel={() => setSheetProduct(null)}
        onConfirm={(options) => {
          if (sheetProduct) addToCart(sheetProduct, options);
          setSheetProduct(null);
        }}
      />

      <CustomerPicker
        visible={pickerOpen}
        selectedId={customer?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onPick={(c) => {
          setCustomer(c);
          setPickerOpen(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}


// ---------------------------------------------------------------------
// Seletor de cliente — busca, escolhe ou cadastra na hora
// ---------------------------------------------------------------------
function CustomerPicker({
  visible,
  selectedId,
  onClose,
  onPick,
}: {
  visible: boolean;
  selectedId: string | null;
  onClose: () => void;
  onPick: (c: Customer | null) => void;
}) {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    void (async () => {
      try {
        setRows(await fetchCustomers());
      } catch {
        setRows([]);
      }
    })();
  }, [visible]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, '');
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))
    );
  }, [rows, query]);

  /** Cadastro rápido: o nome digitado na busca vira um cliente novo. */
  const quickCreate = useCallback(async () => {
    const name = query.trim();
    if (name.length < 2 || creating) return;
    setCreating(true);
    try {
      const id = await upsertCustomer({
        name,
        phone: null,
        notes: null,
        birth_date: null,
      });
      const fresh = await fetchCustomers(true);
      onPick(fresh.find((c) => c.id === id) ?? null);
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível cadastrar');
    } finally {
      setCreating(false);
    }
  }, [query, creating, onPick]);

  const exactExists = useMemo(
    () =>
      (rows ?? []).some(
        (c) => c.name.trim().toLowerCase() === query.trim().toLowerCase()
      ),
    [rows, query]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.pickerRoot}>
        <Pressable style={styles.pickerBackdrop} onPress={onClose} />
        <Glass style={styles.pickerSheet} intensity={30} rounded={radius.xl}>
          <View style={styles.pickerHead}>
            <Text style={styles.pickerTitle}>Cliente</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={20} strokeWidth={STROKE} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.pickerSearch}>
            <Search size={16} strokeWidth={STROKE} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar ou digitar um nome novo"
              placeholderTextColor={colors.textFaint}
              style={styles.pickerInput}
              autoCapitalize="words"
            />
          </View>

          <ScrollView
            style={styles.pickerList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Venda avulsa: sem cliente associado. */}
            <Pressable onPress={() => onPick(null)} style={styles.pickerRow}>
              <View style={styles.customerEmptyIcon}>
                <User size={17} strokeWidth={STROKE} color={colors.textMuted} />
              </View>
              <Text style={styles.pickerRowName}>Sem cliente (avulsa)</Text>
              {selectedId === null ? (
                <Check size={17} strokeWidth={STROKE} color={colors.text} />
              ) : null}
            </Pressable>

            {query.trim().length >= 2 && !exactExists ? (
              <Pressable
                onPress={() => void quickCreate()}
                style={[styles.pickerRow, styles.pickerRowNew]}
                disabled={creating}
              >
                <View style={styles.customerEmptyIcon}>
                  <UserPlus size={17} strokeWidth={STROKE} color={colors.text} />
                </View>
                <Text style={styles.pickerRowName} numberOfLines={1}>
                  Cadastrar {'“'}{query.trim()}{'”'}
                </Text>
              </Pressable>
            ) : null}

            {rows === null ? (
              <Skeleton height={54} style={{ marginTop: spacing.sm }} />
            ) : (
              filtered.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => onPick(c)}
                  style={styles.pickerRow}
                >
                  <Avatar
                    name={c.name}
                    uri={customerPhotoUrl(c.photo_path)}
                    size={34}
                  />
                  <View style={styles.pickerRowBody}>
                    <Text style={styles.pickerRowName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {c.phone ? (
                      <Text style={styles.pickerRowMeta}>
                        {formatPhone(c.phone)}
                      </Text>
                    ) : null}
                  </View>
                  {selectedId === c.id ? (
                    <Check size={17} strokeWidth={STROKE} color={colors.text} />
                  ) : null}
                </Pressable>
              ))
            )}

            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: spacing.sm },

  // --- cliente na venda ---
  customerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customerBody: { flex: 1 },
  customerName: {
    fontFamily: family.bodySemi,
    fontSize: font.body,
    color: colors.text,
  },
  customerMeta: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
    marginTop: 1,
  },
  customerEmptyIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha.p06,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customerPlaceholder: {
    flex: 1,
    fontFamily: family.body,
    fontSize: font.body,
    color: colors.textFaint,
  },

  // --- seletor de cliente ---
  pickerRoot: { flex: 1, justifyContent: 'flex-end' },
  pickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  pickerSheet: { maxHeight: '82%', padding: spacing.lg },
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  pickerTitle: {
    fontFamily: family.displayBold,
    fontSize: font.h2,
    color: colors.text,
  },
  pickerSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: alpha.p06,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerInput: {
    flex: 1,
    color: colors.text,
    fontFamily: family.body,
    fontSize: font.body,
    padding: 0,
  },
  pickerList: { marginTop: spacing.md },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: alpha.p06,
  },
  pickerRowNew: {
    backgroundColor: alpha.p06,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 0,
    marginTop: spacing.xs,
  },
  pickerRowBody: { flex: 1 },
  pickerRowName: {
    flex: 1,
    fontFamily: family.bodyMedium,
    fontSize: font.body,
    color: colors.text,
  },
  pickerRowMeta: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
    marginTop: 1,
  },

  header: { marginBottom: spacing.xl },
  title: {
    color: colors.text,
    fontSize: font.h1,
    fontFamily: family.displayBold,
    letterSpacing: -0.5,
  },
  subtitle: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  block: { marginBottom: spacing.xl },
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
  catBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  catBadgeText: { color: colors.text, fontSize: 10, fontFamily: family.displayBold },
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
  productRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.navActiveBg,
  },
  productInfo: { flex: 1 },
  productName: { color: colors.text, fontSize: font.body, fontFamily: family.bodySemi },
  productMeta: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepQty: {
    color: colors.text,
    fontSize: font.body,
    fontFamily: family.displayBold,
    minWidth: 18,
    textAlign: 'center',
  },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  summaryQty: {
    color: colors.accent,
    fontSize: font.small,
    fontFamily: family.displayBold,
    width: 28,
  },
  summaryName: { color: colors.text, fontSize: font.body },
  summaryOptions: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: 1,
  },
  summaryValue: {
    color: colors.text,
    fontSize: font.body,
    fontFamily: family.bodySemi,
  },
  insumoRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  insumoItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  insumoText: { color: colors.textMuted, fontSize: font.small },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    color: colors.textMuted,
    fontSize: font.body,
    fontFamily: family.bodySemi,
  },
  totalValue: { color: colors.accent, fontSize: font.h3, fontFamily: family.displayBold },
  emptyText: {
    color: colors.textMuted,
    fontSize: font.small,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 118,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  footerInfo: { paddingLeft: spacing.sm },
  footerCount: { color: colors.textMuted, fontSize: font.tiny },
  footerTotal: { color: colors.text, fontSize: font.h3, fontFamily: family.displayBold },

  // Folha de opções
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
  sheetTitle: { color: colors.text, fontSize: font.h3, fontFamily: family.displayBold },
  sheetSubtitle: {
    color: colors.textMuted,
    fontSize: font.small,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  sheetGroup: { marginBottom: spacing.lg },
  sheetGroupName: {
    color: colors.textMuted,
    fontSize: font.small,
    fontFamily: family.displayBold,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sheetOptional: { color: colors.textFaint, fontFamily: family.body },
  sheetOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionBtnSelected: {
    backgroundColor: colors.navActiveBg,
    borderColor: colors.accent,
  },
  optionText: { color: colors.textMuted, fontSize: font.small, fontFamily: family.bodySemi },
  optionDelta: { color: colors.accentSoft, fontSize: font.tiny },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetFooterLabel: { color: colors.textMuted, fontSize: font.tiny },
  sheetFooterValue: {
    color: colors.text,
    fontSize: font.h3,
    fontFamily: family.displayBold,
  },
});
