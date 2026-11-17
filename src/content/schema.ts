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
  /**
   * Only applies when a sibling field has one of these values (the editor hides
   * it otherwise). With `need`, it's required whenever it applies.
   */
  when?: { field: string; is: readonly string[]; need?: boolean };
}

/** Does field `f` apply to record `rec` (its `when`, if any, is met)? */
export function applies(f: { when?: Base<unknown>['when'] }, rec: Record<string, unknown>): boolean {
  return !f.when || f.when.is.includes(String(rec[f.when.field]));
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
  /** Help for each value: the editor shows the chosen one's under the field. */
  helps?: Partial<Record<V, string>>;
}
export interface RefField extends Base<string> {
  kind: 'ref';
  /** Collection the id must exist in. */
  to: string;
  /** Asset refs: which kind of asset fits (model, image, audio). Default model. */
  assetKind?: string;
}
export interface ColorField extends Base<string> {
  kind: 'color';
  default?: string;
}

/** A 2D grid of whole numbers, stored as one run-length-encoded string per row (see grid.ts). */
export interface GridField extends Base<string[]> {
  kind: 'grid';
  cols: number;
  rows: number;
  min: number;
  max: number;
}
/** A list of small records (e.g. herds on a map). */
export interface ListField<S extends Shape = Shape> extends Base<Infer<S>[]> {
  kind: 'list';
  of: S;
  max?: number;
}

export type Field = NumField | StrField | BoolField | ChoiceField | RefField | ColorField | GridField | ListField;
export type Shape = { [k: string]: Field };

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
export const grid = <O extends Omit<Opts<GridField>, 'cols' | 'rows' | 'min' | 'max'>>(
  cols: number, rows: number, min: number, max: number, o: O = {} as O,
) => ({ kind: 'grid', cols, rows, min, max, ...o }) as GridField & O;
export const list = <S extends Shape, O extends Omit<Opts<ListField<S>>, 'of'>>(of: S, o: O = {} as O) =>
  ({ kind: 'list', of, ...o }) as ListField<S> & O;
export const choice = <const V extends string, O extends Omit<Opts<ChoiceField<V>>, 'values'>>(
  values: readonly V[],
  o: O = {} as O,
) => ({ kind: 'choice', values, ...o }) as ChoiceField<V> & O;

export interface Issue {
  field: string;
  msg: string;
}

function gridIssue(f: GridField, v: unknown): string | null {
  if (!Array.isArray(v) || v.length !== f.rows) return `must be ${f.rows} rows`;
  for (let r = 0; r < v.length; r++) {
    const row = v[r];
    if (typeof row !== 'string') return `row ${r} must be text`;
    let n = 0;
    for (const tok of row.split(' ')) {
      const m = tok.match(/^(-?\d+)(?:\*(\d+))?$/);
      if (!m) return `row ${r}: bad value "${tok}"`;
      const val = Number(m[1]);
      if (val < f.min || val > f.max) return `row ${r}: ${val} outside ${f.min}..${f.max}`;
      n += m[2] ? Number(m[2]) : 1;
    }
    if (n !== f.cols) return `row ${r} has ${n} values, needs ${f.cols}`;
  }
  return null;
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
      else if (f.when?.need && applies(f, rec)) out.push({ field: k, msg: `required when ${f.when.field} is ${String(rec[f.when.field])}` });
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
      case 'grid': {
        const err = gridIssue(f, v);
        if (err) out.push({ field: k, msg: err });
        break;
      }
      case 'list':
        if (!Array.isArray(v)) { out.push({ field: k, msg: 'must be a list' }); break; }
        if (f.max !== undefined && v.length > f.max) out.push({ field: k, msg: `at most ${f.max} entries` });
        v.forEach((item, n) => {
          for (const i of validate(f.of, item, ids)) out.push({ field: `${k}[${n}]${i.field ? `.${i.field}` : ''}`, msg: i.msg });
        });
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
      case 'grid': break;
      case 'list': o[k] = []; break;
    }
  }
  return o;
}
