'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Structured Logging Utility for NodeBB Plugin Debugging
 * Provides consistent logging across all plugin components
 */
class PluginLogger {
  constructor(pluginName = 'nodebb-plugin-sunbird-api', options = {}) {
    this.pluginName = pluginName;
    this.debugMode = options.debug || process.env.NODE_ENV === 'development';
    
    // Ensure logs directory exists
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Configure winston logger
    this.logger = winston.createLogger({
      level: this.debugMode ? 'debug' : 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, plugin, context, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          const contextStr = context ? `[${context}]` : '';
          return `${timestamp} [${level.toUpperCase()}] [${plugin}] ${contextStr} ${message} ${metaStr}`;
        })
      ),
      defaultMeta: { plugin: this.pluginName },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, plugin, context, ...meta }) => {
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
              const contextStr = context ? `[${context}]` : '';
              return `${timestamp} [${level.toUpperCase()}] [${plugin}] ${contextStr} ${message} ${metaStr}`;
            })
          )
        }),
        new winston.transports.File({ 
          filename: path.join(logsDir, `${this.pluginName}.log`),
          maxsize: 10485760, // 10MB
          maxFiles: 5
        }),
        new winston.transports.File({ 
          filename: path.join(logsDir, `${this.pluginName}-error.log`),
          level: 'error',
          maxsize: 10485760, // 10MB
          maxFiles: 5
        })
      ]
    });

    this.info('Logger initialized', { 
      debugMode: this.debugMode,
      logLevel: this.logger.level 
    });
  }

  /**
   * Log info level messages
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   * @param {string} context - Context identifier
   */
  info(message, meta = {}, context = null) {
    this.logger.info(message, { ...meta, context });
  }

  /**
   * Log debug level messages (only in debug mode)
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   * @param {string} context - Context identifier
   */
  debug(message, meta = {}, context = null) {
    this.logger.debug(message, { ...meta, context });
  }

  /**
   * Log warning messages
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   * @param {string} context - Context identifier
   */
  warn(message, meta = {}, context = null) {
    this.logger.warn(message, { ...meta, context });
  }

  /**
   * Log error messages with stack traces
   * @param {string|Error} error - Error message or Error object
   * @param {Object} meta - Additional metadata
   * @param {string} context - Context identifier
   */
  error(error, meta = {}, context = null) {
    if (error instanceof Error) {
      this.logger.error(error.message, { 
        ...meta, 
        context,
        stack: error.stack,
        errorName: error.name
      });
    } else {
      this.logger.error(error, { ...meta, context });
    }
  }

  /**
   * Log plugin initialization steps
   * @param {string} step - Initialization step name
   * @param {Object} details - Step details
   */
  logInitStep(step, details = {}) {
    this.info(`Initialization step: ${step}`, details, 'init');
  }

  /**
   * Log route registration
   * @param {string} method - HTTP method
   * @param {string} path - Route path
   * @param {string} handler - Handler function name
   * @param {Array} middleware - Middleware functions
   */
  logRouteRegistration(method, path, handler, middleware = []) {
    this.info(`Route registered: ${method.toUpperCase()} ${path}`, {
      method: method.toUpperCase(),
      path,
      handler,
      middleware: middleware.map(m => m.name || 'anonymous'),
      timestamp: new Date().toISOString()
    }, 'routes');
  }

  /**
   * Log database operations
   * @param {string} operation - Database operation
   * @param {Object} details - Operation details
   */
  logDatabaseOperation(operation, details = {}) {
    this.debug(`Database operation: ${operation}`, details, 'database');
  }

  /**
   * Log middleware execution
   * @param {string} middlewareName - Name of middleware
   * @param {Object} details - Execution details
   */
  logMiddlewareExecution(middlewareName, details = {}) {
    this.debug(`Middleware executed: ${middlewareName}`, details, 'middleware');
  }

  /**
   * Log API request/response
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {number} duration - Request duration in ms
   */
  logApiRequest(req, res, duration = null) {
    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      duration: duration ? `${duration}ms` : undefined
    };

    if (res.statusCode >= 400) {
      this.warn(`API request failed: ${req.method} ${req.path}`, logData, 'api');
    } else {
      this.info(`API request: ${req.method} ${req.path}`, logData, 'api');
    }
  }

  /**
   * Log plugin activation status
   * @param {boolean} isActive - Whether plugin is active
   * @param {Object} details - Activation details
   */
  logPluginActivation(isActive, details = {}) {
    if (isActive) {
      this.info('Plugin activation confirmed', details, 'activation');
    } else {
      this.warn('Plugin activation not confirmed', details, 'activation');
    }
  }

  /**
   * Log NodeBB API compatibility issues
   * @param {string} apiMethod - NodeBB API method
   * @param {string} issue - Compatibility issue description
   * @param {Object} details - Additional details
   */
  logCompatibilityIssue(apiMethod, issue, details = {}) {
    this.warn(`NodeBB v4 compatibility issue: ${apiMethod}`, {
      apiMethod,
      issue,
      ...details
    }, 'compatibility');
  }

  /**
   * Create a child logger with additional context
   * @param {string} context - Context identifier
   * @returns {Object} Child logger with context
   */
  createChildLogger(context) {
    return {
      info: (message, meta = {}) => this.info(message, meta, context),
      debug: (message, meta = {}) => this.debug(message, meta, context),
      warn: (message, meta = {}) => this.warn(message, meta, context),
      error: (error, meta = {}) => this.error(error, meta, context)
    };
  }

  /**
   * Enable or disable debug mode
   * @param {boolean} enabled - Whether to enable debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.logger.level = enabled ? 'debug' : 'info';
    this.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get current log level
   * @returns {string} Current log level
   */
  getLogLevel() {
    return this.logger.level;
  }

  /**
   * Flush all log transports
   */
  flush() {
    this.logger.end();
  }
}

// Create singleton instance
let loggerInstance = null;

/**
 * Get or create logger instance
 * @param {string} pluginName - Plugin name
 * @param {Object} options - Logger options
 * @returns {PluginLogger} Logger instance
 */
function getLogger(pluginName = 'nodebb-plugin-sunbird-api', options = {}) {
  if (!loggerInstance) {
    loggerInstance = new PluginLogger(pluginName, options);
  }
  return loggerInstance;
}

module.exports = {
  PluginLogger,
  getLogger
};