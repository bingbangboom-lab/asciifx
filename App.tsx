import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { 
  Upload, 
  Play, 
  Pause, 
  Monitor, 
  Image as ImageIcon,
  Zap,
  Trash2,
  Film,
  Loader,
  Music,
  Camera,
  Copy,
  FileType,
  VolumeX,
  Volume2,
  Download,
  ChevronDown,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Output, Mp4OutputFormat, BufferTarget, EncodedPacket, EncodedVideoPacketSource, EncodedAudioPacketSource } from 'mediabunny';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

// --- Type Declarations for WebCodecs ---
declare class AudioEncoder {
  constructor(init: { output: (chunk: any, meta?: any) => void; error: (e: any) => void });
  configure(config: { codec: string; sampleRate: number; numberOfChannels: number; bitrate?: number }): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  close(): void;
  readonly state: "configured" | "unconfigured" | "closed";
}

declare class AudioData {
  constructor(init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: BufferSource;
  });
  close(): void;
  clone(): AudioData;
  readonly duration: number;
  readonly timestamp: number;
}

declare class VideoEncoder {
  constructor(init: { output: (chunk: any, meta?: any) => void; error: (e: any) => void });
  configure(config: { codec: string; width: number; height: number; bitrate?: number; framerate?: number }): void;
  encode(frame: VideoFrame, options?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
  readonly state: "configured" | "unconfigured" | "closed";
}

declare global {
  interface Window {
    VideoEncoder?: typeof VideoEncoder;
    AudioEncoder?: typeof AudioEncoder;
    webkitAudioContext?: typeof AudioContext;
  }
}

// --- Constants ---
const DENSITY_SETS = {
  standard: " .:-=+*#%@",
  complex: " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  matrix: " 01",
  minimal: " /\\"
};

const FONT_FAMILIES = {
  "Fira Code": "Fira Code, JetBrains Mono, Roboto Mono, Menlo, Consolas, Courier New, monospace",
  "JetBrains Mono": "JetBrains Mono, Fira Code, Roboto Mono, Menlo, Consolas, Courier New, monospace",
  "Roboto Mono": "Roboto Mono, Fira Code, JetBrains Mono, Menlo, Consolas, Courier New, monospace",
  "System Default": "Menlo, Consolas, Courier New, monospace",
  "Courier New": "Courier New, monospace"
};

const DEFAULT_SETTINGS = {
  fontSize: 16,
  fontFamily: 'Menlo, Consolas, Courier New, monospace',
  contrast: 1.4,
  brightness: 1.1,
  saturation: 1.0,
  gamma: 1.0,
  colorMode: 'original' as 'original' | 'white' | 'matrix' | 'custom',
  customColor: '#22d3ee',
  density: 'standard' as keyof typeof DENSITY_SETS,
  invert: false,
  backgroundColor: '#000000',
};

// --- Logic: Preprocess & Draw ---

const preprocessPixel = (
  r: number, g: number, b: number,
  settings: typeof DEFAULT_SETTINGS
): [number, number, number] => {
  if (settings.brightness !== 1.0) {
    r *= settings.brightness;
    g *= settings.brightness;
    b *= settings.brightness;
  }
  if (settings.contrast !== 1.0) {
    r = (r - 128) * settings.contrast + 128;
    g = (g - 128) * settings.contrast + 128;
    b = (b - 128) * settings.contrast + 128;
  }
  if (settings.saturation !== 1.0) {
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = gray + (r - gray) * settings.saturation;
    g = gray + (g - gray) * settings.saturation;
    b = gray + (b - gray) * settings.saturation;
  }
  if (settings.gamma !== 1.0) {
    const invGamma = 1 / settings.gamma;
    r = 255 * Math.pow(Math.max(0, r) / 255, invGamma);
    g = 255 * Math.pow(Math.max(0, g) / 255, invGamma);
    b = 255 * Math.pow(Math.max(0, b) / 255, invGamma);
  }
  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b))
  ];
};

const drawAsciiFrame = (
  ctx: CanvasRenderingContext2D,
  hiddenCtx: CanvasRenderingContext2D,
  hiddenCanvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
  settings: typeof DEFAULT_SETTINGS
) => {
    const charSize = settings.fontSize;
    const cols = Math.floor(width / charSize);
    const rows = Math.floor(height / charSize);

    if (cols <= 0 || rows <= 0) return;

    if (hiddenCanvas.width !== cols || hiddenCanvas.height !== rows) {
      hiddenCanvas.width = cols;
      hiddenCanvas.height = rows;
    }

    // Draw small frame to read pixels
    hiddenCtx.drawImage(source, 0, 0, cols, rows);
    const frameData = hiddenCtx.getImageData(0, 0, cols, rows);
    const pixels = frameData.data;

    // Clear main canvas
    ctx.fillStyle = settings.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.font = `${charSize}px ${settings.fontFamily}`;
    ctx.textBaseline = 'top';

    const densityKey = settings.density && DENSITY_SETS[settings.density] ? settings.density : 'standard';
    const density = DENSITY_SETS[densityKey];
    const len = density.length;

    // Set fillStyle once for static color modes
    const isStaticColor = settings.colorMode === 'white' || settings.colorMode === 'custom';
    if (settings.colorMode === 'white') {
      ctx.fillStyle = '#ffffff';
    } else if (settings.colorMode === 'custom') {
      ctx.fillStyle = settings.customColor;
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const index = (y * cols + x) * 4;
        const [r, g, b] = preprocessPixel(pixels[index], pixels[index + 1], pixels[index + 2], settings);
        const avg = (0.2126 * r + 0.7152 * g + 0.0722 * b);
        
        let charIndex = Math.floor((avg / 255) * len);
        if (settings.invert) charIndex = len - 1 - charIndex;
        charIndex = Math.max(0, Math.min(len - 1, charIndex));
        
        const char = density[charIndex];

        // Only update fillStyle for dynamic color modes
        if (!isStaticColor) {
          if (settings.colorMode === 'original') {
            ctx.fillStyle = `rgb(${r},${g},${b})`;
          } else if (settings.colorMode === 'matrix') {
            ctx.fillStyle = `rgba(0, 255, 70, ${avg / 255})`;
          }
        }

        ctx.fillText(char, x * charSize, y * charSize);
      }
    }
};

const getAsciiString = (
    hiddenCtx: CanvasRenderingContext2D,
    hiddenCanvas: HTMLCanvasElement,
    source: CanvasImageSource,
    width: number,
    height: number,
    settings: typeof DEFAULT_SETTINGS
): string => {
    const charSize = settings.fontSize;
    const cols = Math.floor(width / charSize);
    const rows = Math.floor(height / charSize);
    
    if (cols <= 0 || rows <= 0) return "";

    if (hiddenCanvas.width !== cols || hiddenCanvas.height !== rows) {
      hiddenCanvas.width = cols;
      hiddenCanvas.height = rows;
    }

    hiddenCtx.drawImage(source, 0, 0, cols, rows);
    const frameData = hiddenCtx.getImageData(0, 0, cols, rows);
    const pixels = frameData.data;
    
    const densityKey = settings.density && DENSITY_SETS[settings.density] ? settings.density : 'standard';
    const density = DENSITY_SETS[densityKey];
    const len = density.length;

    let asciiStr = "";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const index = (y * cols + x) * 4;
        const [r, g, b] = preprocessPixel(pixels[index], pixels[index + 1], pixels[index + 2], settings);
        const avg = (0.2126 * r + 0.7152 * g + 0.0722 * b);
        let charIndex = Math.floor((avg / 255) * len);
        if (settings.invert) charIndex = len - 1 - charIndex;
        charIndex = Math.max(0, Math.min(len - 1, charIndex));
        
        // Add character twice to compensate for character aspect ratio (chars are ~2x taller than wide)
        asciiStr += density[charIndex] + density[charIndex];
      }
      asciiStr += "\n";
    }
    return asciiStr;
}

// --- Components ---

const ControlGroup = ({ 
  title, 
  children, 
  isExpanded = true, 
  onToggle 
}: { 
  title: string, 
  children?: React.ReactNode,
  isExpanded?: boolean,
  onToggle?: () => void
}) => (
  <div className="mb-6 border-b border-cyan-900/50 pb-4 last:border-0">
    <button 
      onClick={onToggle}
      className="w-full text-cyan-400 font-bold mb-3 text-xs uppercase tracking-widest flex items-center justify-between gap-2 hover:text-cyan-300 transition-colors"
    >
      <span className="flex items-center gap-2">
        <Zap size={12} /> {title}
      </span>
      <ChevronDown 
        size={14} 
        className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
      />
    </button>
    <div 
      className={`grid gap-4 overflow-hidden transition-all duration-200 ${
        isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
      }`}
    >
      {children}
    </div>
  </div>
);

const RangeControl = ({ label, value, min, max, step, onChange }: { label: string, value: number, min: number, max: number, step: number, onChange: (val: number) => void }) => (
  <div className="flex flex-col gap-1">
    <div className="flex justify-between text-xs text-cyan-400/70 font-mono">
      <span>{label}</span>
      <span>{value.toFixed(1)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="range-slider w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
    />
  </div>
);

type MediaSource = {
    type: 'video' | 'image' | 'webcam';
    url?: string;
    stream?: MediaStream;
};

export default function App() {
  // State
  const [source, setSource] = useState<MediaSource | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'processing_hq' | 'processing_hq_audio' | 'processing_gif'>('idle');
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [renderStatus, setRenderStatus] = useState<string>("");
  const [isMuted, setIsMuted] = useState(true);
  const isBusy = recordingState !== 'idle';
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    source: true,      // Expanded by default
    playback: false,   // Collapsed by default
    appearance: false, // Collapsed by default
    preprocess: false, // Collapsed by default
    export: false,     // Collapsed by default
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);         // Full-res canvas (for recording/export)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);  // Display-size canvas (for preview)
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const settingsRef = useRef(settings);

  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // --- File Handling ---

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      clearSource();
      const url = URL.createObjectURL(file);
      const type = file.type.startsWith('image') ? 'image' : 'video';
      setSource({ type, url });
      if (type === 'video') setIsPlaying(true);
    }
  };

  const startWebcam = async () => {
    try {
        clearSource();
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err) {
          // Retry without audio if microphone access is blocked/denied
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        setSource({ type: 'webcam', stream });
        setIsPlaying(true);
    } catch (e) {
        alert("Unable to access webcam. Please check permissions for camera (and microphone if recording audio).");
    }
  };

  const clearSource = () => {
    if (source?.url) URL.revokeObjectURL(source.url);
    if (source?.stream) source.stream.getTracks().forEach(t => t.stop());
    setSource(null);
    setIsPlaying(false);
    setRecordingState('idle');
    setRenderProgress(null);
    setVideoDimensions({ width: 0, height: 0 });
    setSettings(DEFAULT_SETTINGS);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  };

  // --- Render Loop ---

  const renderFrame = useCallback(() => {
    const settings = settingsRef.current;
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const hiddenCanvas = hiddenCanvasRef.current;
    
    // Determine the source element
    let mediaElement: CanvasImageSource | null = null;
    let width = 0;
    let height = 0;

    if (source?.type === 'image' && imgRef.current) {
        mediaElement = imgRef.current;
        width = imgRef.current.naturalWidth;
        height = imgRef.current.naturalHeight;
    } else if ((source?.type === 'video' || source?.type === 'webcam') && videoRef.current) {
        mediaElement = videoRef.current;
        width = videoRef.current.videoWidth;
        height = videoRef.current.videoHeight;
        // Allow rendering even when paused/ended so settings updates reflect.
    }

    if (!mediaElement || !canvas || !hiddenCanvas || width === 0 || height === 0) {
       animationFrameRef.current = requestAnimationFrame(renderFrame);
       return;
    }

    // Snap to character grid to avoid leftover strips
    const charSize = settings.fontSize;
    const cols = Math.max(1, Math.floor(width / charSize));
    const rows = Math.max(1, Math.floor(height / charSize));
    const renderWidth = cols * charSize;
    const renderHeight = rows * charSize;

    const ctx = canvas.getContext('2d', { alpha: false });
    const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

    if (!ctx || !hiddenCtx) return;

    // Resize full-res canvas (used for recording/export)
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      setVideoDimensions({ width: renderWidth, height: renderHeight });
    }

    // Draw ASCII to full-res canvas
    drawAsciiFrame(ctx, hiddenCtx, hiddenCanvas, mediaElement, renderWidth, renderHeight, settings);

    // Copy to preview canvas at display size (avoids CSS scaling artifacts)
    if (previewCanvas) {
      const previewCtx = previewCanvas.getContext('2d', { alpha: false });
      if (previewCtx) {
        const rect = previewCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          // Preview canvas just became visible; wait a frame for layout to settle.
          animationFrameRef.current = requestAnimationFrame(renderFrame);
          return;
        }
        const dpr = window.devicePixelRatio || 1;
        const containerWidth = rect.width * dpr;
        const containerHeight = rect.height * dpr;
        
        // Calculate display size maintaining aspect ratio
        const sourceAspect = renderWidth / renderHeight;
        const containerAspect = containerWidth / containerHeight;
        
        let displayWidth: number;
        let displayHeight: number;
        
        if (sourceAspect > containerAspect) {
          // Source is wider - fit to width
          displayWidth = Math.floor(containerWidth);
          displayHeight = Math.floor(containerWidth / sourceAspect);
        } else {
          // Source is taller - fit to height
          displayHeight = Math.floor(containerHeight);
          displayWidth = Math.floor(containerHeight * sourceAspect);
        }
        
        if (displayWidth > 0 && displayHeight > 0) {
          if (previewCanvas.width !== displayWidth || previewCanvas.height !== displayHeight) {
            previewCanvas.width = displayWidth;
            previewCanvas.height = displayHeight;
          }
          
          // Disable smoothing for crisp preview at small font sizes
          previewCtx.imageSmoothingEnabled = false;
          previewCtx.drawImage(canvas, 0, 0, displayWidth, displayHeight);
        }
      }
    }

    if (
      source?.type === 'image' ||
      (videoRef.current && !videoRef.current.paused && !videoRef.current.ended)
    ) {
      animationFrameRef.current = requestAnimationFrame(renderFrame);
    }
  }, [source]);

  // Effects for Source Change & Playback
  useEffect(() => {
    // Attach stream to video element if webcam, or set src for video files
    const video = videoRef.current;
    if (!video) return;

    if (source?.type === 'webcam' && source.stream) {
        video.srcObject = source.stream;
    } else if (source?.type === 'video' && source.url) {
        video.srcObject = null;
        video.src = source.url;
        video.load();
    } else {
        // Cleanup when no source or image source
        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
    }
    // We do not call play() here. We rely on the isPlaying state effect below.
  }, [source]);

  useEffect(() => {
    const isProcessing = recordingState.startsWith('processing');
    
    if (!isProcessing) {
        if (source?.type === 'image') {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = requestAnimationFrame(renderFrame);
        } else if (isPlaying) {
             if (videoRef.current) {
                 const playPromise = videoRef.current.play();
                 if (playPromise !== undefined) {
                     playPromise.catch(() => {
                         // Catch AbortError (interrupted by pause) silently
                     });
                 }
                 animationFrameRef.current = requestAnimationFrame(renderFrame);
             }
        } else {
             videoRef.current?.pause();
             if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, renderFrame, recordingState, source]);

  // Ensure paused video/webcam frames reflect setting changes
  useEffect(() => {
      if ((source?.type === 'video' || source?.type === 'webcam') && videoRef.current) {
        if (videoRef.current.paused || videoRef.current.ended) {
          renderFrame();
        }
      }
  }, [settings, source, renderFrame]);


  // Handle image load event for proper initial render
  useEffect(() => {
    if (source?.type === 'image' && imgRef.current) {
      const img = imgRef.current;
      const handleLoad = () => {
        requestAnimationFrame(() => renderFrame());
      };
      img.addEventListener('load', handleLoad);
      if (img.complete && img.naturalWidth > 0) {
        requestAnimationFrame(() => renderFrame());
      }
      return () => img.removeEventListener('load', handleLoad);
    }
  }, [source, renderFrame]);

  // --- Export Utilities ---

  const copyImageToClipboard = async () => {
    if (!canvasRef.current) return;
    try {
        canvasRef.current.toBlob(blob => {
            if (blob) {
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                alert("Image copied to clipboard!");
            }
        });
    } catch (e) {
        alert("Failed to copy image");
    }
  };

  const copyTextToClipboard = () => {
    if (!hiddenCanvasRef.current || !source) return;
    let mediaElement: CanvasImageSource | null = null;
    let w = 0, h = 0;

    if (source.type === 'image' && imgRef.current) {
        mediaElement = imgRef.current;
        w = imgRef.current.naturalWidth;
        h = imgRef.current.naturalHeight;
    } else if (videoRef.current) {
        mediaElement = videoRef.current;
        w = videoRef.current.videoWidth;
        h = videoRef.current.videoHeight;
    }

    if (!mediaElement) return;
    
    const hiddenCtx = hiddenCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!hiddenCtx) return;

    const charSize = settings.fontSize;
    const cols = Math.max(1, Math.floor(w / charSize));
    const rows = Math.max(1, Math.floor(h / charSize));
    const snapW = cols * charSize;
    const snapH = rows * charSize;
    const text = getAsciiString(hiddenCtx, hiddenCanvasRef.current, mediaElement, snapW, snapH, settings);
    navigator.clipboard.writeText(text);
    alert("ASCII text copied to clipboard!");
  };

  const downloadImage = () => {
    if (!canvasRef.current) return;
    canvasRef.current.toBlob(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ascii-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  };

  const startGifExport = async () => {
      if (!canvasRef.current || !videoRef.current || !hiddenCanvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const hiddenCanvas = hiddenCanvasRef.current;
      const ctx = canvas.getContext('2d', { alpha: false });
      const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || !hiddenCtx) return;

      setIsPlaying(false);
      video.pause();
      video.muted = true;
      setRecordingState('processing_gif');
      setRenderProgress(0);
      setRenderStatus("RECORDING GIF...");

      // Align dimensions to character grid to avoid edge gaps
      const charSize = settings.fontSize;
      const cols = Math.floor(video.videoWidth / charSize);
      const rows = Math.floor(video.videoHeight / charSize);
      const width = cols * charSize;
      const height = rows * charSize;
      
      const fps = 10; // Lower FPS for GIF
      const duration = Math.min(video.duration, 15); // Limit GIF to 15s to prevent crashes
      const totalFrames = Math.floor(duration * fps);
      
      canvas.width = width;
      canvas.height = height;
      
      // GIF Encoder Setup
      const gif = GIFEncoder();
      
      const seekTo = (time: number): Promise<void> => {
        return new Promise((resolve) => {
          if (Math.abs(video.currentTime - time) < 0.01) {
            resolve();
            return;
          }
          
          let timeoutId: number;
          const onSeek = () => {
            clearTimeout(timeoutId);
            video.removeEventListener('seeked', onSeek);
            resolve();
          };
          video.addEventListener('seeked', onSeek);
          video.currentTime = time;
          
          timeoutId = window.setTimeout(() => {
            video.removeEventListener('seeked', onSeek);
            resolve();
          }, 500);
        });
      };
      
      try {
        for (let i = 0; i < totalFrames; i++) {
            const time = i / fps;
            await seekTo(time);
            
            // Small delay to ensure frame is rendered
            await new Promise(r => setTimeout(r, 50));

            drawAsciiFrame(ctx, hiddenCtx, hiddenCanvas, video, width, height, settings);
            
            // Get data for GIF
            const imageData = ctx.getImageData(0, 0, width, height);
            
            // Quantize frame and map pixels to palette indices
            let palette = quantize(imageData.data, 256);
            let data: Uint8Array;

            if (palette && palette.length > 0) {
                data = applyPalette(imageData.data, palette);
            } else {
                // Fallback for safety to prevent empty palette errors
                palette = [[0, 0, 0]];
                data = new Uint8Array(width * height).fill(0);
            }

            // Add frame
            gif.writeFrame(data, width, height, {
                palette,
                delay: Math.round(1000 / fps),
            });

            setRenderProgress(Math.round((i / totalFrames) * 100));
            await new Promise(r => setTimeout(r, 0));
        }
        
        gif.finish();
        const buffer = gif.bytes();
        const blob = new Blob([buffer], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ascii-export-${Date.now()}.gif`;
        a.click();
        URL.revokeObjectURL(url);

      } catch (e) {
          console.error(e);
          alert("GIF Export failed: " + e);
      } finally {
        setRenderProgress(null);
        setRenderStatus("");
        setRecordingState('idle');
        video.currentTime = 0;
        video.muted = isMuted;
      }
  };

  const startOfflineRender = async (withAudio: boolean) => {
      if (source?.type !== 'video' || !videoRef.current || !canvasRef.current || !hiddenCanvasRef.current) return;

      const hasVideoEncoder = typeof window.VideoEncoder === 'function';
      const hasAudioEncoder = typeof window.AudioEncoder === 'function';
      if (!hasVideoEncoder || (withAudio && !hasAudioEncoder)) {
        alert("HQ render requires WebCodecs support (VideoEncoder/AudioEncoder) in this browser.");
        return;
      }
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const hiddenCanvas = hiddenCanvasRef.current;
      const ctx = canvas.getContext('2d', { alpha: false });
      const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

      if (!ctx || !hiddenCtx) return;

      setIsPlaying(false);
      video.pause();
      video.muted = true;
      setRecordingState(withAudio ? 'processing_hq_audio' : 'processing_hq');
      setRenderProgress(0);
      setRenderStatus("INITIALIZING...");

      // Audio Extraction
      let audioBuffer: AudioBuffer | null = null;
      let audioCtx: (AudioContext | null) = null;
      if (withAudio && source.url) {
        try {
          setRenderStatus("EXTRACTING AUDIO...");
          const response = await fetch(source.url);
          const arrayBuffer = await response.arrayBuffer();
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (e) {
          console.warn("Audio extraction failed", e);
        }
      }

      setRenderStatus("PREPARING ENCODER...");

      // Align dimensions to character grid to avoid edge gaps
      const charSize = settings.fontSize;
      const cols = Math.floor(video.videoWidth / charSize);
      const rows = Math.floor(video.videoHeight / charSize);
      const baseWidth = cols * charSize;
      const baseHeight = rows * charSize;
      
      // Ensure even dimensions for H.264 encoding
      const renderWidth = baseWidth - (baseWidth % 2);
      const renderHeight = baseHeight - (baseHeight % 2);
      
      const fps = 30;
      const duration = video.duration;
      const totalFrames = Math.floor(duration * fps);

      canvas.width = renderWidth;
      canvas.height = renderHeight;

      const target = new BufferTarget();
      const output = new Output({
        format: new Mp4OutputFormat(),
        target
      });
      const videoSource = new EncodedVideoPacketSource('avc');
      output.addVideoTrack(videoSource);

      let audioSource: EncodedAudioPacketSource | null = null;
      if (audioBuffer) {
        audioSource = new EncodedAudioPacketSource('aac');
        output.addAudioTrack(audioSource);
      }

      await output.start();

      const videoEncoder = new VideoEncoder({
          output: async (chunk, meta) => {
            const packet = EncodedPacket.fromEncodedChunk(chunk);
            await videoSource.add(packet, meta);
          },
          error: (e) => { console.error(e); setRecordingState('idle'); }
      });

      videoEncoder.configure({
          codec: 'avc1.4d0033', 
          width: renderWidth,
          height: renderHeight,
          bitrate: 12_000_000,
          framerate: fps
      });

      try {
          if (audioBuffer) {
             setRenderStatus("ENCODING AUDIO...");
             const audioEncoder = new AudioEncoder({
                output: async (chunk, meta) => {
                  if (!audioSource) return;
                  const packet = EncodedPacket.fromEncodedChunk(chunk);
                  await audioSource.add(packet, meta);
                },
                error: (e) => console.error(e)
             });
             audioEncoder.configure({
               codec: 'mp4a.40.2',
               sampleRate: audioBuffer.sampleRate,
               numberOfChannels: audioBuffer.numberOfChannels,
               bitrate: 128_000
             });
             
             const numberOfChannels = audioBuffer.numberOfChannels;
             const length = audioBuffer.length;
             const sampleRate = audioBuffer.sampleRate;
             const interleaved = new Float32Array(length * numberOfChannels);
             for (let i = 0; i < length; i++) {
                 for (let ch = 0; ch < numberOfChannels; ch++) interleaved[i * numberOfChannels + ch] = audioBuffer.getChannelData(ch)[i];
             }
             const chunkSize = sampleRate; 
             for (let i = 0; i < length; i += chunkSize) {
                const end = Math.min(i + chunkSize, length);
                const chunkData = interleaved.subarray(i * numberOfChannels, end * numberOfChannels);
                const audioData = new AudioData({
                    format: 'f32', sampleRate, numberOfFrames: end - i, numberOfChannels,
                    timestamp: i * 1_000_000 / sampleRate, data: chunkData
                });
                audioEncoder.encode(audioData);
                audioData.close();
             }
             await audioEncoder.flush();
             audioEncoder.close();
          }

          setRenderStatus("RENDERING VIDEO...");
          for (let i = 0; i < totalFrames; i++) {
              const time = i / fps;
              video.currentTime = time;
              await new Promise<void>(resolve => {
                  let timeoutId: number;
                  const onSeek = () => {
                      clearTimeout(timeoutId);
                      video.removeEventListener('seeked', onSeek);
                      resolve();
                  };
                  video.addEventListener('seeked', onSeek);
                  timeoutId = window.setTimeout(() => {
                      video.removeEventListener('seeked', onSeek);
                      resolve();
                  }, 500);
              });

              drawAsciiFrame(ctx, hiddenCtx, hiddenCanvas, video, renderWidth, renderHeight, settings);
              const frame = new VideoFrame(canvas, { timestamp: i * (1000000 / fps) });
              videoEncoder.encode(frame, { keyFrame: i % 30 === 0 });
              frame.close();

              setRenderProgress(Math.round((i / totalFrames) * 100));
              await new Promise(r => setTimeout(r, 0));
          }

          setRenderStatus("FINALIZING...");
          await videoEncoder.flush();
          videoEncoder.close();
          if (audioCtx) {
            try { audioCtx.close(); } catch {}
          }
          await output.finalize();
          const buffer = target.buffer || new ArrayBuffer(0);
          const blob = new Blob([buffer], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ascii-hq-${withAudio ? 'audio-' : ''}${Date.now()}.mp4`;
          a.click();
          URL.revokeObjectURL(url);
      } catch (err) {
          console.error(err);
          alert("Render failed.");
      } finally {
          setRenderProgress(null);
          setRenderStatus("");
          setRecordingState('idle');
          video.currentTime = 0;
          video.muted = isMuted;
      }
  };

  // --- Live Recording (CanvasStream) ---
  const startLiveRecording = () => {
    if (!canvasRef.current) return;
    setRecordingState('recording');

    const canvasStream = canvasRef.current.captureStream(30);
    const mixedStream = new MediaStream(canvasStream.getVideoTracks());

    const addAudioTracks = (stream?: MediaStream | null) => {
      stream?.getAudioTracks().forEach(track => mixedStream.addTrack(track.clone()));
    };

    if (source?.type === 'video' && videoRef.current?.captureStream && !isMuted) {
      addAudioTracks(videoRef.current.captureStream());
    } else if (source?.type === 'webcam' && source.stream && !isMuted) {
      addAudioTracks(source.stream);
    }

    const preferredMime = 'video/webm;codecs=vp9,opus';
    const fallbackMime = 'video/webm;codecs=vp8,opus';
    const mimeType = MediaRecorder.isTypeSupported(preferredMime)
      ? preferredMime
      : (MediaRecorder.isTypeSupported(fallbackMime) ? fallbackMime : 'video/webm');

    const mediaRecorder = new MediaRecorder(mixedStream, { mimeType });
    chunksRef.current = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mediaRecorder.onstop = () => {
        canvasStream.getTracks().forEach(track => track.stop());
        mixedStream.getTracks().forEach(track => track.stop());
        
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ascii-live-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setRecordingState('idle');
    };
    mediaRecorderRef.current = mediaRecorder;
    if (source?.type === 'video' && videoRef.current) videoRef.current.currentTime = 0;
    if (!isPlaying) setIsPlaying(true);
    mediaRecorder.start();
    
    if (source?.type === 'video' && videoRef.current) {
        videoRef.current.onended = () => { if (mediaRecorder.state === 'recording') { mediaRecorder.stop(); setIsPlaying(false); } };
    }
  };

  const stopLiveRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
  };


  return (
    <div className="h-screen bg-black text-cyan-400 font-sans selection:bg-cyan-900 selection:text-white overflow-hidden flex flex-col">
      {/* Header */}
      <header className={`h-14 border-b border-cyan-900/50 flex items-center justify-between px-6 bg-black/80 backdrop-blur-md sticky top-0 z-50 ${isFullscreen ? 'hidden' : ''}`}>
        <div className="flex items-center gap-2">
          <Monitor className="text-cyan-400" />
          <h1 className="text-xl font-bold tracking-[0.2em] font-mono">ASCII<span className="text-white">FX</span></h1>
        </div>
        <div className="flex gap-4 text-xs font-mono text-cyan-600">
          <span>RES: {videoDimensions.width}x{videoDimensions.height}</span>
          <span>{source?.type?.toUpperCase() || 'NONE'}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        
        {/* Sidebar Controls */}
        <aside className={`w-full md:w-80 max-h-[50vh] md:max-h-none border-b md:border-b-0 md:border-r border-cyan-900/50 bg-black/50 p-4 md:p-6 overflow-y-auto ${isFullscreen ? 'hidden' : ''}`}>
          
          <ControlGroup title="Source" isExpanded={expandedSections.source} onToggle={() => toggleSection('source')}>
            <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <label className="flex-1 flex items-center justify-center gap-2 bg-cyan-900/20 hover:bg-cyan-900/40 border border-cyan-800 hover:border-cyan-500 text-cyan-400 py-3 rounded-lg cursor-pointer transition-all">
                        <Upload size={16} />
                        <span className="text-xs font-bold font-mono">UPLOAD FILE</span>
                        <input 
                            type="file" 
                            accept="video/*,image/*" 
                            onChange={handleFileUpload} 
                            onClick={(e) => (e.currentTarget.value = '')}
                            className="hidden" 
                        />
                    </label>
                    {source && (
                        <button onClick={clearSource} className="px-3 bg-red-900/20 hover:bg-red-900/40 border border-red-900 hover:border-red-500 text-red-400 rounded-lg transition-all">
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
                <button onClick={startWebcam} className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 text-gray-300 py-2 rounded-lg transition-all">
                    <Camera size={14} />
                    <span className="text-xs font-mono">USE WEBCAM</span>
                </button>
            </div>
          </ControlGroup>

          {source?.type !== 'image' && (
              <ControlGroup title="Playback" isExpanded={expandedSections.playback} onToggle={() => toggleSection('playback')}>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    disabled={!source || recordingState.startsWith('processing')}
                    className="flex-1 flex items-center justify-center gap-2 bg-cyan-400 text-black font-bold py-3 rounded-lg hover:bg-cyan-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPlaying ? <Pause size={16} fill="black" /> : <Play size={16} fill="black" />}
                    <span className="text-xs font-mono">{isPlaying ? 'PAUSE' : 'PLAY'}</span>
                  </button>
                  <button 
                    onClick={() => setIsMuted(!isMuted)}
                    disabled={!source || source.type === 'image'}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-3 rounded-lg transition-all disabled:opacity-50"
                  >
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    <span className="text-xs font-mono">{isMuted ? 'UNMUTE' : 'MUTE'}</span>
                  </button>
                </div>
              </ControlGroup>
          )}

          <ControlGroup title="Appearance" isExpanded={expandedSections.appearance} onToggle={() => toggleSection('appearance')}>
            <RangeControl 
              label="FONT SIZE" 
              value={settings.fontSize} 
              min={8} max={32} step={1}
              onChange={(v) => setSettings(s => ({ ...s, fontSize: v }))} 
            />
            
            <div className="flex flex-col gap-2">
                <span className="text-xs text-cyan-400/70 font-mono">FONT FAMILY</span>
                <select 
                    value={settings.fontFamily}
                    onChange={(e) => setSettings(s => ({ ...s, fontFamily: e.target.value }))}
                    className="bg-gray-900 border border-cyan-900 text-cyan-400 text-xs p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
                >
                    {Object.entries(FONT_FAMILIES).map(([label, stack]) => (
                        <option key={label} value={stack}>{label}</option>
                    ))}
                </select>
            </div>

            <div className="flex flex-col gap-2 mt-2">
                <span className="text-xs text-cyan-400/70 font-mono">COLOR MODE</span>
                <div className="grid grid-cols-2 gap-2">
                    {(['original', 'white', 'matrix', 'custom'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSettings(s => ({ ...s, colorMode: mode }))}
                            className={`text-xs border py-1 rounded font-mono uppercase transition-all ${
                                settings.colorMode === mode 
                                ? 'bg-cyan-400 text-black border-cyan-400' 
                                : 'bg-transparent text-cyan-600 border-cyan-900 hover:border-cyan-500 hover:text-cyan-400'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>
            </div>

            {settings.colorMode === 'custom' && (
                <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-cyan-400/70 font-mono">TEXT COLOR</span>
                    <input 
                        type="color" 
                        value={settings.customColor} 
                        onChange={(e) => setSettings(s => ({ ...s, customColor: e.target.value }))}
                        className="w-10 h-6 bg-transparent cursor-pointer border border-cyan-700 rounded"
                    />
                </div>
            )}

            <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-cyan-400/70 font-mono">BG COLOR</span>
                <input 
                    type="color" 
                    value={settings.backgroundColor} 
                    onChange={(e) => setSettings(s => ({ ...s, backgroundColor: e.target.value }))}
                    className="w-10 h-6 bg-transparent cursor-pointer border border-cyan-700 rounded"
                />
            </div>

            <div className="flex flex-col gap-2 mt-2">
                <span className="text-xs text-cyan-400/70 font-mono">DENSITY SET</span>
                <select 
                    value={settings.density}
                    onChange={(e) => setSettings(s => ({ ...s, density: e.target.value as keyof typeof DENSITY_SETS }))}
                    className="bg-gray-900 border border-cyan-900 text-cyan-400 text-xs p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
                >
                    {Object.keys(DENSITY_SETS).map(key => (
                        <option key={key} value={key}>{key.toUpperCase()}</option>
                    ))}
                </select>
            </div>

            <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-cyan-400/70 font-mono">INVERT ASCII</span>
                <button 
                    onClick={() => setSettings(s => ({ ...s, invert: !s.invert }))}
                    className={`w-10 h-5 rounded-full relative transition-colors ${settings.invert ? 'bg-cyan-400' : 'bg-gray-800'}`}
                >
                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-black transition-all ${settings.invert ? 'left-6' : 'left-1'}`} />
                </button>
            </div>
          </ControlGroup>

          <ControlGroup title="Preprocess" isExpanded={expandedSections.preprocess} onToggle={() => toggleSection('preprocess')}>
            <RangeControl 
              label="CONTRAST" 
              value={settings.contrast} 
              min={0.1} max={3} step={0.1}
              onChange={(v) => setSettings(s => ({ ...s, contrast: v }))} 
            />
            <RangeControl 
              label="BRIGHTNESS" 
              value={settings.brightness} 
              min={0.1} max={3} step={0.1}
              onChange={(v) => setSettings(s => ({ ...s, brightness: v }))} 
            />
            <RangeControl 
              label="SATURATION" 
              value={settings.saturation} 
              min={0.1} max={3} step={0.1}
              onChange={(v) => setSettings(s => ({ ...s, saturation: v }))} 
            />
            <RangeControl 
              label="GAMMA" 
              value={settings.gamma} 
              min={0.1} max={3} step={0.1}
              onChange={(v) => setSettings(s => ({ ...s, gamma: v }))} 
            />
          </ControlGroup>

          <ControlGroup title="Export" isExpanded={expandedSections.export} onToggle={() => toggleSection('export')}>
             {/* Copy/Save*/}
             <div className="grid grid-cols-3 gap-2 mb-2">
                 <button onClick={copyImageToClipboard} disabled={!source || isBusy} className="flex flex-col items-center justify-center gap-1 bg-cyan-900/20 hover:bg-cyan-900/50 border border-cyan-800 hover:border-cyan-400 text-cyan-400 py-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                     <Copy size={14} /> <span className="text-[10px] font-bold font-mono">COPY IMG</span>
                 </button>
                 <button onClick={copyTextToClipboard} disabled={!source || isBusy} className="flex flex-col items-center justify-center gap-1 bg-cyan-900/20 hover:bg-cyan-900/50 border border-cyan-800 hover:border-cyan-400 text-cyan-400 py-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                     <FileType size={14} /> <span className="text-[10px] font-bold font-mono">COPY TXT</span>
                 </button>
                 <button onClick={downloadImage} disabled={!source || isBusy} className="flex flex-col items-center justify-center gap-1 bg-cyan-900/20 hover:bg-cyan-900/50 border border-cyan-800 hover:border-cyan-400 text-cyan-400 py-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                     <Download size={14} /> <span className="text-[10px] font-bold font-mono">SAVE PNG</span>
                 </button>
             </div>

             {/* Video Export */}
             <div className="grid grid-cols-3 gap-2 mb-2">
                 <button 
                     onClick={() => startOfflineRender(false)}
                     disabled={source?.type !== 'video' || recordingState !== 'idle'}
                     className="flex flex-col items-center justify-center gap-1 bg-cyan-900/20 hover:bg-cyan-900/50 border border-cyan-800 hover:border-cyan-400 text-cyan-400 py-2 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                   >
                     {recordingState === 'processing_hq' ? <Loader size={14} className="animate-spin" /> : <Film size={14} />}
                     <span className="text-[10px] font-bold font-mono">RENDER HQ</span>
                 </button>
                 <button 
                     onClick={() => startOfflineRender(true)}
                     disabled={source?.type !== 'video' || recordingState !== 'idle'}
                     className="flex flex-col items-center justify-center gap-1 bg-cyan-900/20 hover:bg-cyan-900/50 border border-cyan-800 hover:border-cyan-400 text-cyan-400 py-2 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                   >
                     {recordingState === 'processing_hq_audio' ? <Loader size={14} className="animate-spin" /> : <Music size={14} />}
                     <span className="text-[10px] font-bold font-mono">HQ+AUDIO</span>
                 </button>
                 <button 
                     onClick={startGifExport}
                     disabled={source?.type !== 'video' || recordingState !== 'idle'}
                     className="flex flex-col items-center justify-center gap-1 bg-cyan-900/20 hover:bg-cyan-900/50 border border-cyan-800 hover:border-cyan-400 text-cyan-400 py-2 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                   >
                     {recordingState === 'processing_gif' ? <Loader size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                     <span className="text-[10px] font-bold font-mono">GIF (15s)</span>
                 </button>
             </div>

             {/* Live Record */}
             {recordingState === 'recording' ? (
                <button onClick={stopLiveRecording} className="w-full flex items-center justify-center gap-2 bg-red-900/20 hover:bg-red-900/40 border border-red-500 text-red-500 py-3 rounded-lg transition-all animate-pulse">
                    <div className="w-2 h-2 bg-red-500 rounded-full" />
                    <span className="text-xs font-bold font-mono">STOP RECORDING</span>
                </button>
             ) : (
                <button 
                 onClick={startLiveRecording}
                 disabled={!source || source.type === 'image' || recordingState !== 'idle'}
                 className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 border border-cyan-900/50 hover:border-cyan-900 text-cyan-600 py-3 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
               >
                 <div className="w-2 h-2 bg-red-500 rounded-full opacity-50" />
                 <span className="text-xs font-bold font-mono">LIVE RECORD</span>
               </button>
             )}
          </ControlGroup>

        </aside>

        {/* Canvas Area */}
        <section className={`flex-1 bg-black relative flex items-center justify-center overflow-hidden ${isFullscreen ? 'p-0' : 'p-4 md:p-8'}`}>
            <div className={`absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none ${isFullscreen ? 'hidden' : ''}`} />
            
            {/* Overlay */}
            {renderProgress !== null && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 backdrop-blur-sm">
                    <div className="w-16 h-16 border-4 border-cyan-900 border-t-cyan-400 rounded-full animate-spin mb-4" />
                    <h3 className="text-xl font-bold text-cyan-400 font-mono tracking-widest">RENDERING</h3>
                    <p className="text-cyan-600 font-mono mt-2">{renderStatus}</p>
                    <p className="text-cyan-400 font-bold font-mono mt-1 text-2xl">{renderProgress}%</p>
                </div>
            )}

            <div className={`relative ${isFullscreen ? 'w-full h-full bg-black' : 'border border-cyan-900/50 shadow-[0_0_50px_-20px_rgba(34,211,238,0.15)] bg-black max-w-full max-h-full aspect-video w-full'} flex items-center justify-center ${!source && !isFullscreen ? 'h-full border-dashed' : ''}`}>
                
                {/* Fullscreen Toggle Button */}
                {source && (
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className={`absolute z-40 bg-black/70 hover:bg-black/90 border border-cyan-800 hover:border-cyan-400 text-cyan-400 p-2 rounded-lg transition-all ${isFullscreen ? 'top-4 right-4' : 'top-2 right-2'}`}
                        title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                    >
                        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                )}

                {/* Hidden Sources */}
                <video ref={videoRef} className="hidden" crossOrigin="anonymous" playsInline loop muted={source?.type === 'webcam' ? true : isMuted} />
                <img ref={imgRef} src={source?.url || undefined} className="hidden" crossOrigin="anonymous" alt="source" />
                <canvas ref={hiddenCanvasRef} className="hidden" />
                
                {/* Hidden Full-Res Canvas (for recording/export) */}
                <canvas ref={canvasRef} className="hidden" />

                {/* Visible Preview Canvas (display-sized, no CSS scaling artifacts) */}
                <canvas 
                    ref={previewCanvasRef}
                    className={`${isFullscreen ? 'w-full h-full' : 'max-w-full max-h-full w-full h-full'} object-contain ${!source ? 'hidden' : ''}`}
                    style={{ imageRendering: 'pixelated' }}
                />

                {/* Empty State */}
                {!source && !isFullscreen && (
                    <div className="text-center p-8">
                        <div className="w-20 h-20 bg-cyan-900/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-cyan-500/30 animate-pulse">
                            <Upload size={32} className="text-cyan-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-cyan-400 mb-2 font-mono tracking-widest">ASCII<span className="text-white">FX</span></h2>
                        <p className="text-cyan-600 mb-6 font-mono text-sm">DROP VIDEO/IMAGE OR USE WEBCAM</p>
                        <div className="flex gap-4 justify-center">
                            <label className="bg-cyan-400 hover:bg-cyan-300 text-black font-bold py-2 px-6 rounded-full cursor-pointer transition-all inline-flex items-center gap-2">
                                <ImageIcon size={16} /> <span className="text-xs font-mono">FILE</span>
                                <input 
                                    type="file" 
                                    accept="video/*,image/*" 
                                    onChange={handleFileUpload} 
                                    onClick={(e) => (e.currentTarget.value = '')}
                                    className="hidden" 
                                />
                            </label>
                            <button onClick={startWebcam} className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-full cursor-pointer transition-all inline-flex items-center gap-2">
                                <Camera size={16} /> <span className="text-xs font-mono">WEBCAM</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
      </main>
    </div>
  );
}