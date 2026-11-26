/**
 * The editor's story tools: script import, branch graph, endings ledger, To do
 * and the flow analysis's counters and countdowns (pure functions, headless),
 * then each page in the editor (dev server on :5176): it draws without errors,
 * the playthrough runs, script import creates events (removed again after).
 *   node tools/story-tools-smoke.mjs [--url http://localhost:5176/] [--headless-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { runnerImport } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : (process.env.SMOKE_URL ?? 'http://localhost:5176/');
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const load = async (f) => (await runnerImport(path.join(root, f))).module;

// ---------- script import ----------
const S = await load('src/editor/script.ts');
const refs = { characters: { director: 'The Director', keeper: 'Keeper of Songs' }, buildings: ['solar', 'turret'], units: ['rover', 'brute'], research: ['deep-survey'], existing: ['the-stone'] };
{
  const r = S.parseScript(`# First {t-first}
when: built solar
pause
DIRECTOR: Power is up.
Good work.
KEEPER: We saw.
> Thank them
  = Logged.
  + counter trust 2
  + event next
> Ignore it
+ hint buildItem:turret Defend the bank
+ lock rover
+ spawn brute 2 at ridge guard

# Second
radio
when: after previous
Someone: A voice on the band.
`, refs, { chapter: 'act1' });
  const [a, b] = r.events;
  check(!r.issues.length && r.events.length === 2, 'two events, no issues');
  check(a.id === 't-first' && a.def.trigger === 'built' && a.def.building === 'solar' && a.def.pause && a.def.chapter === 'act1', 'id, trigger, pause and chapter');
  check(a.def.character === 'director' && a.def.text === 'Power is up. Good work.', 'the first line is the card text (narration carries on)');
  check(a.def.lines?.[0]?.character === 'keeper' && a.def.lines[0].text === 'We saw.', 'a character found by first name');
  check(a.def.choices?.length === 2 && a.def.choices[0].reply === 'Logged.', 'choices and replies');
  const fx = a.def.effects ?? [];
  check(fx.some((e) => e.after === 1 && e.kind === 'counter' && e.counter === 'trust' && e.amount === 2) && fx.some((e) => e.after === 1 && e.kind === 'event' && e.event === 'second'), 'effects under a choice belong to it ("event next" looks ahead)');
  check(fx.some((e) => e.after === 0 && e.kind === 'hint' && e.target === 'buildItem' && e.building === 'turret') && fx.some((e) => e.kind === 'lock' && e.unit === 'rover')
    && fx.some((e) => e.kind === 'spawn' && e.unit === 'brute' && e.count === 2 && e.site === 'ridge' && e.guard), 'effects when it fires: hint, lock, spawn');
  check(b.id === 'second' && b.def.style === 'radio' && b.def.trigger === 'after' && b.def.event === 't-first' && b.def.speaker === 'Someone', 'a radio message after the previous event');
  const bad = S.parseScript('# The Stone\nwhen: sometime\n+ teleport\n', refs);
  check(bad.issues.some((i) => /already exists/.test(i.msg)) && bad.issues.some((i) => /unknown condition/.test(i.msg)) && bad.issues.some((i) => /unknown effect/.test(i.msg)), 'existing ids, unknown conditions and effects are reported');
  const cl = S.parseCineLines('[2] DIRECTOR: One two three.\nKEEPER: Four.', refs);
  check(cl.lines.length === 2 && cl.lines[0].at === 2 && cl.lines[1].at > 2 && cl.lines[1].character === 'keeper', 'cinematic lines: given and following times');
}

// ---------- graph, ledger, flow, to do ----------
const G = await load('src/editor/graph.ts');
const L = await load('src/editor/ledger.ts');
const F = await load('src/editor/flow.ts');
const D = await load('src/editor/todo.ts');
const missions = {
  a: { title: 'A', objectives: [{ text: 'x', kind: 'counter', counter: 'trust', count: 5 }], rewards: [{ kind: 'stance', amount: 3 }] },
  b: { title: 'B', after: 'a', objectives: [{ text: 'y', kind: 'timer', timer: 'dawn' }], fails: [{ kind: 'lost', count: 1 }], onFail: 'e2' },
};
const story = {
  e1: { title: 'E1', text: 't', trigger: 'mission', mission: 'a', choices: [{ label: 'Kind' }, { label: 'Cold' }], effects: [
    { after: 1, kind: 'counter', counter: 'trust', amount: 2 }, { after: 2, kind: 'counter', counter: 'trust', amount: -1 }, { after: 1, kind: 'flag', flag: 'kind' }, { after: 0, kind: 'countdown', timer: 'dawn', amount: 60 }] },
  e2: { title: 'E2', text: 't', trigger: 'all', of: [{ kind: 'flag', flag: 'kind' }, { kind: 'counter', counter: 'fear', count: 2 }] },
};
{
  const g = G.buildGraph(missions, story, {});
  const has = (from, to) => g.edges.some((e) => e.from === from && e.to === to);
  check(has('mission:a', 'mission:b') && has('mission:a', 'story:e1') && has('mission:b', 'story:e2'), 'graph: missions follow, events wait on missions, fail events');
  check(has('story:e1', 'flag:kind') && has('flag:kind', 'story:e2') && has('story:e1', 'timer:dawn') && has('timer:dawn', 'mission:b'), 'graph: flags and countdowns link setter to waiter');
  check(g.nodes.find((n) => n.key === 'mission:b').col > g.nodes.find((n) => n.key === 'mission:a').col, 'graph: later things lie further right');
  const l = L.buildLedger(missions, story);
  check(l.range['counter:trust'].min === -1 && l.range['counter:trust'].max === 2, `ledger: a card's choices are either-or (trust ${l.range['counter:trust'].min} … ${l.range['counter:trust'].max})`);
  check(l.thresholds.some((t) => t.measure === 'counter:trust' && t.value === 5 && !t.reachable), 'ledger: a threshold the story can\'t reach is flagged');
  check(l.thresholds.some((t) => t.measure === 'counter:fear' && !t.reachable), 'ledger: thresholds inside all/any groups are read');
  const f = F.analyzeFlow(missions, story);
  check(f.problems.some((p) => /counter "fear", which nothing changes/.test(p.msg)), 'flow: a counter nothing changes');
  check(f.timers.get('dawn')?.setBy.length === 1 && !f.problems.some((p) => /countdown "dawn"/.test(p.msg)), 'flow: countdowns started and waited for');
  check(F.condText('all', story.e2) === 'flag kind and fear ≥ 2', `flow: groups read as one line (${F.condText('all', story.e2)})`);
  const t = D.collectTodo([
    { coll: 'story', id: 'e1', title: 'E1', data: { ...story.e1, status: 'draft', comments: [{ who: 'Ann', text: 'Too long?' }, { text: 'old', done: true }] } },
    { coll: 'characters', id: 'director', title: 'The Director', data: { name: 'The Director' } },
    { coll: 'cinematics', id: 'c', title: 'C', data: { title: 'C', length: 5, camera: [], lines: [{ at: 1, character: 'director', text: 'Hello there' }] } },
  ]);
  check(t.comments.length === 1 && t.comments[0].who === 'Ann', 'to do: open comments only');
  check(t.byStatus.draft.length === 1 && t.byStatus.none.length === 2, 'to do: records by status');
  check(t.missing.find((m) => /portrait/.test(m.what)).items.length === 1 && t.missing.find((m) => /no sound/.test(m.what)).items.length === 1, 'to do: missing portraits and sounds');
  check(t.voice['The Director']?.length === 1 && t.voice['The Director'][0].words === 2, 'to do: the voice script groups lines by character');
}

// ---------- the pages, in the editor ----------
if (!process.argv.includes('--headless-only')) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  for (const [hash, sel] of [['graph', '.graph-svg .gn'], ['ledger', 'h1'], ['todo', 'h1'], ['script', '.script-ev'], ['flow', 'h1'], ['board', '.board-card']]) {
    await p.goto(`${url}editor.html#${hash}`);
    const ok = await p.waitForSelector(sel, { timeout: 30000 }).then(() => true, () => false);
    check(ok && !errs.length, `editor page #${hash} draws${errs.length ? `: ${errs[0]}` : ''}`);
  }
  // script import → create, then remove the files again
  await p.goto(`${url}editor.html#script`);
  await p.waitForSelector('.script-ta');
  await p.fill('.script-ta >> nth=0', '# Smoke Test Event {zz-smoke-a}\nwhen: never\nDIRECTOR: Testing.\n> Yes\n  + flag zz-yes\n\n# Smoke Two {zz-smoke-b}\nDIRECTOR: Two.');
  await p.waitForTimeout(300);
  const label = await p.textContent('.script-grid button.primary');
  check(/Create 2 events/.test(label ?? ''), `script import offers to create them (${label})`);
  await p.click('.script-grid button.primary');
  await p.waitForFunction(() => location.hash.includes('story/zz-smoke-a'), null, { timeout: 15000 }).catch(() => {});
  const made = ['zz-smoke-a', 'zz-smoke-b'].map((id) => path.join(root, `content/story/${id}.json`));
  const okMade = made.every((f) => fs.existsSync(f));
  const two = okMade ? JSON.parse(fs.readFileSync(made[1], 'utf8')) : null;
  check(okMade && two?.trigger === 'after' && two.event === 'zz-smoke-a', 'created as files; the second follows the first');
  for (const f of made) if (fs.existsSync(f)) fs.unlinkSync(f);
  // the playthrough runs and reports
  await p.goto(`${url}editor.html#playthrough`);
  await p.waitForSelector('.bal-opts');
  await p.fill('.bal-opts input[type=number] >> nth=0', '6');
  await p.dispatchEvent('.bal-opts input[type=number] >> nth=0', 'change');
  await p.click('text=▶ Play through');
  const ran = await p.waitForFunction(() => document.querySelectorAll('.bal-run').length === 3 && !document.querySelector('.bal-opts button.primary')?.disabled, null, { timeout: 300000 }).then(() => true, () => false);
  check(ran, 'the playthrough runs three policies');
  const cov = await p.textContent('#aside');
  check(/Coverage over 3 runs/.test(cov ?? '') && /Events no run fired/.test(cov ?? ''), 'and reports coverage');
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
  await b.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
