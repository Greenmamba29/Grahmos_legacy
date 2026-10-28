/**
 * Minimal STEP / ISO-10303-21 reader. IFC files are STEP physical files: a DATA section of
 * `#<id> = TYPE(arg, ...);` records whose args are numbers, 'strings', .ENUMS., $ (unset),
 * * (derived), #refs, (lists) or inline TYPE(...) values. This tokenises records into a typed value
 * model — enough to walk IfcBuildingStorey / IfcSpace / IfcDoor / IfcStair and their 2D geometry.
 * Heavy BIM still wants IfcOpenShell; this keeps the common export path offline and dependency-free.
 */
export type StepValue =
  | number
  | string
  | { ref: number }
  | { enum: string }
  | { typed: string; args: StepValue[] }
  | StepValue[]
  | null;

export interface StepRecord {
  id: number;
  type: string;
  args: StepValue[];
}
export interface StepModel {
  records: Map<number, StepRecord>;
  byType: (type: string) => StepRecord[];
}

const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

function parseArgs(s: string, start: number): { args: StepValue[]; next: number } {
  const args: StepValue[] = [];
  let i = start;
  const n = s.length;
  const ws = (): void => {
    while (i < n && /\s/.test(s[i]!)) i++;
  };
  ws();
  if (s[i] === ')') return { args, next: i + 1 };
  for (;;) {
    ws();
    const c = s[i];
    if (c === undefined) break;
    if (c === "'") {
      let str = '';
      i++;
      while (i < n) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            str += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        str += s[i++];
      }
      args.push(str);
    } else if (c === '#') {
      let num = '';
      i++;
      while (i < n && /[0-9]/.test(s[i]!)) num += s[i++];
      args.push({ ref: Number(num) });
    } else if (c === '(') {
      const inner = parseArgs(s, i + 1);
      args.push(inner.args);
      i = inner.next;
    } else if (c === '.') {
      let e = '';
      i++;
      while (i < n && s[i] !== '.') e += s[i++];
      i++;
      args.push({ enum: e });
    } else if (c === '$') {
      args.push(null);
      i++;
    } else if (c === '*') {
      args.push({ enum: '*' });
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let name = '';
      while (i < n && /[A-Za-z0-9_]/.test(s[i]!)) name += s[i++];
      ws();
      if (s[i] === '(') {
        const inner = parseArgs(s, i + 1);
        args.push({ typed: name.toUpperCase(), args: inner.args });
        i = inner.next;
      } else args.push({ enum: name });
    } else if (/[0-9+-]/.test(c)) {
      let num = '';
      while (i < n && /[0-9+.eE-]/.test(s[i]!)) num += s[i++];
      args.push(Number(num));
    } else i++;
    ws();
    if (s[i] === ',') {
      i++;
      continue;
    }
    if (s[i] === ')') {
      i++;
      break;
    }
    if (i >= n) break;
    i++;
  }
  return { args, next: i };
}

export function parseStep(source: string): StepModel {
  const src = stripComments(source);
  const records = new Map<number, StepRecord>();
  const dataStart = src.search(/\bDATA\s*;/);
  const body = dataStart >= 0 ? src.slice(dataStart + src.slice(dataStart).indexOf(';') + 1) : src;
  const head = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(body)) !== null) {
    const { args } = parseArgs(body, m.index + m[0].length);
    records.set(Number(m[1]), { id: Number(m[1]), type: m[2]!.toUpperCase(), args });
  }
  return {
    records,
    byType: (type) => {
      const want = type.toUpperCase();
      return [...records.values()].filter((r) => r.type === want).sort((a, b) => a.id - b.id);
    },
  };
}
