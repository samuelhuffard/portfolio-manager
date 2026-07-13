# Knowledge graph

The live structural interface is graphify, not Notion.

- Local artifact: `graphify-out/graph.html` (self-contained visual graph; gitignored)
- Report: `graphify-out/GRAPH_REPORT.md`
- Current indexed scope: 205 code files, 46 curated documents, 1,642 nodes, 3,501 edges, and 106 labeled communities (2026-07-12 build)
- Useful commands from the repository root:
  - `graphify query "what enforces that only the owning strategy can sell its lots?"`
  - `graphify path A B`
  - `graphify explain "Node"`
  - `graphify --update` after a substantial session

The graph intentionally excludes archived spend-cap and duplicate log-cluster findings so it reflects system structure rather than sysloop noise. Link or embed the local visual only when it is published to an access-controlled location; do not upload private runtime artifacts or secrets.
