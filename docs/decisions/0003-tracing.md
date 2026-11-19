# 0003 Tracing over a device graph

Status: accepted (M1)

## Decision

- `buildGraph(model)` builds one graphology `MultiDirectedGraph` over every floor. Nodes are devices. Edges are connections (from the source port's device to the load port's device) plus a `contains` edge from each container to every device in its slots.
- `trace(graph, start, { direction, domain, kinds })` walks breadth-first, following only edges of the given domain and kinds. Upstream follows edges backwards, downstream forwards. A plugin's `traceKinds` lists the kinds that conduct; power lists `circuit`, `feeder` and `contains`, so control links (switch → light) are not followed but can be read with `directlyConnected`.
- Devices whose ports do not all conduct to each other (a patch panel's front port 5 only reaches back port 5) declare `portLinks` on their device type. The trace then remembers which port it entered through and only leaves through linked ports. Devices without `portLinks` join all their ports.

## Why the walk is custom

graphology-traversal's BFS cannot filter edges by attribute or carry the entry port, which `portLinks` needs. The walk is about 40 lines on top of graphology's adjacency iteration and is covered by tests; graphology still owns storage and adjacency.

## Why portLinks now

The network plugin (M14) must not need core changes. Port-level pass-through is the one thing network tracing needs that power tracing does not, so the hook exists from M1 and is tested with a stand-in patch panel.

## Keeping the graph current

The graph and the model index are updated incrementally from the Immer patches every edit already produces:

- `deltaFromPatches` lists the devices and connections a set of patches touched.
- `applyEdit` and `applyModelPatches` (for undo, redo and remote changes) carry the cached `ModelIndex` forward to the new model and update only the touched entries. The previous model loses its cache entry and rebuilds its index if it is asked for again, so old models stay correct.
- `LiveGraph.update(next, patches)` drops and re-adds the touched devices (with their containment and connection edges) and the touched connections. Patches that replace a whole floor or collection fall back to a full rebuild.
- The web store deep-freezes a model when it is loaded, so Immer's one-time freeze of the whole tree does not land on the first edit.

A randomised test applies 150 mixed edits, undos and cascading removals to the medium project and checks that the incremental index and graph equal a full rebuild.

## Performance

`pnpm perf` on the large synthetic project (8,006 devices): opening (parse, validate, freeze, index, graph) about 200 ms; selecting a circuit under 0.1 ms; an edit including index and graph update about 4 ms at p95 (previously about 77 ms with full rebuilds).
