'use strict'

const Librato = require('../src/librato')
const _ = require('underscore')
const expect = require('chai').expect
const Q = require('q')

let librato

let metricDefinitions = {
  'foo_max': {
    clientAggFunction: 'max',
  },

  'foo_sum': {
    clientAggFunction: 'sum',
  },

  'foo_mean': {
    clientAggFunction: 'mean',
    libratoAggFunction: 'sum',
    libratoOptions: {
      type: 'measurement',
      display_name: '',
      description: '',
      attributes: {

      }
    }
  },

  'foo_median': {
    clientAggFunction: 'median',
    libratoAggFunction: 'max',
  },

  'foo_std_dev': {
    clientAggFunction: 'std_dev',
    libratoAggFunction: 'max',
  },

  'foo_quantiles': {
    clientAggFunction: 'quantiles',
    libratoAggFunction: 'min',
    quantiles: [0, .5, 1],
    periodMs: 50000
  }
}

let expectSetsEqual = (arr1, arr2) => {
  let equal = _.intersection(arr1, arr2).length == arr1.length && _.difference(arr1, arr2).length == 0
  expect(equal).to.equal(true)
}

describe('.submitMetrics', function() {
  beforeEach(function() {
    librato = new Librato({source: 'my_source', skipSubmit: true, definitions: metricDefinitions})
  })

  it('Correctly handles metrics across multiple submits', function(_done) {
    librato.increment('foo_sum', 2, 'bar')
    librato.increment('foo_sum', 5, 'bar')
    librato.measure('foo_mean', 5, 'bar')

    librato.submitMetrics().then((result)=> {
      let gauges = result.gauges
      expect(gauges.length).to.equal(2)
      expect(gauges.find(g => g.name == 'foo_sum').value).to.equal(7)
      expect(gauges.find(g => g.name == 'foo_mean').value).to.equal(5)
    }).then(()=> {
      expect(_.keys(librato.samples).length).to.equal(0)

      librato.lastSubmittedAt = null //clear the timings
      librato.increment('foo_sum', 2, 'bar')
      librato.increment('foo_sum', 1, 'bar')
      librato.measure('foo_mean', 6, 'bar')
      return librato.submitMetrics()
    }).then((result) => {
      let gauges = result.gauges
      expect(gauges.length).to.equal(2)
      expect(gauges.find(g => g.name == 'foo_sum').value).to.equal(3)
      expect(gauges.find(g => g.name == 'foo_mean').value).to.equal(6)
      _done()
    }).done()
  })
})

describe('.aggregateSamples', function() {
  beforeEach(function() {
    librato = new Librato({source: 'my_source', skipSubmit: true, definitions: metricDefinitions})
  })

  describe('when theres no samples', function() {

    it('returns returns an empty object', function() {
      let r = librato.aggregateAll()
      expect(r).to.be.empty
    })
  })

  describe('aggregation method tests', function() {
    describe('sum', function() {
      it('calculates the sum', function() {
        librato.increment('foo_sum', 2, 'bar')
        librato.increment('foo_sum', 3, 'baz')

        let r = librato.aggregateAll()
        expect(r.foo_sum.bar.value).to.equal(2)
        expect(r.foo_sum.baz.value).to.equal(3)
      })
    })

    describe('mean', function() {
      it('calculates the mean', function() {
        librato.measure('foo_mean', 2, 'bar')
        librato.measure('foo_mean', 4, 'bar')

        let r = librato.aggregateAll()
        expect(r.foo_mean.bar.value).to.equal(3)
      })
    })

    describe('median', function() {
      it('calculates the median', function() {
        librato.measure('foo_median', 2, 'bar')
        librato.measure('foo_median', 5, 'bar')
        librato.measure('foo_median', 3, 'bar')

        let r = librato.aggregateAll()
        expect(r.foo_median.bar.value).to.equal(3)
        expect(r.foo_median.bar.options.libratoAggFunction).to.equal('max')
      })
    })

    describe('max', function() {
      it('calculates the max', function() {
        librato.measure('foo_max', 2)
        librato.measure('foo_max', 5)
        librato.measure('foo_max', 3)

        let r = librato.aggregateAll()
        expect(r.foo_max.my_source.value).to.equal(5)
      })
    })

    describe('max', function() {
      it('calculates the std dev', function() {
        librato.measure('foo_std_dev', 1, 'bar')
        librato.measure('foo_std_dev', 2, 'bar')
        librato.measure('foo_std_dev', 3, 'bar')

        let r = librato.aggregateAll()
        expect(r.foo_std_dev.bar.value - .816 < .01).to.equal(true)
      })
    })

    describe('quantiles', function() {
      it('calculates the quantiles', function() {
        for (var i = 0; i <= 100; ++i) {
          librato.measure('foo_quantiles', i, 'bar')
        }

        let r = librato.aggregateAll()
        expect(r['foo_quantiles.q0'].bar.value).to.equal(0)
        expect(r['foo_quantiles.q50'].bar.value).to.equal(50)
        expect(r['foo_quantiles.q100'].bar.value).to.equal(100)
      })
    })
  })
})

describe('.findReadyKeys', function() {
  beforeEach(function() {
    librato = new Librato({source: 'test', skipSubmit: true, definitions: metricDefinitions})
    librato.increment('foo_sum', 2, 'bar')
    librato.measure('foo_mean', 3, 'baz')
  })

  describe('when none have been submitted', function() {
    it('returns array of all keys', function() {
      let keys = librato.findReadyKeys()
      expectSetsEqual(keys, ['foo_sum', 'foo_mean'])
    })
  })

  describe('when one key isnt ready', function() {
    it('returns array of ready keys', function() {
      librato.lastSubmittedAt.foo_sum = _.now() - 1
      let keys = librato.findReadyKeys()
      expectSetsEqual(keys, ['foo_mean'])
    })
  })

  describe('when no keys are ready', function() {
    it('returns an empty array', function() {
      librato.lastSubmittedAt.foo_sum = _.now() - 1
      librato.lastSubmittedAt.foo_mean = _.now() - 1
      let keys = librato.findReadyKeys()
      expect(keys).to.be.instanceOf(Array)
      expect(keys).to.be.empty
    })
  })
})

describe('.clearKeys', function() {
  beforeEach(function() {
    librato = new Librato({source: 'test', skipSubmit: true, definitions: metricDefinitions})
    librato.increment('foo_sum', 2, 'bar')
    librato.measure('foo_mean', 3, 'baz')
    librato.clearKeys(['foo_sum'])
  })

  it('clears the keys specified', function() {
    let metrics = librato.aggregateAll()
    expect(_.keys(metrics)).to.deep.equal(['foo_mean'])
  })
})

describe('._gatherMetricPropertiesForLibrato', function() {
  beforeEach(function() {
    librato = new Librato({
      source: 'test',
      skipSubmit: true,
      definitions: metricDefinitions,
      libratoNamePrefix: 'prefix',
      periodMs: 20000
    })
  })

  it('creates a list of metric properties', function() {
    let allProps = librato._gatherMetricPropertiesForLibrato(['foo_sum'])
    let props = _.first(allProps)

    expect(props.name).to.equal('prefix.foo_sum')
    expect(props.period).to.equal(20)
    expect(props.attributes.summarize_function).to.equal('sum')
    expect(props.attributes.aggregate).to.equal(false)
  })

  it('correctly handles quantiles', function() {
    let allProps = librato._gatherMetricPropertiesForLibrato(['foo_quantiles'])

    expect(allProps.length).to.equal(3)

    expect(allProps[0].name).to.equal('prefix.foo_quantiles.q0')
    expect(allProps[1].name).to.equal('prefix.foo_quantiles.q50')
    expect(allProps[2].name).to.equal('prefix.foo_quantiles.q100')

    _.each(allProps, (props) => {
      expect(props.attributes.summarize_function).to.equal('min')
      expect(props.attributes.aggregate).to.equal(false)
      expect(props.period).to.equal(50)
    })
  })
})

describe('._gatherForSubmission', function() {
  beforeEach(function() {
    librato = new Librato({source: 'test', skipSubmit: true, definitions: metricDefinitions})
    librato.increment('foo_sum', 2, 'bar')
    librato.increment('foo_sum', 3, 'baz')
    librato.measure('foo_max', 3, 'baz')
    librato.measure('foo_quantiles', 5, 'baz')
    librato.measure('foo_mean', 3, 'baz')
  })

  it('creates an array for submission', function() {
    let metrics = librato.gatherForLibratoSubmission(['foo_mean', 'foo_max', 'foo_quantiles'])
    expectSetsEqual(metrics.keys, ['foo_mean', 'foo_max', 'foo_quantiles'])
    expect(metrics.gauges).to.deep.equal([
      { name: 'foo_mean', value: 3, source: 'baz' },
      { name: 'foo_max', value: 3, source: 'baz' },
      { name: 'foo_quantiles.q0', value: 5, source: 'baz' },
      { name: 'foo_quantiles.q50', value: 5, source: 'baz' },
      { name: 'foo_quantiles.q100', value: 5, source: 'baz' }
    ])
  })
})
