# Brand assets

The **official Interact logo must be included** in Direct Order (login split-panel and
the app shell top-left). See `docs/design/reference-interact-ui.md`.

## Status
- ✅ `interact-logo.png` — full logo, provided by Albert (used by the UI design;
  pixel-sampled for brand hues).
- ⬜ **SVG still preferred** for crisp scaling — `interact-logo.svg` when available.
- ⬜ `interact-mark.svg` / `interact-mark.png` — the green "i" mark alone (collapsed
  sidebar / favicon).

Once added, the UI implementation references these from the app shell and auth screens.
Per-tenant logos (uploaded via tenant branding) live in Supabase Storage, not here — this
folder holds the Interact platform brand only.

## Brand colors (approximate — sample from the official SVG to finalise)
- Green `~#28C76F` · Blue `~#2E7DF1` · App primary indigo `#666CFF` · Grey `~#9AA0A6`
