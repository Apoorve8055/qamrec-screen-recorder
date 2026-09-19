import { describe, it, expect } from 'vitest';
import { classifyKey, isSensitiveField, type KeyInput } from './keys';

const key = (k: Partial<KeyInput>): KeyInput => ({
  key: 'a',
  code: 'KeyA',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  isMac: false,
  ...k,
});
const plain = { editable: false, sensitive: false };
const field = { editable: true, sensitive: false };
const secret = { editable: true, sensitive: true };

describe('classifyKey', () => {
  it('ignores bare modifier presses', () => {
    expect(classifyKey(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), plain)).toEqual({ kind: 'ignore' });
    expect(classifyKey(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), plain)).toEqual({ kind: 'ignore' });
  });

  it('labels shortcuts with modifiers', () => {
    expect(classifyKey(key({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }), field)).toEqual({
      kind: 'shortcut',
      label: 'Ctrl + Shift + K',
    });
  });

  it('uses Mac symbols on Mac', () => {
    expect(classifyKey(key({ key: 'c', code: 'KeyC', metaKey: true, isMac: true }), plain)).toEqual({
      kind: 'shortcut',
      label: '⌘ C',
    });
  });

  it('uses the physical key when Alt changes the character', () => {
    expect(classifyKey(key({ key: '˚', code: 'KeyK', altKey: true, isMac: true }), plain)).toEqual({
      kind: 'shortcut',
      label: '⌥ K',
    });
  });

  it('treats plain characters in fields as typing, never exposing them', () => {
    expect(classifyKey(key({ key: 'h', code: 'KeyH' }), field)).toEqual({ kind: 'typing' });
    expect(classifyKey(key({ key: 'Backspace', code: 'Backspace' }), field)).toEqual({ kind: 'typing' });
  });

  it('shows Enter, Tab and Escape even in fields', () => {
    expect(classifyKey(key({ key: 'Enter', code: 'Enter' }), field)).toEqual({ kind: 'shortcut', label: 'Enter' });
    expect(classifyKey(key({ key: 'Tab', code: 'Tab', shiftKey: true }), field)).toEqual({
      kind: 'shortcut',
      label: 'Shift + Tab',
    });
  });

  it('shows single-key page shortcuts outside fields', () => {
    expect(classifyKey(key({ key: 'j', code: 'KeyJ' }), plain)).toEqual({ kind: 'shortcut', label: 'J' });
    expect(classifyKey(key({ key: 'ArrowDown', code: 'ArrowDown' }), plain)).toEqual({ kind: 'shortcut', label: '↓' });
    expect(classifyKey(key({ key: ' ', code: 'Space' }), plain)).toEqual({ kind: 'shortcut', label: 'Space' });
  });

  it('never reveals anything typed in sensitive fields, even shortcuts', () => {
    expect(classifyKey(key({ key: 'p', code: 'KeyP' }), secret)).toEqual({ kind: 'typing' });
    expect(classifyKey(key({ key: 'v', code: 'KeyV', ctrlKey: true }), secret)).toEqual({ kind: 'typing' });
    expect(classifyKey(key({ key: 'Enter', code: 'Enter' }), secret)).toEqual({ kind: 'typing' });
  });
});

describe('isSensitiveField', () => {
  it('flags password and payment fields', () => {
    expect(isSensitiveField({ type: 'password', autocomplete: '', name: '' })).toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'cc-number', name: '' })).toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'one-time-code', name: '' })).toBe(true);
    expect(isSensitiveField({ type: 'tel', autocomplete: '', name: 'cvv' })).toBe(true);
    expect(isSensitiveField({ type: 'text', autocomplete: 'email', name: 'email' })).toBe(false);
  });
});
