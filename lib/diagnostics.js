'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Comprehensive Plugin Diagnostics System
 * Provides logging, health checks, and route verification for NodeBB plugin compatibility
 */
class PluginDiagnostics {
  constructor(pluginName = 'nodebb-plugin-sunbird-api') {
    this.pluginName = pluginName;
    this.loadStartTime = Date.now();
    this.registeredRoutes = [];
    this.loadSteps = [];
    this.errors = [];
    this.databaseStatus = null;
    
    // Initialize logger
    this.logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { plugin: this.pluginName },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({ 
          filename: path.join(process.cwd(), 'logs', `${this.pluginName}-diagnostics.log`) 
        })
      ]
    });

    this.logger.info('Plugin diagnostics initialized', {
      pluginName: this.pluginName,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log a plugin loading step with timestamp
   * @param {string} step - Description of the loading step
   * @param {Object} details - Additional details about the step
   */
  logLoadingStep(step, details = {}) {
    const timestamp = Date.now();
    const stepInfo = {
      step,
      timestamp,
      elapsedTime: timestamp - this.loadStartTime,
      details
    };
    
    this.loadSteps.push(stepInfo);
    this.logger.info(`Loading step: ${step}`, stepInfo);
  }

  /**
   * Log route registration with method, path, and handler details
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - Route path
   * @param {string} handlerName - Name of the handler function
   * @param {Array} middleware - Array of middleware function names
   */
  logRouteRegistration(method, path, handlerName, middleware = []) {
    const routeInfo = {
      method: method.toUpperCase(),
      path,
      handlerName,
      middleware,
      registeredAt: new Date().toISOString(),
      isRegistered: true
    };
    
    this.registeredRoutes.push(routeInfo);
    this.logger.info(`Route registered: ${method.toUpperCase()} ${path}`, routeInfo);
  }

  /**
   * Log dependency loading and verification
   * @param {string} moduleName - Name of the module being loaded
   * @param {boolean} success - Whether the module loaded successfully
   * @param {Error} error - Error if loading failed
   */
  logDependencyLoad(moduleName, success, error = null) {
    const dependencyInfo = {
      moduleName,
      success,
      error: error ? error.message : null,
      timestamp: new Date().toISOString()
    };
    
    if (success) {
      this.logger.info(`Dependency loaded: ${moduleName}`, dependencyInfo);
    } else {
      this.logger.error(`Dependency failed to load: ${moduleName}`, dependencyInfo);
      this.errors.push({
        type: 'dependency',
        message: `Failed to load ${moduleName}`,
        error: error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log database connection status
   * @param {string} dbType - Type of database (redis, mongodb)
   * @param {boolean} connected - Whether connection was successful
   * @param {Error} error - Error if connection failed
   */
  logDatabaseConnection(dbType, connected, error = null) {
    this.databaseStatus = {
      type: dbType,
      connected,
      connectionTime: new Date().toISOString(),
      error: error ? error.message : null
    };
    
    if (connected) {
      this.logger.info(`Database connected: ${dbType}`, this.databaseStatus);
    } else {
      this.logger.error(`Database connection failed: ${dbType}`, this.databaseStatus);
      this.errors.push({
        type: 'database',
        message: `Database connection failed: ${dbType}`,
        error: error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log plugin activation status
   * @param {boolean} activated - Whether plugin is activated
   * @param {Object} pluginInfo - Plugin information from NodeBB
   */
  logPluginActivation(activated, pluginInfo = {}) {
    const activationInfo = {
      activated,
      pluginInfo,
      timestamp: new Date().toISOString()
    };
    
    if (activated) {
      this.logger.info('Plugin activation confirmed', activationInfo);
    } else {
      this.logger.warn('Plugin activation not confirmed', activationInfo);
      this.errors.push({
        type: 'activation',
        message: 'Plugin activation not confirmed',
        details: pluginInfo,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log errors with appropriate severity and context
   * @param {Error} error - The error object
   * @param {string} context - Context where the error occurred
   * @param {string} severity - Error severity (error, warn, info)
   */
  logError(error, context = 'unknown', severity = 'error') {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      context,
      severity,
      timestamp: new Date().toISOString()
    };
    
    this.errors.push({
      type: 'runtime',
      message: error.message,
      context,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    this.logger[severity](`Error in ${context}: ${error.message}`, errorInfo);
  }

  /**
   * Get comprehensive plugin health status
   * @returns {Object} Complete health status including routes, database, and errors
   */
  getHealthStatus() {
    return {
      pluginName: this.pluginName,
      isHealthy: this.errors.length === 0 && this.databaseStatus?.connected,
      loadTime: Date.now() - this.loadStartTime,
      loadSteps: this.loadSteps,
      routes: {
        total: this.registeredRoutes.length,
        registered: this.registeredRoutes.filter(r => r.isRegistered).length,
        list: this.registeredRoutes
      },
      database: this.databaseStatus,
      errors: this.errors,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get diagnostic information for specific route
   * @param {string} path - Route path to check
   * @returns {Object} Route diagnostic information
   */
  getRouteDiagnostics(path) {
    const route = this.registeredRoutes.find(r => r.path === path);
    return {
      path,
      found: !!route,
      details: route || null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Verify route accessibility by checking if it's properly mounted
   * @param {Object} router - Express router instance
   * @param {string} path - Route path to verify
   * @returns {boolean} Whether route is accessible
   */
  verifyRouteAccessibility(router, path) {
    try {
      // Check if route exists in router stack
      const routeExists = router.stack && router.stack.some(layer => {
        return layer.route && layer.route.path === path;
      });
      
      this.logger.info(`Route accessibility check: ${path}`, {
        path,
        accessible: routeExists,
        timestamp: new Date().toISOString()
      });
      
      return routeExists;
    } catch (error) {
      this.logError(error, `route-verification-${path}`);
      return false;
    }
  }

  /**
   * Generate comprehensive diagnostic report
   * @returns {Object} Complete diagnostic report
   */
  generateDiagnosticReport() {
    const report = {
      summary: {
        pluginName: this.pluginName,
        totalLoadTime: Date.now() - this.loadStartTime,
        totalSteps: this.loadSteps.length,
        totalRoutes: this.registeredRoutes.length,
        totalErrors: this.errors.length,
        isHealthy: this.errors.length === 0 && this.databaseStatus?.connected
      },
      loadingSteps: this.loadSteps,
      routes: this.registeredRoutes,
      database: this.databaseStatus,
      errors: this.errors,
      generatedAt: new Date().toISOString()
    };
    
    this.logger.info('Diagnostic report generated', { 
      summary: report.summary 
    });
    
    return report;
  }

  /**
   * Create health check endpoint response
   * @returns {Object} Health check response object
   */
  createHealthCheckResponse() {
    const health = this.getHealthStatus();
    return {
      status: health.isHealthy ? 'healthy' : 'unhealthy',
      plugin: this.pluginName,
      uptime: health.loadTime,
      routes: health.routes.total,
      database: health.database?.connected ? 'connected' : 'disconnected',
      errors: health.errors.length,
      timestamp: health.timestamp
    };
  }
}

module.exports = PluginDiagnostics;