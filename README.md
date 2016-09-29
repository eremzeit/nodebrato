
differences:
-- supports registering metric definitions which allow greater control over how each individual metric is aggregated and collected
  -- reporting intervals can be defined on a per-metric basis
    -- allows you to save money by allowing high resolution reporting only when needed
  -- allows you to define separate client-side aggregation functions and librato-side aggregation functions
    -- which allows you to more carefully control how the data is visualized
-- `librato-node` aggregates all measurements inline.  This is faster and requires a smaller footprint but results in less flexability.
-- This library stores all data-points and aggregates at submission time, which gives the ability to specify the reporting source
   on a per-measurement basis.
-- `librato-node` is written in coffeescript, which has fewer fans these days.
-- Supports publishing annotations
