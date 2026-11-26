/**
 * Story → Script import: write scenes as a screenplay, get story events (or a
 * cinematic's lines). `parseScript` is pure (the editor smoke test checks it);
 * `renderScript` is the page: the script on the left, what it will create on
 * the right, then Create.
 *
 *   # The Stone                    a new story event (id from the title; "# The Stone {stone}" picks one)
 *   when: site east-stone          its trigger: any condition and its value (see CONDITIONS), or "after previous"
 *   delay: 5 · pause · radio · chapter: touchdown · unless: some-flag
 *   DIRECTOR: Accord, this is…     who says what (a character's id or name, or any name); the first is the card's text
 *   More narration                 a line without a name carries on the line before
 *   > Scan it again                a choice
 *     = Second scan running.       its reply (logged)
 *     + flag stone-scanned         an effect when that choice is picked
 *   + alloys 50                    an effect when the event fires
 *
 * Cinematic lines: "[12.5] DIRECTOR: text" (a time is optional: each line follows
 * the one before by how long it takes to read).
 */
import { CONDITIONS, HINT_TARGETS, ID_RE, STORY_EFFECTS, type Condition, type EffectDef, type StoryDef, type StoryEffect } from '../content/defs';
import { h } from './dom';

export interface ScriptRefs {
  /** id → name */
  characters: Record<string, string>;
  buildings: string[];
  units: string[];
  research: string[];
  existing: string[];
}
export interface ScriptEvent { id: string; def: StoryDef; line: number }
export interface ScriptIssue { line: number; msg: string }

const slug = (t: string) => t.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'event';
const num = (v: string | undefined) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

/** Who a "NAME:" is: a character (by id, name or first name), else just a speaker name. */
function whoIs(name: string, refs: ScriptRefs): { character?: string; speaker?: string } {
  const n = name.trim().toLowerCase();
  for (const [id, full] of Object.entries(refs.characters)) {
    const f = full.toLowerCase();
    if (id === n || f === n || f.split(/\s+/)[0] === n || f.replace(/^the\s+/, '') === n) return { character: id };
  }
  return { speaker: name.trim().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\B\w+/g, (m) => m.toLowerCase()) };
}

/** A condition from "kind value value": "site east-stone", "built solar 2", "time 2.5", "counter honesty 3". */
function parseCondition(words: string[], prev: string | undefined, line: number, issues: ScriptIssue[]): Partial<StoryDef> | null {
  let [kind, a, b] = words;
  if (!kind) { issues.push({ line, msg: 'when: needs a condition' }); return null; }
  if (kind === 'after' && (a === 'previous' || a === 'prev' || a === undefined)) {
    if (!prev) { issues.push({ line, msg: '"after previous": there is no event before this one' }); return null; }
    return { trigger: 'after', event: prev };
  }
  if (kind === 'reach') kind = 'site';
  if (!(CONDITIONS as readonly string[]).includes(kind) || kind === 'all' || kind === 'any') {
    issues.push({ line, msg: `unknown condition "${kind}" (one of: ${CONDITIONS.filter((c) => c !== 'all' && c !== 'any').join(', ')})` });
    return null;
  }
  const k = kind as Condition;
  const out: Partial<StoryDef> & Record<string, unknown> = { trigger: k };
  switch (k) {
    case 'time': out.sol = num(a); break;
    case 'built': case 'placed': out.building = a; if (num(b) !== undefined) out.count = num(b); break;
    case 'site': case 'explored': out.site = a; break;
    case 'contact': case 'trust': out.group = a; break;
    case 'flag': out.flag = a; break;
    case 'counter': case 'counterBelow': out.counter = a; out.count = num(b) ?? 0; break;
    case 'timer': out.timer = a; break;
    case 'opened': out.panel = a as StoryDef['panel']; if (b) out.building = b; break;
    case 'researched': out.research = a; break;
    case 'after': out.event = a; break;
    case 'mission': case 'failed': out.mission = a; break;
    case 'start': case 'pod': case 'never': break;
    default: if (num(a) !== undefined) out.count = num(a);
  }
  return out;
}

/** An effect from "+ kind args…". */
function parseEffect(text: string, refs: ScriptRefs, next: () => string | undefined, line: number, issues: ScriptIssue[]): EffectDef | null {
  const words = text.trim().split(/\s+/);
  const kind = words.shift() as StoryEffect;
  if (!(STORY_EFFECTS as readonly string[]).includes(kind)) { issues.push({ line, msg: `unknown effect "${kind}" (one of: ${STORY_EFFECTS.join(', ')})` }); return null; }
  const rest = () => words.join(' ');
  const e: EffectDef & Record<string, unknown> = { kind };
  const target = (id: string | undefined) => {
    if (!id) return;
    if (refs.buildings.includes(id)) e.building = id; else if (refs.units.includes(id)) e.unit = id;
    else issues.push({ line, msg: `no building or unit "${id}"` });
  };
  switch (kind) {
    case 'log': case 'win': case 'fail': e.text = rest(); break;
    case 'alloys': case 'isotopes': case 'biomass': case 'stance': case 'wellbeing': e.amount = num(words[0]); break;
    case 'regard': e.group = words[0]; e.amount = num(words[1]); break;
    case 'flag': case 'unflag': e.flag = words[0]; break;
    case 'counter': case 'setCounter': e.counter = words[0]; e.amount = num(words[1]) ?? (kind === 'counter' ? 1 : 0); break;
    case 'countdown': e.timer = words.shift(); e.amount = num(words.shift()); e.text = rest() || undefined; break;
    case 'stopCountdown': e.timer = words[0]; break;
    case 'event': { const id = words[0] === 'next' ? next() : words[0]; if (!id) issues.push({ line, msg: '"event next": no event follows in the script' }); e.event = id; break; }
    case 'pack': case 'unhint': break;
    case 'spawn': {
      // spawn <unit> [count] at <site> [guard]
      e.unit = words.shift();
      if (num(words[0]) !== undefined) e.count = num(words.shift());
      if (words[0] === 'at') words.shift();
      e.site = words.shift();
      if (words[0] === 'guard') e.guard = true;
      break;
    }
    case 'research': e.research = words[0]; if (words[0] && !refs.research.includes(words[0])) issues.push({ line, msg: `no research "${words[0]}"` }); break;
    case 'lock': case 'unlock': target(words[0]); break;
    case 'reveal': e.site = words[0]; if (num(words[1]) !== undefined) e.amount = num(words[1]); break;
    case 'waypoint': e.site = words.shift(); e.text = rest() || undefined; break;
    case 'clearWaypoint': if (words[0]) e.site = words[0]; break;
    case 'camera': if (words[0] && refs.buildings.includes(words[0])) e.building = words[0]; else e.site = words[0]; break;
    case 'hint': {
      const [t, b] = (words.shift() ?? '').split(':');
      if (!(HINT_TARGETS as readonly string[]).includes(t)) { issues.push({ line, msg: `hint: point at one of ${HINT_TARGETS.join(', ')} (buildItem:<building> for a build-menu entry)` }); return null; }
      e.target = t as EffectDef['target'];
      if (b) e.building = b;
      e.text = rest() || undefined;
      break;
    }
    case 'cinematic': e.cinematic = words[0]; break;
  }
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

export function parseScript(text: string, refs: ScriptRefs, defaults: { chapter?: string } = {}): { events: ScriptEvent[]; issues: ScriptIssue[] } {
  const events: ScriptEvent[] = [];
  const issues: ScriptIssue[] = [];
  const lines = text.split('\n');
  // event ids first, so "+ event next" can look ahead
  const heads: string[] = [];
  const used = new Set<string>();
  for (const l of lines) {
    const m = l.match(/^#\s+(.*?)\s*(?:\{([a-z0-9][a-z0-9_-]*)\})?\s*$/);
    if (!m) continue;
    let id = m[2] ?? slug(m[1]);
    if (!m[2]) { const base = id; for (let n = 2; used.has(id); n++) id = `${base}-${n}`; }
    used.add(id);
    heads.push(id);
  }
  let cur: ScriptEvent | null = null;
  let choice: NonNullable<StoryDef['choices']>[number] | null = null;
  let choiceN = 0;
  let lastLine: { text: string } | null = null;
  let k = -1;
  const finish = () => {
    if (!cur) return;
    if (!cur.def.text) issues.push({ line: cur.line, msg: `"${cur.def.title}" has no text: add a line ("NAME: what they say")` });
    events.push(cur);
  };
  lines.forEach((raw, i) => {
    const n = i + 1;
    const l = raw.trimEnd();
    if (!l.trim() || l.trim().startsWith('//')) return;
    const head = l.match(/^#\s+(.*?)\s*(?:\{([a-z0-9][a-z0-9_-]*)\})?\s*$/);
    if (head) {
      finish();
      k++;
      const id = heads[k];
      if (!ID_RE.test(id)) issues.push({ line: n, msg: `"${id}" isn't a usable id` });
      if (refs.existing.includes(id)) issues.push({ line: n, msg: `a story event "${id}" already exists: give this one an id ("# ${head[1]} {new-id}")` });
      cur = { id, line: n, def: { title: head[1], text: '', trigger: k > 0 ? 'after' : 'never', ...(k > 0 ? { event: heads[k - 1] } : {}), ...(defaults.chapter ? { chapter: defaults.chapter } : {}) } as StoryDef };
      choice = null; choiceN = 0; lastLine = null;
      return;
    }
    if (!cur) { issues.push({ line: n, msg: 'start an event with "# Title" first' }); return; }
    const ev: StoryDef = (cur as ScriptEvent).def;
    const t = l.trim();
    const meta = t.match(/^(when|delay|chapter|unless|tags):\s*(.*)$/i);
    if (meta) {
      const v = meta[2].trim();
      const key = meta[1].toLowerCase();
      if (key === 'when') {
        const c = parseCondition(v.split(/\s+/), heads[k - 1], n, issues);
        if (c) { delete (ev as Partial<StoryDef>).event; Object.assign(ev, c); }
      } else if (key === 'delay') ev.delay = num(v);
      else if (key === 'chapter') ev.chapter = v;
      else if (key === 'unless') ev.unless = v;
      else if (key === 'tags') ev.tags = v;
      return;
    }
    if (/^(pause|radio)$/i.test(t)) { if (t.toLowerCase() === 'pause') ev.pause = true; else ev.style = 'radio'; return; }
    if (t.startsWith('>')) {
      choice = { label: t.slice(1).trim() };
      (ev.choices ??= []).push(choice);
      choiceN = ev.choices.length;
      if (choiceN > 4) issues.push({ line: n, msg: 'a card has at most 4 choices' });
      return;
    }
    if (t.startsWith('=') && choice) { choice.reply = t.slice(1).trim(); return; }
    if (t.startsWith('+')) {
      const e = parseEffect(t.slice(1), refs, () => heads[k + 1], n, issues);
      // indented under a choice: when that choice is picked; else when it fires
      const after = choice && /^\s/.test(raw) ? choiceN : 0;
      if (e) (ev.effects ??= []).push({ after, ...e });
      return;
    }
    const said = t.match(/^([A-Za-z][\w .'-]{0,30}):\s+(.*)$/);
    if (said) {
      const who = whoIs(said[1], refs);
      if (!ev.text) {
        ev.text = said[2];
        if (who.character) ev.character = who.character; else ev.speaker = who.speaker;
        lastLine = { get text() { return ev.text; }, set text(v) { ev.text = v; } } as { text: string };
      } else {
        const ln = { text: said[2], ...(who.character ? (who.character !== ev.character ? { character: who.character } : {}) : { speaker: who.speaker }) };
        (ev.lines ??= []).push(ln);
        lastLine = ln;
        if (ev.lines.length > 12) issues.push({ line: n, msg: 'a card has at most 12 more lines' });
      }
      return;
    }
    // narration: carries on the line before, or starts the card's text
    if (lastLine) lastLine.text = `${lastLine.text} ${t}`;
    else { ev.text = t; lastLine = { get text() { return ev.text; }, set text(v) { ev.text = v; } } as { text: string }; }
  });
  finish();
  for (const e of events) if (e.def.style === 'radio' && (e.def.choices?.length || e.def.lines?.length)) issues.push({ line: e.line, msg: `"${e.def.title}": a radio message is one line, no choices` });
  return { events, issues };
}

/** Cinematic lines: "[12.5] NAME: text" (the time is optional). */
export function parseCineLines(text: string, refs: ScriptRefs, start = 0): { lines: { at: number; character?: string; speaker?: string; text: string; for?: number }[]; issues: ScriptIssue[] } {
  const out: { at: number; character?: string; speaker?: string; text: string; for?: number }[] = [];
  const issues: ScriptIssue[] = [];
  let t = start;
  text.split('\n').forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith('//')) return;
    const m = l.match(/^(?:\[(\d+(?:\.\d+)?)\]\s*)?(?:([A-Za-z][\w .'-]{0,30}):\s+)?(.*)$/);
    if (!m || !m[3]) { issues.push({ line: i + 1, msg: 'expected "[time] NAME: line"' }); return; }
    if (m[1] !== undefined) t = Number(m[1]);
    const words = m[3].split(/\s+/).length;
    const dur = Math.round(Math.min(12, Math.max(2, 1.2 + words * 0.32)) * 10) / 10;
    const who = m[2] ? whoIs(m[2], refs) : {};
    out.push({ at: Math.round(t * 100) / 100, ...who, text: m[3], for: dur });
    t += dur + 0.3;
  });
  return { lines: out, issues };
}

// ---------- the page ----------

export const SAMPLE = `// A scene, written as a script. Lines starting // are notes.
# Smoke on the Horizon
when: contact vell
pause
DIRECTOR: Movement on the north-west ridge. People, Accord. Not ours.
FIRSTBORN: They're watching us. They have been for days.
> Approach them
  = Opening a channel on every band we have.
  + regard vell 10
  + flag vell-approached
> Keep away
  + counter caution 1
+ hint goals Your goals have changed

# The Keeper's Song
when: after previous
delay: 20
radio
KEEPER: They came like you. They grew like you. Their guardian burned them.
`;

export interface ScriptHost {
  refs: ScriptRefs;
  chapters: { id: string; title: string }[];
  cinematics: { id: string; title: string; length: number; lines: number }[];
  /** Problems the content checks find with these drafts in (path → messages). */
  check(drafts: ScriptEvent[]): Record<string, string[]>;
  create(drafts: ScriptEvent[]): Promise<void>;
  addLines(cinematic: string, lines: ReturnType<typeof parseCineLines>['lines']): Promise<void>;
  open(id: string): void;
  summary(def: StoryDef): string[];
}

const KEY = 'exo.editor.script';
export function renderScript(main: HTMLElement, aside: HTMLElement, host: ScriptHost) {
  let saved: { text: string; cine: string; chapter: string; cineId: string } = { text: SAMPLE, cine: '', chapter: '', cineId: host.cinematics.find((c) => c.id !== 'landing')?.id ?? host.cinematics[0]?.id ?? '' };
  try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* private mode */ }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ } };
  const ta = h('textarea', 'script-ta');
  ta.value = saved.text;
  ta.spellcheck = true;
  ta.lang = 'en-GB';
  const chapter = h('select', 'bal-num');
  chapter.append(Object.assign(h('option', '', '(none)'), { value: '' }), ...host.chapters.map((c) => Object.assign(h('option', '', c.title), { value: c.id })));
  chapter.value = saved.chapter;
  const create = h('button', 'primary', 'Create');
  const out = h('div', 'script-out');
  const draw = () => {
    saved.text = ta.value; saved.chapter = chapter.value; keep();
    const { events, issues } = parseScript(ta.value, host.refs, { chapter: chapter.value || undefined });
    const checks = events.length ? host.check(events) : {};
    const nChecks = Object.values(checks).reduce((m, x) => m + x.length, 0);
    create.textContent = `Create ${events.length} event${events.length === 1 ? '' : 's'}`;
    create.disabled = !events.length || issues.length > 0;
    out.replaceChildren(
      ...issues.map((x) => h('div', 'issue', `Line ${x.line}: ${x.msg}`)),
      ...events.map((e) => {
        const probs = checks[e.id] ?? [];
        const card = h('div', `script-ev${probs.length ? ' bad' : ''}`,
          h('div', 'fl-head', h('b', '', e.def.title), h('small', 'dim', ` · ${e.id}${e.def.style === 'radio' ? ' · radio' : ''}${e.def.pause ? ' · pauses' : ''}`)),
          ...host.summary(e.def).map((x) => h('div', 'dim', x)),
          h('div', 'script-said', `${e.def.character ?? e.def.speaker ?? ''}${e.def.character || e.def.speaker ? ': ' : ''}${e.def.text}`),
          ...(e.def.lines ?? []).map((l) => h('div', 'script-said', `${l.character ?? l.speaker ?? (e.def.character ?? e.def.speaker ?? '')}: ${l.text}`)),
          ...(e.def.choices ?? []).map((c) => h('div', 'script-choice', `› ${c.label}${c.reply ? ` → “${c.reply}”` : ''}`)),
          ...probs.map((p) => h('div', 'issue', p)));
        return card;
      }),
      ...(nChecks ? [h('div', 'help-block', 'Content checks see problems in the drafts above (they would show under Checks → Problems): fix them in the script, or create and fix them in the form.')] : []),
    );
  };
  ta.oninput = draw;
  chapter.onchange = draw;
  create.onclick = async () => {
    const { events, issues } = parseScript(ta.value, host.refs, { chapter: chapter.value || undefined });
    if (!events.length || issues.length) return;
    create.disabled = true;
    await host.create(events);
  };
  // cinematic lines
  const cineTa = h('textarea', 'script-ta small');
  cineTa.value = saved.cine;
  cineTa.placeholder = '[2] DIRECTOR: Power first. Everything else after.\nFIRSTBORN: Is that the sun?';
  const cineSel = h('select', 'bal-num');
  cineSel.append(...host.cinematics.map((c) => Object.assign(h('option', '', `${c.title} (${c.length} s, ${c.lines} lines)`), { value: c.id })));
  cineSel.value = saved.cineId;
  const cineOut = h('div', 'script-out');
  const addBtn = h('button', '', 'Add lines');
  const drawCine = () => {
    saved.cine = cineTa.value; saved.cineId = cineSel.value; keep();
    const { lines, issues } = parseCineLines(cineTa.value, host.refs);
    addBtn.textContent = `Add ${lines.length} line${lines.length === 1 ? '' : 's'} to the cinematic`;
    addBtn.disabled = !lines.length || !!issues.length || !cineSel.value;
    const len = host.cinematics.find((c) => c.id === cineSel.value)?.length ?? 0;
    cineOut.replaceChildren(...issues.map((x) => h('div', 'issue', `Line ${x.line}: ${x.msg}`)),
      ...lines.map((l) => h('div', `script-said${l.at + (l.for ?? 0) > len ? ' bad' : ''}`, `${l.at.toFixed(1)} s · ${l.character ?? l.speaker ?? '—'}: ${l.text}`)),
      ...(lines.some((l) => l.at + (l.for ?? 0) > len) ? [h('div', 'issue', `Some lines run past the cinematic's end (${len} s): lengthen it on its page after adding them.`)] : []));
  };
  cineTa.oninput = drawCine;
  cineSel.onchange = drawCine;
  addBtn.onclick = async () => {
    const { lines, issues } = parseCineLines(cineTa.value, host.refs);
    if (!lines.length || issues.length) return;
    addBtn.disabled = true;
    await host.addLines(cineSel.value, lines);
  };
  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Script import'), h('div', 'path', 'Write scenes as a script; get story events (or a cinematic\'s lines).'))),
    h('div', 'script-grid',
      h('div', '', ta, h('div', 'bal-opts', h('label', '', 'Chapter ', chapter), create)),
      h('div', '', h('div', 'group', 'Will create'), out)),
    h('h2', 'bal-h', 'Lines for a cinematic'),
    h('div', 'script-grid', h('div', '', cineTa, h('div', 'bal-opts', h('label', '', 'Cinematic ', cineSel), addBtn)), h('div', '', cineOut)),
  );
  aside.replaceChildren(h('div', 'group', 'How to write it'), h('pre', 'script-help', `# Title {id}        a new event (id optional)
when: site east-stone  its trigger
  (any condition: time 2.5 · built solar 2 ·
  flag x · after previous · mission groundwork ·
  counter honesty 3 · timer dawn · opened build ·
  placed solar · researched deep-survey · never)
  The first event starts as "never", the rest
  follow the one before.
delay: 5   pause   radio
chapter: touchdown   unless: flag   tags: a, b
NAME: what they say  (character id or name)
narration            carries on the line before
> Choice label
  = reply (logged)
  + effect           when this choice is picked
+ effect             when the event fires

Effects:
+ flag x  + unflag x  + alloys 50  + isotopes 5
+ stance 4  + wellbeing -3  + regard vell 10
+ counter honesty 1  + setCounter honesty 0
+ countdown dawn 90 Hold until dawn
+ stopCountdown dawn   + event next (or an id)
+ spawn brute 2 at east-stone guard   + pack
+ research deep-survey  + lock turret  + unlock rover
+ reveal east-stone 30  + waypoint east-stone Look
+ clearWaypoint  + camera east-stone
+ hint build Open the Build menu
+ hint buildItem:solar Pick the Solar Array
+ unhint  + cinematic id  + log text
+ win The signal is answered  + fail text

Cinematic lines:
[12.5] NAME: text   (time optional: lines follow
on by reading time)`));
  draw();
  drawCine();
}
