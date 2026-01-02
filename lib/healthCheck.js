'use strict';

const { getLogger } = require('./logger');

/**
 * Health Check System for NodeBB Plugin
 * Provides comprehensive health monitoring and diagnostic endpoints
 */
class HealthCheckManager {
  constructor(pluginName = 'nodebb-plugin-sunbird-api') {
    this.pluginName = pluginName;
    this.logger = getLogger(pluginName).createChildLogger('health-check');
    this.startTime = Date.now();
    this.checks = new Map();
    this.lastHealthStatus = null;
    
    // Register default health checks
    this.registerHealthCheck('uptime', () => this.getUptimeCheck());
    this.registerHealthCheck('memory', () => this.getMemoryCheck());
    
    this.logger.info('Health check manager initialized');
  }

  /**
   * Register a health check function
   * @param {string} name - Name of the health check
   * @param {Function} checkFunction - Function that returns health status
   */
  registerHealthCheck(name, checkFunction) {
    this.checks.set(name, checkFunction);
    this.logger.debug(`Health check registered: ${name}`);
  }

  /**
   * Remove a health check
   * @param {string} name - Name of the health check to remove
   */
  unregisterHealthCheck(name) {
    this.checks.delete(name);
    this.logger.debug(`Health check unregistered: ${name}`);
  }

  /**
   * Get uptime health check
   * @returns {Object} Uptime check result
   */
  getUptimeCheck() {
    const uptime = Date.now() - this.startTime;
    return {
      status: 'healthy',
      uptime: uptime,
      uptimeFormatted: this.formatUptime(uptime),
      startTime: new Date(this.startTime).toISOString()
    };
  }

  /**
   * Get memory usage health check
   * @returns {Object} Memory check result
   */
  getMemoryCheck() {
    const memUsage = process.memoryUsage();
    const totalMB = Math.round(memUsage.rss / 1024 / 1024);
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    // Consider unhealthy if using more than 1GB
    const isHealthy = totalMB < 1024;
    
    return {
      status: isHealthy ? 'healthy' : 'warning',
      memory: {
        rss: `${totalMB}MB`,
        heapUsed: `${heapUsedMB}MB`,
        heapTotal: `${heapTotalMB}MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
      },
      warning: !isHealthy ? 'High memory usage detected' : null
    };
  }

  /**
   * Run all registered health checks
   * @returns {Object} Complete health status
   */
  async runHealthChecks() {
    const results = {};
    let overallStatus = 'healthy';
    
    for (const [name, checkFunction] of this.checks) {
      try {
        const result = await checkFunction();
        results[name] = result;
        
        // Update overall status based on individual check results
        if (result.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'warning' && overallStatus === 'healthy') {
          overallStatus = 'warning';
        }
      } catch (error) {
        this.logger.error(`Health check failed: ${name}`, { error: error.message });
        results[name] = {
          status: 'unhealthy',
          error: error.message
        };
        overallStatus = 'unhealthy';
      }
    }
    
    const healthStatus = {
      plugin: this.pluginName,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results
    };
    
    this.lastHealthStatus = healthStatus;
    return healthStatus;
  }

  /**
   * Get plugin-specific health status
   * @param {Object} diagnostics - Plugin diagnostics instance
   * @returns {Object} Plugin health status
   */
  getPluginHealth(diagnostics) {
    if (!diagnostics) {
      return {
        status: 'unknown',
        message: 'No diagnostics available'
      };
    }
    
    const health = diagnostics.getHealthStatus();
    return {
      status: health.isHealthy ? 'healthy' : 'unhealthy',
      loadTime: health.loadTime,
      routes: {
        total: health.routes.total,
        registered: health.routes.registered
      },
      database: health.database,
      errors: health.errors.length,
      lastError: health.errors.length > 0 ? health.errors[health.errors.length - 1] : null
    };
  }

  /**
   * Create health check endpoint handler
   * @param {Object} diagnostics - Plugin diagnostics instance
   * @returns {Function} Express route handler
   */
  createHealthEndpoint(diagnostics = null) {
    return async (req, res) => {
      try {
        const startTime = Date.now();
        
        // Run system health checks
        const systemHealth = await this.runHealthChecks();
        
        // Get plugin-specific health if diagnostics available
        const pluginHealth = diagnostics ? this.getPluginHealth(diagnostics) : null;
        
        // Determine overall status
        let overallStatus = systemHealth.status;
        if (pluginHealth && pluginHealth.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        }
        
        const response = {
          status: overallStatus,
          plugin: this.pluginName,
          timestamp: new Date().toISOString(),
          responseTime: `${Date.now() - startTime}ms`,
          system: systemHealth,
          plugin: pluginHealth
        };
        
        // Set appropriate HTTP status code
        const httpStatus = overallStatus === 'healthy' ? 200 : 
                          overallStatus === 'warning' ? 200 : 503;
        
        this.logger.info('Health check requested', {
          status: overallStatus,
          responseTime: response.responseTime,
          httpStatus
        });
        
        res.status(httpStatus).json(response);
      } catch (error) {
        this.logger.error('Health check endpoint error', { error: error.message });
        res.status(500).json({
          status: 'error',
          plugin: this.pluginName,
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    };
  }

  /**
   * Create diagnostics endpoint handler
   * @param {Object} diagnostics - Plugin diagnostics instance
   * @returns {Function} Express route handler
   */
  createDiagnosticsEndpoint(diagnostics) {
    return (req, res) => {
      try {
        if (!diagnostics) {
          return res.status(404).json({
            error: 'Diagnostics not available',
            plugin: this.pluginName,
            timestamp: new Date().toISOString()
          });
        }
        
        const report = diagnostics.generateDiagnosticReport();
        
        this.logger.info('Diagnostics report requested', {
          totalSteps: report.summary.totalSteps,
          totalRoutes: report.summary.totalRoutes,
          totalErrors: report.summary.totalErrors
        });
        
        res.json(report);
      } catch (error) {
        this.logger.error('Diagnostics endpoint error', { error: error.message });
        res.status(500).json({
          error: error.message,
          plugin: this.pluginName,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Create route status endpoint handler
   * @param {Object} diagnostics - Plugin diagnostics instance
   * @returns {Function} Express route handler
   */
  createRouteStatusEndpoint(diagnostics) {
    return (req, res) => {
      try {
        if (!diagnostics) {
          return res.status(404).json({
            error: 'Diagnostics not available',
            plugin: this.pluginName,
            timestamp: new Date().toISOString()
          });
        }
        
        const health = diagnostics.getHealthStatus();
        const routes = health.routes.list.map(route => ({
          method: route.method,
          path: route.path,
          handler: route.handlerName,
          middleware: route.middleware,
          registered: route.isRegistered,
          registeredAt: route.registeredAt
        }));
        
        this.logger.info('Route status requested', {
          totalRoutes: routes.length
        });
        
        res.json({
          plugin: this.pluginName,
          timestamp: new Date().toISOString(),
          routes: {
            total: routes.length,
            list: routes
          }
        });
      } catch (error) {
        this.logger.error('Route status endpoint error', { error: error.message });
        res.status(500).json({
          error: error.message,
          plugin: this.pluginName,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Create comprehensive route diagnostics endpoint handler
   * @param {Object} routeDiagnostics - Route diagnostics instance
   * @returns {Function} Express route handler
   */
  createRouteListEndpoint(routeDiagnostics) {
    return (req, res) => {
      try {
        if (!routeDiagnostics) {
          return res.status(404).json({
            error: 'Route diagnostics not available',
            plugin: this.pluginName,
            timestamp: new Date().toISOString()
          });
        }
        
        const report = routeDiagnostics.generateRouteDiagnosticsReport();
        
        this.logger.info('Route list requested', {
          totalRoutes: report.summary.totalRoutes,
          registeredRoutes: report.summary.registeredRoutes,
          conflicts: report.summary.conflicts
        });
        
        res.json({
          plugin: this.pluginName,
          timestamp: new Date().toISOString(),
          ...report
        });
      } catch (error) {
        this.logger.error('Route list endpoint error', { error: error.message });
        res.status(500).json({
          error: error.message,
          plugin: this.pluginName,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Create route accessibility testing endpoint handler
   * @param {Object} routeDiagnostics - Route diagnostics instance
   * @returns {Function} Express route handler
   */
  createRouteTestEndpoint(routeDiagnostics) {
    return async (req, res) => {
      try {
        if (!routeDiagnostics) {
          return res.status(404).json({
            error: 'Route diagnostics not available',
            plugin: this.pluginName,
            timestamp: new Date().toISOString()
          });
        }
        
        const { method, path } = req.query;
        
        if (!method || !path) {
          return res.status(400).json({
            error: 'Missing required parameters: method and path',
            plugin: this.pluginName,
            timestamp: new Date().toISOString(),
            usage: 'GET /api/forum/routes/test?method=POST&path=/api/forum/v2/create'
          });
        }
        
        const testResult = await routeDiagnostics.testRouteAccessibility(method, path);
        
        this.logger.info('Route accessibility test requested', {
          method,
          path,
          accessible: testResult.accessible
        });
        
        const httpStatus = testResult.accessible ? 200 : 404;
        
        res.status(httpStatus).json({
          plugin: this.pluginName,
          timestamp: new Date().toISOString(),
          test: testResult
        });
      } catch (error) {
        this.logger.error('Route test endpoint error', { error: error.message });
        res.status(500).json({
          error: error.message,
          plugin: this.pluginName,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Create route conflict resolution endpoint handler
   * @param {Object} routeDiagnostics - Route diagnostics instance
   * @returns {Function} Express route handler
   */
  createRouteConflictEndpoint(routeDiagnostics) {
    return (req, res) => {
      try {
        if (!routeDiagnostics) {
          return res.status(404).json({
            error: 'Route diagnostics not available',
            plugin: this.pluginName,
            timestamp: new Date().toISOString()
          });
        }
        
        const conflicts = routeDiagnostics.getRouteConflicts();
        const errors = routeDiagnostics.getRegistrationErrors();
        
        // Categorize conflicts by severity
        const conflictsBySeverity = {
          high: conflicts.filter(c => c.highestSeverity === 'high'),
          medium: conflicts.filter(c => c.highestSeverity === 'medium'),
          low: conflicts.filter(c => c.highestSeverity === 'low')
        };
        
        // Generate resolution recommendations
        const resolutionPlan = this.generateConflictResolutionPlan(conflicts, errors);
        
        this.logger.info('Route conflicts requested', {
          totalConflicts: conflicts.length,
          highSeverity: conflictsBySeverity.high.length,
          mediumSeverity: conflictsBySeverity.medium.length,
          lowSeverity: conflictsBySeverity.low.length,
          errors: errors.length
        });
        
        res.json({
          plugin: this.pluginName,
          timestamp: new Date().toISOString(),
          summary: {
            totalConflicts: conflicts.length,
            totalErrors: errors.length,
            severity: {
              high: conflictsBySeverity.high.length,
              medium: conflictsBySeverity.medium.length,
              low: conflictsBySeverity.low.length
            }
          },
          conflicts: conflictsBySeverity,
          errors: errors,
          resolutionPlan: resolutionPlan
        });
      } catch (error) {
        this.logger.error('Route conflict endpoint error', { error: error.message });
        res.status(500).json({
          error: error.message,
          plugin: this.pluginName,
          timestamp: new Date().toISOString()
        });
      }
    };
  }

  /**
   * Generate conflict resolution plan
   * @param {Array} conflicts - Array of conflicts
   * @param {Array} errors - Array of errors
   * @returns {Object} Resolution plan
   */
  generateConflictResolutionPlan(conflicts, errors) {
    const plan = {
      immediate: [],
      recommended: [],
      optional: []
    };
    
    // High severity conflicts need immediate attention
    conflicts.filter(c => c.highestSeverity === 'high').forEach(conflict => {
      plan.immediate.push({
        type: 'conflict',
        routeId: conflict.routeId,
        issue: conflict.message,
        action: conflict.resolutionSuggestions[0] || 'Review route path for conflicts',
        priority: 'high'
      });
    });
    
    // Registration errors need immediate attention
    errors.forEach(error => {
      plan.immediate.push({
        type: 'error',
        routeId: error.routeId,
        issue: error.error,
        action: 'Fix route registration code',
        priority: 'high'
      });
    });
    
    // Medium severity conflicts are recommended fixes
    conflicts.filter(c => c.highestSeverity === 'medium').forEach(conflict => {
      plan.recommended.push({
        type: 'conflict',
        routeId: conflict.routeId,
        issue: conflict.message,
        action: conflict.resolutionSuggestions[0] || 'Consider using plugin-specific namespace',
        priority: 'medium'
      });
    });
    
    // Low severity conflicts are optional improvements
    conflicts.filter(c => c.highestSeverity === 'low').forEach(conflict => {
      plan.optional.push({
        type: 'conflict',
        routeId: conflict.routeId,
        issue: conflict.message,
        action: conflict.resolutionSuggestions[0] || 'Monitor for potential issues',
        priority: 'low'
      });
    });
    
    return plan;
  }

  /**
   * Format uptime in human-readable format
   * @param {number} uptime - Uptime in milliseconds
   * @returns {string} Formatted uptime string
   */
  formatUptime(uptime) {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get last health status
   * @returns {Object|null} Last health status or null if none available
   */
  getLastHealthStatus() {
    return this.lastHealthStatus;
  }
}

module.exports = HealthCheckManager;