
# Nodebrato

A node.js library for aggregating and submitting to Librato Metrics.

### How is this different from `librato-node`?

- Supports pre-registering metric definitions 
  - Allow greater control over how each individual metric is collected, aggregated and submitted
    - Reporting intervals can be defined on a per-metric basis, which can save you money
    - Define separate client-side aggregation functions and librato-side aggregation functions
- Supports more of the Librato API
  - Publishing graph annotations
  - Updating metric definitions automatically so that you don't have to do that manually in the librato interface.
- `librato-node` aggregates all measurements inline, which limits flexibility but is more suited for extremely high performance reporting.
- `librato-node` is written in coffeescript

