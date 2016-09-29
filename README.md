
# Nodebrato

A node.js library for aggregating and submitting to Librato Metrics.

## Features

- Supports pre-registering metric definitions 
- Can metric definitions automatically so that you don't have to do that manually in the librato interface.
- Gives more control over how each individual metric is collected, aggregated and submitted
  - Reporting intervals can be defined on a per-metric basis, which can save you money
  - Define separate client-side aggregation functions and librato-side aggregation functions
- Implements additional client-side aggregation functions, such as quantiles
- Supports Librato graph annotations


### How is this different from `librato-node`?

- `librato-node` aggregates all measurements inline, which limits flexibility but is more suited for extremely high performance reporting.
- `librato-node` is written in coffeescript

## Metric Definitions

```

```

