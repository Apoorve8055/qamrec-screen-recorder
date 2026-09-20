import type { Rect, WebcamSettings } from '../shared/types';
import type { Project } from '../editor/project';
import type { Scene } from './scene';
import { cameraAt, viewRect, type CameraState } from './camera';
import { activeClicks, scrollActivityAt, typingFocusAt, visibleKeystrokes } from './cursor';
import { subtitleAt, wrapText } from '../subtitles/subtitles';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const BACKGROUNDS: Record<string, { label: string; stops: string[] }> = {
  aurora: { label: 'Aurora', stops: ['#4c1d95', '#be185d', '#f59e0b'] },
  ocean: { label: 'Ocean', stops: ['#0c4a6e', '#0284c7', '#22d3ee'] },
  sunset: { label: 'Sunset', stops: ['#7c2d12', '#ea580c', '#fbbf24'] },
  mint: { label: 'Mint', stops: ['#064e3b', '#059669', '#6ee7b7'] },
  midnight: { label: 'Midnight', stops: ['#020617', '#1e293b', '#475569'] },
  paper: { label: 'Paper', stops: ['#f5f5f4', '#e7e5e4', '#d6d3d1'] },
  black: { label: 'Black', stops: ['#000000', '#000000'] },
};

export interface FrameSources {
  screen: CanvasImageSource | null;
  screenWidth: number;
  screenHeight: number;
  webcam: CanvasImageSource | null;
  webcamWidth: number;
  webcamHeight: number;
}

const FONT = '"Inter Variable", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const RIPPLE_MS = 650;
const STEP_BADGE_MS = 2000;
const TYPING_GLOW_HOLD_MS = 900;
const CHAPTER_CARD_MS = 3000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** Where the (padded, rounded) screen sits in the output frame, px */
export function contentRect(width: number, height: number, project: Project): Rect {
  const pad = project.settings.frame.padding * Math.min(width, height);
  const availW = width - pad * 2;
  const availH = height - pad * 2;
  const aspect = project.sourceWidth / project.sourceHeight;
  const w = availW / availH > aspect ? availH * aspect : availW;
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Webcam bubble rect in output px */
export function webcamRect(width: number, height: number, ws: WebcamSettings): Rect {
  const unit = height / 1080;
  const h = ws.size * height;
  const w = ws.shape === 'rectangle' ? (h * 16) / 9 : h;
  const margin = 16 * unit;
  return {
    x: clamp(ws.x * width - w / 2, margin, width - w - margin),
    y: clamp(ws.y * height - h / 2, margin, height - h - margin),
    w,
    h,
  };
}

function shapePath(ctx: Ctx, r: Rect, shape: WebcamSettings['shape'], unit: number) {
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      break;
    case 'rounded':
      ctx.roundRect(r.x, r.y, r.w, r.h, r.h * 0.18);
      break;
    case 'rectangle':
      ctx.roundRect(r.x, r.y, r.w, r.h, r.h * 0.08);
      break;
    default:
      ctx.roundRect(r.x, r.y, r.w, r.h, 6 * unit);
  }
}

function drawBackground(ctx: Ctx, width: number, height: number, project: Project) {
  const { padding, background } = project.settings.frame;
  if (padding <= 0) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const bg = BACKGROUNDS[background] ?? BACKGROUNDS.aurora;
  const grad = ctx.createLinearGradient(0, 0, width, height);
  bg.stops.forEach((c, i) => grad.addColorStop(i / Math.max(1, bg.stops.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

/** Draws `source` into `dest`, optionally mirrored horizontally */
function drawImageRect(
  ctx: Ctx,
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dest: Rect,
  mirror: boolean
) {
  if (!mirror) {
    ctx.drawImage(source, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h);
    return;
  }
  ctx.save();
  ctx.translate(dest.x + dest.w, dest.y);
  ctx.scale(-1, 1);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dest.w, dest.h);
  ctx.restore();
}

function drawScreen(ctx: Ctx, content: Rect, sources: FrameSources, cam: CameraState, project: Project, unit: number) {
  const { frame, webcam } = project.settings;
  const radius = frame.padding > 0 ? frame.cornerRadius * unit : 0;

  if (frame.padding > 0 && frame.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 48 * unit;
    ctx.shadowOffsetY = 16 * unit;
    ctx.beginPath();
    ctx.roundRect(content.x, content.y, content.w, content.h, radius);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.roundRect(content.x, content.y, content.w, content.h, radius);
  ctx.clip();

  if (!sources.screen) {
    ctx.fillStyle = '#111';
    ctx.fillRect(content.x, content.y, content.w, content.h);
    return;
  }
  const vr = viewRect(cam);
  drawImageRect(
    ctx,
    sources.screen,
    vr.x * sources.screenWidth,
    vr.y * sources.screenHeight,
    vr.w * sources.screenWidth,
    vr.h * sources.screenHeight,
    content,
    project.cameraOnly && webcam.mirror
  );
}

function drawPointerEffects(ctx: Ctx, content: Rect, cam: CameraState, scene: Scene, t: number, unit: number) {
  const { cursor } = scene.project.settings;
  const vr = viewRect(cam);
  const map = (x: number, y: number) => ({
    x: content.x + ((x - vr.x) / vr.w) * content.w,
    y: content.y + ((y - vr.y) / vr.h) * content.h,
  });
  const zoomBoost = Math.sqrt(cam.scale);

  // Element focus: glow around the field being typed into
  const typingRect = typingFocusAt(scene.typing, t, TYPING_GLOW_HOLD_MS);
  if (typingRect && scene.project.settings.zoom.typingFocus) {
    const a = map(typingRect.x, typingRect.y);
    const b = map(typingRect.x + typingRect.w, typingRect.y + typingRect.h);
    ctx.save();
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
    ctx.shadowColor = 'rgba(250, 204, 21, 0.8)';
    ctx.shadowBlur = 18 * unit;
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.roundRect(a.x - 4 * unit, a.y - 4 * unit, b.x - a.x + 8 * unit, b.y - a.y + 8 * unit, 8 * unit);
    ctx.stroke();
    ctx.restore();
  }

  const pointer = scene.cursorAt(t);
  if (pointer && cursor.highlight) {
    const p = map(pointer.x, pointer.y);
    const r = cursor.highlightSize * unit * zoomBoost;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(cursor.highlightColor, 0.28);
    ctx.fill();
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = withAlpha(cursor.highlightColor, 0.65);
    ctx.stroke();
  }

  if (cursor.clickRipples) {
    for (const c of activeClicks(scene.clicks, t, RIPPLE_MS)) {
      const p = map(c.x, c.y);
      const r = (10 + 42 * easeOut(c.progress)) * unit * zoomBoost;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.lineWidth = 3 * unit;
      ctx.strokeStyle = withAlpha(cursor.rippleColor, 0.9 * (1 - c.progress));
      ctx.stroke();
      if (c.progress < 0.35) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * unit * zoomBoost, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(cursor.rippleColor, 0.8 * (1 - c.progress / 0.35));
        ctx.fill();
      }
    }
  }

  if (cursor.clickIndicators) {
    for (const c of activeClicks(scene.clicks, t, STEP_BADGE_MS)) {
      const p = map(c.x, c.y);
      const alpha = c.progress > 0.8 ? (1 - c.progress) / 0.2 : 1;
      const bx = p.x + 24 * unit;
      const by = p.y - 24 * unit;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(bx, by, 15 * unit, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.lineWidth = 2 * unit;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${16 * unit}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(c.step), bx, by + unit);
      ctx.restore();
    }
  }

  if (cursor.scrollIndicator) {
    const s = scrollActivityAt(scene.scrolls, t, 700);
    if (s) {
      const anchor = pointer
        ? map(pointer.x, pointer.y)
        : { x: content.x + content.w - 40 * unit, y: content.y + content.h / 2 };
      const x = anchor.x;
      const y = anchor.y + (pointer ? 44 * unit : 0);
      ctx.save();
      ctx.globalAlpha = s.strength;
      ctx.beginPath();
      ctx.roundRect(x - 13 * unit, y - 20 * unit, 26 * unit, 40 * unit, 13 * unit);
      ctx.fillStyle = 'rgba(17, 17, 23, 0.75)';
      ctx.fill();
      ctx.beginPath();
      const dir = s.direction;
      ctx.moveTo(x - 6 * unit, y - 3 * unit * dir);
      ctx.lineTo(x, y + 5 * unit * dir);
      ctx.lineTo(x + 6 * unit, y - 3 * unit * dir);
      ctx.lineWidth = 2.5 * unit;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawWebcam(ctx: Ctx, width: number, height: number, sources: FrameSources, project: Project, unit: number) {
  const ws = project.settings.webcam;
  if (!sources.webcam || project.cameraOnly || project.webcamOffsetMs === null || !ws.visible) return;

  const r = webcamRect(width, height, ws);
  const target = r.w / r.h;
  const src = sources.webcamWidth / sources.webcamHeight;
  let cw = src > target ? sources.webcamHeight * target : sources.webcamWidth;
  let ch = cw / target;
  cw /= ws.cropZoom;
  ch /= ws.cropZoom;
  const cx = ((sources.webcamWidth - cw) / 2) * (1 + clamp(ws.cropX, -1, 1));
  const cy = ((sources.webcamHeight - ch) / 2) * (1 + clamp(ws.cropY, -1, 1));

  if (ws.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 30 * unit;
    ctx.shadowOffsetY = 10 * unit;
    shapePath(ctx, r, ws.shape, unit);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  shapePath(ctx, r, ws.shape, unit);
  ctx.clip();
  drawImageRect(ctx, sources.webcam, cx, cy, cw, ch, r, ws.mirror);
  ctx.restore();

  if (ws.borderWidth > 0) {
    shapePath(ctx, r, ws.shape, unit);
    ctx.lineWidth = ws.borderWidth * unit;
    ctx.strokeStyle = ws.borderColor;
    ctx.stroke();
  }
}

function drawKeystrokes(ctx: Ctx, width: number, height: number, scene: Scene, t: number, unit: number) {
  const { keys } = scene.project.settings;
  if (!keys.enabled) return;
  const visible = visibleKeystrokes(scene.keys, t, { holdMs: 1400, fadeMs: 400, chainGapMs: 1000, maxItems: 4 });
  if (!visible) return;

  const fontSize = 30 * unit;
  const padX = 20 * unit;
  const pillH = 58 * unit;
  const gap = 12 * unit;
  ctx.save();
  ctx.globalAlpha = visible.opacity;
  ctx.font = `600 ${fontSize}px ${FONT}`;
  const widths = visible.labels.map((l) => ctx.measureText(l).width + padX * 2);
  const total = widths.reduce((s, w) => s + w, 0) + gap * (widths.length - 1);
  let x = (width - total) / 2;
  const y = keys.position === 'bottom' ? height - pillH - 56 * unit : 56 * unit;

  visible.labels.forEach((label, i) => {
    ctx.beginPath();
    ctx.roundRect(x, y, widths[i], pillH, 14 * unit);
    ctx.fillStyle = 'rgba(17, 17, 23, 0.85)';
    ctx.fill();
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + widths[i] / 2, y + pillH / 2 + unit);
    x += widths[i] + gap;
  });
  ctx.restore();
}

function drawChapterTitle(ctx: Ctx, height: number, scene: Scene, t: number, unit: number) {
  const { project } = scene;
  if (!project.settings.frame.chapterTitles) return;
  let index = -1;
  for (let i = 0; i < project.chapters.length; i++) if (project.chapters[i].t <= t) index = i;
  if (index < 0) return;
  const chapter = project.chapters[index];
  const age = t - chapter.t;
  if (age > CHAPTER_CARD_MS) return;

  const alpha = Math.min(1, age / 300, (CHAPTER_CARD_MS - age) / 500);
  const x = 56 * unit;
  const y = height - 220 * unit;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = `700 ${34 * unit}px ${FONT}`;
  const titleW = ctx.measureText(chapter.title).width;
  ctx.beginPath();
  ctx.roundRect(x, y, titleW + 48 * unit, 96 * unit, 16 * unit);
  ctx.fillStyle = 'rgba(17, 17, 23, 0.82)';
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x, y + 18 * unit, 5 * unit, 60 * unit);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = `600 ${16 * unit}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(`CHAPTER ${index + 1}`, x + 24 * unit, y + 16 * unit);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${34 * unit}px ${FONT}`;
  ctx.fillText(chapter.title, x + 24 * unit, y + 42 * unit);
  ctx.restore();
}

function drawSubtitles(ctx: Ctx, width: number, height: number, scene: Scene, t: number, unit: number) {
  const { project } = scene;
  const style = project.settings.subtitles;
  if (!style.show || !project.subtitles.length) return;
  const cue = subtitleAt(project.subtitles, t);
  if (!cue || !cue.text.trim()) return;

  const fontSize = style.fontSize * unit;
  const lineH = fontSize * 1.3;
  const padX = fontSize * 0.45;
  ctx.save();
  ctx.font = `600 ${fontSize}px ${FONT}`;
  // About `maxChars` characters per line (half an em each), never wider than 80% of the frame
  const maxWidth = Math.min(width * 0.8, style.maxChars * fontSize * 0.5);
  const lines = wrapText(cue.text, maxWidth, (s) => ctx.measureText(s).width);
  // Make room for keystroke pills when they share the same edge
  const { keys } = project.settings;
  const sharesEdge = keys.enabled && keys.position === style.position && scene.keys.length > 0;
  const margin = (sharesEdge ? 140 : 56) * unit;
  const top = style.position === 'bottom' ? height - margin - lines.length * lineH : margin;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const cy = top + i * lineH + lineH / 2;
    if (style.background) {
      const w = ctx.measureText(line).width;
      ctx.beginPath();
      ctx.roundRect(width / 2 - w / 2 - padX, cy - lineH / 2, w + padX * 2, lineH, 8 * unit);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(2, fontSize * 0.14);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.strokeText(line, width / 2, cy);
    }
    ctx.fillStyle = style.textColor;
    ctx.fillText(line, width / 2, cy + unit);
  });
  ctx.restore();
}

/** Renders one output frame at source time `t` */
export function renderFrame(
  ctx: Ctx,
  width: number,
  height: number,
  sources: FrameSources,
  scene: Scene,
  t: number
): void {
  const { project } = scene;
  const unit = height / 1080;
  const cam: CameraState = project.cameraOnly ? { scale: 1, x: 0.5, y: 0.5 } : cameraAt(scene.camera, t);
  const content = contentRect(width, height, project);

  ctx.save();
  drawBackground(ctx, width, height, project);

  ctx.save();
  drawScreen(ctx, content, sources, cam, project, unit);
  if (!project.cameraOnly) drawPointerEffects(ctx, content, cam, scene, t, unit);
  ctx.restore();

  drawWebcam(ctx, width, height, sources, project, unit);
  drawKeystrokes(ctx, width, height, scene, t, unit);
  drawChapterTitle(ctx, height, scene, t, unit);
  drawSubtitles(ctx, width, height, scene, t, unit);
  ctx.restore();
}
