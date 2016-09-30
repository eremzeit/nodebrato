'use strict'

const EventEmitter = require('events')
const SimpleStats = require('simple-statistics')
const request = require('request')
const Q = require('q')
const _ = require('underscore')


class Librato {
  constructor(options) {
    EventEmitter.call(this)

    options = options || {}

    this.options = Object.assign({}, options, {
      source: options.source || process.env.NODEJS_ENV,
      definitions: options.definitions || {},
      periodMs: options.periodMs || 60000,
      logging: options.logging || false
    })

    // In the future we could make a better way to synchronize the reporting of the individual metrics
    // but for now just check in often if any of the metrics are ready for submitting.
    this.options.pollingIntervalMs = Math.max(this.options.periodMs / 20, 1000)

    this.definitions = this.options.definitions = this._processDefinitions(this.options.definitions)
    this.lastSubmittedAt = {}
    this.samples = {}
  }

  start() {
    this.intervalId = setInterval(() => {
      this.submitMetrics()
    }, this.options.pollingIntervalMs)
  }

  stop() {
    clearInterval(this.intervalId)
  }

  clearKeys(keys) {
    if (!_.isArray(keys)) keys = [keys]

    this.samples = _.omit(this.samples, keys)
  }

  findReadyKeys() {
    return _.keys(this.samples).filter((k) => {
      let def = this._getDefinition(k)
      return !this.lastSubmittedAt[k] || (_.now() - this.lastSubmittedAt[k]) >= def.periodMs
    })
  }

  gatherForLibratoSubmission(keys) {
    if (!keys) keys = _.keys(this.samples)
    if (!_.isArray(keys)) keys = [keys]

    keys = _.intersection(keys, this.findReadyKeys())
    let byMetricBySource = this.aggregateKeys(keys)

    let gauges = _.reduce(_.keys(byMetricBySource), (acc, metricName) => {
      let bySource = byMetricBySource[metricName]
      let key = _.first(_.values(bySource)).key

      let def = this._getDefinition(key)

      let _gauges = _.reduce(_.keys(bySource), (acc, source) => {
        let metric = bySource[source]

        let item = {
          name: metric.metricName,
          value: metric.value,
          source: source,
        }

        acc.push(item)

        return acc
      }, [])

      return acc.concat(_gauges)
    }, [])

    return {
      keys,
      metricNames: gauges.map(g => g.name),
      gauges
    }
  }

  submitMetrics() {
    let result = this.gatherForLibratoSubmission()
    let now = _.now()

    return this._submit(result.gauges).finally(() => {
      _.each(result.keys, (k) => {
        let def = this._getDefinition(k)

        if (this.lastSubmittedAt[k]) {
          this.lastSubmittedAt[k] = this.lastSubmittedAt[k] + def.periodMs
        } else {
          this.lastSubmittedAt[k] = now
        }
      })

      this.clearKeys(result.keys)
    })
  }

  _submit(gauges) {
    this._log('Submitting gauges', gauges.map(g=>g.name))

    if (this.skipSubmit) {
      return Q(null)
    } else {
      return postGaugesToLibrato(this.options.email, this.options.token, gauges).then((response) => {
        let s

        if (response) {
          s = "Response: "
          if (typeof(response) == 'object') {
            s += JSON.stringify(response)
          } else {
            s += response
          }

          this._logVerbose(response)
          this._log(`Submitted metrics ${result.metricNames}`)
        }
      }).fail((err) => {
        console.error('Error')

        var s
        if (err.errors && err.errors.params) {
          s = JSON.stringify(err.errors.params)
        } else if(err.message){
          s = err.message
          s += err.stack
        } else {
          s = JSON.stringify(err)
        }

        s = 'Submission error: ' + s

        console.log(s)
      })
    }
  }

  _record(key, value, source) {
    source = source || this._getDefinition(key).source || this.options.source

    this.samples[key] = this.samples[key] || {}
    this.samples[key][source] = this.samples[key][source] || []

    //this._log(`Sample ${key} ${value}`)

    this.samples[key][source].push({
      key,
      value,
      collectedAt: new Date()
    })
  }

  measure(key, value, source) {
    if (!this.definitions[key]) {
      this.definitions[key] = {
        key,
        clientAggFunction: 'mean'
      }
    }

    this._record(key, value, source)
  }

  increment(key, value, source) {
    let def = this.definitions[key]
    if (!def) {
      def = this.definitions[key] = {
        key,
        clientAggFunction: 'sum'
      }
    }

    if (def.clientAggFunction !== 'sum') {
      throw new Error(`attempted to increment metric '${key}' with agg function ${def.clientAggFunction}`)
    }

    this._record(key, value || 1, source)
  }

  aggregateAll() {
    return this.aggregateKeys(_.keys(this.samples))
  }

  aggregateKeys(keys) {
    if (!_.isArray(keys)) keys = [keys]
    //result in the form:
    //{
    //    metricName: {
    //      source : {
    //       metricName: <name>
    //       value: <val>,
    //       options: <options>
    //      }
    //      <...>
    //   }
    //   <...>
    //}

    keys = _.intersection(keys, _.keys(this.samples))

    return _.reduce(keys, (byMetricBySource, key) => {
      let samplesBySource = this.samples[key]

      _.each(_.keys(samplesBySource), (source) => {
        let def = this._getDefinition(key)

        let samplesForSource = samplesBySource[source]

        let aggResults = this._aggregateSamples(samplesForSource, def)

        _.each(aggResults, (result) => {
          let metricName = result.metricName

          byMetricBySource[metricName] = byMetricBySource[metricName] || {}
          byMetricBySource[metricName][source] = result
        })
      })

      return byMetricBySource
    }, {})
  }

  _getDefinition(key) {
    let def = this.definitions[key]

    if (!def) {
      def = this._getDefaultDefinition()
      def.key = key
    }

    return def
  }

  _processDefinitions(definitions) {
    return _.reduce(_.keys(definitions), (acc, key) => {
      let def = Object.assign({}, definitions[key])

      if (def.type == 'counter') {
        def.clientAggFunction = 'sum'
        def.libratoAggFunction = 'sum'
      }

      def.libratoAggFunction = def.libratoAggFunction  || def.clientAggFunction
      def.clientAggFunction = def.clientAggFunction  || def.libratoAggFunction
      def.key = key

      if (!def.periodMs) {
        def.periodMs = this.options.periodMs
      }

      acc[key] = def

      return acc
    }, {})
  }

  _aggregateSamples(samples, definition) {
    if (samples.length == 0) return []

    let r = {}
    let options = Object.assign({}, definition)
    let aggFn = this._getClientAggFunction(definition.clientAggFunction)

    let sampleValues = samples.map(s => s.value)

    let metrics = []
    if (definition.clientAggFunction == 'quantiles') {
      let quantiles = definition.quantiles || [0, .25, .50, .75, 1]

      let values = aggFn(sampleValues, quantiles)

      _.each(quantiles, (q, i) => {
        let metricName = `${definition.key}.q${Math.round(q * 100)}`

        metrics.push({
          metricName,
          value: values[i],
          options
        })
      })
    } else {
      metrics.push({
        metricName: definition.key,
        value : aggFn(sampleValues),
        options
      })
    }

    return metrics
  }

  _getClientAggFunction(fnKey, options) {
    switch (fnKey) {
      case 'sum':
        return SimpleStats.sum
      case 'mean':
        return SimpleStats.mean
      case 'median':
        return SimpleStats.median
      case 'max':
        return SimpleStats.max
      case 'min':
        return SimpleStats.min
      case 'quantiles':
        return SimpleStats.quantile
      case 'std_dev':
        return SimpleStats.standardDeviation
      default:

    }
  }

  _getDefaultDefinition() {
    if (this.definitions.__default) {
      return this.definitions.__default
    } else {
      return {
        clientAggFunction: 'mean',
      }
    }
  }

  _logVerbose() {
    if (this.options.logVerbose) {
      console.log.apply(null, (['librato: '].concat(Array.prototype.slice.call(arguments))))
    }
  }

  _log() {
    if (this.options.logging) {
      console.log.apply(null, (['librato: '].concat(Array.prototype.slice.call(arguments))))
    }
  }
}

function postGaugesToLibrato(email, token, gauges) {
  if (!gauges.length) {
    return Q(null)
  }

  let d = Q.defer()

  let authHash = Buffer.from(`${email}:${token}`).toString('base64')

  let options = {
    method: 'POST',
    uri: 'https://metrics-api.librato.com/v1/metrics',
    headers: {
      Authorization: 'Basic ' + authHash,
      'user-agent': `showgoers`
    },
    json: {gauges}
  }

  request.post(options, (err, res, body) => {
    if (err || res.statusCode >= 400) {
      d.reject(body)
    } else {
      d.resolve(res)
    }
  })

  return d.promise
}

function updateMetricsToLibrato(email, token, gauges) {
  if (!gauges.length) {
    return Q(null)
  }

  let d = Q.defer()

  let authHash = Buffer.from(`${email}:${token}`).toString('base64')

  let options = {
    method: 'POST',
    uri: 'https://metrics-api.librato.com/v1/metrics',
    headers: {
      Authorization: 'Basic ' + authHash,
      'user-agent': `showgoers`
    },
    json: {gauges}
  }

  request.post(options, (err, res, body) => {
    if (err || res.statusCode >= 400) {
      d.reject(body)
    } else {
      d.resolve(res)
    }
  })

  return d.promise
}

function authHash(email, token) {
  return Buffer.from(`${email}:${token}`).toString('base64')
}

function libratoHeaders(email, token) {
  return {
    Authorization: 'Basic ' + authHash(email, token),
    'user-agent': `showgoers`
  }
}

function updateMetricsToLibrato(email, token, attributes) {
  if (!attributes.name) {
    throw new Error('Librato metrics must have a name')
  }

  let d = Q.defer()

  let options = {
    method: 'POST',
    uri: `https://metrics-api.librato.com/v1/metrics/${attributes.name}`,
    headers: libratoHeaders(email, token),
    json: attributes
  }

  request.post(options, (err, res, body) => {
    if (err || res.statusCode >= 400) {
      d.reject(body)
    } else {
      d.resolve(res)
    }
  })

  return d.promise
}


/*
 * attributes - Should be in the form of...
 * {
 *   "title": "My Annotation",
 *   "description": "Joe deployed v29 to metrics",
 *   "source": null,
 *   "start_time": 1234567890,
 *   "end_time": null,
 *   "links": [  ]
 * }
 */
function createAnnotation(email, token, metricName, attributes) {
  let options = {
    method: 'POST',
    uri: `https://metrics-api.librato.com/v1/annotations/${metricName}`,
    headers: libratoHeaders(email, token),
    json: attributes
  }

  request.post(options, (err, res, body) => {
    if (err || res.statusCode >= 400) {
      d.reject(body)
    } else {
      d.resolve(res)
    }
  })
}

module.exports = Librato
