import { h } from './dom';
/**
 * Story board (Story → Story board): every story record (missions, story
 * events, cinematics, characters, inhabitants, story bible entries) as a card,
 * in a column per chapter (content/chapters, in order; then "No chapter").
 *
 *   - drag a card to another column to move it to that chapter (Save writes it)
 *   - filter by kind, tag, character or text; click a card to open it
 *   - missions run in campaign order, then events, cinematics and the rest
 *
 * Chapters, tags and notes are editor-only fields (defs.ts organizeFields).
 */
export interface BoardItem {
  coll: string;
  id: string;
  title: string;
  chapter?: string;
  tags: string[];
  /** One line on what it is or does. */
  summary: string;
  /** Characters it involves (speakers, lines). */
  characters: string[];
  /** Content problems in its file. */
  problems: number;
  /** Campaign position (missions), for sorting. */
  order?: number;
  secret?: boolean;
  /** Production status (organizeFields `status`). */
  status?: string;
  /** Comments not yet resolved. */
  comments?: number;
}
export interface BoardChapter { id: string; title: string; order: number; act?: string; color: string; summary?: string }
export interface BoardHost {
  items: BoardItem[];
  chapters: BoardChapter[];
  /** Character id → name. */
  names: Record<string, string>;
  open(coll: string, id: string): void;
  /** Write new chapters to the records' files (null = none). */
  save(moves: { coll: string; id: string; chapter: string | null }[]): Promise<void>;
  newChapter(): void;
  newItem(coll: string, chapter: string | null): void;
}

export const KINDS: { coll: string; label: string; one: string; color: string }[] = [
  { coll: 'missions', label: 'Missions', one: 'Mission', color: '#5ff3ff' },
  { coll: 'story', label: 'Events', one: 'Event', color: '#ffb547' },
  { coll: 'cinematics', label: 'Cinematics', one: 'Cinematic', color: '#ff8ad8' },
  { coll: 'characters', label: 'Characters', one: 'Character', color: '#7fe08a' },
  { coll: 'inhabitants', label: 'Inhabitants', one: 'Inhabitants', color: '#b98cff' },
  { coll: 'lore', label: 'Story bible', one: 'Bible', color: '#d5c39c' },
];
const RANK = Object.fromEntries(KINDS.map((k, i) => [k.coll, i]));


const PREFS = 'exo.board';
const prefs = { hide: [] as string[], tag: '', who: '', q: '', status: '' };
/** Status colours (the card's left edge shows its kind; the status shows as a small badge). */
export const STATUS_COLOR: Record<string, string> = { idea: '#7f93a8', draft: '#ffb547', wired: '#3fd6ff', tested: '#5be3a0', final: '#c49bff' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) ?? '{}')); } catch { /* private mode */ }
const keep = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ } };

/** Split a tags field into tags. */
export const tagsOf = (s: unknown) => (typeof s === 'string' ? s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : []);

export function renderBoard(main: HTMLElement, aside: HTMLElement, host: BoardHost): { dispose(): void } {
  const items = host.items.map((x) => ({ ...x }));
  const orig = new Map(items.map((x) => [`${x.coll}/${x.id}`, x.chapter ?? null]));
  const chapters = [...host.chapters].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const known = new Set(chapters.map((c) => c.id));
  const save = h('button', 'primary', 'Save moves');
  const undo = h('button', '', 'Undo moves');
  const addCh = h('button', '', '＋ Chapter');
  addCh.onclick = () => host.newChapter();
  const cols = h('div', 'board-cols');
  // a second horizontal scrollbar above the columns, pinned to the top while the page scrolls, kept in step with the
  // board's own (which sits below the longest column)
  const topBar = h('div', 'board-topscroll');
  const topInner = h('div', '');
  topBar.append(topInner);
  topBar.onscroll = () => { if (cols.scrollLeft !== topBar.scrollLeft) cols.scrollLeft = topBar.scrollLeft; };
  cols.onscroll = () => { if (topBar.scrollLeft !== cols.scrollLeft) topBar.scrollLeft = cols.scrollLeft; };
  const sizeTop = () => {
    topInner.style.width = `${cols.scrollWidth}px`;
    topBar.style.display = cols.scrollWidth > cols.clientWidth + 1 ? '' : 'none';
  };
  const ro = new ResizeObserver(sizeTop);
  ro.observe(cols);
  const moved = () => items.filter((x) => (x.chapter ?? null) !== orig.get(`${x.coll}/${x.id}`));

  // filters
  const kinds = h('div', 'board-kinds');
  for (const k of KINDS) {
    const b = h('button', `chip${prefs.hide.includes(k.coll) ? '' : ' on'}`, k.label);
    b.style.setProperty('--k', k.color);
    b.onclick = () => {
      prefs.hide = prefs.hide.includes(k.coll) ? prefs.hide.filter((x) => x !== k.coll) : [...prefs.hide, k.coll];
      b.classList.toggle('on', !prefs.hide.includes(k.coll));
      keep(); draw();
    };
    kinds.append(b);
  }
  const allTags = [...new Set(items.flatMap((x) => x.tags))].sort();
  const tagSel = h('select', 'board-tag');
  tagSel.append(new Option('Any tag', ''), ...allTags.map((t) => new Option(t, t)));
  tagSel.value = allTags.includes(prefs.tag) ? prefs.tag : '';
  tagSel.onchange = () => { prefs.tag = tagSel.value; keep(); draw(); };
  const whoSel = h('select', 'board-who');
  const people = Object.entries(host.names).sort((a, b) => a[1].localeCompare(b[1]));
  whoSel.append(new Option('Anyone', ''), ...people.map(([id, n]) => new Option(n, id)));
  whoSel.value = host.names[prefs.who] ? prefs.who : '';
  whoSel.onchange = () => { prefs.who = whoSel.value; keep(); draw(); };
  const stSel = h('select', 'board-tag');
  stSel.append(new Option('Any status', ''), new Option('No status', '-'), ...Object.keys(STATUS_COLOR).map((s) => new Option(s, s)), new Option('Not final', '!final'), new Option('Open comments', 'comments'));
  stSel.value = prefs.status;
  stSel.onchange = () => { prefs.status = stSel.value; keep(); draw(); };
  const search = h('input', 'board-q');
  search.placeholder = 'Filter cards…';
  search.value = prefs.q;
  search.oninput = () => { prefs.q = search.value; keep(); draw(); };
  const count = h('span', 'dim', '');

  const visible = (x: BoardItem) => {
    if (prefs.hide.includes(x.coll)) return false;
    if (prefs.tag && !x.tags.includes(prefs.tag)) return false;
    if (prefs.status === '-' ? !!x.status : prefs.status === '!final' ? x.status === 'final' : prefs.status === 'comments' ? !x.comments : prefs.status && x.status !== prefs.status) return false;
    if (prefs.who && !(x.characters.includes(prefs.who) || (x.coll === 'characters' && x.id === prefs.who))) return false;
    const q = prefs.q.trim().toLowerCase();
    return !q || `${x.title} ${x.id} ${x.summary} ${x.tags.join(' ')}`.toLowerCase().includes(q);
  };

  const card = (x: BoardItem) => {
    const k = KINDS.find((k) => k.coll === x.coll)!;
    const c = h('div', `board-card${x.problems ? ' bad' : ''}${(x.chapter ?? null) !== orig.get(`${x.coll}/${x.id}`) ? ' moved' : ''}`);
    c.style.setProperty('--k', k.color);
    c.draggable = true;
    c.dataset.key = `${x.coll}/${x.id}`;
    c.title = `${k.one}: ${x.title} (${x.id}). Click to open; drag to another chapter.`;
    c.append(...[
      h('div', 'bc-top', h('span', 'bc-kind', k.one), x.status ? (() => { const b = h('span', 'bc-status', x.status); b.style.setProperty('--s', STATUS_COLOR[x.status] ?? '#7f93a8'); return b; })() : null,
        x.comments ? h('span', 'bc-comments', `💬 ${x.comments}`) : null, x.secret ? h('span', 'bc-secret', 'secret') : null, x.problems ? h('span', 'bc-bad', `${x.problems} problem${x.problems > 1 ? 's' : ''}`) : null),
      h('div', 'bc-title', x.title),
      x.summary ? h('div', 'bc-sum', x.summary) : null,
      x.tags.length ? h('div', 'bc-tags', ...x.tags.map((t) => { const s = h('span', '', t); s.onclick = (e) => { e.stopPropagation(); prefs.tag = t; tagSel.value = t; keep(); draw(); }; return s; })) : null,
    ].filter((n): n is HTMLDivElement => n !== null));
    c.onclick = () => host.open(x.coll, x.id);
    c.ondragstart = (e) => { e.dataTransfer!.setData('text/plain', c.dataset.key!); e.dataTransfer!.effectAllowed = 'move'; c.classList.add('dragging'); };
    c.ondragend = () => c.classList.remove('dragging');
    return c;
  };

  const column = (ch: BoardChapter | null, list: BoardItem[]) => {
    const col = h('div', 'board-col');
    if (ch) col.style.setProperty('--c', ch.color);
    const title = h('a', 'bh-title', ch ? ch.title : 'No chapter');
    if (ch) { title.href = '#'; title.onclick = (e) => { e.preventDefault(); host.open('chapters', ch.id); }; }
    const add = h('select', 'bh-add');
    add.title = 'Add a record to this chapter';
    add.append(new Option('＋', ''), ...KINDS.map((k) => new Option(`New ${k.one.toLowerCase()}`, k.coll)));
    add.onchange = () => { const v = add.value; add.value = ''; if (v) host.newItem(v, ch?.id ?? null); };
    col.append(h('div', 'board-head', title, h('span', 'dim', String(list.length)), add));
    if (ch?.summary) col.append(h('div', 'bh-sum', ch.summary));
    const body = h('div', 'board-body');
    const sorted = [...list].sort((a, b) => RANK[a.coll] - RANK[b.coll] || (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
    let last = '';
    for (const x of sorted) {
      if (x.coll !== last) { body.append(h('div', 'board-sep', KINDS.find((k) => k.coll === x.coll)!.label)); last = x.coll; }
      body.append(card(x));
    }
    if (!list.length) body.append(h('div', 'board-empty', 'Drop cards here'));
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = (e) => {
      e.preventDefault();
      col.classList.remove('over');
      const key = e.dataTransfer!.getData('text/plain');
      const x = items.find((i) => `${i.coll}/${i.id}` === key);
      if (!x) return;
      x.chapter = ch?.id;
      draw();
    };
    col.append(body);
    return col;
  };

  const draw = () => {
    cols.replaceChildren();
    const vis = items.filter(visible);
    for (const ch of chapters) {
      const col = column(ch, vis.filter((x) => x.chapter === ch.id));
      if (ch.act) col.prepend(h('div', 'board-act', ch.act));
      cols.append(col);
    }
    cols.append(column(null, vis.filter((x) => !x.chapter || !known.has(x.chapter))));
    count.textContent = `${vis.length} of ${items.length} cards`;
    const m = moved();
    save.disabled = undo.disabled = !m.length;
    save.textContent = m.length ? `Save ${m.length} move${m.length > 1 ? 's' : ''}` : 'Save moves';
    sizeTop();
  };
  save.onclick = async () => {
    save.disabled = true;
    const m = moved();
    await host.save(m.map((x) => ({ coll: x.coll, id: x.id, chapter: x.chapter ?? null })));
    for (const x of m) orig.set(`${x.coll}/${x.id}`, x.chapter ?? null);
    draw();
  };
  undo.onclick = () => { for (const x of items) x.chapter = orig.get(`${x.coll}/${x.id}`) ?? undefined; draw(); };

  main.replaceChildren(
    h('div', 'head', h('div', '', h('h1', '', 'Story board'), h('div', 'path', 'Every story record by chapter. Drag a card to move it; click to open it.')), h('div', 'actions', addCh, undo, save)),
    h('div', 'board-filters', kinds, tagSel, whoSel, stSel, search, count),
    topBar,
    cols,
  );
  main.classList.add('board-mode');
  // the side panel: chapters at a glance, and how to use tags
  const stats = h('div', 'board-stats');
  for (const ch of chapters) {
    const n = items.filter((x) => x.chapter === ch.id);
    const row = h('div', 'bs-row');
    row.style.setProperty('--c', ch.color);
    row.append(h('span', 'bs-dot'), h('span', '', ch.title), h('small', 'dim', KINDS.map((k) => { const c = n.filter((x) => x.coll === k.coll).length; return c ? `${c} ${k.label.toLowerCase()}` : ''; }).filter(Boolean).join(' · ') || 'empty'));
    stats.append(row);
  }
  const none = items.filter((x) => !x.chapter || !known.has(x.chapter)).length;
  const byStatus = h('div', 'board-stats');
  for (const [s, c] of [...Object.entries(STATUS_COLOR), ['-', '#333']] as [string, string][]) {
    const n = items.filter((x) => (s === '-' ? !x.status : x.status === s)).length;
    if (!n) continue;
    const row = h('div', 'bs-row');
    row.style.setProperty('--c', c);
    row.append(h('span', 'bs-dot'), h('span', '', s === '-' ? 'no status' : s), h('small', 'dim', String(n)));
    row.onclick = () => { prefs.status = s; stSel.value = s; keep(); draw(); };
    byStatus.append(row);
  }
  aside.replaceChildren(
    h('div', 'group', 'Chapters'), stats,
    h('div', 'group', 'Status'), byStatus,
    h('div', 'help-block', `${none} record${none === 1 ? '' : 's'} in no chapter yet. Chapters, tags and writer's notes are for the editor; the game ignores them.`),
    h('div', 'group', 'Organising'),
    h('div', 'help-block', 'Each mission, event, cinematic, character, inhabitant group and story bible entry has Chapter, Tags and Writer\'s notes fields at the bottom of its form. Tags are comma-separated; click one on a card to filter by it. Anyone shows the records a character speaks in. The sidebar lists story records under their chapters too. Story flow shows how missions and events trigger each other.'),
  );
  draw();
  return { dispose() { ro.disconnect(); main.classList.remove('board-mode'); } };
}
