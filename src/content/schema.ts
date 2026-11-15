/**
 * Tiny schema system for game content.
 *
 * One definition drives three things:
 *   - the TypeScript type of a content record (`Infer<typeof schema>`),
 *   - validation (game load, editor save, `npm run content:check`),
 *   - the editor's form (labels, units, ranges, help text, widgets).
 *
 * Deliberately small: add a field kind here when content needs it.
 */

interface Base<T> {
  /** Phantom marker carrying the field's value type. */
  readonly _t?: T;
  label?: string;
  help?: string;
  optional?: boolean;
}

export interface NumField extends Base<number> {
  kind: 'num';
  int?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Display unit, e.g. "s", "MW", "m/s". */
  unit?: string;
  default?: number;
}
export interface StrField extends Base<string> {
  kind: 'str';
  multiline?: boolean;
  default?: string;
}
export interface BoolField extends Base<boolean> {
  kind: 'bool';
  default?: boolean;
}
export interface ChoiceField<V extends string = string> extends Base<V> {
  kind: 'choice';
  values: readonly V[];
  default?: V;
}
export interface RefField extends Base<string> {
  kind: 'ref';
  /** Collection the id must exist in. */
  to: string;
}
export interface ColorField extends Base<string> {
  kind: 'color';
  default?: string;
}

export type Field = NumField | StrField | BoolField | ChoiceField | RefField | ColorField;
export type Shape = Record<string, Field>;

type ValueOf<F> = F extends Base<infer T> ? T : never;
type OptKeys<S extends Shape> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];
type ReqKeys<S extends Shape> = Exclude<keyof S, OptKeys<S>>;
export type Infer<S extends Shape> =
  { [K in ReqKeys<S>]: ValueOf<S[K]> } & { [K in OptKeys<S>]?: ValueOf<S[K]> };

type Opts<F> = Omit<F, 'kind' | '_t'>;
export const num = <O extends Opts<NumField>>(o: O = {} as O) => ({ kind: 'num', ...o }) as NumField & O;
export const int = <O extends Opts<NumField>>(o: O = {} as O) => ({ kind: 'num', int: true, ...o }) as NumField & O;
export const str = <O extends Opts<StrField>>(o: O = {} as O) => ({ kind: 'str', ...o }) as StrField & O;
export const bool = <O extends Opts<BoolField>>(o: O = {} as O) => ({ kind: 'bool', ...o }) as BoolField & O;
export const color = <O extends Opts<ColorField>>(o: O = {} as O) => ({ kind: 'color', ...o }) as ColorField & O;
export const ref = <O extends Omit<Opts<RefField>, 'to'>>(to: string, o: O = {} as O) =>
  ({ kind: 'ref', to, ...o }) as RefField & O;
export const choice = <const V extends string, O extends Omit<Opts<ChoiceField<V>>, 'values'>>(
  values: readonly V[],
  o: O = {} as O,
) => ({ kind: 'choice', values, ...o }) as ChoiceField<V> & O;

export interface Issue {
  field: string;
  msg: string;
}

/** Ids of every record in every collection, for `ref` checks. */
export type IdIndex = Record<string, Set<string>>;

export function validate(shape: Shape, data: unknown, ids?: IdIndex): Issue[] {
  const out: Issue[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return [{ field: '', msg: 'must be a JSON object' }];
  }
  const rec = data as Record<string, unknown>;
  for (const [k, f] of Object.entries(shape)) {
    const v = rec[k];
    if (v === undefined || v === null) {
      if (!f.optional) out.push({ field: k, msg: 'required' });
      continue;
    }
    switch (f.kind) {
      case 'num':
        if (typeof v !== 'number' || !Number.isFinite(v)) out.push({ field: k, msg: 'must be a number' });
        else {
          if (f.int && !Number.isInteger(v)) out.push({ field: k, msg: 'must be a whole number' });
          if (f.min !== undefined && v < f.min) out.push({ field: k, msg: `must be ≥ ${f.min}` });
          if (f.max !== undefined && v > f.max) out.push({ field: k, msg: `must be ≤ ${f.max}` });
        }
        break;
      case 'str':
        if (typeof v !== 'string') out.push({ field: k, msg: 'must be text' });
        break;
      case 'bool':
        if (typeof v !== 'boolean') out.push({ field: k, msg: 'must be true or false' });
        break;
      case 'choice':
        if (typeof v !== 'string' || !f.values.includes(v)) out.push({ field: k, msg: `must be one of ${f.values.join(', ')}` });
        break;
      case 'color':
        if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) out.push({ field: k, msg: 'must be a colour like #33ccff' });
        break;
      case 'ref':
        if (typeof v !== 'string') out.push({ field: k, msg: 'must be an id' });
        else if (ids && !ids[f.to]?.has(v)) out.push({ field: k, msg: `no ${f.to} with id "${v}"` });
        break;
    }
  }
  for (const k of Object.keys(rec)) {
    if (k !== '$schema' && !(k in shape)) out.push({ field: k, msg: 'unknown field' });
  }
  return out;
}

/** A record with every field at its default (or a neutral value), for "New". */
export function blank(shape: Shape): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(shape)) {
    if (f.optional) continue;
    switch (f.kind) {
      case 'num': o[k] = f.default ?? f.min ?? 0; break;
      case 'str': o[k] = f.default ?? ''; break;
      case 'bool': o[k] = f.default ?? false; break;
      case 'choice': o[k] = f.default ?? f.values[0]; break;
      case 'color': o[k] = f.default ?? '#ffffff'; break;
      case 'ref': o[k] = ''; break;
    }
  }
  return o;
}
