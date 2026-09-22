/**
 * Clientes — grid com fotos, cadastro e ficha individual.
 * Clientes são cadastrados antes das vendas e associados a elas.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import {
  customerPhotoUrl,
  deactivateCustomer,
  fetchCustomerDetail,
  fetchCustomers,
  setCustomerPhoto,
  upsertCustomer,
} from '../lib/api';
import {
  ageFrom,
  formatBirth,
  formatMeat,
  formatPhone,
  type Customer,
  type CustomerDetail,
} from '../lib/types';
import { alpha, brl, colors, family, font, radius, spacing } from '../theme';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  PrimaryButton,
  SectionTitle,
  Skeleton,
  Squish,
} from '../components/ui';
import Glass from '../components/Glass';
import {
  Cake,
  Camera,
  ImageIcon,
  Phone,
  Plus,
  Receipt,
  STROKE,
  Search,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
} from '../components/icons';
import { tapLight } from '../lib/celebrate';

export default function ClientesScreen() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [detailOf, setDetailOf] = useState<Customer | null>(null);

  const { width } = useWindowDimensions();
  // Grid responsiva: 3 colunas em telas estreitas, 4 nas largas.
  const cols = width >= 420 ? 4 : 3;
  const gap = spacing.md;
  const cardW = (width - spacing.lg * 2 - gap * (cols - 1)) / cols;

  const load = useCallback(async (force = false) => {
    try {
      setError(null);
      const data = await fetchCustomers(force);
      setRows(data);
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar clientes');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

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

  // Aniversariantes do mês corrente — motivo real de cadastrar data.
  const birthdays = useMemo(() => {
    if (!rows) return [];
    const m = new Date().getMonth() + 1;
    return rows
      .filter((c) => c.birth_date && Number(c.birth_date.slice(5, 7)) === m)
      .sort((a, b) => a.birth_date!.slice(8).localeCompare(b.birth_date!.slice(8)));
  }, [rows]);

  const handleSaved = useCallback(async () => {
    setFormOpen(false);
    setEditing(null);
    await load(true);
  }, [load]);

  const confirmRemove = useCallback(
    (c: Customer) => {
      Alert.alert(
        'Remover cliente',
        `Remover ${c.name} da lista? O histórico de vendas dele é preservado.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Remover',
            style: 'destructive',
            onPress: async () => {
              try {
                await deactivateCustomer(c.id);
                await load(true);
              } catch (e: any) {
                Alert.alert('Erro', e?.message ?? 'Não foi possível remover');
              }
            },
          },
        ]
      );
    },
    [load]
  );

  if (error) {
    return (
      <View style={styles.root}>
        <ErrorState message={error} onRetry={() => void load(true)} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.text}
          />
        }
      >
        <Text style={styles.title}>Clientes</Text>
        <Text style={styles.subtitle}>
          {rows ? `${rows.length} cadastrado${rows.length === 1 ? '' : 's'}` : '—'}
        </Text>

        <View style={styles.searchRow}>
          <Search size={17} strokeWidth={STROKE} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar por nome ou telefone"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} strokeWidth={STROKE} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {birthdays.length > 0 && !query ? (
          <Animated.View entering={FadeIn.duration(320)}>
            <Card style={styles.birthCard}>
              <View style={styles.birthHead}>
                <Cake size={16} strokeWidth={STROKE} color={colors.text} />
                <Text style={styles.birthTitle}>Aniversariantes do mês</Text>
              </View>
              {birthdays.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setDetailOf(c)}
                  style={styles.birthRow}
                >
                  <Text style={styles.birthDay}>{c.birth_date!.slice(8)}</Text>
                  <Text style={styles.birthName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {ageFrom(c.birth_date) !== null ? (
                    <Text style={styles.birthAge}>
                      {ageFrom(c.birth_date)! + 1} anos
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </Card>
          </Animated.View>
        ) : null}

        {rows === null ? (
          <View style={styles.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                height={cardW + 34}
                style={{ width: cardW, borderRadius: radius.lg }}
              />
            ))}
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            Icon={query ? Search : Users}
            title={query ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'}
            subtitle={
              query
                ? 'Tente outro nome ou número.'
                : 'Cadastre o primeiro cliente no botão abaixo. Depois ele pode ser associado às vendas.'
            }
          />
        ) : (
          <View style={styles.grid}>
            {filtered.map((c, i) => (
              <Animated.View
                key={c.id}
                entering={FadeInDown.delay(Math.min(i * 28, 340)).duration(300)}
              >
                <Squish
                  onPress={() => {
                    tapLight();
                    setDetailOf(c);
                  }}
                  onLongPress={() => confirmRemove(c)}
                  style={[styles.gridCard, { width: cardW }]}
                >
                  <Avatar
                    name={c.name}
                    uri={customerPhotoUrl(c.photo_path)}
                    size={cardW - spacing.lg * 2}
                  />
                  <Text style={styles.gridName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {c.phone ? (
                    <Text style={styles.gridMeta} numberOfLines={1}>
                      {formatPhone(c.phone)}
                    </Text>
                  ) : null}
                </Squish>
              </Animated.View>
            ))}
          </View>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

      <Pressable
        onPress={() => {
          tapLight();
          setEditing(null);
          setFormOpen(true);
        }}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="Cadastrar cliente"
      >
        <UserPlus size={22} strokeWidth={STROKE} color={colors.bg} />
      </Pressable>

      <CustomerForm
        visible={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={handleSaved}
      />

      <CustomerSheet
        customer={detailOf}
        onClose={() => setDetailOf(null)}
        onEdit={(c) => {
          setDetailOf(null);
          setEditing(c);
          setFormOpen(true);
        }}
        onChanged={() => void load(true)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------
// Formulário de cadastro / edição
// ---------------------------------------------------------------------
function CustomerForm({
  visible,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initial: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [birth, setBirth] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? '');
    setPhone(initial?.phone ? formatPhone(initial.phone) : '');
    setNotes(initial?.notes ?? '');
    // Guarda ISO no banco, mostra dd/mm/aaaa.
    setBirth(initial?.birth_date ? formatBirth(initial.birth_date) : '');
  }, [visible, initial]);

  /** dd/mm/aaaa digitado -> ISO. Devolve undefined se estiver inválido. */
  const birthISO = useMemo((): string | null | undefined => {
    const t = birth.trim();
    if (!t) return null;
    const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return undefined;
    const [, d, mo, y] = m;
    const iso = `${y}-${mo}-${d}`;
    const dt = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return undefined;
    // Rejeita 31/02 e afins, que o Date normaliza em silêncio.
    if (dt.getDate() !== Number(d) || dt.getMonth() + 1 !== Number(mo)) {
      return undefined;
    }
    if (dt > new Date()) return undefined;
    return iso;
  }, [birth]);

  const valid = name.trim().length >= 2 && birthISO !== undefined;

  const save = useCallback(async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await upsertCustomer({
        id: initial?.id,
        name: name.trim(),
        phone: phone.replace(/\D/g, '') || null,
        notes: notes.trim() || null,
        birth_date: birthISO ?? null,
      });
      onSaved();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  }, [valid, saving, initial, name, phone, notes, birthISO, onSaved]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Glass style={styles.sheet} intensity={30} rounded={radius.xl}>
          <ScrollView
            contentContainerStyle={styles.sheetInner}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>
                {initial ? 'Editar cliente' : 'Novo cliente'}
              </Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={20} strokeWidth={STROKE} color={colors.textMuted} />
              </Pressable>
            </View>

            <Field label="Nome">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nome do cliente"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="words"
              />
            </Field>

            <Field label="Número" Icon={Phone}>
              <TextInput
                value={phone}
                onChangeText={(t) => setPhone(formatPhone(t) || t)}
                placeholder="(21) 99999-0000"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                keyboardType="phone-pad"
                maxLength={16}
              />
            </Field>

            <Field
              label="Data de nascimento"
              Icon={Cake}
              error={birthISO === undefined ? 'Use dd/mm/aaaa' : undefined}
            >
              <TextInput
                value={birth}
                onChangeText={(t) => {
                  // Máscara progressiva dd/mm/aaaa
                  const d = t.replace(/\D/g, '').slice(0, 8);
                  let out = d;
                  if (d.length > 4) out = `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
                  else if (d.length > 2) out = `${d.slice(0, 2)}/${d.slice(2)}`;
                  setBirth(out);
                }}
                placeholder="dd/mm/aaaa"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                keyboardType="number-pad"
                maxLength={10}
              />
            </Field>

            <Field label="Informações extras">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Preferências, alergias, observações"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.inputMulti]}
                multiline
              />
            </Field>

            <View style={styles.sheetActions}>
              <PrimaryButton
                label={initial ? 'Salvar' : 'Cadastrar'}
                onPress={save}
                disabled={!valid}
                loading={saving}
              />
            </View>
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

function Field({
  label,
  Icon,
  error,
  children,
}: {
  label: string;
  Icon?: typeof User;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        {Icon ? <Icon size={13} strokeWidth={STROKE} color={colors.textMuted} /> : null}
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------
// Ficha do cliente
// ---------------------------------------------------------------------
function CustomerSheet({
  customer,
  onClose,
  onEdit,
  onChanged,
}: {
  customer: Customer | null;
  onClose: () => void;
  onEdit: (c: Customer) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customer) {
      setDetail(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const d = await fetchCustomerDetail(customer.id);
        if (alive) setDetail(d);
      } catch {
        if (alive) setDetail(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [customer]);

  const pickPhoto = useCallback(
    async (fromCamera: boolean) => {
      if (!customer || busy) return;
      try {
        const perm = fromCamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permissão necessária', 'Autorize o acesso para enviar a foto.');
          return;
        }

        const res = fromCamera
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });

        if (res.canceled || !res.assets?.[0]?.uri) return;

        setBusy(true);
        await setCustomerPhoto(customer.id, res.assets[0].uri);
        onChanged();
      } catch (e: any) {
        Alert.alert('Erro', e?.message ?? 'Não foi possível enviar a foto');
      } finally {
        setBusy(false);
      }
    },
    [customer, busy, onChanged]
  );

  if (!customer) return null;

  const age = ageFrom(customer.birth_date);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Glass style={styles.sheet} intensity={30} rounded={radius.xl}>
          <ScrollView contentContainerStyle={styles.sheetInner}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {customer.name}
              </Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={20} strokeWidth={STROKE} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.profile}>
              <Avatar
                name={customer.name}
                uri={customerPhotoUrl(customer.photo_path)}
                size={78}
              />
              <View style={styles.profileMeta}>
                {customer.phone ? (
                  <View style={styles.metaRow}>
                    <Phone size={13} strokeWidth={STROKE} color={colors.textMuted} />
                    <Text style={styles.metaText}>{formatPhone(customer.phone)}</Text>
                  </View>
                ) : null}
                {customer.birth_date ? (
                  <View style={styles.metaRow}>
                    <Cake size={13} strokeWidth={STROKE} color={colors.textMuted} />
                    <Text style={styles.metaText}>
                      {formatBirth(customer.birth_date)}
                      {age !== null ? `  ·  ${age} anos` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.photoBtns}>
              <Pressable
                onPress={() => void pickPhoto(true)}
                style={styles.photoBtn}
                disabled={busy}
              >
                <Camera size={16} strokeWidth={STROKE} color={colors.text} />
                <Text style={styles.photoBtnText}>Câmera</Text>
              </Pressable>
              <Pressable
                onPress={() => void pickPhoto(false)}
                style={styles.photoBtn}
                disabled={busy}
              >
                <ImageIcon size={16} strokeWidth={STROKE} color={colors.text} />
                <Text style={styles.photoBtnText}>Galeria</Text>
              </Pressable>
              <Pressable
                onPress={() => onEdit(customer)}
                style={styles.photoBtn}
                disabled={busy}
              >
                <Text style={styles.photoBtnText}>Editar dados</Text>
              </Pressable>
            </View>
            {busy ? (
              <ActivityIndicator color={colors.text} style={{ marginTop: spacing.sm }} />
            ) : null}

            {customer.notes ? (
              <Card style={styles.notesCard}>
                <Text style={styles.notesText}>{customer.notes}</Text>
              </Card>
            ) : null}

            {detail === null ? (
              <Skeleton height={110} style={{ marginTop: spacing.lg }} />
            ) : (
              <>
                <View style={styles.statsRow}>
                  <MiniStat
                    label="Gastou"
                    value={brl(detail.summary.total_spent)}
                  />
                  <MiniStat
                    label="Vendas"
                    value={String(detail.summary.sales_count)}
                  />
                  <MiniStat
                    label="Ticket médio"
                    value={brl(detail.summary.avg_ticket)}
                  />
                </View>

                {detail.summary.meat_grams > 0 ? (
                  <Text style={styles.meatLine}>
                    Consumiu {formatMeat(detail.summary.meat_grams)} de carne
                  </Text>
                ) : null}

                {detail.favorites.length > 0 ? (
                  <View style={styles.block}>
                    <SectionTitle>Itens preferidos</SectionTitle>
                    {detail.favorites.map((f) => (
                      <View key={f.product_name} style={styles.favRow}>
                        <Text style={styles.favQty}>{f.qty}x</Text>
                        <Text style={styles.favName} numberOfLines={1}>
                          {f.product_name}
                        </Text>
                        <Text style={styles.favTotal}>{brl(f.total)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {detail.recent_sales.length > 0 ? (
                  <View style={styles.block}>
                    <SectionTitle>Últimas compras</SectionTitle>
                    {detail.recent_sales.map((s) => (
                      <View key={s.id} style={styles.saleRow}>
                        <Receipt size={14} strokeWidth={STROKE} color={colors.textFaint} />
                        <View style={styles.saleBody}>
                          <Text style={styles.saleDate}>
                            {formatBirth(s.sale_date)}
                          </Text>
                          <Text style={styles.saleItems} numberOfLines={1}>
                            {s.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                          </Text>
                        </View>
                        <Text style={styles.saleTotal}>{brl(s.total)}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <EmptyState
                    Icon={Receipt}
                    title="Nenhuma compra ainda"
                    subtitle="As vendas associadas a este cliente aparecem aqui."
                  />
                )}
              </>
            )}
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={styles.miniStatValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: {
    fontFamily: family.displayBold,
    fontSize: font.h1,
    color: colors.text,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: family.body,
    fontSize: font.body,
    padding: 0,
  },
  birthCard: { marginTop: spacing.lg, padding: spacing.md },
  birthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  birthTitle: {
    fontFamily: family.bodySemi,
    fontSize: font.small,
    color: colors.text,
    letterSpacing: 0.4,
  },
  birthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  birthDay: {
    fontFamily: family.displayBold,
    fontSize: font.body,
    color: colors.text,
    width: 26,
  },
  birthName: {
    flex: 1,
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
  },
  birthAge: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  gridCard: {
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridName: {
    fontFamily: family.bodySemi,
    fontSize: font.small,
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  gridMeta: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
    marginTop: 1,
  },
  bottomPad: { height: 110 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 124,
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: { maxHeight: '90%' },
  sheetInner: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: family.displayBold,
    fontSize: font.h2,
    color: colors.text,
  },
  field: { marginBottom: spacing.lg },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontFamily: family.bodySemi,
    fontSize: font.tiny,
    color: colors.textMuted,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  fieldError: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  input: {
    backgroundColor: alpha.p06,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontFamily: family.body,
    fontSize: font.body,
  },
  inputMulti: { minHeight: 82, textAlignVertical: 'top' },
  sheetActions: { marginTop: spacing.sm },

  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  profileMeta: { flex: 1, gap: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
  },
  photoBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: 'wrap',
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: alpha.p08,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoBtnText: {
    fontFamily: family.bodyMedium,
    fontSize: font.small,
    color: colors.text,
  },
  notesCard: { marginTop: spacing.lg, padding: spacing.md },
  notesText: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
    lineHeight: 20,
  },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  miniStat: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniStatLabel: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  miniStatValue: {
    fontFamily: family.displayBold,
    fontSize: font.h3,
    color: colors.text,
    marginTop: 2,
  },
  meatLine: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textFaint,
    marginTop: spacing.sm,
  },
  block: { marginTop: spacing.xl },
  favRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: alpha.p06,
  },
  favQty: {
    fontFamily: family.displayBold,
    fontSize: font.small,
    color: colors.text,
    width: 30,
  },
  favName: {
    flex: 1,
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
  },
  favTotal: {
    fontFamily: family.bodyMedium,
    fontSize: font.small,
    color: colors.text,
  },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: alpha.p06,
  },
  saleBody: { flex: 1 },
  saleDate: {
    fontFamily: family.bodyMedium,
    fontSize: font.small,
    color: colors.text,
  },
  saleItems: {
    fontFamily: family.body,
    fontSize: font.tiny,
    color: colors.textFaint,
    marginTop: 1,
  },
  saleTotal: {
    fontFamily: family.bodySemi,
    fontSize: font.small,
    color: colors.text,
  },
});
