/**
 * Trava de acesso do app.
 *
 * Escopo: impedir que alguém que pegue o celular destravado abra o
 * faturamento. NÃO é autenticação de servidor — a chave do Supabase
 * continua sendo a publishable. Para multiusuário de verdade, o caminho
 * é Supabase Auth + RLS por usuário.
 *
 * A senha fica em expo-secure-store (Keychain/Keystore), nunca em
 * AsyncStorage. O default abaixo é trocável pelos donos na primeira
 * abertura sem mexer no código.
 */
import * as SecureStore from 'expo-secure-store';

/**
 * Senha inicial — formato "Animal@ano" (ano aleatório entre 1900-2000),
 * fácil de lembrar e digitar para os donos. Trocável em Ajustes.
 */
export const DEFAULT_PASSWORD = 'Coruja@1913';

const KEY_PASSWORD = 'laviela.lock.password';
const KEY_SESSION = 'laviela.lock.session';

/** Senha vigente: a personalizada, ou a inicial. */
export async function currentPassword(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(KEY_PASSWORD);
    return saved && saved.length > 0 ? saved : DEFAULT_PASSWORD;
  } catch {
    return DEFAULT_PASSWORD;
  }
}

export async function checkPassword(attempt: string): Promise<boolean> {
  const real = await currentPassword();
  return attempt === real;
}

export async function setPassword(next: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_PASSWORD, next);
}

export async function isUsingDefaultPassword(): Promise<boolean> {
  try {
    const saved = await SecureStore.getItemAsync(KEY_PASSWORD);
    return !saved || saved === DEFAULT_PASSWORD;
  } catch {
    return true;
  }
}

/**
 * Marca a sessão como desbloqueada. Fica valendo até `logout()` ser
 * chamado explicitamente — não expira sozinha, mesmo fechando o app.
 */
export async function markUnlocked(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY_SESSION, '1');
  } catch {
    // sem persistência: só pede senha de novo, não quebra nada
  }
}

/** Sessão aberta? (não expira por tempo — só por logout manual). */
export async function hasActiveSession(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY_SESSION)) === '1';
  } catch {
    return false;
  }
}

/** Encerra a sessão: a próxima abertura do app pede senha de novo. */
export async function logout(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_SESSION);
  } catch {
    // ignora
  }
}
