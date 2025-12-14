import { useState, useRef, useCallback } from 'react';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';
export type RecordingFormat = 'mp4' | 'webm';

interface UseMediaRecorderOptions {
  preferMp4?: boolean;
  audioBitsPerSecond?: number;
  videoBitsPerSecond?: number;
  onDataAvailable?: (blob: Blob) => void;
  onStop?: (blob: Blob, format: RecordingFormat) => void;
  onError?: (error: Error) => void;
}

interface UseMediaRecorderReturn {
  state: RecorderState;
  duration: number;
  blob: Blob | null;
  format: RecordingFormat | null;
  startRecording: (stream: MediaStream) => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
}

export function useMediaRecorder(options: UseMediaRecorderOptions = {}): UseMediaRecorderReturn {
  const {
    preferMp4 = true,
    audioBitsPerSecond = 128000,
    videoBitsPerSecond = 2500000,
    onDataAvailable,
    onStop,
    onError,
  } = options;

  const [state, setState] = useState<RecorderState>('idle');
  const [duration, setDuration] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [format, setFormat] = useState<RecordingFormat | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const formatRef = useRef<RecordingFormat>('webm');

  const getSupportedMimeType = useCallback((): { mimeType: string; format: RecordingFormat } => {
    // Try MP4 first if preferred (works on Windows/Mac Chrome)
    if (preferMp4) {
      const mp4Types = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4',
      ];

      for (const type of mp4Types) {
        if (MediaRecorder.isTypeSupported(type)) {
          return { mimeType: type, format: 'mp4' };
        }
      }
    }

    // Fall back to WebM
    const webmTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];

    for (const type of webmTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        return { mimeType: type, format: 'webm' };
      }
    }

    return { mimeType: 'video/webm', format: 'webm' };
  }, [preferMp4]);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = window.setInterval(() => {
      setDuration(Date.now() - startTimeRef.current);
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = useCallback(
    (stream: MediaStream) => {
      try {
        chunksRef.current = [];
        setBlob(null);
        setDuration(0);
        setFormat(null);

        const { mimeType, format: recordFormat } = getSupportedMimeType();
        formatRef.current = recordFormat;
        setFormat(recordFormat);

        console.log(`Recording with MIME type: ${mimeType} (${recordFormat})`);

        const recorder = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond,
          videoBitsPerSecond,
        });

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
            onDataAvailable?.(event.data);
          }
        };

        recorder.onstop = () => {
          stopTimer();
          const finalBlob = new Blob(chunksRef.current, { type: mimeType });
          setBlob(finalBlob);
          setState('stopped');
          onStop?.(finalBlob, formatRef.current);

          // Notify background script
          chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        };

        recorder.onerror = (event) => {
          stopTimer();
          setState('idle');
          onError?.(new Error('Recording error: ' + (event as ErrorEvent).message));
        };

        mediaRecorderRef.current = recorder;
        recorder.start(1000); // Collect data every second
        setState('recording');
        startTimer();

        // Notify background script
        chrome.runtime.sendMessage({ type: 'START_RECORDING' });
      } catch (error) {
        onError?.(error as Error);
      }
    },
    [audioBitsPerSecond, videoBitsPerSecond, onDataAvailable, onStop, onError, getSupportedMimeType, startTimer, stopTimer]
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setState('paused');
      stopTimer();

      // Notify background script
      chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    }
  }, [stopTimer]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setState('recording');
      startTimer();

      // Notify background script
      chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
    }
  }, [startTimer]);

  return {
    state,
    duration,
    blob,
    format,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  };
}
