import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendCsv, csvLine, csvRecords, parseCsv } from '../csv.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'el-karta-csv-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseCsv', () => {
  it('reads back what csvLine writes, including quotes, commas and newlines', () => {
    const values = ['a', 'b,c', 'say "hi"', 'two\nlines', '', 1.5];
    const text = csvLine(values) + csvLine(['x']);
    expect(parseCsv(text)).toEqual([['a', 'b,c', 'say "hi"', 'two\nlines', '', '1.5'], ['x']]);
  });

  it('accepts CRLF and a missing final newline', () => {
    expect(parseCsv('a,b\r\nc,')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
  });
});

describe('csvRecords', () => {
  it('keys rows by the header and fills cells a short row lacks', () => {
    expect(csvRecords('a,b,c\n1,2\n')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});

describe('appendCsv', () => {
  it('writes the header once, then appends', async () => {
    const path = join(dir, 'sub', 'r.csv');
    await appendCsv(path, ['a', 'b'], [{ a: 1 }]);
    await appendCsv(path, ['a', 'b'], [{ b: 'x' }]);
    expect(await readFile(path, 'utf8')).toBe('a,b\n1,\n,x\n');
  });

  it('rewrites a file once when columns are added, keeping old rows under their names', async () => {
    const path = join(dir, 'r.csv');
    await writeFile(path, 'a,c\n1,"x,y"\n');
    await appendCsv(path, ['a', 'b', 'c'], [{ a: 2, b: 'new', c: 'z' }]);
    expect(await readFile(path, 'utf8')).toBe('a,b,c\n1,,"x,y"\n2,new,z\n');
    await appendCsv(path, ['a', 'b', 'c'], [{ a: 3 }]);
    expect(await readFile(path, 'utf8')).toBe('a,b,c\n1,,"x,y"\n2,new,z\n3,,\n');
  });

  it('refuses a file with a column it does not know', async () => {
    const path = join(dir, 'r.csv');
    await writeFile(path, 'a,gone\n1,2\n');
    await expect(appendCsv(path, ['a', 'b'], [{ a: 1 }])).rejects.toThrow(/other columns/);
    expect(await readFile(path, 'utf8')).toBe('a,gone\n1,2\n');
  });
});
