/**
 * Keystroke classification for the page tracker.
 *
 * Privacy rules:
 * - Plain characters typed into fields are never labelled, only reported as "typing".
 * - Nothing typed into sensitive fields (passwords, payment, one-time codes) is labelled at all.
 */

export interface KeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isMac: boolean;
}

export interface TargetInput {
  editable: boolean;
  sensitive: boolean;
}

export type KeyClass = { kind: 'shortcut'; label: string } | { kind: 'typing' } | { kind: 'ignore' };

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS']);
const FIELD_VISIBLE_KEYS = new Set(['Enter', 'Tab', 'Escape']);

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

function keyName(k: KeyInput): string {
  if (KEY_NAMES[k.key]) return KEY_NAMES[k.key];
  if (k.key.length === 1) {
    if (k.code.startsWith('Key')) return k.code.slice(3);
    if (k.code.startsWith('Digit')) return k.code.slice(5);
    return k.key.toUpperCase();
  }
  return k.key;
}

function formatLabel(k: KeyInput, includeShift: boolean): string {
  const name = keyName(k);
  if (k.isMac) {
    const mods = [k.ctrlKey && '⌃', k.altKey && '⌥', includeShift && k.shiftKey && '⇧', k.metaKey && '⌘'];
    return [...mods.filter(Boolean), name].join(' ');
  }
  const mods = [k.ctrlKey && 'Ctrl', k.altKey && 'Alt', includeShift && k.shiftKey && 'Shift', k.metaKey && 'Win'];
  return [...mods.filter(Boolean), name].join(' + ');
}

export function classifyKey(k: KeyInput, target: TargetInput): KeyClass {
  if (MODIFIER_KEYS.has(k.key)) return { kind: 'ignore' };
  if (target.sensitive) return { kind: 'typing' };

  const hasCommandModifier = k.ctrlKey || k.altKey || k.metaKey;
  const printable = k.key.length === 1;

  if (target.editable && !hasCommandModifier && !FIELD_VISIBLE_KEYS.has(k.key)) {
    return { kind: 'typing' };
  }
  return { kind: 'shortcut', label: formatLabel(k, hasCommandModifier || !printable) };
}

const SENSITIVE_AUTOCOMPLETE = /^(cc-|one-time-code|current-password|new-password)/;
const SENSITIVE_NAME = /(cvv|cvc|card.?num|cc.?num|\bpin\b|ssn|otp|passw|passcode|security.?code)/i;

export function isSensitiveField(field: { type: string; autocomplete: string; name: string }): boolean {
  if (field.type === 'password') return true;
  if (SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return true;
  return SENSITIVE_NAME.test(field.name);
}
