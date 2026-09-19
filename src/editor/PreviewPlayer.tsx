import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Point, ZoomRegion } from '../shared/types';
import type { Scene } from '../effects/scene';
import { contentRect, renderFrame, webcamRect, type FrameSources } from '../effects/compositor';
import { cameraAt, viewRect } from '../effects/camera';
import { getBackgroundBlur, type BackgroundBlur } from '../effects/webcamBlur';
import { getTrim, nextKeptTime } from './timeline';

export interface PreviewHandle {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
}

interface Props {
  scene: Scene;
  mainUrl: string;
  webcamUrl: string | null;
  selectedZoom: ZoomRegion | null;
  onTime: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onPickFocus: (p: Point) => void;
  onWebcamMove: (x: number, y: number) => void;
}

const MAX_CANVAS_WIDTH = 1920;
const TIME_REPORT_MS = 66;
const WEBCAM_DRIFT_S = 0.2;

/** Live, WYSIWYG preview: the same compositor the exporter uses, driven by <video> playback */
export const PreviewPlayer = forwardRef<PreviewHandle, Props>(function PreviewPlayer(
  { scene, mainUrl, webcamUrl, selectedZoom, onTime, onPlayingChange, onPickFocus, onWebcamMove },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const sceneRef = useRef(scene);
  const blurRef = useRef<BackgroundBlur | null>(null);
  const playingRef = useRef(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const callbacks = useRef({ onTime, onPlayingChange, onPickFocus, onWebcamMove, selectedZoom });

  sceneRef.current = scene;
  callbacks.current = { onTime, onPlayingChange, onPickFocus, onWebcamMove, selectedZoom };

  const { project } = scene;
  const wantsBlur = project.settings.webcam.backgroundBlur && (project.cameraOnly || !!webcamUrl);

  useEffect(() => {
    if (!wantsBlur || blurRef.current) return;
    let cancelled = false;
    getBackgroundBlur().then((b) => {
      if (!cancelled) blurRef.current = b;
    });
    return () => {
      cancelled = true;
    };
  }, [wantsBlur]);

  const syncWebcam = (force: boolean) => {
    const main = mainRef.current;
    const cam = webcamRef.current;
    const offset = sceneRef.current.project.webcamOffsetMs;
    if (!main || !cam || offset === null) return;
    const target = Math.max(0, main.currentTime - offset / 1000);
    if (force || Math.abs(cam.currentTime - target) > WEBCAM_DRIFT_S) cam.currentTime = target;
    if (playingRef.current && cam.paused) cam.play().catch(() => {});
    if (!playingRef.current && !cam.paused) cam.pause();
  };

  const setPlaying = (playing: boolean) => {
    playingRef.current = playing;
    callbacks.current.onPlayingChange(playing);
  };

  const play = () => {
    const main = mainRef.current;
    if (!main) return;
    const { project: p } = sceneRef.current;
    const trim = getTrim(p.cuts, p.duration);
    const t = main.currentTime * 1000;
    if (t >= trim.end - 50 || t < trim.start) main.currentTime = trim.start / 1000;
    main.play().then(
      () => setPlaying(true),
      () => setPlaying(false)
    );
  };

  const pause = () => {
    mainRef.current?.pause();
    setPlaying(false);
    syncWebcam(true);
  };

  useImperativeHandle(ref, () => ({
    play,
    pause,
    toggle: () => (playingRef.current ? pause() : play()),
    seek(t: number) {
      const main = mainRef.current;
      if (!main) return;
      main.currentTime = Math.max(0, t) / 1000;
      syncWebcam(true);
      callbacks.current.onTime(t);
    },
  }));

  // Fit the canvas to the container at the output aspect ratio
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const aspect = project.sourceWidth / project.sourceHeight;
    const fit = () => {
      const { width, height } = container.getBoundingClientRect();
      const w = Math.max(1, width / height > aspect ? height * aspect : width);
      const h = w / aspect;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const scale = Math.min(window.devicePixelRatio, MAX_CANVAS_WIDTH / w);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [project.sourceWidth, project.sourceHeight]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    let lastReport = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const main = mainRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !main || !ctx) return;
      const s = sceneRef.current;
      const p = s.project;
      let t = main.currentTime * 1000;

      if (playingRef.current) {
        const next = nextKeptTime(t, p.duration, p.cuts);
        if (next > t + 1) {
          main.currentTime = next / 1000;
          t = next;
          syncWebcam(true);
        }
        const trim = getTrim(p.cuts, p.duration);
        if (t >= trim.end - 20 || main.ended) {
          main.pause();
          setPlaying(false);
        }
        syncWebcam(false);
      }

      const cam = webcamRef.current;
      const hasWebcam = !!cam && cam.readyState >= 2;
      let screen: CanvasImageSource | null = main.readyState >= 2 ? main : null;
      let webcam: CanvasImageSource | null = hasWebcam ? cam : null;
      const blur = p.settings.webcam.backgroundBlur ? blurRef.current : null;
      if (blur && p.cameraOnly && screen) {
        screen = blur.process(main, main.videoWidth, main.videoHeight, p.settings.webcam.blurAmount);
      } else if (blur && hasWebcam && cam) {
        webcam = blur.process(cam, cam.videoWidth, cam.videoHeight, p.settings.webcam.blurAmount);
      }

      const sources: FrameSources = {
        screen,
        screenWidth: main.videoWidth || p.sourceWidth,
        screenHeight: main.videoHeight || p.sourceHeight,
        webcam,
        webcamWidth: cam?.videoWidth || 1,
        webcamHeight: cam?.videoHeight || 1,
      };
      renderFrame(ctx, canvas.width, canvas.height, sources, s, t);

      const now = performance.now();
      if (now - lastReport > TIME_REPORT_MS) {
        lastReport = now;
        callbacks.current.onTime(t);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // The loop reads everything through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toCanvasPoint = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const overWebcam = (x: number, y: number) => {
    const canvas = canvasRef.current!;
    const p = sceneRef.current.project;
    if (p.cameraOnly || p.webcamOffsetMs === null || !p.settings.webcam.visible) return null;
    const r = webcamRect(canvas.width, canvas.height, p.settings.webcam);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h ? r : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const { x, y } = toCanvasPoint(e);
    const cam = overWebcam(x, y);
    if (cam) {
      dragRef.current = { dx: x - (cam.x + cam.w / 2), dy: y - (cam.y + cam.h / 2) };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const s = sceneRef.current;
    if (callbacks.current.selectedZoom && !s.project.cameraOnly) {
      const content = contentRect(canvas.width, canvas.height, s.project);
      const vr = viewRect(cameraAt(s.camera, (mainRef.current?.currentTime ?? 0) * 1000));
      const u = vr.x + ((x - content.x) / content.w) * vr.w;
      const v = vr.y + ((y - content.y) / content.h) * vr.h;
      callbacks.current.onPickFocus({ x: Math.min(1, Math.max(0, u)), y: Math.min(1, Math.max(0, v)) });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const { x, y } = toCanvasPoint(e);
    if (dragRef.current) {
      callbacks.current.onWebcamMove(
        (x - dragRef.current.dx) / canvas.width,
        (y - dragRef.current.dy) / canvas.height
      );
      return;
    }
    canvas.style.cursor = overWebcam(x, y) ? 'move' : callbacks.current.selectedZoom ? 'crosshair' : 'default';
  };

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="rounded-md shadow-2xl"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragRef.current = null)}
      />
      <video ref={mainRef} src={mainUrl} preload="auto" playsInline className="hidden" onEnded={() => setPlaying(false)} />
      {webcamUrl && <video ref={webcamRef} src={webcamUrl} preload="auto" playsInline muted className="hidden" />}
    </div>
  );
});
