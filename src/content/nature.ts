/**
 * Biomes and wildlife (content/biomes, content/wildlife): which biome a region
 * gets and which species each herd is. Plain data, shared by the sim worker,
 * the renderer and the editor so they all agree.
 */
import type { BiomeDef, BodyDef, HerdDef, RegionDef, WildlifeDef } from './defs';

export interface NatureDb {
  bodies: Record<string, BodyDef>;
  biomes: Record<string, BiomeDef>;
  wildlife: Record<string, WildlifeDef>;
}

/** The biome a body gets when it names none: from its air, surface, frost, seas and plant life. */
export function autoBiome(id: string, b: BodyDef | undefined): string {
  if (!b || id === 'home') return 'verdant';
  if (!b.atmosphere) return 'barren';
  const sub = (b.sub ?? '').toLowerCase();
  if (b.surface === 'volcanic' || b.surface === 'sulfur' || /molten|volcan|lava/.test(sub)) return 'volcanic';
  if (b.surface === 'icy' || /frozen|ice|frost/.test(sub) || (b.snowLine !== undefined && b.snowLine > 0 && b.snowLine < 20)) return 'frozen';
  if (!b.ocean || b.surface === 'dusty' || /desert|arid|dust/.test(sub)) return 'arid';
  if ((b.plants ?? -1) > 0.05) return 'lush';
  return 'verdant';
}

/** A region's biome id: the override (?biome=), the region's, its body's, or picked from the body. */
export function biomeId(db: NatureDb, region: Pick<RegionDef, 'body' | 'biome'>, override?: string | null): string {
  const bodyId = region.body && db.bodies[region.body] ? region.body : 'home';
  const body = db.bodies[bodyId];
  for (const c of [override, region.biome, body?.biome, autoBiome(bodyId, body)]) if (c && db.biomes[c]) return c;
  return db.biomes.verdant ? 'verdant' : Object.keys(db.biomes)[0];
}

export function biomeOf(db: NatureDb, region: Pick<RegionDef, 'body' | 'biome'>, override?: string | null): BiomeDef | undefined {
  return db.biomes[biomeId(db, region, override)];
}

/** Stable 0..1 from two ints. */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The species of herd `index`: its own, else a weighted pick from the biome's wildlife (stable per region seed). */
export function herdSpecies(db: NatureDb, biome: BiomeDef | undefined, herd: Pick<HerdDef, 'species'>, index: number, seed: number): string {
  if (herd.species && db.wildlife[herd.species]) return herd.species;
  const rows = (biome?.wildlife ?? []).filter((w) => db.wildlife[w.species] && (w.weight ?? 1) > 0);
  if (!rows.length) return db.wildlife.grazer ? 'grazer' : Object.keys(db.wildlife)[0];
  // the first herd always gets the biome's first species, so every region shows its staple
  if (index === 0) return rows[0].species;
  const total = rows.reduce((t, w) => t + (w.weight ?? 1), 0);
  let k = hash01(seed, index * 31 + 7) * total;
  for (const w of rows) { k -= w.weight ?? 1; if (k <= 0) return w.species; }
  return rows[rows.length - 1].species;
}

/** Species ids in a fixed order: snapshots carry an index into this. */
export const wildlifeIds = (db: Pick<NatureDb, 'wildlife'>) => Object.keys(db.wildlife).sort();

/** Herd size for a species (its Herd size × on the region's Grazers count; at least one if any were asked for). */
export const herdCount = (grazers: number, w: WildlifeDef | undefined) =>
  grazers <= 0 ? 0 : Math.max(1, Math.round(grazers * (w?.herdScale ?? 1)));
