'use strict'

const jwt = require('jsonwebtoken')
const async = require('async')

const passport = require.main.require('passport')
const nconf = require.main.require('nconf')

const user = require.main.require('./src/user')
// const plugins = require.main.require('./src/plugins')

const errorHandler = require('./lib/errorHandler')
const { getLogger } = require('./lib/logger')
// const utils = require('./utils');

// Initialize logger for middleware
const logger = getLogger('nodebb-plugin-sunbird-api').createChildLogger('middleware')

const Middleware = {
  regexes: {
    tokenRoute: new RegExp(
      '^' +
        nconf.get('relative_path') +
        '\\/api\\/v\\d+\\/users\\/(\\d+)\\/tokens'
    )
  }
}

Middleware.requireUser = async function (req, res, next) {
  var routeMatch

  logger.debug('requireUser middleware called', {
    path: req.path,
    method: req.method,
    hasAuth: !!req.headers.authorization
  })

  // If plugins handle the response, stop default actions
  if (res.headersSent) {
    logger.warn('Response already sent, skipping middleware')
    return
  }

  if (req.headers.hasOwnProperty('authorization')) {
    logger.debug('Processing authorization header')
    
    passport.authenticate('bearer', { session: false }, function (err, user) {
      if (err) {
        logger.error('Authentication error', { error: err.message })
        return next(err)
      }
      if (!user) {
        logger.warn('Authentication failed - no user found')
        return errorHandler.respond(401, res)
      }

      logger.debug('User authenticated', { uid: user.uid, master: user.master })

      // If the token received was a master token, a _uid must also be present for all calls
      if (user.hasOwnProperty('uid')) {
        req.login(user, function (err) {
          if (err) {
            logger.error('Login error', { error: err.message })
            return errorHandler.respond(500, res)
          }

          req.uid = user.uid
          req.loggedIn = req.uid > 0
          logger.debug('User logged in successfully', { uid: req.uid })
          next()
        })
      } else if (user.hasOwnProperty('master') && user.master === true) {
        user.uid = req.body.request._uid || req.query._uid || 1
        delete user.master

        logger.debug('Master token used', { assignedUid: user.uid })

        req.login(user, function (err) {
          if (err) {
            logger.error('Master token login error', { error: err.message })
            return errorHandler.respond(500, res)
          }

          req.uid = user.uid
          req.loggedIn = req.uid > 0
          logger.debug('Master token login successful', { uid: req.uid })
          next()
        })
      } else {
        logger.error('Invalid authentication state')
        return errorHandler.respond(500, res)
      }
    })(req, res, next)
  } else if (
    (routeMatch = req.originalUrl.match(Middleware.regexes.tokenRoute))
  ) {
    logger.debug('Token generation route detected')
    
    // If token generation route is hit, check password instead
    if (!utils.checkRequired(['password'], req, res)) {
      logger.warn('Password missing for token generation')
      return false
    }

    var uid = routeMatch[1]
    logger.debug('Checking password for token generation', { uid })

    user.isPasswordCorrect(uid, req.body.password, req.ip, function (err, ok) {
      if (!err && ok) {
        req.login({ uid: parseInt(uid, 10) }, function (err) {
          if (err) {
            logger.error('Token generation login error', { error: err.message })
            return errorHandler.respond(500, res)
          }

          req.uid = user.uid
          req.loggedIn = req.uid > 0
          logger.debug('Token generation login successful', { uid: req.uid })
          next()
        })
      } else {
        logger.warn('Password check failed for token generation', { uid, error: err?.message })
        errorHandler.respond(401, res)
      }
    })
  } else {
    // No bearer token, jwt, or special handling instructions, transparently pass-through
    logger.warn('No authentication provided')
    return errorHandler.respond(401, res)
  }
}

Middleware.requireAdmin = function (req, res, next) {
  logger.debug('requireAdmin middleware called', { uid: req.user?.uid })
  
  if (!req.user) {
    logger.warn('Admin check failed - no user')
    return errorHandler.respond(401, res)
  }
  
  user.isAdministrator(req.user.uid, function (err, isAdmin) {
    if (err) {
      logger.error('Admin check error', { error: err.message, uid: req.user.uid })
      return errorHandler.respond(403, res)
    }
    
    if (!isAdmin) {
      logger.warn('Admin check failed - user not admin', { uid: req.user.uid })
      return errorHandler.respond(403, res)
    }

    logger.debug('Admin check passed', { uid: req.user.uid })
    next()
  })
}

module.exports = Middleware