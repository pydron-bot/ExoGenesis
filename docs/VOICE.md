# Exo Genesis — Voices

The story's spoken lines are recorded with ElevenLabs, offline: the game only plays files. Each character's voice was
designed for Exo Genesis from a written description (Voice Design, `eleven_ttv_v3`), not cloned from anyone, and is
saved on the account as "Exo Genesis – <name>". Lines are generated with `eleven_v4`. The account's plan covers
commercial use.

## How it fits together

- **`tools/voice/cast.json`**: who has a voice. Each entry has the Voice Design prompt (`description`, written from
  `content/characters/<id>.json` and STORY.md §18), the text its previews read (`sample`), and once chosen the saved
  `voice` id. A cast entry is a character id, or claims a one-off `speaker` name ("Kindred sentry"). Meridian is a
  `remix` of the caretaker's voice: the player's own voice, older.
- **`tools/voice/design.mjs`**: three previews per voice and a review page (`tools/.cache/voice-design/review.html`,
  git-ignored, audio inlined) to choose from; `--keep <id> <n>` saves preview n on the account and into cast.json.
- **`tools/voice/lines.mjs`**: voices the lines. Writes `public/media/voice/<who>/<key>.mp3`, the index the game
  reads (`public/media/voice/index.json`: key → file and length), and the ledger `tools/voice/lines.json` (what each
  file says, in which voice and model, and where the line is from).
- **`src/voice.ts`**: the game side. A line's key is a hash of who says it (character id, else speaker name) and its
  text as written, so **editing a line silences it** until it is generated again: a stale take never plays. Lines
  with `{first}` or `{who}` aren't voiced (their words change per game).
- **Where it plays**: cinematic lines when their subtitle comes up (`src/cinematic.ts`); story card pages as each
  shows (`src/contact-card.ts`); radio messages in the corner, which stay up until their line has been said. One
  voice at a time: a new line cuts the last; closing a card or skipping a cinematic stops it.
- **Voice effect** (the editor's **Voice** field on cinematic lines, story cards and their lines): `radio` plays it
  through a transmission (band-limited, driven, hiss and crackle; `GameAudio.speak`), `clean` as recorded. Empty: a
  radio-style card is `radio`, everything else `clean`. The Director's recordings are clean on purpose: too clean.
- **Options → Sound → Voices** turns them off (kept in the browser, `exo.voices`).

## Making and changing lines

```sh
node tools/voice/lines.mjs --cine cine-signal --dry-run    # what it would voice, and the credits
node tools/voice/lines.mjs --cine cine-signal,cine-marrow --story signal --who director
node tools/voice/lines.mjs --all                           # everything with a voice
node tools/voice/lines.mjs --redo 2049fc3c,1898c681        # a new take (keys from lines.json)
node tools/voice/lines.mjs --prune                         # drop files of lines that changed or went
```

Only new and changed lines are generated: rerun after editing. Each character has a fixed seed, so the same words come
out the same way (the three ships' briefings, which the Archivist lays side by side); `--redo` takes a fresh seed. For
a cinematic, the tool warns when a recording runs into the next line or past its subtitle: move the next line's **At**
or lengthen **Shows for**.

Credits: about one per character of text. The whole script is about 74,000 characters (`Checks → To do → voice
script` in the editor counts it), so it goes in batches.

## Cast

| Id | Voice | Voiced so far |
|---|---|---|
| `caretaker` | The caretaker (the private log; the player's voice), designed | all |
| `director` | The Director (Sol Mission Control's recordings), designed | all |
| `meridian` | Meridian, a remix of the caretaker | all |
| `marrow` | Captain Ilse Marrow, designed | the Signal, the council hall |
| `bede` | Dr Femi Bede, designed | the council hall |
| `archivist` | The Archivist, designed | the Signal |
| `firstborn` | The Firstborn, designed | the Signal |
| `sentry` | Kindred sentry, designed | all |
| `engram` | ENGRAM, built-in Daniel | all |
| `keeper` | The Marro, built-in Lily | all |
| `cantor` | The Cantor, built-in Adam | all |
| `sefa` | Sefa of the Enclave, built-in Matilda | all |
| `settler` | Settler, built-in Jessica | all |

Designed voices take one of the plan's 10 custom-voice slots (8 used); the side characters use ElevenLabs' built-in
voices (`library` in cast.json: auditioned like designed ones, no slot). Still text: the Clause, the logs and
manifests, Column 01–12, the Biosphere Report and other narration. `node tools/voice/lines.mjs --all --dry-run` shows
what's left.
