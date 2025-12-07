# ASCII FX

ASCII FX converts video, images, or webcam streams into ASCII art with multiple export options (PNG, text, GIF, HQ MP4, live recording).

> Code and documentation generated with Claude Opus 4.5 and GPT-5.1 Codex.

## Features
- Upload video/image or use webcam.
- Live ASCII preview with adjustable font, density, color modes, brightness/contrast/saturation/gamma, invert, and background color.
- Exports: copy PNG, copy ASCII text, save PNG, GIF export, HQ MP4 (with/without audio), live record (video+audio when allowed).
- GIF export (15 seconds from start).
- No external API keys or network calls are required at runtime; only browser permissions for camera/mic.

## How It Works
1. **Source** → Load image, video, or webcam stream
2. **Sample** → Downscale frame to character grid (cols × rows based on font size)
3. **Map** → Convert each pixel's luminance to ASCII character from density set
4. **Render** → Draw characters to canvas with selected color mode
5. **Export** → Capture canvas as PNG/GIF/MP4 or copy to clipboard

## Technical Details
| Component | Implementation |
|-----------|----------------|
| Rendering | Canvas 2D API with `requestAnimationFrame` loop |
| Video Export | WebCodecs (`VideoEncoder`/`AudioEncoder`) → MP4 via mediabunny |
| GIF Export | gifenc (quantize + palette per frame) |
| Live Record | `MediaRecorder` + `captureStream()` → WebM |
| Preprocessing | Per-pixel brightness, contrast, saturation, gamma |

## Requirements
- Node.js (for local dev).
- Modern browser with:
  - `MediaRecorder` and `captureStream` (for live record).
  - WebCodecs for HQ export (browser must support `VideoEncoder`/`AudioEncoder`).
  - Webcam: camera permission; microphone permission is needed for audio capture (live record and HQ-with-audio).

## Run Locally
1. Install dependencies: `npm install`
2. Start dev server: `npm run dev`
3. Open the printed local URL in your browser.