#!/usr/bin/env node

/**
 * Plugin Configuration Verification Script
 * 
 * This script verifies that all NodeBB plugins in the workspace are properly configured
 * for NodeBB v4 compatibility and identifies any issues that could prevent loading.
 */

const fs = require('fs');
const path = require('path');

function verifyPluginConfig() {
  console.log('=== NodeBB Plugin Configuration Verification ===\n');
  
  const pluginDirs = [
    'nodebb-plugin-sunbird-api',
    'nodebb-plugin-write-api', 
    'nodebb-plugin-sunbird-oidc',
    'nodebb-plugin-azure-storage',
    'nodebb-plugin-sunbird-telemetry'
  ];
  
  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
    issues: []
  };
  
  function logIssue(plugin, type, message) {
    results.issues.push({ plugin, type, message });
    const symbol = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${symbol} [${plugin}] ${message}`);
    
    if (type === 'error') results.failed++;
    else if (type === 'warning') results.warnings++;
  }
  
  function logSuccess(plugin, message) {
    results.passed++;
    console.log(`✅ [${plugin}] ${message}`);
  }
  
  pluginDirs.forEach(pluginDir => {
    console.log(`\nChecking ${pluginDir}:`);
    
    const pluginPath = path.join('..', pluginDir);
    const pluginJsonPath = path.join(pluginPath, 'plugin.json');
    const packageJsonPath = path.join(pluginPath, 'package.json');
    
    // Check if plugin directory exists
    if (!fs.existsSync(pluginPath)) {
      logIssue(pluginDir, 'error', 'Plugin directory does not exist');
      return;
    }
    
    // Check plugin.json
    if (!fs.existsSync(pluginJsonPath)) {
      logIssue(pluginDir, 'error', 'plugin.json does not exist');
      return;
    }
    
    let pluginJson, packageJson;
    
    try {
      pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
      logSuccess(pluginDir, 'plugin.json is valid JSON');
    } catch (e) {
      logIssue(pluginDir, 'error', `plugin.json is invalid JSON: ${e.message}`);
      return;
    }
    
    // Check package.json
    if (!fs.existsSync(packageJsonPath)) {
      logIssue(pluginDir, 'error', 'package.json does not exist');
      return;
    }
    
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      logSuccess(pluginDir, 'package.json is valid JSON');
    } catch (e) {
      logIssue(pluginDir, 'error', `package.json is invalid JSON: ${e.message}`);
      return;
    }
    
    // Check for deprecated library field
    if (pluginJson.library) {
      logIssue(pluginDir, 'warning', 'Uses deprecated "library" field in plugin.json');
    } else {
      logSuccess(pluginDir, 'No deprecated "library" field');
    }
    
    // Check main field consistency
    if (packageJson.main) {
      const mainFile = path.join(pluginPath, packageJson.main);
      if (fs.existsSync(mainFile)) {
        logSuccess(pluginDir, `Main file exists: ${packageJson.main}`);
      } else {
        logIssue(pluginDir, 'error', `Main file does not exist: ${packageJson.main}`);
      }
    } else {
      logIssue(pluginDir, 'warning', 'No "main" field in package.json');
    }
    
    // Check NodeBB v4 compatibility
    if (packageJson.nbbpm && packageJson.nbbpm.compatibility) {
      const compatibility = packageJson.nbbpm.compatibility;
      if (compatibility.includes('4.0.0') || compatibility.includes('^4')) {
        logSuccess(pluginDir, `NodeBB v4 compatible: ${compatibility}`);
      } else {
        logIssue(pluginDir, 'warning', `May not be NodeBB v4 compatible: ${compatibility}`);
      }
    } else {
      logIssue(pluginDir, 'warning', 'No NodeBB compatibility specified');
    }
    
    // Check hooks configuration
    if (pluginJson.hooks && Array.isArray(pluginJson.hooks)) {
      const hasAppLoad = pluginJson.hooks.some(hook => hook.hook === 'static:app.load');
      if (hasAppLoad) {
        logSuccess(pluginDir, 'Has static:app.load hook');
      } else {
        logIssue(pluginDir, 'warning', 'No static:app.load hook found');
      }
    } else {
      logIssue(pluginDir, 'warning', 'No hooks configuration');
    }
    
    // Check plugin ID consistency
    if (pluginJson.id && packageJson.name) {
      if (pluginJson.id === packageJson.name) {
        logSuccess(pluginDir, 'Plugin ID matches package name');
      } else {
        logIssue(pluginDir, 'warning', `Plugin ID mismatch: plugin.json="${pluginJson.id}", package.json="${packageJson.name}"`);
      }
    }
  });
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('=== VERIFICATION SUMMARY ===');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`⚠️  Warnings: ${results.warnings}`);
  console.log(`❌ Errors: ${results.failed}`);
  
  if (results.failed === 0) {
    console.log('\n🎉 All critical issues resolved!');
    console.log('Plugins should now load correctly in NodeBB v4.');
  } else {
    console.log('\n⚠️  Critical issues found that need to be resolved.');
  }
  
  if (results.warnings > 0) {
    console.log('\n📝 Warnings (recommended to fix):');
    results.issues
      .filter(issue => issue.type === 'warning')
      .forEach(issue => {
        console.log(`   • [${issue.plugin}] ${issue.message}`);
      });
  }
  
  if (results.failed > 0) {
    console.log('\n🚨 Critical Errors (must fix):');
    results.issues
      .filter(issue => issue.type === 'error')
      .forEach(issue => {
        console.log(`   • [${issue.plugin}] ${issue.message}`);
      });
  }
  
  console.log('\n📋 Recommended Actions:');
  console.log('1. Restart NodeBB after fixing configuration issues');
  console.log('2. Check NodeBB logs for any remaining plugin loading errors');
  console.log('3. Verify plugin activation in NodeBB admin panel');
  console.log('4. Test API endpoints to ensure functionality');
  
  return results.failed === 0;
}

// Run verification
if (require.main === module) {
  const success = verifyPluginConfig();
  process.exit(success ? 0 : 1);
}

module.exports = { verifyPluginConfig };