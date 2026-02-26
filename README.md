# Arenas of The Scarlett Isles (GitHub Pages)

This is a **VTT-like arena mini-game app**:
- Loads battlemaps per round
- Adjustable grid overlay
- Add Player (name, HP, image) -> draggable token
- Auto enemy tokens per round (Wyvern uses `assets/wyvern.png`)
- Round flow:
  - **Enter The Arena** -> Round Rules popup
  - **Begin Round** -> Turn roll modal (per player)
  - Tracks successes/failures, applies damage, then end-of-round prize/HP summary
  - Proceed to next round or leave

## Deploy
1. Create repo `arenas-of-the-scarlett-isles`
2. Upload contents of this zip to repo root
3. Settings -> Pages -> Deploy from branch -> `main` / `(root)`

## Wyvern token
Replace `assets/wyvern.png` with your transparent token PNG (same filename).

## Add new arenas later
Edit `data/arenas.json` and add new arenas/rounds + map images in `assets/maps/`.
