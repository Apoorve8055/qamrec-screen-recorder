# Qamrec Screen Recorder

A free, open-source, and privacy-focused screen and camera recorder Chrome extension. Record your screen, webcam, or both with picture-in-picture mode - all recordings stay on your device.

## Features

### Recording Modes
- **Screen Recording** - Capture your entire screen, a specific window, or a browser tab
- **Camera Recording** - Record directly from your webcam
- **Screen + Camera (PiP)** - Record your screen with a camera overlay in picture-in-picture mode

### Audio Options
- **System Audio** - Capture audio from your computer (tabs, applications)
- **Microphone** - Record your voice with microphone input
- Both can be enabled simultaneously

### Export Formats
- **WebM** - High-quality video format (default)
- **MP4** - Native MP4 when supported by browser
- **GIF** - Convert recordings to animated GIFs

### Video Resolution
Choose output resolution for exports:
- Original
- 1080p
- 720p
- 480p

### Other Features
- Pause and resume recordings
- Live preview while recording
- Duration and file size display
- No account required
- No data uploaded - everything stays local

## Privacy

All recordings are processed and saved locally on your device. No data ever leaves your browser. The extension only requests permissions necessary for recording functionality.

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
- `npm run zip` - Create extension zip file for distribution

### Tech Stack
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Chrome Extension Manifest V3
- gifenc (for GIF encoding)

## Project Structure
```
src/
├── background/     # Service worker
├── components/     # Shared React components
├── config/         # Feature flags and configuration
├── popup/          # Extension popup UI
├── recorder/       # Recording page and hooks
├── styles/         # Tailwind CSS styles
├── types/          # TypeScript types
└── utils/          # Utility functions
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details.

## Author

**Apoorve Verma**
- Website: [apoorveverma.com](https://www.apoorveverma.com)
- GitHub: [@Apoorve8055](https://github.com/Apoorve8055)
