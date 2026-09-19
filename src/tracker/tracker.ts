/**
 * Page tracker content script. Injected (via activeTab) only into the tab being recorded.
 * Streams pointer, keyboard, focus and scroll events to the recorder while recording is active.
 * Nothing leaves the browser: messages go straight to the extension's recorder window.
 */
import type { Rect, TrackerControl, TrackerMessage, ViewportInfo } from '../shared/types';
import { classifyKey, isSensitiveField } from './keys';

const PORT_NAME = 'qamrec-tracker';
const MOVE_INTERVAL_MS = 33;
const SCROLL_INTERVAL_MS = 100;
const VIEWPORT_INTERVAL_MS = 1000;

interface TrackerGlobal {
  __qamrecTracker?: { dispose: () => void };
}

(() => {
  const global = window as unknown as TrackerGlobal;
  // Re-injection replaces any previous instance
  global.__qamrecTracker?.dispose();

  let port: chrome.runtime.Port | null = null;
  let active = false;
  let lastMove = 0;
  let lastScroll = 0;
  let scrollAccum = 0;
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);

  const viewport = (): ViewportInfo => {
    const screenAny = screen as Screen & { availLeft?: number; availTop?: number; left?: number; top?: number };
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      screenWidth: screen.width,
      screenHeight: screen.height,
      screenLeft: screenAny.left ?? screenAny.availLeft ?? 0,
      screenTop: screenAny.top ?? screenAny.availTop ?? 0,
      dpr: window.devicePixelRatio,
      title: document.title,
    };
  };

  const post = (msg: TrackerMessage) => {
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch {
      dispose();
    }
  };
  const send = (msg: TrackerMessage) => {
    if (active) post(msg);
  };

  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);
  const isEditable = (el: EventTarget | null): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    if (el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type);
  };
  const isSensitive = (el: HTMLElement) =>
    el instanceof HTMLInputElement &&
    isSensitiveField({ type: el.type, autocomplete: el.autocomplete ?? '', name: `${el.name} ${el.id}` });

  const onPointerMove = (e: PointerEvent) => {
    const now = Date.now();
    if (now - lastMove < MOVE_INTERVAL_MS) return;
    lastMove = now;
    send({ type: 'move', x: e.clientX, y: e.clientY, at: now });
  };

  const onPointerDown = (e: PointerEvent) => {
    send({ type: 'click', x: e.clientX, y: e.clientY, at: Date.now() });
  };

  /** The real event target: e.target is retargeted to the host element for shadow-DOM inputs */
  const realTarget = (e: Event): EventTarget | null => e.composedPath()[0] ?? e.target;

  const onKeyDown = (e: KeyboardEvent) => {
    const target = realTarget(e);
    const editable = isEditable(target);
    const cls = classifyKey(
      { key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey, isMac },
      { editable, sensitive: editable && isSensitive(target) }
    );
    const at = Date.now();
    if (cls.kind === 'shortcut') send({ type: 'key', label: cls.label, at });
    else if (cls.kind === 'typing') send({ type: 'typing', rect: editable ? rectOf(target) : null, at });
  };

  const onFocusIn = (e: FocusEvent) => {
    const target = realTarget(e);
    if (isEditable(target)) send({ type: 'focus', rect: rectOf(target), at: Date.now() });
  };

  const onWheel = (e: WheelEvent) => {
    scrollAccum += e.deltaY;
    const now = Date.now();
    if (now - lastScroll < SCROLL_INTERVAL_MS) return;
    lastScroll = now;
    send({ type: 'scroll', dy: scrollAccum, at: now });
    scrollAccum = 0;
  };

  const onVisibility = () => {
    post({ type: 'viewport', vp: viewport() });
    send({ type: 'visibility', visible: document.visibilityState === 'visible', at: Date.now() });
  };
  const onResize = () => post({ type: 'viewport', vp: viewport() });

  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointermove', onPointerMove, opts);
  window.addEventListener('pointerdown', onPointerDown, opts);
  window.addEventListener('keydown', onKeyDown, opts);
  window.addEventListener('focusin', onFocusIn, opts);
  window.addEventListener('wheel', onWheel, opts);
  window.addEventListener('resize', onResize, opts);
  document.addEventListener('visibilitychange', onVisibility);
  // Catches window moves and title changes
  const viewportTimer = window.setInterval(() => post({ type: 'viewport', vp: viewport() }), VIEWPORT_INTERVAL_MS);

  function dispose() {
    window.removeEventListener('pointermove', onPointerMove, opts);
    window.removeEventListener('pointerdown', onPointerDown, opts);
    window.removeEventListener('keydown', onKeyDown, opts);
    window.removeEventListener('focusin', onFocusIn, opts);
    window.removeEventListener('wheel', onWheel, opts);
    window.removeEventListener('resize', onResize, opts);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(viewportTimer);
    try {
      port?.disconnect();
    } catch {
      // Already disconnected
    }
    port = null;
    active = false;
    if (global.__qamrecTracker?.dispose === dispose) delete global.__qamrecTracker;
  }
  global.__qamrecTracker = { dispose };

  try {
    port = chrome.runtime.connect({ name: PORT_NAME });
  } catch {
    dispose();
    return;
  }
  port.onMessage.addListener((msg: TrackerControl) => {
    if (msg.type === 'state') active = msg.active;
  });
  // The recorder closed or the extension reloaded: stop listening entirely
  port.onDisconnect.addListener(dispose);
  post({ type: 'viewport', vp: viewport() });
})();
