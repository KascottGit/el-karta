import { BUDGET_MS, measure } from '../test/perf.ts';

const f = (ms: number, digits = 1) => `${ms.toFixed(digits)} ms`;

for (const size of ['small', 'medium', 'large'] as const) {
  measure(size, 50);
  const r = measure(size);
  const budget = BUDGET_MS[size];
  console.log(
    `\n${size}: ${r.devices} devices, ${r.connections} graph edges, ${r.storedMegabytes.toFixed(1)} MB stored JSON`,
  );
  console.log(
    `  open      ${f(r.openMs.total)} (JSON ${f(r.openMs.parse)}, schema+migrate ${f(r.openMs.validateSchema)}, graph ${f(r.openMs.graph)})  budget ${budget.open} ms`,
  );
  console.log(
    `  select    p50 ${f(r.selectMs.p50, 3)}, p95 ${f(r.selectMs.p95, 3)}, max ${f(r.selectMs.max, 3)} over ${r.selectMs.samples} random devices  budget ${budget.select} ms`,
  );
  console.log(`  main panel downstream (whole building) ${f(r.panelDownstreamMs)}`);
  console.log(`  edit + reindex + rebuild graph ${f(r.rebuildAfterEditMs)}`);
}
