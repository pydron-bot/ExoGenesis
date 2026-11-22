# Writing music for Exo Genesis

A brief for anyone (person or agent) adding a piece. The engine's history and measurements are in
`docs/TECH.md` (search "Music"); this file is the how-to.

## How the engine works

- **No audio files.** All music is synthesised live in Web Audio by `src/audio/music.ts` (`AmbientMusic`),
  with drums from `src/audio/drums.ts` and shared voices in `src/audio/synth.ts`. A 200 ms timer schedules
  notes 1.2 s ahead on the audio clock.
- **A piece is a "mood":** one JSON file in `content/music/<id>.json`, typed by `musicShape` in
  `src/content/defs.ts` (the field list and every allowed value, with help text: the source of truth).
- **Two ways to write a mood:**
  - **Free (generative):** a list of `chords` that it drifts through at random (`order: "drift"`, pulled back
    to the first by `homePull`) or plays in order (`order: "cycle"`), each held `chordMin`–`chordMax` s. Bells
    pick random notes from the chord, `melody` phrases play at chord starts, and `sections` switch layers on and
    off by chord count. Never the same twice.
  - **Written score:** `score` (sections of bars) and `form` (their playing order). It plays as written, from a
    seeded random source (`seed`), so it is the same every time. With `scoreThen: "drift"` it plays once, then
    drifts on over its own chords. Prefer this for anything with a tune.
- **Layers** (the parts a section can switch on): `pad`, `choir`, `bass`, `bells`, `pulse`, `drums`,
  `bassline`, `arp`, `melody`, `calls`, `crash`. A section's `layers` string names the ones that play in it
  (empty = all). A layer also needs its level above 0 to sound: `pad`, `bass`, `bells`, `pulse`, `choir`, `arp`,
  `lead` (melody), `drums`, `calls`, `crash`, `basslineLevel`.
- **Mix chain:** voices → (hall reverb, bell echo) → mood `level` → grit → worn → the Music bus (0.6) → the
  player's music volume → master.
- **When it plays** (`use`): `title`, `day`, `night`, `tension` (a fight is on: it cuts in over the others), or
  `none` (never: a sketch or template). Several moods share a use, and the director (`GameAudio.musicFor` in
  `src/audio/index.ts`) picks one at random, never the same one twice in a row. Day and night play in 3–6 min
  stretches with 2–5 min of quiet between. Tension fades in over 2.5 s and holds 25 s after the last shot.

## Notation

- **Notes:** `C4` is middle C (MIDI 60). Sharps `#`, flats `b`: `F#3`, `Bb2`, `C#6`. Chords are notes low to
  high, separated by spaces: `"D3 A3 F4"`.
- **Bar length:** `barSteps` sixteenth-steps (16 = 4/4, 12 = 3/4 or 6/8, 20 = 5/4, 14 = 7/8) at `pulseRate` bpm
  (a beat is 4 steps).
- **Bells and melody in a score bar:** one token per step, where a step is `bellStep` / `leadStep` long
  (default 8ths, so a 16-step bar takes **8 tokens**; with 16ths it takes 16; with 4ths, 4). The tokens are a
  note, `-` (hold the note before; it has no effect in bells, which ring on anyway) or `.` (a rest). `|` is
  ignored, so you can use it to group beats. A line isn't cut off at the bar line: extra tokens run on into
  the next bar. A `-` at the start of a bar does **not** tie to the note in the bar before.
- **Score bars:** `chord` (pad notes) and `bass` (one note; empty = the lowest chord note an octave down). A bar
  with no chord keeps the one before sounding until the section ends. A new section strikes the held chord
  again with its own layers. A `bass` needs a `chord` in the same bar.
- **Drum tracks** (up to 8): `sound` is one of `kick thud tom snare rim hat shaker clank taiko hand clap block
  zap crash swell`. `steps` are 16 to a bar: `x` hit, `o` soft hit, `.` rest (spaces and `|` ignored, 64 at
  most). Each track loops on its own length, so a 12-step track drifts against a 16-step bar. `level` and
  `pan` are per track. Drums play only in sections whose layers include `drums`, and `drumsIn` counts the
  bars (or chords) to wait before they come in.
- **Bassline** (16 steps a bar, on the chord's root): `x` root, `o` octave up, `5` fifth, `.` rest. It's usually
  used with the drone `bass` left out of the section, or set to 0.
- **Crash:** if a section lists `crash`, a reverse cymbal rises over the bar before it and a crash lands on its
  downbeat.

## Instruments (choices)

- `padTone`: warm, soft, hollow, glass, strings, choir-ah, choir-oo, organ, brass. Shaped by `swell` and
  `release` (s), `brightness`, `vibrato`, `detune`, `glide` (cents of slide in) and `warble`.
- `choir` / `choirVowel` (ah, oo): voices on the chord's top three notes, over any pad.
- `bellTone`: glass, soft, metal, pluck, marimba, kalimba, keys, harp, piano.
- `arpTone`: pluck, square, glass, saw, string, marimba, piano, bowed. `arpMode` (up, down, updown, random,
  chord), `arpRate` (4ths, 8ths, triplets, 16ths), `arpOctaves`, `arpShift`, `arpGate`, `arpBright`.
- `leadTone`: flute, soft, glass, saw, piano, violin. Also `leadGlide` and `leadVibrato`.
- `basslineTone`: synth, strings.
- Colour: `room` (reverb length in s, 0.4–12), `space` (how much reverb), `echo` / `echoSync` (bell echo, on the
  beat), `air` (hiss), `grit` (saturation), `lofi` (old radio), `pulse` (a heartbeat throb on the bass).

## Example: a written tension piece

The example is `content/music/tension-breach-example.json` (`use: "none"`, so it never plays in the game). It's
in D minor at 112 bpm in 4/4, with brass pads, a bowed 16th ostinato, a string bassline, taiko and snare, and a
violin tune in B with a crash on the way in. The form is `intro A A B break B`, then it repeats. It passes
`npm run content:check` and plays every part. Rendered 60 s with `--seed 1`, it measured −22.1 LUFS against
Tension · Siege's −20.2, so to ship it you'd raise `level` to about 1.25 and check again. Shortened here:

```json
{
  "name": "Tension · Breach",
  "use": "none",
  "seed": 3,
  "score": [
    { "name": "intro", "layers": "pad bass pulse arp", "bars": [
      { "chord": "D3 A3 F4", "bass": "D2" }, {},
      { "chord": "Bb2 F3 D4", "bass": "Bb1" },
      { "chord": "A2 E3 C#4", "bass": "A1" } ] },
    { "name": "B", "layers": "pad choir arp drums bassline melody crash", "bars": [
      { "chord": "D3 A3 F4", "bass": "D2", "melody": "D5 - - - F5 - E5 -" },
      { "melody": "D5 - C5 - A4 - - -" },
      { "chord": "Bb2 F3 D4", "bass": "Bb1", "melody": "Bb4 - - - D5 - F5 -" },
      { "chord": "A2 E3 C#4", "bass": "A1", "melody": "E5 - - - - - . ." } ] }
  ],
  "form": "intro B",
  "pulseRate": 112, "barSteps": 16, "bellStep": "8ths", "leadStep": "8ths",
  "swell": 0.6, "release": 1.5,
  "pad": 0.6, "padTone": "brass", "brightness": 0.8, "choir": 0.3, "choirVowel": "ah",
  "bass": 0.7, "bells": 0.4, "bellTone": "metal", "pulse": 0.35,
  "arp": 0.55, "arpMode": "up", "arpRate": "16ths", "arpShift": 0, "arpTone": "bowed", "arpGate": 0.4,
  "bassline": "x..x ..x. x..o ..5.", "basslineLevel": 0.65, "basslineTone": "strings",
  "lead": 0.6, "leadTone": "violin",
  "drums": 0.9,
  "drumTracks": [
    { "sound": "taiko", "steps": "x... .... x.x. ....", "level": 0.85 },
    { "sound": "snare", "steps": ".... x... .... x...", "level": 0.5 },
    { "sound": "hat",   "steps": "o.o. o.o. o.o. o.oo", "level": 0.2, "pan": 0.3 },
    { "sound": "clank", "steps": "..x. .... ..x. .... ..x. ....", "level": 0.25, "pan": -0.4 }
  ],
  "crash": 0.5, "air": 0.3, "echo": 0.3, "echoSync": true, "space": 0.45, "room": 3.5,
  "level": 1
}
```

Shipped scores to learn from: `title-landfall.json` (piano, builds to drums, then drifts),
`night-last-star.json`, `night-silent-hull.json` and `night-stillness.json` (slow choir and bells),
`score-example.json` (the smallest template). The free moods (`day-prospector`, `night-transmission`,
`tension-warpath` and the rest) show the generative side.

## Workflow

1. `git pull --rebase` (the web editor commits to `main` too).
2. Write `content/music/<use>-<name>.json`. The id comes from the name: "Night · Outer Dark" becomes
   `night-outer-dark`. Use `use: "none"` while drafting.
3. `npm run content:check` catches bad note names, drum and bassline characters, layer names, form names that
   don't exist, a bass with no chord, and a score with no chord.
4. Listen: start the dev server (`npx vite --port 5176`), then
   `node tools/music-render.mjs <id> --seconds 90 --seed 1` writes `music-drafts/<id>.wav`. The render prints
   its peak and a count of what played (chords, bells, hits, arps, leads); a part that plays 0 times is switched
   off somewhere. Or use the editor (`editor.html`, Rules → Music, ▶ Listen; Import takes pasted JSON).
5. **Match loudness** to other moods with the same use: render both with the same seed and length, then
   `ffmpeg -nostats -i file.wav -af ebur128 -f null - 2>&1 | grep "I:"`. Scale `level` by the difference
   (+2 dB ≈ ×1.26). Keep peaks under about 0.8.
6. Set the real `use`. Then it's a release: bump `package.json`, add a player-facing entry at the top of
   `src/changelog.ts` and a note under Music in `docs/TECH.md`, and run `npm run build`.
   `node tools/music-smoke.mjs` checks the director and the editor.

## Taste notes from the shipped pieces

- Music sits **under** gunfire and alerts. Day and night pieces are calm backgrounds for long sessions; tension
  is driving but has no big climax.
- Every mood is meant to sound unlike the others: a different scale, instrument set, metre, room and form.
  Check the list in `content/music/` before picking a colour.
- Pads blur together with long swells (3–20 s). Drum- and arp-led pieces want short swells (under 1 s) and a
  small room (1–4 s).
- Plucks, mallets and the worn filter carry little energy, so those moods need `level` 2–4. Big pad halls need
  about 1.
- Keep melodies in the key of the chords. The engine doesn't check harmony, only note names.
- `tools/music-gen.mjs` with `tools/music-prompts.json` makes ElevenLabs reference tracks for comparison by ear
  (style descriptions only, never real artists or songs).
