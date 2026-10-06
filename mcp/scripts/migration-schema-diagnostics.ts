import { createHash } from 'node:crypto';
import type { Entry } from './domain-migrations';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const name = (value: string) => /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value) ? value : `identifier-sha256:${hash(value)}`;
// Strings may include literals, expressions, function arguments or sensitive DDL.
// Never emit their contents. Names appear only as validated path components.
const summary = (value: unknown): unknown => value === undefined ? {missing:true}
  : value === null || typeof value === 'boolean' || typeof value === 'number' ? value
  : {type:Array.isArray(value) ? 'array' : typeof value,sha256:hash(value)};
interface Difference {path:string; expected:unknown; actual:unknown}
function compare(expected:unknown, actual:unknown, path:string, output:Difference[]) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    for(let i=0;i<Math.max(expected.length,actual.length);i++) {
      const row = expected[i] ?? actual[i];
      const label = Array.isArray(row) && typeof row[0] === 'string' ? `${i}:${name(row[0])}` : String(i);
      compare(expected[i],actual[i],`${path}[${label}]`,output);
    }
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    const a=expected as Record<string,unknown>, b=actual as Record<string,unknown>;
    for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()) compare(a[key],b[key],`${path}.${name(key)}`,output);
  } else output.push({path,expected:summary(expected),actual:summary(actual)});
}
/** Metadata already read by plan; no SQL or baseline decision is performed here. */
export function diagnoseSchema(actual:unknown[], entries:Entry[]) {
  const comparisons = entries.map(entry=> {
    const differences:Difference[]=[];
    const expectedTables=new Map(entry.schema.map((table:any)=>[table.name,table]));
    const actualTables=new Map(actual.map((table:any)=>[table.name,table]));
    for(const table of [...new Set([...expectedTables.keys(),...actualTables.keys()])].sort()) {
      compare(expectedTables.get(table),actualTables.get(table),`public.${name(table)}`,differences);
    }
    return {version:entry.version,file:entry.file,exactSnapshotMatch:JSON.stringify(actual)===JSON.stringify(entry.schema),differenceCount:differences.length,differences};
  });
  const minimum=Math.min(...comparisons.map(c=>c.differenceCount));
  return {diagnosticOnly:true,strings:'sha256 only; never SQL expressions or row contents',
    fieldLegend:{columns:['name','type','notNull','default','identity','generated'],constraints:['name','definition','validated'],indexes:['name','definition','valid']},
    comparisons:comparisons.map(({differences,...rest})=>({...rest,
      // Similarity is a debugging aid, never permission to baseline.
      ...((rest.differenceCount===minimum || rest.version===entries.at(-1)?.version)
        ? {differences:differences.slice(0,80),truncated:differences.length>80} : {})}))};
}
