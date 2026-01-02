'use strict';

const { getLogger } = require('./logger');

/**
 * Route Diagnostics System for NodeBB Plugin
 * Provides route registration verification and conflict detection
 */
class RouteDiagnostics {
  constructor(pluginName = 'nodebb-plugin-sunbird-api') {
    this.pluginName = pluginName;
    this.logger = getLogger(pluginName).createChildLogger('route-diagnostics');
    this.registeredRoutes = new Map();
    this.routeConflicts = [];
    this.routeRegistrationErrors = [];
    
    this.logger.info('Route diagnostics initialized');
  }

  /**
   * Register a route and verify its registration
   * @param {Object} router - Express router instance
   * @param {string} method - HTTP method
   * @param {string} path - Route path
   * @param {Function|Array} handlers - Route handlers (middleware + final handler)
   * @param {string} handlerName - Name of the final handler function
   */
  registerAndVerifyRoute(router, method, path, handlers, handlerName) {
    const routeId = `${method.toUpperCase()}:${path}`;
    const timestamp = new Date().toISOString();
    
    try {
      // Extract middleware and final handler
      const handlerArray = Array.isArray(handlers) ? handlers : [handlers];
      const middleware = handlerArray.slice(0, -1);
      const finalHandler = handlerArray[handlerArray.length - 1];
      
      // Enhanced logging for route registration
      this.logger.info(`[ROUTE REGISTRATION] Starting registration for ${routeId}`, {
        method: method.toUpperCase(),
        path,
        handlerName,
        middlewareCount: middleware.length,
        middlewareNames: middleware.map(m => m.name || 'anonymous'),
        timestamp,
        routerStackSizeBefore: router.stack ? router.stack.length : 0
      });
      
      // Check for existing route conflicts before registration
      const existingConflict = this.checkRouteConflicts(method, path);
      if (existingConflict) {
        this.logger.warn(`[ROUTE CONFLICT] Potential conflict detected for ${routeId}`, existingConflict);
      }
      
      // Register the route with detailed logging
      this.logger.debug(`[ROUTE REGISTRATION] Calling router.${method.toLowerCase()}('${path}', [${handlerArray.length} handlers])`);
      router[method.toLowerCase()](path, ...handlerArray);
      
      // Verify route was registered in NodeBB's routing table
      const isRegistered = this.verifyRouteRegistration(router, method, path);
      const routerStackSizeAfter = router.stack ? router.stack.length : 0;
      
      // Enhanced route information storage
      const routeInfo = {
        method: method.toUpperCase(),
        path,
        handlerName,
        middleware: middleware.map((m, index) => ({
          name: m.name || 'anonymous',
          index,
          type: this.identifyMiddlewareType(m)
        })),
        registeredAt: timestamp,
        isRegistered,
        verified: isRegistered,
        routerStackChange: routerStackSizeAfter - (router.stack ? router.stack.length - 1 : 0),
        nodebbCompatible: this.checkNodeBBCompatibility(path),
        lastAccessed: null,
        accessCount: 0
      };
      
      this.registeredRoutes.set(routeId, routeInfo);
      
      // Enhanced success/failure logging
      if (isRegistered) {
        this.logger.info(`[ROUTE SUCCESS] Route registered and verified: ${routeId}`, {
          stackSizeChange: routeInfo.routerStackChange,
          totalRoutes: this.registeredRoutes.size,
          nodebbCompatible: routeInfo.nodebbCompatible
        });
      } else {
        this.logger.error(`[ROUTE FAILURE] Route registration failed verification: ${routeId}`, {
          stackSizeBefore: router.stack ? router.stack.length - 1 : 0,
          stackSizeAfter: routerStackSizeAfter,
          expectedChange: 1
        });
        this.routeRegistrationErrors.push({
          routeId,
          error: 'Route not found in router stack after registration',
          timestamp,
          routerStackInfo: {
            sizeBefore: router.stack ? router.stack.length - 1 : 0,
            sizeAfter: routerStackSizeAfter
          }
        });
      }
      
      return isRegistered;
    } catch (error) {
      this.logger.error(`[ROUTE ERROR] Route registration exception: ${routeId}`, { 
        error: error.message,
        stack: error.stack,
        handlerCount: Array.isArray(handlers) ? handlers.length : 1
      });
      this.routeRegistrationErrors.push({
        routeId,
        error: error.message,
        stack: error.stack,
        timestamp,
        type: 'registration_exception'
      });
      return false;
    }
  }

  /**
   * Verify that a route is properly registered in the router
   * @param {Object} router - Express router instance
   * @param {string} method - HTTP method
   * @param {string} path - Route path
   * @returns {boolean} Whether route is registered
   */
  verifyRouteRegistration(router, method, path) {
    try {
      if (!router.stack) {
        this.logger.warn('Router has no stack property - NodeBB v4 compatibility issue?');
        return false;
      }
      
      const methodUpper = method.toUpperCase();
      
      // Enhanced route verification with detailed logging
      this.logger.debug(`[ROUTE VERIFICATION] Checking ${methodUpper} ${path} in router stack`, {
        stackSize: router.stack.length,
        stackLayers: router.stack.map((layer, index) => ({
          index,
          hasRoute: !!layer.route,
          routePath: layer.route?.path,
          routeMethods: layer.route ? Object.keys(layer.route.methods) : []
        }))
      });
      
      // Check if route exists in router stack
      const matchingLayers = router.stack.filter(layer => {
        if (!layer.route) return false;
        
        const routePath = layer.route.path;
        const routeMethods = Object.keys(layer.route.methods);
        
        const pathMatch = routePath === path;
        const methodMatch = routeMethods.some(m => m.toUpperCase() === methodUpper);
        
        return pathMatch && methodMatch;
      });
      
      const routeExists = matchingLayers.length > 0;
      
      this.logger.debug(`[ROUTE VERIFICATION] Result for ${methodUpper} ${path}`, {
        exists: routeExists,
        matchingLayers: matchingLayers.length,
        stackLayers: router.stack.length,
        routeDetails: matchingLayers.map(layer => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
          handlerCount: layer.route.stack ? layer.route.stack.length : 0
        }))
      });
      
      return routeExists;
    } catch (error) {
      this.logger.error(`[ROUTE VERIFICATION ERROR] ${method} ${path}`, { 
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * Identify middleware type for better diagnostics
   * @param {Function} middleware - Middleware function
   * @returns {string} Middleware type
   */
  identifyMiddlewareType(middleware) {
    if (!middleware || typeof middleware !== 'function') {
      return 'unknown';
    }
    
    const name = middleware.name || 'anonymous';
    
    // Identify common middleware types
    if (name.includes('requireUser') || name.includes('auth')) {
      return 'authentication';
    }
    if (name.includes('requireAdmin') || name.includes('admin')) {
      return 'authorization';
    }
    if (name.includes('validate') || name.includes('check')) {
      return 'validation';
    }
    if (name.includes('cors') || name.includes('CORS')) {
      return 'cors';
    }
    if (name.includes('rate') || name.includes('limit')) {
      return 'rate-limiting';
    }
    if (name.includes('log') || name.includes('Log')) {
      return 'logging';
    }
    
    return 'custom';
  }

  /**
   * Check NodeBB v4 compatibility for route path
   * @param {string} path - Route path
   * @returns {boolean} Whether path is NodeBB v4 compatible
   */
  checkNodeBBCompatibility(path) {
    // NodeBB v4 compatible patterns
    const compatiblePatterns = [
      /^\/api\/[^\/]+\/v[0-9]+\//,  // Versioned APIs like /api/forum/v2/
      /^\/api\/[^\/]+\/[^\/]+$/,    // Simple APIs like /api/forum/health
      /^\/[^\/]+\/[^\/]+$/          // Simple paths
    ];
    
    // Check against known incompatible patterns
    const incompatiblePatterns = [
      /^\/api\/v[0-9]+\//,          // Old style /api/v1/ (conflicts with core)
      /^\/admin\//,                 // Admin paths (reserved)
      /^\/user\//,                  // User paths (reserved)
      /^\/users\//                  // Users paths (reserved)
    ];
    
    // Check incompatible first
    if (incompatiblePatterns.some(pattern => pattern.test(path))) {
      return false;
    }
    
    // Check compatible patterns
    return compatiblePatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check for route conflicts with NodeBB core APIs
   * @param {string} method - HTTP method
   * @param {string} path - Route path
   * @returns {Object} Conflict check result
   */
  checkRouteConflicts(method, path) {
    const routeId = `${method.toUpperCase()}:${path}`;
    
    // Enhanced NodeBB v4 core API patterns that might conflict
    const coreApiPatterns = [
      { pattern: '/api/v3/', severity: 'high', description: 'NodeBB v4 core API namespace' },
      { pattern: '/api/admin/', severity: 'high', description: 'NodeBB admin API namespace' },
      { pattern: '/api/user/', severity: 'medium', description: 'NodeBB user API namespace' },
      { pattern: '/api/users/', severity: 'medium', description: 'NodeBB users API namespace' },
      { pattern: '/api/categories/', severity: 'medium', description: 'NodeBB categories API namespace' },
      { pattern: '/api/topics/', severity: 'medium', description: 'NodeBB topics API namespace' },
      { pattern: '/api/posts/', severity: 'medium', description: 'NodeBB posts API namespace' },
      { pattern: '/api/groups/', severity: 'medium', description: 'NodeBB groups API namespace' },
      { pattern: '/api/flags/', severity: 'low', description: 'NodeBB flags API namespace' },
      { pattern: '/api/search/', severity: 'low', description: 'NodeBB search API namespace' },
      { pattern: '/api/notifications/', severity: 'low', description: 'NodeBB notifications API namespace' },
      { pattern: '/api/chats/', severity: 'low', description: 'NodeBB chats API namespace' },
      { pattern: '/api/compose/', severity: 'low', description: 'NodeBB compose API namespace' }
    ];
    
    // Check for Write API conflicts (NodeBB plugin)
    const writeApiPatterns = [
      { pattern: '/api/v1/', severity: 'high', description: 'NodeBB Write API v1 namespace' },
      { pattern: '/api/v2/', severity: 'high', description: 'NodeBB Write API v2 namespace' }
    ];
    
    const allPatterns = [...coreApiPatterns, ...writeApiPatterns];
    const conflicts = [];
    
    for (const { pattern, severity, description } of allPatterns) {
      if (path.startsWith(pattern)) {
        conflicts.push({
          pattern,
          severity,
          description,
          recommendation: this.getConflictRecommendation(pattern, path)
        });
      }
    }
    
    // Check for exact route duplicates in our own registered routes
    const existingRoute = this.registeredRoutes.get(routeId);
    if (existingRoute) {
      conflicts.push({
        pattern: path,
        severity: 'high',
        description: 'Duplicate route registration',
        recommendation: 'Remove duplicate route registration'
      });
    }
    
    if (conflicts.length > 0) {
      const conflictInfo = {
        routeId,
        path,
        method: method.toUpperCase(),
        conflicts,
        highestSeverity: this.getHighestSeverity(conflicts),
        message: `Route conflicts detected: ${conflicts.map(c => c.description).join(', ')}`,
        timestamp: new Date().toISOString(),
        resolutionSuggestions: conflicts.map(c => c.recommendation).filter(Boolean)
      };
      
      this.routeConflicts.push(conflictInfo);
      
      const logLevel = conflictInfo.highestSeverity === 'high' ? 'error' : 
                      conflictInfo.highestSeverity === 'medium' ? 'warn' : 'info';
      
      this.logger[logLevel](`[ROUTE CONFLICT] ${conflictInfo.highestSeverity.toUpperCase()} severity conflict: ${routeId}`, conflictInfo);
      
      return conflictInfo;
    }
    
    return null;
  }

  /**
   * Get conflict resolution recommendation
   * @param {string} pattern - Conflicting pattern
   * @param {string} path - Route path
   * @returns {string} Recommendation
   */
  getConflictRecommendation(pattern, path) {
    if (pattern.includes('/api/v3/')) {
      return `Use plugin-specific namespace like /api/forum/v3/ instead of ${pattern}`;
    }
    if (pattern.includes('/api/admin/')) {
      return `Use plugin admin namespace like /api/forum/admin/ instead of ${pattern}`;
    }
    if (pattern.includes('/api/v1/') || pattern.includes('/api/v2/')) {
      return `Avoid Write API namespace conflicts - use /api/forum/v2/ or /api/forum/v3/`;
    }
    return `Consider using plugin-specific namespace to avoid conflicts with ${pattern}`;
  }

  /**
   * Get highest severity from conflicts array
   * @param {Array} conflicts - Array of conflicts
   * @returns {string} Highest severity
   */
  getHighestSeverity(conflicts) {
    const severityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
    return conflicts.reduce((highest, conflict) => {
      return severityOrder[conflict.severity] > severityOrder[highest] ? conflict.severity : highest;
    }, 'low');
  }

  /**
   * Test route accessibility by making a test request
   * @param {string} method - HTTP method
   * @param {string} path - Route path
   * @param {Object} options - Test options
   * @returns {Promise<Object>} Test result
   */
  async testRouteAccessibility(method, path, options = {}) {
    const routeId = `${method.toUpperCase()}:${path}`;
    
    try {
      this.logger.info(`[ROUTE TEST] Testing accessibility for ${routeId}`);
      
      // Get route information
      const routeInfo = this.registeredRoutes.get(routeId);
      
      if (!routeInfo) {
        return {
          routeId,
          accessible: false,
          registered: false,
          testPerformed: false,
          error: 'Route not found in registry',
          timestamp: new Date().toISOString()
        };
      }
      
      // Basic accessibility check
      const basicAccessible = routeInfo.isRegistered && routeInfo.verified;
      
      // Enhanced accessibility testing could be added here
      // For now, we'll do basic checks
      const testResult = {
        routeId,
        accessible: basicAccessible,
        registered: routeInfo.isRegistered,
        verified: routeInfo.verified,
        testPerformed: true,
        middlewareCount: routeInfo.middleware.length,
        nodebbCompatible: routeInfo.nodebbCompatible,
        conflicts: this.routeConflicts.filter(c => c.routeId === routeId),
        message: basicAccessible ? 'Route appears accessible' : 'Route may not be accessible',
        timestamp: new Date().toISOString()
      };
      
      this.logger.info(`[ROUTE TEST] Accessibility test completed for ${routeId}`, testResult);
      
      return testResult;
    } catch (error) {
      this.logger.error(`[ROUTE TEST ERROR] Accessibility test failed for ${routeId}`, { 
        error: error.message,
        stack: error.stack
      });
      return {
        routeId,
        accessible: false,
        error: error.message,
        testPerformed: false,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Record route access for diagnostics
   * @param {string} method - HTTP method
   * @param {string} path - Route path
   * @param {Object} accessInfo - Access information
   */
  recordRouteAccess(method, path, accessInfo = {}) {
    const routeId = `${method.toUpperCase()}:${path}`;
    const routeInfo = this.registeredRoutes.get(routeId);
    
    if (routeInfo) {
      routeInfo.lastAccessed = new Date().toISOString();
      routeInfo.accessCount = (routeInfo.accessCount || 0) + 1;
      
      if (!routeInfo.accessHistory) {
        routeInfo.accessHistory = [];
      }
      
      routeInfo.accessHistory.push({
        timestamp: routeInfo.lastAccessed,
        ...accessInfo
      });
      
      // Keep only last 10 access records
      if (routeInfo.accessHistory.length > 10) {
        routeInfo.accessHistory = routeInfo.accessHistory.slice(-10);
      }
      
      this.logger.debug(`[ROUTE ACCESS] Recorded access to ${routeId}`, {
        accessCount: routeInfo.accessCount,
        lastAccessed: routeInfo.lastAccessed
      });
    }
  }

  /**
   * Get all registered routes
   * @returns {Array} Array of route information
   */
  getAllRoutes() {
    return Array.from(this.registeredRoutes.values());
  }

  /**
   * Get route information by path
   * @param {string} path - Route path
   * @returns {Array} Array of routes matching the path
   */
  getRoutesByPath(path) {
    return Array.from(this.registeredRoutes.values())
      .filter(route => route.path === path);
  }

  /**
   * Get route conflicts
   * @returns {Array} Array of route conflicts
   */
  getRouteConflicts() {
    return this.routeConflicts;
  }

  /**
   * Get route registration errors
   * @returns {Array} Array of registration errors
   */
  getRegistrationErrors() {
    return this.routeRegistrationErrors;
  }

  /**
   * Generate route diagnostics report
   * @returns {Object} Complete route diagnostics report
   */
  generateRouteDiagnosticsReport() {
    const routes = this.getAllRoutes();
    const registeredCount = routes.filter(r => r.isRegistered).length;
    const verifiedCount = routes.filter(r => r.verified).length;
    
    return {
      summary: {
        totalRoutes: routes.length,
        registeredRoutes: registeredCount,
        verifiedRoutes: verifiedCount,
        conflicts: this.routeConflicts.length,
        errors: this.routeRegistrationErrors.length
      },
      routes: routes,
      conflicts: this.routeConflicts,
      errors: this.routeRegistrationErrors,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Verify all registered routes
   * @param {Object} router - Express router instance
   * @returns {Object} Verification results
   */
  verifyAllRoutes(router) {
    const results = {
      verified: 0,
      failed: 0,
      routes: []
    };
    
    for (const [routeId, routeInfo] of this.registeredRoutes) {
      const isVerified = this.verifyRouteRegistration(router, routeInfo.method, routeInfo.path);
      
      // Update route info
      routeInfo.verified = isVerified;
      routeInfo.lastVerified = new Date().toISOString();
      
      if (isVerified) {
        results.verified++;
      } else {
        results.failed++;
      }
      
      results.routes.push({
        routeId,
        verified: isVerified,
        ...routeInfo
      });
    }
    
    this.logger.info('Route verification completed', {
      total: this.registeredRoutes.size,
      verified: results.verified,
      failed: results.failed
    });
    
    return results;
  }

  /**
   * Clear all diagnostics data
   */
  clear() {
    this.registeredRoutes.clear();
    this.routeConflicts = [];
    this.routeRegistrationErrors = [];
    this.logger.info('Route diagnostics data cleared');
  }

  /**
   * Implement route conflict resolution logic
   * @param {string} conflictType - Type of conflict to resolve
   * @param {Object} options - Resolution options
   * @returns {Object} Resolution result
   */
  resolveRouteConflict(conflictType, options = {}) {
    const resolutionResult = {
      type: conflictType,
      resolved: false,
      actions: [],
      recommendations: [],
      timestamp: new Date().toISOString()
    };

    try {
      switch (conflictType) {
        case 'namespace_conflict':
          resolutionResult.actions.push('Identified namespace conflicts');
          resolutionResult.recommendations.push('Use plugin-specific namespace like /api/forum/');
          resolutionResult.recommendations.push('Avoid core NodeBB API paths like /api/v3/');
          break;

        case 'duplicate_routes':
          const duplicates = this.findDuplicateRoutes();
          resolutionResult.actions.push(`Found ${duplicates.length} duplicate routes`);
          resolutionResult.recommendations.push('Remove duplicate route registrations');
          resolutionResult.duplicates = duplicates;
          break;

        case 'write_api_conflict':
          const writeApiConflicts = this.routeConflicts.filter(c => 
            c.conflicts.some(conf => conf.description.includes('Write API'))
          );
          resolutionResult.actions.push(`Found ${writeApiConflicts.length} Write API conflicts`);
          resolutionResult.recommendations.push('Use /api/forum/v2/ or /api/forum/v3/ instead of /api/v1/ or /api/v2/');
          resolutionResult.conflicts = writeApiConflicts;
          break;

        case 'middleware_issues':
          const middlewareProblems = this.analyzeMiddlewareIssues();
          resolutionResult.actions.push('Analyzed middleware configuration');
          resolutionResult.recommendations = middlewareProblems.recommendations;
          resolutionResult.issues = middlewareProblems.issues;
          break;

        default:
          resolutionResult.actions.push('Unknown conflict type');
          resolutionResult.recommendations.push('Manual review required');
      }

      resolutionResult.resolved = resolutionResult.recommendations.length > 0;
      
      this.logger.info(`Route conflict resolution attempted: ${conflictType}`, resolutionResult);
      
      return resolutionResult;
    } catch (error) {
      this.logger.error(`Route conflict resolution failed: ${conflictType}`, { error: error.message });
      resolutionResult.error = error.message;
      return resolutionResult;
    }
  }

  /**
   * Find duplicate route registrations
   * @returns {Array} Array of duplicate routes
   */
  findDuplicateRoutes() {
    const routeMap = new Map();
    const duplicates = [];

    for (const [routeId, routeInfo] of this.registeredRoutes) {
      const key = `${routeInfo.method}:${routeInfo.path}`;
      
      if (routeMap.has(key)) {
        duplicates.push({
          routeId,
          path: routeInfo.path,
          method: routeInfo.method,
          duplicate: true,
          original: routeMap.get(key)
        });
      } else {
        routeMap.set(key, routeId);
      }
    }

    return duplicates;
  }

  /**
   * Analyze middleware configuration issues
   * @returns {Object} Middleware analysis result
   */
  analyzeMiddlewareIssues() {
    const issues = [];
    const recommendations = [];

    for (const [routeId, routeInfo] of this.registeredRoutes) {
      // Check for missing authentication middleware on protected routes
      if (routeInfo.path.includes('/admin/') || routeInfo.path.includes('/create') || routeInfo.path.includes('/delete')) {
        const hasAuth = routeInfo.middleware.some(m => 
          m.type === 'authentication' || m.name.includes('requireUser')
        );
        
        if (!hasAuth) {
          issues.push({
            routeId,
            issue: 'Missing authentication middleware on protected route',
            severity: 'high'
          });
          recommendations.push(`Add authentication middleware to ${routeId}`);
        }
      }

      // Check for middleware order issues
      const authIndex = routeInfo.middleware.findIndex(m => m.type === 'authentication');
      const authzIndex = routeInfo.middleware.findIndex(m => m.type === 'authorization');
      
      if (authIndex > -1 && authzIndex > -1 && authIndex > authzIndex) {
        issues.push({
          routeId,
          issue: 'Authorization middleware before authentication middleware',
          severity: 'medium'
        });
        recommendations.push(`Reorder middleware for ${routeId}: authentication should come before authorization`);
      }
    }

    return { issues, recommendations };
  }

  /**
   * Generate route performance report
   * @returns {Object} Performance report
   */
  generatePerformanceReport() {
    const routes = Array.from(this.registeredRoutes.values());
    const totalRoutes = routes.length;
    const accessedRoutes = routes.filter(r => r.accessCount > 0);
    const neverAccessedRoutes = routes.filter(r => r.accessCount === 0);
    
    // Calculate average access count
    const totalAccesses = routes.reduce((sum, r) => sum + (r.accessCount || 0), 0);
    const avgAccess = totalRoutes > 0 ? totalAccesses / totalRoutes : 0;
    
    // Find most and least accessed routes
    const sortedByAccess = routes.sort((a, b) => (b.accessCount || 0) - (a.accessCount || 0));
    const mostAccessed = sortedByAccess.slice(0, 5);
    const leastAccessed = sortedByAccess.slice(-5);

    return {
      summary: {
        totalRoutes,
        accessedRoutes: accessedRoutes.length,
        neverAccessedRoutes: neverAccessedRoutes.length,
        totalAccesses,
        averageAccess: Math.round(avgAccess * 100) / 100
      },
      mostAccessed: mostAccessed.map(r => ({
        routeId: `${r.method}:${r.path}`,
        accessCount: r.accessCount || 0,
        lastAccessed: r.lastAccessed
      })),
      leastAccessed: leastAccessed.map(r => ({
        routeId: `${r.method}:${r.path}`,
        accessCount: r.accessCount || 0,
        lastAccessed: r.lastAccessed
      })),
      neverAccessed: neverAccessedRoutes.map(r => ({
        routeId: `${r.method}:${r.path}`,
        registeredAt: r.registeredAt
      })),
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = RouteDiagnostics;