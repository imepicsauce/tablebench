# TableBench

A browser-based 3D visualizer for board-game boards and cards. Set real-world dimensions, drop in your artwork, pick a surface finish, and look at the result on a virtual table.

No build step and no dependencies to install. It is plain HTML, CSS and JavaScript, with [three.js](https://threejs.org/) r128 loaded from a CDN.

## Run it

Open `index.html` in a browser. An internet connection is needed for three.js (cdnjs) and the web fonts (Google Fonts). If the fonts can't load, the app falls back to system fonts.

If you prefer a local server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Features

- **Board**: presets or custom width / height / thickness / corner radius, plus a surface image.
- **Cards**: presets or custom size, thickness and corner radius, with separate front and back images. Add as many cards as you like. Each keeps its own settings.
- **Image positioning**: zoom (1-5x), shift X / Y and mirror for the board and every card face. Images always fill the face, and the edge colour is sampled from the artwork.
- **Materials**: Matte, Glossy, Textured (linen weave) and Holographic (view-dependent rainbow foil), each with a strength slider. Applies to the board top and to each card.
- **On the table**: drag cards to move them, rotate 90 degrees, flip face-down, duplicate or remove. Overlapping cards stack automatically.
- **Camera**: orbit, top-down view, auto-rotate, and a **freecam** with WASD / QE flight.
- **Cinematic mode** (in freecam): inertia and eased turns, banking, handheld sway, FOV control, letterbox bars, and automated moves (Orbit, Push in, Crane, Slide, Reveal) with adjustable length and looping.
- **Units**: millimetres or inches.

## Controls

| Input | Action |
| --- | --- |
| Drag empty space | Orbit (look, in freecam) |
| Drag a card | Move it across the board |
| Scroll / pinch | Zoom (dolly, in freecam) |
| `F` | Toggle freecam |
| `W A S D` / arrows | Move in freecam |
| `Q` / `E` | Down / up in freecam |
| `Shift` | Boost speed in freecam |
| `C` | Toggle smooth (cinematic) motion in freecam |
| `1` - `5` | Camera moves: Orbit, Push in, Crane, Slide, Reveal |
| `Esc` | Exit freecam |

## Project structure

```
tablebench/
├── index.html        Markup: sidebar controls and the 3D stage
├── css/
│   └── styles.css    All styling
└── js/
    └── app.js        Scene, geometry, materials, camera and UI logic
```

## Notes

- Uploaded images are downscaled in the browser (2048 px for the board, 1024 px for cards). Nothing is uploaded anywhere.
- Rounded-corner geometry is generated procedurally, so any radius up to half the shortest side works.
- Holographic foil is a shader approximation, not a physical simulation.

## License

Add a license of your choice before publishing (for example MIT).
