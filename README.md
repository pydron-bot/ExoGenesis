# Exo Genesis

A browser base-building RTS with a strategy layer — Command & Conquer meets Civilization, in one
solar system. You are the caretaker AI of humanity's last seed-probe: land on an alien world,
keep the cryo bank alive, and raise the next generation.

Built with Three.js + TypeScript + Vite. Design: [docs/DESIGN.md](docs/DESIGN.md).

## Status — M0 tech demo

- **Continuous zoom** from the landing site → planet globe → whole solar system, no loading.
  The detailed landing region is laid onto the low-poly globe and stays in place as you climb.
- **Simulation in a Web Worker** at a fixed 10 Hz tick; the renderer interpolates snapshots.
  All game state is plain data.
- **Save / Load** to IndexedDB (this browser only).
- **The landing:** Command Core, one worker drone, 160 grazing creatures that scatter from
  the drone, a cryo bank losing power until you build a solar array.
- **Home planet:** radius 3,000 units (~30 km at game scale) carved into 89 fixed land regions —
  the held landing region (Touchdown), four tutorial regions around it, and larger regions across
  the rest of the globe. Borders, fills and labels fade in from orbit.
- **System:** star; 9 planets (Cinder, Ash, Verdance — temperate, Home, Dunmore, Thalassa and
  Halcyon gas giants, Nereid ice giant, Rime — frozen); 12 moons; main asteroid belt and an outer
  icy belt (instanced); two comets on eccentric orbits; orbit paths, markers and labels.

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Order the drone | drag from the drone to a spot | same, or click drone then click ground |
| Pan | drag the ground | drag / WASD / arrows |
| Zoom | pinch | wheel / + − |
| Rotate | two-finger twist / vertical | right-drag / Q E |
| Jump | Surface / Planet / System buttons | 1 / 2 / 3 |
| Build solar | Solar, then tap ground | B, then click |
| Pause | ❚❚ | Space |

## Run

```sh
npm install
npm run dev        # http://localhost:5176 (on hive1: systemd user unit exo-dev.service)
npm run build
node tools/smoke.mjs   # end-to-end input + save/load test (Playwright)
node tools/shot.mjs    # headless screenshots of each zoom level → shots/
```
