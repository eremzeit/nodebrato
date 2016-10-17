'use strict'

const EventEmitter = require('events')
const SimpleStats = require('simple-statistics')
const request = require('request')
const Q = require('q')
const _ = require('underscore')

const libratoAggegationFunctions = ['average', 'sum', 'count', 'min', 'max']
const clientAggegationFunctions = ['mean', 'median', 'sum', 'min', 'max', 'quantiles', 'std_dev']

class Librato {
  constructor(options) {
    EventEmitter.call(this)

    options = options || {}

    this.options = Object.assign({}, options, {
      source: options.source || process.env.NODE_ENV,
      definitions: options.definitions || {},
      periodMs: options.periodMs || 60000,
      logging: options.logging || false,
      loggingVerbose: options.loggingVerbose || false,
      libratoNamePrefix: options.libratoNamePrefix ? `${options.libratoNamePrefix}.` : '',
      blacklist: options.blacklist || []
    })

    if (!this.options.source) {
      throw new Error(`Must provide a source`)
    }

    if ((!this.options.email || !this.options.token) && !this.options.skipSubmit) {
      throw new Error(`Missing email or token: ${this.options}`)
    }

    // In the future we could make a better way to synchronize the reporting of the individual metrics
    // but for now just check in often if any of the metrics are ready for submitting.
    this.options.pollingIntervalMs = Math.max(this.options.periodMs / 20, 1000)

    this.definitions = this.options.definitions = this._processDefinitions(this.options.definitions)
    this.lastSubmittedAt = {}
    this.samples = {}
  }

  start() {
    this.intervalId = setInterval(() => {
      this._logVerbose('samples: ', _.chain(this.samples).values().map(x => _.values(x)).flatten(false).value().length)
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
    this.lastSubmittedAt = this.lastSubmittedAt || {}

    return _.chain(this.samples).keys()
      .filter((k) => {
        let def = this._getDefinition(k)

        if (this.lastSubmittedAt[k]) {
          let periodMs = def.periodMs || this.options.periodMs
          return (_.now() - this.lastSubmittedAt[k]) >= periodMs
        } else {
          return true
        }
      }).value()
  }

  gatherForLibratoSubmission(keys) {
    keys = keys || _.keys(this.samples)
    if (!_.isArray(keys)) keys = [keys]

    keys = _.intersection(keys, this.findReadyKeys())
    let byMetricBySource = this.aggregateKeys(keys)

    let gauges = _.reduce(_.keys(byMetricBySource), (acc, metricName) => {
      let bySource = byMetricBySource[metricName]
      let key = _.first(_.values(bySource)).key

      let def = this._getDefinition(key)

      let _gauges = _.reduce(_.keys(bySource), (acc, source) => {
        let metric = bySource[source]

        let fullMetricName = metric.metricName

        let item = {
          name: this._fullMetricName(metric.metricName),
          value: metric.value,
          source: source
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
    let toSubmit = this.gatherForLibratoSubmission()
    let now = _.now()

    if (this.lastSubmittedAt[k]) {
      let periodMs = def.periodMs || this.options.periodMs
      this.lastSubmittedAt[k] = this.lastSubmittedAt[k] + periodMs
    } else {
      this.lastSubmittedAt[k] = now
    }

    return this._submit(toSubmit.gauges).then((r)=> {
      return toSubmit
    }).finally(() => {
      _.each(toSubmit.keys, (k) => {
        let def = this._getDefinition(k)

      })

      this.clearKeys(toSubmit.keys)
    })
  }

  updateMetricDefinitions() {
    return updateMetricsToLibrato(this.options.email, this.options.token, allMetricProperties).then((res)=> {
      this._log(`Updated metrics: ${allMetricProperties.map(props => props.name)}`)
    }, (err) => {
      console.error(`Error while updating metrics: ${err.message}`)
    })
  }

  _gatherMetricPropertiesForLibrato(keys) {
    keys = keys || _.keys(this.definitions)

    return _.chain(keys)
      .map(key => this.definitions[key])
      .map(this._metricDefinitionToLibratoProperties.bind(this))
      .flatten(true).value()
  }

  _metricDefinitionToLibratoProperties(def) {
    let props = def.libratoMetricProperties || {}

    let metricProps
    if (_.isArray(def.quantiles)) {
      metricProps = _.map(def.quantiles, (q) =>  {
        return Object.assign({}, props, { name: this._metricNameForQuantile(def.key, q) })
      })
    } else {
      metricProps = [
        Object.assign({}, props, { name: def.key })
      ]
    }

    return _.map(metricProps, (props) => {

      let attributes = Object.assign({}, props.attributes || {}, {
        summarize_function : def.libratoAggFunction,
        aggregate: this.options.libratoServerSideAggregation || false
      })

      return Object.assign(props, {
        type : 'gauge', //we only support gauges now
        name : this._fullMetricName(props.name),
        period : Math.round(def.periodMs / 1000),
        attributes
      })
      return props
    })
  }

  _submit(gauges) {

    if (this.options.skipSubmit || gauges.length == 0) {
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

          this._log(`Submitted metrics ${gauges.map(g => g.name)}`)
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
    if (_.any(this.options.blacklist, pattern => key.match(pattern))) return

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
    return _.chain(definitions)
      .keys()
      .map((key) => {

        let def = Object.assign({}, definitions[key])

        if (def.type == 'counter') {
          def.clientAggFunction = 'sum'
          def.libratoAggFunction = 'sum'
        }

        def.libratoAggFunction = def.libratoAggFunction  || def.clientAggFunction
        def.clientAggFunction = def.clientAggFunction  || def.libratoAggFunction

        if (def.libratoAggFunction == 'mean') {
          def.libratoAggFunction = 'average'
        }

        def.key = key

        if (!def.periodMs) {
          def.periodMs = this.options.periodMs
        }

        return def
      }).tap((defs)=> {
        _.each(defs, (def) => {
          let error = this._definitionError(def)
          if (error) {

            console.error(def)
            throw new Error(error)
          }
        })
      }).reduce((acc, def) => {
        acc[def.key] = def
        return acc
      }, {}).value()
  }

  _definitionError(def) {
    if (!_.contains(libratoAggegationFunctions, def.libratoAggFunction)) {
      return `libratoAggFunction is invalid: ${def.libratoAggFunction}`
    }

    if (!_.contains(clientAggegationFunctions, def.clientAggFunction)) {
      return `clientAggFunction is invalid: ${def.clientAggFunction}`
    }

    return null
  }

  _fullMetricName(metricName) {
    return `${this.options.libratoNamePrefix}` + metricName
  }

  _metricNameForQuantile(key, quantile) {
    return `${key}.q${Math.round(quantile * 100)}`
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
        let metricName = this._metricNameForQuantile(definition.key, q)

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
    if (this.options.loggingVerbose) {
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

  let authHash = makeAuthHash(email, token)

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

  let authHash = makeAuthHash(email, token)

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

function makeAuthHash(email, token) {
  let majorVersion = parseInt(process.version.split('.')[0])
  if (majorVersion >= 6) {
    return Buffer.from(`${email}:${token}`).toString('base64')
  } else {
    return new Buffer(`${email}:${token}`).toString('base64')
  }
}

function libratoHeaders(email, token) {
  return {
    Authorization: 'Basic ' + makeAuthHash(email, token),
    'user-agent': `showgoers`
  }
}

function updateMetricsToLibrato(email, token, allMetricProperties) {
  return _.reduce(allMetricProperties, (q, props) => {
    q = q.then(updateMetricToLibrato(email, token, props)).delay(1000)
  }, Q(null))
}

function updateMetricToLibrato(email, token, metricProperties) {
  if (!attributes.name) {
    throw new Error('Librato metrics must have a name')
  }

  metricProperties = _.pick('name', 'period', 'description', 'display_name', 'attributes', 'source_lag')
  metricProperties.attributes = _.pick(metricProperties.attributes,
    'color', //hex string
    'display_max',
    'display_min',
    'display_units_long',
    'display_units_short',
    'display_stacked',
    'display_transform'
  )


  let d = Q.defer()

  let options = {
    method: 'POST',
    uri: `https://metrics-api.librato.com/v1/metrics/${attributes.name}`,
    headers: libratoHeaders(email, token),
    json: metricProperties
  }

  request.post(options, (err, res, body) => {
    let successCodes = [202, 204]

    if (err || res.statusCode >= 400) {
      d.reject(body)
    } else {
      if (!_.contains(acceptedCodes, res.statusCode)) {
        console.warn(`Expected status code in ${statusCodes.join(', ')}.  Got ${res.statusCode}`)
      }
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
function createAnnotation(email, token, libratoMetricName, attributes) {
  let options = {
    method: 'POST',
    uri: `https://metrics-api.librato.com/v1/annotations/${libratoMetricName}`,
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
