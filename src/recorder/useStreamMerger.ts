import { useRef, useCallback, useEffect } from 'react';
import type { PipConfig } from '../types';
import { DEFAULT_PIP_CONFIG } from '../types';

interface UseStreamMergerOptions {
  pipConfig?: PipConfig;
  frameRate?: number;
}

interface UseStreamMergerReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  mergeStreams: (screenStream: MediaStream, cameraStream: MediaStream) => MediaStream;
  stopMerging: () => void;
}

export function useStreamMerger(options: UseStreamMergerOptions = {}): UseStreamMergerReturn {
  const { pipConfig = DEFAULT_PIP_CONFIG, frameRate = 30 } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);

  const stopMerging = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
      screenVideoRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.pause();
      cameraVideoRef.current.srcObject = null;
      cameraVideoRef.current = null;
    }
  }, []);

  const createVideoElement = useCallback((stream: MediaStream): HTMLVideoElement => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    return video;
  }, []);

  const mergeStreams = useCallback(
    (screenStream: MediaStream, cameraStream: MediaStream): MediaStream => {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Canvas ref is not available');
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Create video elements for both streams
      screenVideoRef.current = createVideoElement(screenStream);
      cameraVideoRef.current = createVideoElement(cameraStream);

      const screenVideo = screenVideoRef.current;
      const cameraVideo = cameraVideoRef.current;

      // Wait for both videos to be ready
      const setupCanvas = () => {
        // Get screen dimensions
        const screenTrack = screenStream.getVideoTracks()[0];
        const settings = screenTrack.getSettings();
        const screenWidth = settings.width || 1920;
        const screenHeight = settings.height || 1080;

        // Set canvas size to match screen
        canvas.width = screenWidth;
        canvas.height = screenHeight;

        // Draw loop
        const draw = () => {
          // Draw screen (full canvas)
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

          // Draw camera overlay (bottom-right)
          const { width, height, offsetX, offsetY, borderRadius } = pipConfig;
          const x = canvas.width - width - offsetX;
          const y = canvas.height - height - offsetY;

          // Draw rounded rectangle for camera
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, width, height, borderRadius);
          ctx.clip();
          ctx.drawImage(cameraVideo, x, y, width, height);
          ctx.restore();

          // Draw border around camera
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(x, y, width, height, borderRadius);
          ctx.stroke();

          animationFrameRef.current = requestAnimationFrame(draw);
        };

        draw();
      };

      // Start drawing when screen video is playing
      screenVideo.onplaying = () => {
        cameraVideo.play().then(setupCanvas).catch(console.error);
      };

      screenVideo.play().catch(console.error);

      // Combine canvas stream with audio from both sources
      const canvasStream = canvas.captureStream(frameRate);

      // Get audio tracks from both streams
      const screenAudioTracks = screenStream.getAudioTracks();
      const cameraAudioTracks = cameraStream.getAudioTracks();

      // Add audio tracks to the canvas stream
      screenAudioTracks.forEach((track) => canvasStream.addTrack(track));
      cameraAudioTracks.forEach((track) => canvasStream.addTrack(track));

      return canvasStream;
    },
    [pipConfig, frameRate, createVideoElement]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMerging();
    };
  }, [stopMerging]);

  return {
    canvasRef,
    mergeStreams,
    stopMerging,
  };
}
