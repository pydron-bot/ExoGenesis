/**
 * Checks → To do: what's left to make. Open comments; story records by status
 * (anything not final); pieces missing (portraits, speakers, sounds, models,
 * chapters); and the voice script: every spoken line, by character, with word
 * counts, ready to copy out for a recording session. `collectTodo` is pure
 * (the editor smoke test checks it).
 */
import { STATUSES, type CharacterDef, type CinematicDef, type StoryDef } from '../content/defs';
import { h } from './dom';

export interface TodoRec { coll: string; id: string; title: string; data: Record<string, unknown> }
export interface VoiceLine { character: string; where: string; coll: string; id: string; text: string; words: number }
export interface Todo {
  comments: { coll: string; id: string; title: string; who: string; text: string }[];
  byStatus: Record<string, TodoRec[]>;
  missing: { what: string; items: TodoRec[] }[];
  voice: Record<string, VoiceLine[]>;
}

const STORY_COLLS = ['missions', 'story', 'cinematics', 'characters', 'inhabitants', 'lore'];
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function collectTodo(all: TodoRec[]): Todo {
  const story = all.filter((r) => STORY_COLLS.includes(r.coll));
  const comments: Todo['comments'] = [];
  for (const r of story) for (const c of (r.data.comments as { who?: string; text?: string; done?: boolean }[] | undefined) ?? []) {
    if (c && !c.done && c.text) comments.push({ coll: r.coll, id: r.id, title: r.title, who: c.who ?? '', text: c.text });
  }
  const byStatus: Todo['byStatus'] = {};
  for (const s of [...STATUSES.filter((x) => x !== 'final'), 'none']) byStatus[s] = [];
  for (const r of story) {
    const s = typeof r.data.status === 'string' ? r.data.status : 'none';
    if (s !== 'final') (byStatus[s] ??= []).push(r);
  }
  const of = (coll: string) => all.filter((r) => r.coll === coll);
  const chars = new Map(of('characters').map((r) => [r.id, r.data as Partial<CharacterDef>]));
  const missing: Todo['missing'] = [
    { what: 'Characters without a portrait', items: of('characters').filter((r) => !(r.data as Partial<CharacterDef>).portrait) },
    { what: 'Story cards with no speaker (no character or name)', items: of('story').filter((r) => { const e = r.data as Partial<StoryDef>; return !e.character && !e.speaker; }) },
    { what: 'Cinematics with no sound or music', items: of('cinematics').filter((r) => !(r.data as Partial<CinematicDef>).sounds?.length) },
    { what: 'Cinematic lines nobody says (no character or speaker)', items: of('cinematics').filter((r) => (r.data as Partial<CinematicDef>).lines?.some((l) => !l.character && !l.speaker)) },
    { what: 'Units on their built-in stand-in model', items: of('units').filter((r) => !r.data.model) },
    { what: 'Buildings on their built-in stand-in model', items: of('buildings').filter((r) => !r.data.model && r.id !== 'core') },
    { what: 'Story records in no chapter', items: story.filter((r) => r.coll !== 'characters' && !r.data.chapter) },
  ];
  // the voice script: every spoken line, by who says it
  const voice: Todo['voice'] = {};
  const say = (who: string | undefined, where: string, r: TodoRec, text: string | undefined) => {
    if (!text?.trim()) return;
    const name = who ? (chars.get(who)?.name ?? who) : 'Unnamed';
    (voice[name] ??= []).push({ character: name, where, coll: r.coll, id: r.id, text, words: words(text) });
  };
  for (const r of of('story')) {
    const e = r.data as Partial<StoryDef>;
    say(e.character ?? e.speaker, e.title ?? r.id, r, e.text);
    for (const l of e.lines ?? []) say(l.character ?? l.speaker ?? e.character ?? e.speaker, e.title ?? r.id, r, l.text);
  }
  for (const r of of('cinematics')) {
    const c = r.data as Partial<CinematicDef>;
    for (const l of c.lines ?? []) say(l.character ?? l.speaker, `${c.title ?? r.id} @ ${l.at} s`, r, l.text);
  }
  return { comments, byStatus, missing, voice };
}

/** The voice script as plain text: a section per character, each line with where it's from. */
export function voiceScript(v: Todo['voice']): string {
  return Object.entries(v).sort((a, b) => a[0].localeCompare(b[0])).map(([who, ls]) =>
    `== ${who} (${ls.length} line${ls.length === 1 ? '' : 's'}, ${ls.reduce((m, l) => m + l.words, 0)} words)\n\n${ls.map((l, i) => `${i + 1}. [${l.where}]\n${l.text}`).join('\n\n')}`).join('\n\n\n');
}

// ---------- the page ----------

export function renderTodo(main: HTMLElement, aside: HTMLElement, host: { records: TodoRec[]; open(coll: string, id: string): void }) {
  const T = collectTodo(host.records);
  const link = (r: { coll: string; id: string; title: string }) => { const a = h('a', 'fl-link', r.title); a.onclick = () => host.open(r.coll, r.id); return a; };
  const kind = (coll: string) => ({ missions: 'mission', story: 'event', cinematics: 'cinematic', characters: 'character', inhabitants: 'inhabitants', lore: 'bible', units: 'unit', buildings: 'building' } as Record<string, string>)[coll] ?? coll;
  const out: Node[] = [h('div', 'head', h('div', '', h('h1', '', 'To do'), h('div', 'path', 'What\'s left to make: open comments, status, missing pieces, and the voice script.')))];
  out.push(h('h2', 'bal-h', `Open comments (${T.comments.length})`));
  if (!T.comments.length) out.push(h('div', 'help-block', 'None. Leave one on any story record (Comments, at the bottom of its form); tick Resolved when it\'s dealt with.'));
  for (const c of T.comments) out.push(h('div', 'todo-c', link(c), h('small', 'dim', ` · ${kind(c.coll)}`), h('div', '', c.who ? h('b', '', `${c.who}: `) : null, c.text)));
  out.push(h('h2', 'bal-h', 'Not final yet'));
  const st = h('div', 'todo-cols');
  for (const [s, list] of Object.entries(T.byStatus)) {
    if (!list.length) continue;
    st.append(h('div', 'todo-col', h('div', 'group', `${s === 'none' ? 'No status' : s} (${list.length})`), ...list.map((r) => h('div', '', link(r), h('small', 'dim', ` · ${kind(r.coll)}`)))));
  }
  out.push(st.childNodes.length ? st : h('div', 'help-block', 'Everything is final.'));
  out.push(h('h2', 'bal-h', 'Missing pieces'));
  for (const m of T.missing) {
    if (!m.items.length) continue;
    out.push(h('details', 'todo-m', h('summary', '', `${m.what} (${m.items.length})`), h('div', 'todo-list', ...m.items.flatMap((r, i) => [i ? ', ' : '', link(r)]))));
  }
  main.replaceChildren(...out);
  // the voice script
  const total = Object.values(T.voice).flat();
  const copy = h('button', '', 'Copy the voice script');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(voiceScript(T.voice)); copy.textContent = 'Copied'; } catch { copy.textContent = 'Couldn\'t copy'; } };
  const save = h('button', '', 'Download .txt');
  save.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([voiceScript(T.voice)], { type: 'text/plain' }));
    a.download = 'exo-voice-script.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  aside.replaceChildren(
    h('div', 'group', `Voice script: ${total.length} lines, ${total.reduce((m, l) => m + l.words, 0).toLocaleString()} words`),
    h('div', 'help-block', 'Every spoken line (story cards, conversations, radio messages, cinematic lines), by who says it.'),
    h('div', 'actions-col', copy, save),
    ...Object.entries(T.voice).sort((a, b) => b[1].length - a[1].length).map(([who, ls]) =>
      h('div', 'todo-v', h('b', '', who), h('small', 'dim', ` · ${ls.length} line${ls.length === 1 ? '' : 's'}, ${ls.reduce((m, l) => m + l.words, 0)} words`))),
  );
}
