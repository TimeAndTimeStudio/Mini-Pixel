# Mini Pixel

**Mini Pixel** is a free, browser-based pixel art editor and sprite animation maker. Draw, animate, and export pixel art with nothing to install and nothing to sign up for — just open `index.html` and start drawing.

Made by **Time And Time Studio**.

## Features

- **Draw & erase** — Pencil, Eraser, and Eyedropper tools with an adjustable 1–64px brush size (shared between pencil and eraser).
- **Full color control** — a color wheel with a brightness slider, plus a hex input for exact colors.
- **Mirror / symmetry drawing** — Mirror X and Mirror Y for symmetrical sprites and patterns.
- **Undo / redo** — full history so you can experiment freely.
- **Resizable canvas** — set any custom width and height.
- **Multi-frame animation** — add, copy, and delete frames; preview at any FPS; export every frame at once.
- **Import / export PNG** — bring in an existing PNG to edit, or export your art to a PNG file.
- **Pan, zoom & rotate** — two-finger pinch/rotate/drag on touch; on desktop, scroll the wheel to zoom, middle-drag to rotate, right-drag to pan; or pick a preset zoom level from 1× to 64×. One click/tap resets the view. Zoom and rotation always pivot on the canvas's own center.
- **Local project storage** — save and reload multiple named projects, stored in the browser (`localStorage`) — no account, no server.
- **Touch-friendly layout** — primary tools live in a bottom bar within thumb's reach; secondary tools live in a collapsible side toolbar.
- **In-app docs** — a "Docs" button at the bottom of the side toolbar opens an overlay explaining what the app can do.

## Keyboard & mouse controls

| Input | Action |
| --- | --- |
| `P` | Pencil |
| `E` | Eraser |
| `I` | Eyedropper |
| `M` | Toggle Mirror X |
| `N` | Toggle Mirror Y |
| `[` / `]` | Rotate view left / right |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| Mouse wheel | Zoom in / out |
| Middle-button drag | Rotate view |
| Right-button drag | Pan view |

## Project structure

```
.
├── index.html   # markup, layout, SEO meta tags, Docs overlay content
├── style.css    # all styling (theme, layout, responsive rules)
└── app.js       # all app logic (drawing, gestures, frames, projects, docs overlay)
```

There is no build step and no dependencies — it's plain HTML/CSS/JS. To run it locally, just open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server
```

## Browser support

Targets modern desktop and mobile browsers (touch gestures use the Pointer Events API; layout uses `dvh` units with a `vh` fallback for older browsers).

## SEO files

`sitemap.xml`, `robots.txt`, and the `<link rel="canonical">` in `index.html` all point to the production domain **https://pixel.timeandtime.online/**.

## Favicon

`favicon.ico` (16/32/48/64px) is a small pixel-art "M", linked from `index.html` via `<link rel="icon">`/`<link rel="shortcut icon">`.

**If it doesn't show up:**
- Make sure `favicon.ico` was actually uploaded/deployed in the *same folder* as `index.html` — the link is a relative path (`favicon.ico`), so it 404s silently if the file isn't sitting right next to it on the server.
- Browsers cache favicons very aggressively — even after fixing the file, a browser that already saw a missing (or old) icon for this URL may keep showing nothing/the old one. Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`), or try a private/incognito window, or a different browser, to confirm.
- The `<link>` tags include a `?v=2` cache-busting query string — bump that number any time you replace `favicon.ico` so browsers are forced to fetch the new one instead of serving a cached copy.

## License / credit

© Time And Time Studio.
