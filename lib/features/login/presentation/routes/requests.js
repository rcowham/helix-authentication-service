//
// Copyright 2020 Perforce Software
//
const express = require('express')
const router = express.Router()
const container = require('@lib/container')
const server = require('@lib/server')

const logger = container.resolve('logger')
const findRequest = container.resolve('findRequest')
const findUserProfile = container.resolve('findUserProfile')
const receiveUserProfile = container.resolve('receiveUserProfile')
const startRequest = container.resolve('startRequest')
const serviceURI = server.getServiceURI(process.env)

// How long to wait (in ms) for user details before returning 408.
const requestTimeout = (parseInt(process.env.LOGIN_TIMEOUT) || 60) * 1000

// :userId is an arbitrary user identifier decided by the client
//
// eslint-disable-next-line no-unused-vars
router.get('/new/:userId', (req, res, next) => {
  // Start the login request for the associated "user" identifier.
  const userId = req.params.userId
  const forceAuthn = Boolean(req.query.forceAuthn || process.env.FORCE_AUTHN || false)
  const request = startRequest(userId, forceAuthn)
  logger.debug('requests: new request %s for %s', request.id, userId)
  // Assemble a default login URL as a convenience for the client.
  const protocol = process.env.DEFAULT_PROTOCOL || 'saml'
  const instanceId = process.env.INSTANCE_ID || 'none'
  const loginUrl = `${serviceURI}/${protocol}/login/${request.id}?instanceId=${instanceId}`
  res.json({
    request: request.id,
    loginUrl,
    baseUrl: serviceURI,
    instanceId
  })
})

// **ONLY** expose this when running in a test environment.
if (process.env.NODE_ENV === 'automated_tests') {
  // For testing only, inserts a user profile into the cache.
  //
  // eslint-disable-next-line no-unused-vars
  router.post('/insert/:requestId', async (req, res, next) => {
    const request = await findRequest(req.params.requestId)
    if (request) {
      receiveUserProfile(request.userId, req.body)
      res.json({ status: 'ok' })
    } else {
      res.json({ status: 'error' })
    }
  })
}

// :requestId is the request identifier returned from /new/:userId
router.get('/status/:requestId', async (req, res, next) => {
  const cert = server.getClientCert(req)
  if (cert) {
    const subject = cert.subject && cert.subject.CN ? cert.subject.CN : '(none)'
    logger.debug('requests: received client cert with subject <<%s>>', subject)
  } else {
    logger.debug('requests: client did not send a client certificate')
  }
  // When the service is configured to use HTTPS, then require that the client
  // sends a valid client certificate for this request. Otherwise, we assume all
  // clients are authorized. This helps for testing, as well as when the service
  // is behind a proxy that terminates the SSL connection. When behind a proxy
  // that terminates the SSL connection, the service PROTOCOL will be 'http' and
  // as such cannot validate the client making the request. It will be necessary
  // for the proxy to perform that validation, if so desired.
  //
  // Why might the connection protocol appear to be 'https' when the service is
  // listening on an insecure protocol? Because Express.js will set the request
  // properties to reflect that of the proxy using the X-Forwarded-* headers.
  const authorized = server.isClientAuthorized(req, cert, process.env.CLIENT_CERT_CN)
  const isSecure = server.isSecure(process.env)
  if (!isSecure || authorized) {
    try {
      const requestId = req.params.requestId
      const user = await findUserProfile(requestId, requestTimeout)
      if (user) {
        logger.debug('requests: resolved user for %s (%s)', user.id, requestId)
        res.json(user.profile)
      } else {
        // no such request, move on to the next handler (a likely 404)
        next()
      }
    } catch (err) {
      res.status(408).send('Request Timeout')
    }
  } else if (cert && cert.subject) {
    const msg = `certificates for ${cert.subject.CN} from ${cert.issuer.CN} are not permitted`
    res.status(403).send(msg)
  } else {
    res.status(401).send('client certificate required')
  }
})

module.exports = router
