
# Nodebrato

A node.js bindings for Librato metrics that provides advanced statistics which allow you to reduce your reporting frequency and ultimately lower your montly Librato bill.

It was originally created for [http://showgoers.tv](Showgoers) but I forked it out of that codebase to open it up for community use and contributions.

## Features

- Supports pre-registering metric definitions
- Can update metric definitions automatically so that you don't have to do that manually in the librato interface. (edit: this feature hasn't quite been merged into master.  Pull-requests are welcome!)
- Gives more control over how each individual metric is collected, aggregated and submitted
  - Reporting intervals can be defined on a per-metric basis.  This can can save you money by allowing you to only report when you need to.
  - Supports defining separate client-side aggregation functions and librato-side aggregation functions
    - This lets you use aggregation functions that librato doesn't support (eg. advanced stastistics and *quantiles*)
    - By giving you more additional descriptive statistics, you can drastically increase your reporting period (less $$$) but still have a clear understanding of that stat.
    - It's also useful for librato power users who make heavy use of alerts and composite functions.
- Supports Librato graph annotations (eg. for marking deployments, etc)

### How is this different from `librato-node`?

- `librato-node` aggregates all measurements inline, which limits flexibility but is more suited for extremely high performance reporting.
- `librato-node` is written in Coffeescript.

## Example

```
let metricDefinitions = {
  'errors': {
    libratoAggFunction: 'sum',
    periodMs: 10000 //perhaps we want errors reported at a higher resolution than other metrics
  },

  'star_rating': {
    libratoAggFunction: 'average',
  },

  'web_requests': {
    clientAggFunction: 'sum',
    libratoAggFunction: 'average',
    libratoMetricProperties: {
      display_name: 'Site Requests',
      description: 'The number of requests made to the web server',
      attributes: {
        color: '#ff0000'
      }
    },
  },

  'response_time_ms': {
    clientAggFunction: 'quantiles',
    libratoAggFunction: 'min',
    quantiles: [0, .1, .90, 1], //when submitted to librato, will actually create 4 separate metrics (ie. response_time_ms.q0, response_time_ms.q10, response_time_ms.q90, response_time_ms.q100)
    periodMs: 30 * 60 * 1000  //because we're intelligently aggregating, we only need to report every thirty minutes
  }
}

let librato = new Librato({
  source: 'my_default_source',
  definitions: metricDefinitions,
  logging: true, //turn on debug output to console
  periodMs: 10000
})

librato.start()

librato.increment('requests', 10)
librato.measure('response_time_ms', 1)
librato.measure('star_rating', 5)
librato.measure('star_rating', 4, 'another_source')

librato.measure('not_defined_metric', 1)  //when using the measure method will default to "mean" as an aggregation function
librato.increment('not_defined_count', 1)  //when using the increment method will default to "sum" as an aggregation function

```
