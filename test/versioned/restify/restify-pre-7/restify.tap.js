/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const tap = require('tap')
const request = require('request')
const helper = require('../../../lib/agent_helper')
const { assertMetrics } = require('../../../lib/metrics_helper')

const METRIC = 'WebTransaction/Restify/GET//hello/:name'

tap.test('Restify', (t) => {
  t.autoend()

  let agent = null
  let restify = null
  t.beforeEach(() => {
    agent = helper.instrumentMockedAgent()

    restify = require('restify')
  })

  t.afterEach(() => {
    helper.unloadAgent(agent)
  })

  t.test('should not crash when handling a connection', function (t) {
    t.plan(7)

    const server = restify.createServer()
    t.teardown(() => server.close())

    server.get('/hello/:name', function sayHello(req, res) {
      t.ok(agent.getTransaction(), 'transaction should be available in handler')
      res.send('hello ' + req.params.name)
    })

    server.listen(0, function () {
      const port = server.address().port
      t.notOk(agent.getTransaction(), 'transaction should not leak into server')

      const url = `http://localhost:${port}/hello/friend`
      request.get(url, function (error, response, body) {
        if (error) {
          return t.fail(error)
        }
        t.notOk(agent.getTransaction(), 'transaction should not leak into external request')

        const metric = agent.metrics.getMetric(METRIC)
        t.ok(metric, 'request metrics should have been gathered')
        t.equal(metric.callCount, 1, 'handler should have been called')
        t.equal(body, '"hello friend"', 'should return expected data')

        const isFramework = agent.environment.get('Framework').indexOf('Restify') > -1
        t.ok(isFramework, 'should indicate that restify is a framework')
      })
    })
  })

  t.test('should still be instrumented when run with SSL', function (t) {
    t.plan(7)

    helper
      .withSSL()
      .then(([key, certificate, ca]) => {
        const server = restify.createServer({ key: key, certificate: certificate })
        t.teardown(() => server.close())

        server.get('/hello/:name', function sayHello(req, res) {
          t.ok(agent.getTransaction(), 'transaction should be available in handler')
          res.send('hello ' + req.params.name)
        })

        server.listen(0, function () {
          const port = server.address().port
          t.notOk(agent.getTransaction(), 'transaction should not leak into server')

          const opts = { url: `https://${helper.SSL_HOST}:${port}/hello/friend`, ca }
          request.get(opts, function (error, response, body) {
            if (error) {
              t.fail(error)
              return t.end()
            }

            t.notOk(agent.getTransaction(), 'transaction should not leak into external request')

            const metric = agent.metrics.getMetric(METRIC)
            t.ok(metric, 'request metrics should have been gathered')
            t.equal(metric.callCount, 1, 'handler should have been called')
            t.equal(body, '"hello friend"', 'should return expected data')

            const isFramework = agent.environment.get('Framework').indexOf('Restify') > -1
            t.ok(isFramework, 'should indicate that restify is a framework')
          })
        })
      })
      .catch((error) => {
        t.fail('unable to set up SSL: ' + error)
        t.end()
      })
  })

  t.test('should generate middleware metrics', (t) => {
    // Metrics for this transaction with the right name.
    const expectedMiddlewareMetrics = [
      [{ name: 'WebTransaction/Restify/GET//foo/:bar' }],
      [{ name: 'WebTransactionTotalTime/Restify/GET//foo/:bar' }],
      [{ name: 'Apdex/Restify/GET//foo/:bar' }],

      // Unscoped middleware metrics.
      [{ name: 'Nodejs/Middleware/Restify/middleware//' }],
      [{ name: 'Nodejs/Middleware/Restify/middleware2//' }],
      [{ name: 'Nodejs/Middleware/Restify/handler//foo/:bar' }],

      // Scoped middleware metrics.
      [
        {
          name: 'Nodejs/Middleware/Restify/middleware//',
          scope: 'WebTransaction/Restify/GET//foo/:bar'
        }
      ],
      [
        {
          name: 'Nodejs/Middleware/Restify/middleware2//',
          scope: 'WebTransaction/Restify/GET//foo/:bar'
        }
      ],
      [
        {
          name: 'Nodejs/Middleware/Restify/handler//foo/:bar',
          scope: 'WebTransaction/Restify/GET//foo/:bar'
        }
      ]
    ]

    const server = restify.createServer()
    t.teardown(() => server.close())

    server.use(function middleware(req, res, next) {
      t.ok(agent.getTransaction(), 'should be in transaction context')
      next()
    })

    server.use(function middleware2(req, res, next) {
      t.ok(agent.getTransaction(), 'should be in transaction context')
      next()
    })

    server.get('/foo/:bar', function handler(req, res, next) {
      t.ok(agent.getTransaction(), 'should be in transaction context')
      res.send({ message: 'done' })
      next()
    })

    server.listen(0, function () {
      const port = server.address().port
      const url = `http://localhost:${port}/foo/bar`

      request.get(url, function (error) {
        t.error(error)

        assertMetrics(agent.metrics, expectedMiddlewareMetrics, false, false)
        t.end()
      })
    })
  })
})
