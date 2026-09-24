/** Motion preference: OS prefers-reduced-motion OR the in-game 「演出を控えめに」 setting. */
import { computed } from '@preact/signals';
import { settings } from '../state/save';

export const reduceMotion = computed(() => settings.value.reduceMotion);

export function motionReduced(): boolean {
  return reduceMotion.peek();
}
