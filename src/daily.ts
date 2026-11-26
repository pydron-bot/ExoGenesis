/**
 * Daily Planet (DESIGN §5.10 A): one seeded skirmish world per UTC day, the same for everyone, from the
 * procedural skirmish generator and computer players. One scored try a day, kept in this browser
 * (`exo-daily`); later tries the same day are practice. The end screen shows the score and a spoiler-free
 * result to share (text and an emoji timeline, like Wordle's), by the Web Share sheet or the clipboard.
 * No server: the seed comes from the date.
 */
import type { Snapshot } from './sim/types';
import { PLAYER_NAMES, SKIRMISH_WORLDS } from './skirmish/setup';
import { esc } from './util/html';

const KEY = 'exo-daily';
/** Seconds of play per square of the shared timeline. */
export const DAILY_SLICE = 120;
/** First day (day 1 of the count shown when sharing). */
const EPOCH = Date.UTC(2026, 10, 20);

export interface DailyRules {
  date: string;
  /** Day number since the first Daily Planet (shown in the share). */
  day: number;
  seed: number;
  world: string;
  players: number;
  ai: 'normal' | 'hard';
  size: 'small' | 'medium';
  water: 'none' | 'some' | 'lots';
  relief: 'flat' | 'rolling' | 'rugged';
  alloys: number;
}

export interface DailyResult {
  won: boolean;
  secs: number;
  score: number;
  parts: { label: string; points: number }[];
  /** The timeline: one character per slice (see DAILY_MARKS). */
  line: string;
}
export interface DailyRecord { started: number; result?: DailyResult }

/** The UTC date as YYYY-MM-DD. */
export const dailyDate = (now = new Date()) => now.toISOString().slice(0, 10);

/** FNV-1a over the text, then a little mixing: a stable 32-bit number per string. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return h >>> 0;
}

/** Today's planet: everything follows from the date, so everyone gets the same one. */
export function dailyRules(date = dailyDate(), oceans: (world: string) => boolean = () => true): DailyRules {
  const h = hash(`exo-daily:${date}`);
  let r = h;
  const next = (n: number) => { r = Math.imul(r ^ (r >>> 13), 0x5bd1e995) >>> 0; return r % n; };
  const world = SKIRMISH_WORLDS[next(SKIRMISH_WORLDS.length)];
  const players = 2 + next(2); // one or two computer players
  const day = Math.floor((Date.parse(`${date}T00:00:00Z`) - EPOCH) / 86400000) + 1;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    date, day, seed: 1 + (h % 99999), world, players,
    // weekends are harder
    ai: dow === 0 || dow === 6 ? 'hard' : 'normal',
    size: players > 2 ? 'medium' : next(2) ? 'medium' : 'small',
    water: oceans(world) ? (['none', 'some', 'lots'] as const)[next(3)] : 'none',
    relief: (['flat', 'rolling', 'rugged'] as const)[next(3)],
    alloys: [400, 600, 800][next(3)],
  };
}

/** The game's link (a skirmish, marked as the daily). `practice` plays it unscored. */
export function dailyLink(d: DailyRules, base: string, practice = false) {
  const q = new URLSearchParams({
    skirmish: String(d.seed), players: String(d.players), world: d.world, size: d.size, water: d.water, relief: d.relief,
    ai: d.ai, alloys: String(d.alloys), packs: '1', daily: d.date,
  });
  if (practice) q.set('practice', '1');
  return `${base}?${q}`;
}

// ---------- the record (this browser) ----------
function readAll(): Record<string, DailyRecord> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writeAll(all: Record<string, DailyRecord>) {
  // keep the last 60 days
  const keys = Object.keys(all).sort().slice(-60);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]])))); } catch { /* private mode: it just isn't kept */ }
}
export const dailyRecord = (date: string): DailyRecord | undefined => readAll()[date];
/** Claim today's scored try. False if it was already taken (this one is practice). */
export function claimDaily(date: string): boolean {
  const all = readAll();
  if (all[date]) return false;
  all[date] = { started: Date.now() };
  writeAll(all);
  return true;
}
export function saveDaily(date: string, result: DailyResult) {
  const all = readAll();
  all[date] = { started: all[date]?.started ?? Date.now(), result };
  writeAll(all);
}
/** Days in a row with a finished try, up to `date`. */
export function dailyStreak(date: string) {
  const all = readAll();
  let n = 0;
  for (let t = Date.parse(`${date}T00:00:00Z`); all[new Date(t).toISOString().slice(0, 10)]?.result; t -= 86400000) n++;
  return n;
}

// ---------- scoring ----------
type Stats = NonNullable<Snapshot['players']>[number]['stats'];

/**
 * The score: winning is worth most, and sooner is better; a loss still scores the time held. On top: kills of
 * the other players' things, alloys mined; off: units and buildings lost.
 */
export function dailyScore(won: boolean, secs: number, st: Stats): { score: number; parts: DailyResult['parts'] } {
  const parts: DailyResult['parts'] = [];
  if (won) {
    parts.push({ label: 'Victory', points: 1000 });
    parts.push({ label: 'Speed', points: Math.round(Math.max(0, 2400 - secs) / 4) });
  } else parts.push({ label: `Held out ${Math.floor(secs / 60)} min`, points: Math.round(Math.min(secs, 2400) / 3) });
  parts.push({ label: `${st.enemyKills ?? 0} kills`, points: (st.enemyKills ?? 0) * 5 });
  parts.push({ label: `${Math.round(st.mined)} alloys mined`, points: Math.round(st.mined / 20) });
  parts.push({ label: `${st.unitsLost ?? 0} units lost`, points: -(st.unitsLost ?? 0) * 8 });
  parts.push({ label: `${st.buildingsLost} buildings lost`, points: -st.buildingsLost * 20 });
  return { score: Math.max(0, parts.reduce((m, p) => m + p.points, 0)), parts };
}

/** Timeline marks: quiet, a fight held, heavy losses, out; and the last square. */
export const DAILY_MARKS = { calm: '🟩', fight: '🟨', hurt: '🟥', out: '⬛', won: '🏆', lost: '💀' } as const;

/**
 * Watches a daily game through its snapshots: one mark per DAILY_SLICE seconds of play (quiet,
 * fighting, or hurt), from your losses and kills in that slice.
 */
export class DailyTracker {
  private slice = -1;
  private base = { lost: 0, bldg: 0, kills: 0 };
  private last = { lost: 0, bldg: 0, kills: 0 };
  private worst: 'calm' | 'fight' | 'hurt' = 'calm';
  readonly marks: string[] = [];
  sample(s: Snapshot) {
    const me = s.players?.[0];
    if (!me) return;
    const k = Math.floor(s.secs / DAILY_SLICE);
    const st = me.stats, lost = st.unitsLost ?? 0, bldg = st.buildingsLost, kills = st.enemyKills ?? 0;
    const cur = { lost, bldg, kills };
    if (this.slice < 0) { this.slice = k; this.base = cur; this.last = cur; }
    // a new slice starts from where the last sample left off
    while (k > this.slice) {
      this.marks.push(DAILY_MARKS[this.worst]);
      this.slice++;
      this.worst = 'calm';
      this.base = this.last;
    }
    const dl = lost - this.base.lost, db = bldg - this.base.bldg, dk = kills - this.base.kills;
    const now = db >= 2 || dl >= 6 ? 'hurt' : dl || db || dk ? 'fight' : 'calm';
    const rank = { calm: 0, fight: 1, hurt: 2 };
    if (rank[now] > rank[this.worst]) this.worst = now;
    this.last = cur;
  }
  /** The finished line: the slices so far (the one under way counts) and how it ended. */
  line(won: boolean) {
    const all = [...this.marks, DAILY_MARKS[this.worst]];
    // long games fold into at most 15 squares (worst of each pair)
    const rank = (m: string) => (m === DAILY_MARKS.hurt ? 2 : m === DAILY_MARKS.fight ? 1 : 0);
    let row = all;
    while (row.length > 15) {
      const out: string[] = [];
      for (let i = 0; i < row.length; i += 2) out.push(rank(row[i]) >= rank(row[i + 1] ?? DAILY_MARKS.calm) ? row[i] : row[i + 1]);
      row = out;
    }
    return row.join('') + (won ? DAILY_MARKS.won : DAILY_MARKS.lost);
  }
}

/** The text to share: no map, no build, just how it went. */
export function shareText(d: DailyRules, r: DailyResult, worldName: string, url: string) {
  const mm = `${Math.floor(r.secs / 60)}:${String(Math.floor(r.secs % 60)).padStart(2, '0')}`;
  return [
    `Exo Genesis · Daily Planet #${d.day}`,
    `${worldName} · ${d.players - 1} rival${d.players > 2 ? 's' : ''} · ${d.ai === 'hard' ? 'Hard' : 'Normal'}`,
    r.line,
    `${r.won ? 'Victory' : 'Fell'} at ${mm} · ${r.score.toLocaleString('en')} pts`,
    url,
  ].join('\n');
}

/** Share by the system sheet where there is one (phones), else copy. Resolves to what happened. */
export async function shareResult(text: string): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
  if (nav.share && matchMedia('(pointer: coarse)').matches) {
    try { await nav.share({ text }); return 'shared'; } catch { /* cancelled, or not allowed: copy instead */ }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { /* no clipboard API: select it */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand?.('copy');
  ta.remove();
  return ok ? 'copied' : 'failed';
}

/** The score card (end screen and the title's look back): score, how it was made, the line, a Share button. */
export function resultHtml(d: DailyRules, r: DailyResult, worldName: string, practice = false) {
  return `<div class="dl-head">DAILY PLANET #${d.day} · ${esc(worldName.toUpperCase())}${practice ? ' · PRACTICE' : ''}</div>
    <div class="dl-score">${r.score.toLocaleString('en')}<small>pts</small></div>
    <div class="dl-line" aria-label="timeline">${r.line}</div>
    <table class="dl-parts">${r.parts.filter((p) => p.points).map((p) => `<tr><td>${esc(p.label)}</td><td>${p.points > 0 ? '+' : '−'}${Math.abs(p.points).toLocaleString('en')}</td></tr>`).join('')}</table>
    ${practice ? '<div class="dl-note">Practice: today\'s scored try is already taken.</div>' : '<button class="dl-share go">Share result</button><div class="dl-note dl-said"></div>'}`;
}

/** The opponents' names for a daily (for the HUD line). */
export const dailyRivals = (d: DailyRules) => PLAYER_NAMES.slice(1, d.players).join(' and ');
