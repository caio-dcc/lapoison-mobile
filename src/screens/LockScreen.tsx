/**
 * Tela de senha + seleção de operador. Usa o teclado nativo do sistema
 * (TextInput padrão) — mais previsível do que um teclado componentizado.
 *
 * Após a senha correta, pede para escolher quem está operando (Caio ou
 * Matheus) — essa escolha identifica o autor de cada venda na auditoria.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { alpha, colors, family, font, radius, spacing } from '../theme';
import { Check, Lock, STROKE, User } from '../components/icons';
import Glass from '../components/Glass';
import { checkPassword, OPERATORS, setOperator, type Operator } from '../lib/auth';
import { tapLight, tapMedium } from '../lib/celebrate';

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [step, setStep] = useState<'password' | 'operator'>('password');
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const shake = useSharedValue(0);
  const cardIn = useSharedValue(0);

  useEffect(() => {
    cardIn.value = withTiming(1, { duration: 520 });
  }, [cardIn]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardIn.value,
    transform: [
      { translateY: (1 - cardIn.value) * 28 },
      { translateX: shake.value },
    ],
  }));

  const submit = useCallback(async () => {
    if (checking || value.length === 0) return;
    setChecking(true);
    const ok = await checkPassword(value);
    setChecking(false);

    if (ok) {
      tapMedium();
      Keyboard.dismiss();
      setStep('operator');
      return;
    }

    setError(true);
    setValue('');
    tapMedium();
    shake.value = withSequence(
      withTiming(-11, { duration: 55 }),
      withTiming(11, { duration: 55 }),
      withTiming(-7, { duration: 55 }),
      withTiming(7, { duration: 55 }),
      withSpring(0, { damping: 12, stiffness: 260 })
    );
  }, [checking, value, shake]);

  const pickOperator = useCallback(
    async (name: Operator) => {
      tapLight();
      await setOperator(name);
      onUnlock();
    },
    [onUnlock]
  );

  if (step === 'operator') {
    return (
      <View style={styles.root}>
        <Animated.View
          style={styles.center}
          entering={FadeIn.duration(360)}
        >
          <View style={styles.lockBadge}>
            <User size={26} strokeWidth={STROKE} color={colors.text} />
          </View>

          <Text style={styles.brand}>Quem está operando?</Text>
          <Text style={styles.hint}>
            Identifica os registros feitos nesta sessão
          </Text>

          <View style={styles.operatorList}>
            {OPERATORS.map((name) => (
              <Pressable
                key={name}
                onPress={() => void pickOperator(name)}
                style={styles.operatorBtn}
              >
                <Text style={styles.operatorInitial}>{name.charAt(0)}</Text>
                <Text style={styles.operatorName}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={[styles.center, cardStyle]}>
        <View style={styles.lockBadge}>
          <Lock size={26} strokeWidth={STROKE} color={colors.text} />
        </View>

        <Text style={styles.brand}>La Viela</Text>
        <Text style={styles.hint}>
          {error ? 'Senha incorreta' : 'Digite a senha de acesso'}
        </Text>

        <Glass style={styles.fieldWrap} intensity={20} rounded={radius.md}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={(t) => {
              setError(false);
              setValue(t);
            }}
            onSubmitEditing={() => void submit()}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            placeholder="Senha"
            placeholderTextColor={colors.textFaint}
            style={[styles.field, error && styles.fieldError]}
          />
        </Glass>

        <Pressable
          onPress={() => void submit()}
          style={[styles.okBtn, (checking || value.length === 0) && styles.okBtnOff]}
          disabled={checking || value.length === 0}
        >
          <Check size={18} strokeWidth={STROKE} color={colors.bg} />
          <Text style={styles.okBtnText}>Entrar</Text>
        </Pressable>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  lockBadge: {
    width: 62,
    height: 62,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha.p06,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  brand: {
    fontFamily: family.displayBold,
    fontSize: font.h1,
    color: colors.text,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  hint: {
    fontFamily: family.body,
    fontSize: font.small,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  fieldWrap: {
    width: '100%',
  },
  field: {
    height: 52,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontFamily: family.bodyMedium,
    fontSize: font.h3,
    textAlign: 'center',
    letterSpacing: 2,
  },
  fieldError: {
    color: colors.danger,
  },
  okBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 50,
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    marginTop: spacing.lg,
  },
  okBtnOff: {
    opacity: 0.5,
  },
  okBtnText: {
    fontFamily: family.bodySemi,
    fontSize: font.body,
    color: colors.bg,
  },
  operatorList: {
    width: '100%',
    gap: spacing.md,
  },
  operatorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: alpha.p06,
    borderWidth: 1,
    borderColor: colors.border,
  },
  operatorInitial: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: alpha.p12,
    color: colors.text,
    fontFamily: family.displayBold,
    fontSize: font.h3,
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: 40,
    overflow: 'hidden',
  },
  operatorName: {
    fontFamily: family.bodySemi,
    fontSize: font.body,
    color: colors.text,
  },
});
