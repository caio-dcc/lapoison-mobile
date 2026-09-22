/**
 * Som + vibração de comemoração ao fechar uma venda.
 *
 * SDK 57: expo-av foi REMOVIDO do SDK; o pacote correto é expo-audio.
 * Usamos createAudioPlayer (não o hook) porque o player precisa viver
 * fora do ciclo de um componente — é disparado de um callback de venda.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

let player: AudioPlayer | null = null;
let ready = false;

/** Pré-carrega o som. Chamado uma vez na inicialização do app. */
export async function initCelebration(): Promise<void> {
  if (ready) return;
  try {
    // Toca mesmo com o celular no silencioso — é um feedback de operação.
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
    player = createAudioPlayer(require('../../assets/sfx/success.wav'));
    ready = true;
  } catch {
    // Áudio é enfeite: nunca deve impedir o app de abrir.
    ready = false;
  }
}

/** Dispara som + haptic. Fire-and-forget: nunca lança nem bloqueia a UI. */
export function celebrate(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => undefined
  );

  try {
    if (player) {
      // Sem o seek, um segundo toque não reinicia o áudio.
      player.seekTo(0);
      player.play();
    }
  } catch {
    // ignora
  }
}

/** Toque leve para seleções e trocas de aba. */
export function tapLight(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function tapMedium(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}
