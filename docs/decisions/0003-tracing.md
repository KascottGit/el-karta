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

## Performance

The graph is rebuilt from the model after an edit (about 70 ms for the large synthetic project). Tracing itself is well under 1 ms. If edits in M3+ make rebuilds noticeable, update the graph incrementally from the edit's patches.
