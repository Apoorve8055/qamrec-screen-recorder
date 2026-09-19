# <img src="public/icons/icon48.png" width="32" height="32" alt="Qamrec"> Qamrec Screen Recorder

A free, open-source, privacy-focused screen and camera recorder for Chrome that makes recordings look edited: automatic zoom on clicks, smooth camera moves, cursor and keystroke overlays, a styled webcam bubble, and a built-in editor. Everything is processed on your device.

## Features

### Recording
- **This tab** - One click, no picker; enables all page effects (auto-zoom, clicks, keystrokes, typing focus)
- **Screen / window / tab** - Chrome's picker; page effects apply when the shared surface is the browser window you started from, otherwise smart auto-framing is used
- **Camera only**, or a **webcam overlay** recorded as a separate track so it can be restyled after recording
- **System/tab audio + microphone**, mixed into one track, with **noise reduction** and live **level meters**
- **Pause & resume**, **live preview**, **countdown**, **highlight markers**, no artificial time limit
- **Scheduled recording** (start in N minutes or at a time) and **auto-stop**
- **Tutorial mode** - numbered click steps, keystrokes and cursor highlight
- **Presets** (Cinematic, Tutorial, Clean capture, Quick GIF, Talking head, plus your own)
- Keyboard shortcuts: `Alt+Shift+S` stop, `Alt+Shift+P` pause/resume, `Alt+Shift+M` marker

### Cinematic effects (applied in the editor, fully adjustable)
- **Automatic click zoom** with **smooth zoom & pan** that anticipates the cursor ("follow the action")
- **Automatic typing focus** and **element focus** glow on the field being typed into
- **Smart auto-framing** from on-screen motion when page tracking isn't available (e.g. desktop apps)
- **Cursor highlight**, **click ripples**, **numbered click indicators**, **scroll indicator**
- **Keystroke & shortcut display** (typed text is never shown; password/payment fields are ignored)
- **Custom zoom intensity, hold duration and transition speed**; **manual zoom keyframes** (add, move, resize, set focus by clicking the preview)
- **Webcam shape** (circle, rounded, square, wide), **position** (drag it), **size**, **crop**, **border**, **shadow**, **mirror** and **background blur** (MediaPipe, runs locally)
- **Frame styling** - background gradients, padding, rounded corners, drop shadow
- **Chapter markers** from page changes and scene cuts (with optional title cards) and **automatic highlight detection**

### Editing & export
- **Trim & cut** on a timeline with waveform, **automatic silence removal**, "keep only highlights"
- **MP4** (H.264/AAC via WebCodecs), **WebM** (VP9/Opus) and **GIF** export with conversion progress and cancel
- **Resolution scaling** (original, 2160p-480p; scales by height and never upscales) and frame-rate choice
- **Custom filename templates**: `{date} {time} {datetime} {title} {mode} {duration} {res} {n}`

## Privacy

All recording, analysis and encoding happens locally in your browser. Nothing is uploaded, there is no account, no analytics. The page tracker is injected only into the tab you start recording from, only sends events while recording, and never records typed characters.

### Permissions
| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Inject the click/keystroke tracker into the tab you started recording from |
| `tabCapture` | One-click recording of the current tab |
| `downloads` | Save exported files |
| `storage` | Remember your settings and presets on this device |

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/Apoorve8055/qamrec-screen-recorder.git
   cd qamrec-screen-recorder
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Development

### Prerequisites
- Node.js 18+
- npm

### Scripts
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run typecheck` - Run TypeScript type checking
- `npm test` - Run unit tests (Vitest)
- `npm run zip` - Create extension zip file for distribution

### Tech Stack
- React 18, TypeScript, Vite, Tailwind CSS
- Chrome Extension Manifest V3 (Chrome 116+)
- [mediabunny](https://mediabunny.dev) (WebCodecs decode/encode, MP4/WebM muxing)
- MediaPipe Tasks Vision (webcam background blur, bundled locally)
- gifenc (GIF encoding)

## Project Structure
```
src/
├── analysis/       # Scene cuts, chapters, highlights, silence detection
├── background/     # Service worker (windows, tab capture, tracker injection, shortcuts)
├── components/     # Shared React components
├── config/         # Feature flags
├── editor/         # Editor UI, timeline, trim/cut model, preview player
├── effects/        # Zoom engine, camera path, cursor effects, compositor, blur
├── export/         # MP4/WebM/GIF renderer
├── media/          # Remuxing/probing recordings
├── popup/          # Extension popup UI
├── recorder/       # Recording window, capture session, audio mixer
├── shared/         # Types, settings/presets, storage, filenames
├── tracker/        # Page tracker content script
└── utils/          # Utility functions
```

### How it works
Recording captures raw video (and, optionally, a separate webcam track) plus a timeline of page
events from the tracker. Nothing is baked in: after recording, the editor precomputes a camera
path (zooms, pans) from those events and renders every frame through one compositor, used both
for the live preview and for frame-accurate export.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details.

## Author

**Apoorve Verma**
- Website: [apoorveverma.com](https://www.apoorveverma.com)
- GitHub: [@Apoorve8055](https://github.com/Apoorve8055)
