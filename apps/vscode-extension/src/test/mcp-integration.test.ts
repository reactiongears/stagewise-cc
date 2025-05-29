import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { mcpToolbarIntegration } from '../mcp/integration';
import { toolbarBridge } from '../utils/toolbar-bridge';
import { imageCache } from '../utils/image-processing';
import {
  responseCache,
  mcpRateLimiter,
  performanceMetrics,
} from '../utils/performance';
import { errorLogger } from '../utils/error-handling';
import { getConfiguration } from '../utils/configuration';

suite('MCP Integration Test Suite', () => {
  vscode.window.showInformationMessage('Start MCP integration tests.');

  setup(() => {
    // Clear caches and reset state before each test
    imageCache.clear();
    responseCache.clear();
    mcpRateLimiter.reset();
    performanceMetrics.clear();
    errorLogger.clear();
    toolbarBridge.clear();
  });

  test('Configuration validation', () => {
    try {
      const config = getConfiguration();
      assert.strictEqual(typeof config.stagewise.server.port, 'number');
      assert.strictEqual(typeof config.stagewise.mcp.enabled, 'boolean');
      assert.ok(config.stagewise.server.port >= 1024);
      assert.ok(config.stagewise.server.port <= 65535);
    } catch (error) {
      assert.fail(`Configuration validation failed: ${error}`);
    }
  });

  test('Image cache operations', () => {
    const testImage = {
      base64: 'test_base64_data',
      mimeType: 'image/png' as const,
      width: 100,
      height: 100,
    };

    // Test set and get
    imageCache.set('test_key', testImage);
    const retrieved = imageCache.get('test_key');
    assert.deepStrictEqual(retrieved, testImage);

    // Test clear
    imageCache.clear();
    assert.strictEqual(imageCache.get('test_key'), undefined);
    assert.strictEqual(imageCache.size, 0);
  });

  test('Response cache with TTL', async () => {
    const testData = { foo: 'bar' };

    // Set with short TTL
    responseCache.set('test_key', testData, 100); // 100ms TTL
    assert.deepStrictEqual(responseCache.get('test_key'), testData);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.strictEqual(responseCache.get('test_key'), undefined);
  });

  test('Rate limiter functionality', async () => {
    const key = 'test_endpoint';

    // Should allow initial requests
    for (let i = 0; i < 5; i++) {
      const allowed = await mcpRateLimiter.checkLimit(key);
      assert.strictEqual(allowed, true);
    }

    // Check remaining requests
    const remaining = mcpRateLimiter.getRemainingRequests(key);
    assert.ok(remaining >= 0);

    // Reset and verify
    mcpRateLimiter.reset(key);
    assert.ok(mcpRateLimiter.getRemainingRequests(key) > 0);
  });

  test('Toolbar bridge message processing', async () => {
    // Test DOM metadata update
    const mockDOMMetadata = {
      type: 'dom-metadata',
      data: {
        elements: [
          {
            selector: '.test-element',
            tagName: 'DIV',
            attributes: { class: 'test-element' },
          },
        ],
        url: 'https://example.com',
        timestamp: Date.now(),
      },
    };

    try {
      await toolbarBridge.processToolbarMessage(mockDOMMetadata);
      const latestMetadata = toolbarBridge.getLatestDOMMetadata();
      assert.ok(latestMetadata);
      assert.strictEqual(latestMetadata.url, 'https://example.com');
    } catch (error) {
      assert.fail(`Toolbar bridge processing failed: ${error}`);
    }
  });

  test('Performance metrics recording', () => {
    // Record some metrics
    performanceMetrics.recordMetric('test_operation', 100);
    performanceMetrics.recordMetric('test_operation', 200);
    performanceMetrics.recordMetric('test_operation', 150);

    // Check average
    const avg = performanceMetrics.getAverage('test_operation');
    assert.strictEqual(avg, 150);

    // Check percentile
    const p50 = performanceMetrics.getPercentile('test_operation', 50);
    assert.strictEqual(p50, 150);
  });

  test('Error logging and retrieval', () => {
    const testError = new Error('Test error');
    const context = {
      operation: 'test_operation',
      timestamp: new Date(),
    };

    errorLogger.log(testError, context);

    const recentErrors = errorLogger.getRecentErrors(1);
    assert.strictEqual(recentErrors.length, 1);
    assert.strictEqual(recentErrors[0].error.message, 'Test error');
    assert.strictEqual(recentErrors[0].context.operation, 'test_operation');
  });

  test('MCP-Toolbar integration initialization', async () => {
    try {
      await mcpToolbarIntegration.initialize();
      // Verify initialization succeeded
      // In a real test, we'd check specific integration points
    } catch (error) {
      assert.fail(`MCP-Toolbar integration failed: ${error}`);
    }
  });

  test('Base64 validation', () => {
    // Test valid base64
    const validBase64 = 'SGVsbG8gV29ybGQ='; // "Hello World"
    const invalidBase64 = 'Not@Valid#Base64!';

    // Simple validation function
    const isValidBase64 = (str: string): boolean => {
      try {
        return Buffer.from(str, 'base64').toString('base64') === str;
      } catch {
        return false;
      }
    };

    assert.strictEqual(isValidBase64(validBase64), true);
    assert.strictEqual(isValidBase64(invalidBase64), false);
  });

  test('Circuit breaker pattern', async () => {
    const { CircuitBreaker } = await import('../utils/error-handling');
    const breaker = new CircuitBreaker(3, 1000); // 3 failures, 1 second timeout

    let callCount = 0;
    const failingFunction = async () => {
      callCount++;
      throw new Error('Simulated failure');
    };

    // Should fail 3 times and then open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(failingFunction);
      } catch {
        // Expected to fail
      }
    }

    // Circuit should be open now
    try {
      await breaker.execute(failingFunction);
      assert.fail('Circuit breaker should be open');
    } catch (error: any) {
      assert.strictEqual(error.code, 'NETWORK_ERROR');
      assert.ok(error.message.includes('temporarily unavailable'));
    }

    // Verify function was called only 3 times
    assert.strictEqual(callCount, 3);
  });
});

suite('MCP Tools Test Suite', () => {
  test('Tool registration and execution', async () => {
    // This would test the actual MCP tool registration
    // In a real test environment, we'd mock the MCP server

    // For now, just verify the tools module exports the expected functions
    const tools = await import('../mcp/tools');
    assert.strictEqual(typeof tools.registerScreenshotTool, 'function');
    assert.strictEqual(typeof tools.registerDOMMetadataTool, 'function');
    assert.strictEqual(typeof tools.registerWorkspaceFileTool, 'function');
    assert.strictEqual(typeof tools.registerAllTools, 'function');
  });
});

suite('Configuration Test Suite', () => {
  test('Environment verification', async () => {
    const { verifyEnvironment } = await import('../utils/configuration');
    const checks = await verifyEnvironment();

    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);

    // Check that each check has required properties
    for (const check of checks) {
      assert.ok(check.name);
      assert.strictEqual(typeof check.passed, 'boolean');
      assert.ok(check.message);
    }
  });
});
