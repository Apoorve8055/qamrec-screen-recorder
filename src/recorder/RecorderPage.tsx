import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaRecorder, type RecordingFormat } from './useMediaRecorder';
import { useStreamMerger } from './useStreamMerger';
import { downloadBlob, downloadBlobFallback, formatFileSize } from '../utils/download';
import { convertToGif, convertToWebm, type ConversionProgress, type VideoResolution } from '../utils/convert';
import { FEATURES } from '../config/features';
import type { RecordingMode } from '../types';

type PageState = 'setup' | 'recording' | 'preview';

export function RecorderPage() {
  const [pageState, setPageState] = useState<PageState>('setup');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RecordingMode>('screen');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [includeMic, setIncludeMic] = useState(false);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress | null>(null);
  const [convertingFormat, setConvertingFormat] = useState<'webm' | 'gif' | null>(null);
  const [videoResolution, setVideoResolution] = useState<VideoResolution>('original');

  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { canvasRef, mergeStreams, stopMerging } = useStreamMerger();

  const [recordingFormat, setRecordingFormat] = useState<RecordingFormat>('webm');

  const {
    state: recorderState,
    duration,
    blob,
    format,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  } = useMediaRecorder({
    onStop: (recordedBlob, recordedFormat) => {
      const url = URL.createObjectURL(recordedBlob);
      setRecordedBlobUrl(url);
      setRecordingFormat(recordedFormat);
      setPageState('preview');
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Parse URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode') as RecordingMode;
    const audioParam = params.get('audio');
    const micParam = params.get('mic');

    if (modeParam) setMode(modeParam);
    if (audioParam) setIncludeAudio(audioParam === 'true');
    if (micParam) setIncludeMic(micParam === 'true');

    // Auto-start recording
    handleStartCapture(modeParam || 'screen', audioParam === 'true', micParam === 'true');
  }, []);

  // Set live preview when stream is available and recording
  useEffect(() => {
    if (pageState === 'recording' && liveStream && liveVideoRef.current) {
      liveVideoRef.current.srcObject = liveStream;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [pageState, liveStream]);

  // Set playback video when blob URL is available and in preview
  useEffect(() => {
    if (pageState === 'preview' && recordedBlobUrl && previewVideoRef.current) {
      previewVideoRef.current.src = recordedBlobUrl;
    }
  }, [pageState, recordedBlobUrl]);

  const handleStartCapture = async (
    captureMode: RecordingMode,
    audio: boolean = includeAudio,
    mic: boolean = includeMic
  ) => {
    try {
      setError(null);
      let finalStream: MediaStream;

      if (captureMode === 'screen' || captureMode === 'screen-camera') {
        // Get screen stream
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'monitor',
          },
          audio: audio && FEATURES.SYSTEM_AUDIO,
        });

        if (captureMode === 'screen-camera') {
          // Also get camera stream
          const cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 300, height: 300, facingMode: 'user' },
            audio: mic,
          });

          // Merge streams using canvas
          finalStream = mergeStreams(screenStream, cameraStream);
        } else {
          // Add microphone if requested
          if (mic) {
            const micStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
            });
            micStream.getAudioTracks().forEach((track) => screenStream.addTrack(track));
          }
          finalStream = screenStream;
        }

        // Handle screen share stop
        screenStream.getVideoTracks()[0].onended = () => {
          stopRecording();
        };
      } else {
        // Camera only mode
        finalStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 1280, height: 720 },
          audio: mic || audio,
        });
      }

      streamRef.current = finalStream;

      // Store stream for useEffect to set on video element
      setLiveStream(finalStream);
      setPageState('recording');
      startRecording(finalStream);
    } catch (err) {
      const error = err as Error;
      if (error.name === 'NotAllowedError') {
        setError('Permission denied. Please allow screen/camera access.');
      } else if (error.name === 'NotFoundError') {
        setError('No camera or microphone found.');
      } else {
        setError(error.message);
      }
    }
  };

  const handleStopRecording = useCallback(() => {
    stopRecording();
    stopMerging();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [stopRecording, stopMerging]);

  const handleDownload = async (downloadFormat: 'webm' | 'mp4' | 'gif') => {
    if (!blob) return;

    setError(null);

    try {
      if (downloadFormat === 'webm') {
        // WebM download - convert if resolution changed or native format is not WebM
        if (videoResolution === 'original' && recordingFormat === 'webm') {
          // Direct download
          try {
            await downloadBlob(blob, undefined, 'webm');
          } catch {
            downloadBlobFallback(blob, undefined, 'webm');
          }
        } else {
          // Convert to WebM with resolution
          setIsConverting(true);
          setConversionProgress(null);
          setConvertingFormat('webm');

          const webmBlob = await convertToWebm(blob, setConversionProgress, videoResolution);

          try {
            await downloadBlob(webmBlob, undefined, 'webm');
          } catch {
            downloadBlobFallback(webmBlob, undefined, 'webm');
          }
        }
      } else if (downloadFormat === 'mp4') {
        // MP4 only available if native format is MP4
        if (recordingFormat === 'mp4') {
          try {
            await downloadBlob(blob, undefined, 'mp4');
          } catch {
            downloadBlobFallback(blob, undefined, 'mp4');
          }
        }
      } else if (downloadFormat === 'gif') {
        // Convert to GIF
        setIsConverting(true);
        setConversionProgress(null);
        setConvertingFormat('gif');

        const gifBlob = await convertToGif(blob, setConversionProgress, videoResolution);

        try {
          await downloadBlob(gifBlob, undefined, 'gif');
        } catch {
          downloadBlobFallback(gifBlob, undefined, 'gif');
        }
      }
    } catch (err) {
      setError('Conversion failed: ' + (err as Error).message);
    } finally {
      setIsConverting(false);
      setConversionProgress(null);
      setConvertingFormat(null);
    }
  };

  const handleNewRecording = () => {
    // Clean up previous blob URL
    if (recordedBlobUrl) {
      URL.revokeObjectURL(recordedBlobUrl);
    }
    setRecordedBlobUrl(null);
    setLiveStream(null);
    setPageState('setup');
    setError(null);
    // Start new recording immediately
    handleStartCapture(mode);
  };

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Hidden canvas for stream merging */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Error display */}
      {error && (
        <div className="fixed top-2 left-2 right-2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">
          <p>{error}</p>
          <button
            onClick={() => setError(null)}
            className="absolute top-1 right-2 text-white/80 hover:text-white"
          >
            x
          </button>
        </div>
      )}

      {/* Conversion progress overlay */}
      {isConverting && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 text-center max-w-xs">
            <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-medium mb-2">
              {conversionProgress?.phase === 'extracting' && `Extracting frames... ${conversionProgress.progress}%`}
              {conversionProgress?.phase === 'encoding' && `Encoding ${convertingFormat?.toUpperCase()}... ${conversionProgress.progress}%`}
              {!conversionProgress && `Converting to ${convertingFormat?.toUpperCase()}...`}
            </p>
            {conversionProgress && conversionProgress.phase !== 'done' && (
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all"
                  style={{ width: `${conversionProgress.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recording view */}
      {pageState === 'recording' && (
        <div className="flex flex-col h-screen">
          {/* Live preview */}
          <div className="flex-1 relative bg-black min-h-0">
            <video
              ref={liveVideoRef}
              className="w-full h-full object-contain"
              muted
              playsInline
            />

            {/* Recording indicator */}
            <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  recorderState === 'recording' ? 'bg-red-500 recording-pulse' : 'bg-yellow-500'
                }`}
              />
              <span className="font-mono text-sm">{formatDuration(duration)}</span>
              {recorderState === 'paused' && (
                <span className="text-yellow-400 text-xs">PAUSED</span>
              )}
            </div>

            {/* Mode indicator */}
            <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded-full text-xs">
              {mode === 'screen' && 'Screen'}
              {mode === 'camera' && 'Camera'}
              {mode === 'screen-camera' && 'Screen+Cam'}
            </div>
          </div>

          {/* Controls */}
          <div className="p-4 bg-gray-800 flex items-center justify-center gap-3">
            {recorderState === 'recording' ? (
              <button
                onClick={pauseRecording}
                className="w-12 h-12 rounded-full bg-yellow-600 hover:bg-yellow-500 flex items-center justify-center transition-colors"
                title="Pause"
              >
                <PauseIcon />
              </button>
            ) : (
              <button
                onClick={resumeRecording}
                className="w-12 h-12 rounded-full bg-green-600 hover:bg-green-500 flex items-center justify-center transition-colors"
                title="Resume"
              >
                <PlayIcon />
              </button>
            )}

            <button
              onClick={handleStopRecording}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors"
              title="Stop Recording"
            >
              <StopIcon />
            </button>
          </div>
        </div>
      )}

      {/* Preview view */}
      {pageState === 'preview' && blob && (
        <div className="flex flex-col h-screen">
          {/* Video preview */}
          <div className="flex-1 relative bg-black min-h-0">
            <video
              ref={previewVideoRef}
              className="w-full h-full object-contain"
              controls
              playsInline
            />
          </div>

          {/* Info and actions */}
          <div className="p-4 bg-gray-800">
            <div className="mb-3">
              <h2 className="text-sm font-medium">Recording Complete</h2>
              <p className="text-gray-400 text-xs">
                {formatDuration(duration)} - {formatFileSize(blob.size)}
              </p>
            </div>

            {/* Video Resolution selector */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Video Resolution</label>
              <select
                value={videoResolution}
                onChange={(e) => {
                  const val = e.target.value;
                  setVideoResolution(val === 'original' ? 'original' : parseInt(val, 10) as VideoResolution);
                }}
                disabled={isConverting}
                className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-primary-500 disabled:opacity-50"
              >
                <option value="original">Original</option>
                <option value={1080}>1080p</option>
                <option value={720}>720p</option>
                <option value={480}>480p</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Resolution applies to WebM and GIF only</p>
            </div>

            {/* Download format buttons */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1">Download Format</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleDownload('webm')}
                  disabled={isConverting}
                  className="btn-primary text-sm py-2 rounded-lg font-medium transition-colors"
                >
                  WebM
                </button>
                <button
                  onClick={() => handleDownload('mp4')}
                  disabled={isConverting || recordingFormat !== 'mp4'}
                  className={`text-sm py-2 rounded-lg font-medium transition-colors ${
                    recordingFormat === 'mp4'
                      ? 'btn-primary'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  MP4
                </button>
                <button
                  onClick={() => handleDownload('gif')}
                  disabled={isConverting}
                  className="btn-primary text-sm py-2 rounded-lg font-medium transition-colors"
                >
                  GIF
                </button>
              </div>
            </div>

            <button
              onClick={handleNewRecording}
              disabled={isConverting}
              className="w-full btn-secondary flex items-center justify-center gap-2 text-sm py-2 disabled:opacity-50"
            >
              <RefreshIcon />
              New Recording
            </button>
          </div>
        </div>
      )}

      {/* Setup/Loading view */}
      {pageState === 'setup' && !error && (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Requesting permissions...</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Icons
function PauseIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
