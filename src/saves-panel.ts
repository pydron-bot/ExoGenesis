/**
 * The SAVES panel (game menu Save / Load, Ctrl+S's "Saved" line, the title screen's LOAD): save files by name,
 * newest first. Save as a new file or over one, Load, Rename, Export (a .json download), Delete, Import.
 * The files themselves are src/saves.ts; main.ts says what saving and loading do.
 */
import { esc, panel } from './options';
import { deleteSave, exportSave, importSave, listSaves, renameSave, type SaveKind, type SaveMeta } from './saves';

export interface SavesPanelOptions {
  /** Saving is possible here (in a game, not on the title screen or in a play test). */
  save?: {
    kind: SaveKind;
    /** The name a new file starts with. */
    name: string;
    /** Save the game as a new file, or over `id`. Resolves to the file written (null: it failed, already said). */
    run(name: string, id?: string): Promise<SaveMeta | null>;
  };
  /** Load a file (the panel is closed first). */
  load(meta: SaveMeta): void;
  /** Ask twice before loading: what would be lost ("Your campaign will be replaced"). */
  loadWarning?(meta: SaveMeta): string | null;
  /** Why this file can't be loaded here, if it can't. */
  cannotLoad?(meta: SaveMeta): string | null;
  tap?(): void;
  onClose?(): void;
}

const KIND: Record<SaveKind, string> = { campaign: 'Campaign', skirmish: 'Skirmish', domination: 'Domination' };

function ago(t: number) {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })} ${time}`;
}
const mb = (n?: number) => (!n ? '' : n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);

export function openSaves(o: SavesPanelOptions) {
  const { el, close } = panel(o.save ? 'Save & load' : 'Load', `
    ${o.save ? `<div class="sv-new">
      <input class="sv-name" type="text" maxlength="60" aria-label="Save name" value="${esc(o.save.name)}">
      <button class="sv-btn sv-primary" data-act="new">SAVE</button>
    </div>` : ''}
    <div class="op-sec">Save files</div>
    <div class="sv-list"><div class="sv-empty">Reading…</div></div>
    <div class="sv-foot">
      <button class="sv-btn" data-act="import">IMPORT FILE…</button>
      <input class="sv-file" type="file" accept=".json,application/json" hidden>
      <small>Saves live in this browser. Export one to keep it safe or to carry on on another device.</small>
    </div>`, o.onClose);
  el.classList.add('saves');
  const list = el.querySelector<HTMLElement>('.sv-list')!;
  const nameIn = el.querySelector<HTMLInputElement>('.sv-name');
  const fileIn = el.querySelector<HTMLInputElement>('.sv-file')!;
  let metas: SaveMeta[] = [];
  let busy = false;
  /** A button that asks twice: first tap arms it with `ask`, the second runs. */
  let armed: HTMLButtonElement | null = null;
  const arm = (b: HTMLButtonElement, ask: string) => {
    if (armed === b) { armed = null; return true; }
    if (armed) { armed.classList.remove('armed'); armed.textContent = armed.dataset.label!; }
    armed = b;
    b.dataset.label = b.textContent!;
    b.classList.add('armed');
    b.textContent = ask;
    return false;
  };
  const flash = (text: string, bad = false) => {
    let n = el.querySelector<HTMLElement>('.sv-msg');
    if (!n) { n = document.createElement('div'); n.className = 'sv-msg'; list.before(n); }
    n.textContent = text;
    n.classList.toggle('bad', bad);
  };

  const draw = (hi?: string) => {
    armed = null;
    if (!metas.length) { list.innerHTML = `<div class="sv-empty">No save files yet${o.save ? '. Name one above and tap SAVE.' : '.'}</div>`; return; }
    list.innerHTML = metas.map((m) => {
      const no = o.cannotLoad?.(m) ?? null;
      return `<div class="sv-row${m.id === hi ? ' hi' : ''}" data-id="${esc(m.id)}">
        <div class="sv-text"><b class="sv-title">${esc(m.name)}</b>
          <small><span class="sv-kind">${KIND[m.kind]}</span> · ${esc(m.place)}${m.when ? ` · ${esc(m.when)}` : ''}</small>
          <small class="sv-dim">${m.auto ? 'Kept by the game before you started over' : 'Saved'} ${ago(m.savedAt)}${m.size ? ` · ${mb(m.size)}` : ''}${no ? ` · ${esc(no)}` : ''}</small></div>
        <div class="sv-acts">
          <button class="sv-btn sv-primary" data-act="load"${no ? ' disabled' : ''}>LOAD</button>
          ${o.save && o.save.kind === m.kind ? '<button class="sv-btn" data-act="over">SAVE HERE</button>' : ''}
          <button class="sv-btn" data-act="rename">RENAME</button>
          <button class="sv-btn" data-act="export">EXPORT</button>
          <button class="sv-btn sv-del" data-act="delete" aria-label="Delete">DELETE</button>
        </div>
      </div>`;
    }).join('');
  };
  const refresh = async (hi?: string) => {
    try { metas = await listSaves(); } catch (e) { flash(`Couldn’t read the saves: ${(e as Error).message}`, true); metas = []; }
    draw(hi);
  };

  const saveAs = async (name: string, id?: string) => {
    if (!o.save || busy) return;
    busy = true;
    flash('Saving…');
    try {
      const m = await o.save.run(name, id);
      if (m) { flash(`Saved “${m.name}”`); await refresh(m.id); }
      else flash('Not saved', true);
    } finally { busy = false; }
  };

  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
    if (!b || b.disabled) return;
    o.tap?.();
    const act = b.dataset.act!;
    if (act === 'new') { void saveAs(nameIn!.value); return; }
    if (act === 'import') { fileIn.click(); return; }
    const row = b.closest<HTMLElement>('.sv-row')!;
    const m = metas.find((x) => x.id === row.dataset.id)!;
    if (!m) return;
    if (act === 'load') {
      const warn = o.loadWarning?.(m);
      if (warn && !arm(b, warn)) return;
      close();
      o.load(m);
    } else if (act === 'over') {
      if (!arm(b, 'TAP TO REPLACE')) return;
      void saveAs(m.name, m.id);
    } else if (act === 'delete') {
      if (!arm(b, 'TAP TO DELETE')) return;
      void deleteSave(m.id).then(() => { flash(`Deleted “${m.name}”`); return refresh(); });
    } else if (act === 'export') {
      void exportSave(m.id).then((f) => {
        if (!f) { flash('That save couldn’t be read', true); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([f.text], { type: 'application/json' }));
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        flash(`Exported ${f.name}`);
      });
    } else if (act === 'rename') {
      const title = row.querySelector<HTMLElement>('.sv-title')!;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 60; inp.value = m.name; inp.className = 'sv-name sv-rename';
      title.replaceWith(inp);
      inp.focus(); inp.select();
      let done = false;
      const commit = (keep: boolean) => {
        if (done) return; done = true;
        if (keep && inp.value.trim() && inp.value.trim() !== m.name) void renameSave(m.id, inp.value).then(() => refresh(m.id));
        else draw();
      };
      inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); } };
      inp.onblur = () => commit(true);
    }
  });
  // typing a name doesn't drive the game (WASD, hotkeys); Enter saves
  nameIn?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') void saveAs(nameIn.value); });
  fileIn.onchange = () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    void f.text().then(importSave).then((m) => { flash(`Imported “${m.name}”`); return refresh(m.id); }, (e: Error) => flash(e.message, true));
  };
  void refresh();
  (nameIn ?? el.querySelector<HTMLElement>('.op-x'))?.focus({ preventScroll: true });
  return { el, close };
}
