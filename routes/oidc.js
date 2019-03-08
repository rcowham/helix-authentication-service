//
// Copyright 2019 Perforce Software
//
const express = require('express')
const router = express.Router()
const passport = require('passport')
const { Issuer, Strategy } = require('openid-client')
const transitory = require('transitory')

// How long to wait (in ms) for user details before returning 408.
const requestTimeout = 60 * 1000

// Set up an in-memory cache of the user details; could have used
// github:isaacs/node-lru-cache but that lacks fine cache control, while
// github:aholstenson/transitory is a bit more sophisticated.
const userCache = transitory()
  .expireAfterWrite(60 * 60 * 1000)
  .expireAfterRead(5 * 60 * 1000)
  .build()
// Nonetheless, still need to prune stale entries occasionally.
setInterval(() => userCache.cleanUp(), 5 * 60 * 1000)

let client = null

Issuer.discover(process.env.OIDC_ISSUER_URI).then((issuer) => {
  // console.info(issuer.issuer)
  // console.info(issuer.metadata)
  //
  // dynamic registration, maybe not permitted with the oidc-provider npm?
  //
  // issuer.Client.fromUri(
  //   issuer.metadata.registration_endpoint,
  //   'registration_access_token'
  // ).then(function (client) {
  //   console.log('Discovered client %s %O', client.client_id, client.metadata);
  // })
  //
  // manual client definition
  //
  client = new issuer.Client({
    client_id: process.env.OIDC_CLIENT_ID,
    client_secret: process.env.OIDC_CLIENT_SECRET,
    post_logout_redirect_uris: [process.env.SVC_BASE_URI]
  })
  const params = {
    // Some services require the absolute URI that is whitelisted in the client
    // app settings; the test oidc-provider is not one of these.
    redirect_uri: process.env.SVC_BASE_URI + '/oidc/callback'
  }
  passport.use('openidconnect', new Strategy({
    client,
    params,
    passReqToCallback: true
  }, (req, tokenset, userinfo, done) => {
    req.session.idToken = tokenset.id_token
    return done(null, userinfo)
  }))
}).catch((err) => {
  console.error(err)
})

passport.serializeUser((user, done) => {
  done(null, user)
})

passport.deserializeUser((obj, done) => {
  done(null, obj)
})

router.use(passport.initialize())
router.use(passport.session())

router.get('/login', passport.authenticate('openidconnect', {
  successReturnToOrRedirect: '/',
  scope: 'openid profile email'
}))

router.get('/callback', passport.authenticate('openidconnect', {
  callback: true,
  successReturnToOrRedirect: '/oidc/details',
  failureRedirect: '/oidc/login_failed'
}))

router.get('/login_failed', (req, res, next) => {
  // we need a route that is not the login route lest we end up
  // in a redirect loop when a failure occurs
  res.render('login_failed')
})

function checkAuthentication (req, res, next) {
  if (req.isAuthenticated()) {
    next()
  } else {
    res.redirect('/')
  }
}

router.get('/details', checkAuthentication, (req, res, next) => {
  // using email for the cache key because it is the best we have right now
  userCache.set(req.user.email, req.user)
  const name = req.user.given_name || req.user.name || req.user.email
  res.render('details', { name })
})

router.get('/data/:id', async (req, res, next) => {
  // the params are automatically decoded
  try {
    let user = await new Promise((resolve, reject) => {
      if (userCache.has(req.params.id)) {
        // data is ready, no need to wait
        resolve(userCache.get(req.params.id))
      } else {
        // wait for the data to become available
        const timeout = setInterval(() => {
          if (userCache.has(req.params.id)) {
            clearInterval(timeout)
            resolve(userCache.get(req.params.id))
          }
        }, 1000)
        // but don't wait too long
        req.connection.setTimeout(requestTimeout, () => {
          clearInterval(timeout)
          reject(new Error('timeout'))
        })
      }
    })
    res.json(user)
  } catch (err) {
    res.status(408).send('Request Timeout')
  }
})

router.get('/logout', checkAuthentication, (req, res) => {
  userCache.delete(req.user.email)
  req.logout()
  const url = client.endSessionUrl({
    // need the token for the logout redirect to be honored
    id_token_hint: req.session.idToken
  })
  res.redirect(url || '/')
})

module.exports = router
