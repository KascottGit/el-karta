import { planCropBox } from '@el-karta/ai-passes';
import { createFakeProvider, ProviderError } from '@el-karta/ai-providers';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LightFacit, Manifest } from '../floorplan/facit.ts';
import { loadPlanImage } from '../floorplan/image.ts';
import { FLOORPLAN_COLUMNS, runFloorplanEval } from '../floorplan/run.ts';
import type { FloorplanScores } from '../floorplan/score.ts';
import { flat, locate } from './fixtures.ts';

/** A one-page A4 PDF (595 × 842 pt) with a rectangle on it, built by hand with a valid xref. */
function a4Pdf(): Buffer {
  const content = '0 0 0 RG 4 w 150 300 300 250 re S';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const facit: LightFacit = {
  id: 'tiny',
  level: 'light',
  checked: true,
  rotationDeg: 0,
  scale: { metresPerImageWidth: 21, evidence: ['ratio 1:100 on A4'] },
  totalArea: null,
  ceilingHeight: null,
  rooms: [
    { name: 'Vardagsrum', types: ['living_room'], area: null },
    { name: 'Sovrum', types: ['bedroom'], area: null },
    { name: 'Hall', types: ['hallway'], area: null },
  ],
  doors: 2,
};

const box = { xmin: 250, ymin: 350, xmax: 750, ymax: 650 };

let dir: string;
let manifestPath: string;
let resultsDir: string;

async function setUp(pdf: Buffer, sha = createHash('sha256').update(pdf).digest('hex')) {
  const manifest: Manifest = {
    imagesDir: 'images',
    plans: [{ id: 'tiny', file: 'tiny.pdf', page: 1, source: 'test', sha256: sha }],
  };
  await mkdir(join(dir, 'images'));
  await mkdir(join(dir, 'facit'));
  await writeFile(join(dir, 'images', 'tiny.pdf'), pdf);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(dir, 'facit', 'tiny.json'), JSON.stringify(facit));
}

const run = (replies: unknown[], mode: 'printed' | 'estimate' = 'printed') => {
  const provider = createFakeProvider(replies);
  const rows = runFloorplanEval({
    provider,
    model: 'fake-model',
    mode,
    manifestPath,
    facitDir: join(dir, 'facit'),
    resultsDir,
    now: () => new Date('2026-11-21T10:00:00Z'),
  });
  return { provider, rows };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'el-karta-evals-'));
  manifestPath = join(dir, 'manifest.json');
  resultsDir = join(dir, 'results');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const pngSize = (data: string) => {
  const png = Buffer.from(data, 'base64');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

describe('loadPlanImage', () => {
  it('renders a PDF page with its width in mm, and takes an image file at its own size', async () => {
    const pdfPath = join(dir, 'page.pdf');
    await writeFile(pdfPath, a4Pdf());
    const pdf = await loadPlanImage(pdfPath, 1);
    expect([pdf.width, pdf.height]).toEqual([2828, 4000]);
    expect(pdf.pdfPageWidthMm).toBeCloseTo(210, 1);

    const region = { x: 100, y: 200, width: 300, height: 400 };
    const pngPath = join(dir, 'page.png');
    await writeFile(pngPath, Buffer.from((await pdf.encode(region)).data, 'base64'));
    const image = await loadPlanImage(pngPath, 1);
    expect([image.width, image.height, image.pdfPageWidthMm]).toEqual([300, 400, undefined]);
    expect(pngSize((await image.encode({ x: 10, y: 20, width: 50, height: 60 })).data)).toEqual([
      50, 60,
    ]);
  });
});

describe('runFloorplanEval', () => {
  it('renders the PDF page like the app, runs the flow, scores it and appends a CSV row', async () => {
    await setUp(a4Pdf());
    const { provider, rows } = run([locate(box), flat()]);
    const [row] = await rows;

    // The page is rendered at the app's 4000 px long side, and the locate call sees all of it.
    const page = provider.calls[0]!.images[0]!;
    expect(page.mimeType).toBe('image/png');
    expect(pngSize(page.data)).toEqual([2828, 4000]);
    const crop = planCropBox(locate(box), { width: 2828, height: 4000 });
    expect(pngSize(provider.calls[1]!.images[0]!.data)).toEqual([crop.width, crop.height]);

    expect(row).toMatchObject({
      plan: 'tiny',
      model: 'fake-model',
      modelVersion: 'fake:fake-model',
      mode: 'printed',
      status: 'ok',
      scaleStatus: 'printed',
      roomsExpected: 3,
      roomsFound: 2,
      doorsExpected: 2,
      doorsFound: 2,
      typeAccuracy: 1,
      calls: 2,
      estimateWithin10: null,
    });
    expect(row!.nameMatch).toBeCloseTo(2 / 3);
    expect(row!.rotationErrorDeg as number).toBeCloseTo(0, 9);
    // "1:100" on the 210 mm (595.28 pt) wide PDF page: the whole image is 21 m wide.
    expect(row!.scaleError as number).toBeCloseTo(0, 4);

    const csv = (await readFile(join(resultsDir, 'floorplan.csv'), 'utf8')).trim().split('\n');
    expect(csv[0]).toBe(FLOORPLAN_COLUMNS.join(','));
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('2026-11-21T10:00:00.000Z,tiny,fake-model,fake:fake-model,printed,ok');

    const raw = await readdir(join(resultsDir, 'raw'));
    expect(raw).toEqual(['2026-11-21T10-00-00-000Z-tiny-fake-model-printed.json']);
    const saved = JSON.parse(await readFile(join(resultsDir, 'raw', raw[0]!), 'utf8')) as {
      tiles: { result: { output: unknown } }[];
    };
    expect(saved.tiles[0]!.result.output).toEqual(flat());
    expect(JSON.stringify(saved)).not.toContain(page.data.slice(0, 100));

    await run([locate(box), flat()]).rows;
    const twice = (await readFile(join(resultsDir, 'floorplan.csv'), 'utf8')).trim().split('\n');
    expect(twice).toHaveLength(3);
  });

  it('scores an estimate from standard objects in estimate mode', async () => {
    await setUp(a4Pdf());
    const crop = planCropBox(locate(box), { width: 2828, height: 4000 });
    // An interior door leaf (0.85 m) at the true scale of 21 m over 2828 px.
    const leaf = (0.85 / (21 / 2828) / crop.width) * 1000;
    const reply = flat({
      standardObjects: [
        { type: 'interior_door_leaf', a: { x: 600, y: 450 }, b: { x: 600 + leaf, y: 450 } },
      ],
    });
    const [row] = await run([locate(box), reply], 'estimate').rows;
    expect(row).toMatchObject({
      mode: 'estimate',
      scaleStatus: 'estimate',
      estimateWithin10: true,
    });
    expect(Math.abs(row!.scaleError as number)).toBeLessThan(0.01);
  });

  it('records a failed estimate-mode run as an estimate that missed', async () => {
    await setUp(a4Pdf());
    const [row] = await run([new ProviderError('error', 'boom')], 'estimate').rows;
    expect(row).toMatchObject({
      status: 'error',
      estimateWithin10: false,
      roomsExpected: 3,
      doorsExpected: 2,
    });
    expect(row!.roomsFound).toBeUndefined();
    const csv = (await readFile(join(resultsDir, 'floorplan.csv'), 'utf8')).trim().split('\n');
    const columns = FLOORPLAN_COLUMNS as readonly string[];
    expect(csv[1]!.split(',')[columns.indexOf('estimateWithin10')]).toBe('false');
  });

  it('refuses to run when a plan file does not match its checksum', async () => {
    await setUp(a4Pdf(), '0'.repeat(64));
    const { provider, rows } = run([locate(box), flat()]);
    await expect(rows).rejects.toThrow(/does not match its sha256/);
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses unknown plan ids', async () => {
    await setUp(a4Pdf());
    await expect(
      runFloorplanEval({
        provider: createFakeProvider([{}]),
        model: 'm',
        mode: 'printed',
        plans: ['nope'],
        manifestPath,
      }),
    ).rejects.toThrow('Unknown plans: nope');
  });

  it('has a CSV column for every score', () => {
    const scores: Record<keyof FloorplanScores, true> = {
      roomsExpected: true,
      roomsFound: true,
      nameMatch: true,
      typeAccuracy: true,
      doorsExpected: true,
      doorsFound: true,
      scaleError: true,
      estimateWithin10: true,
      rotationErrorDeg: true,
      roomAreaError: true,
      wallLengthError: true,
    };
    expect(FLOORPLAN_COLUMNS).toEqual(expect.arrayContaining(Object.keys(scores)));
  });
});
