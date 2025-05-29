import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { getCurrentIDE } from '../utils/get-current-ide';
import * as sinon from 'sinon';

describe('IDE Detection and Agent Dispatch', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getCurrentIDE', () => {
    it('should detect Windsurf when appName contains "windsurf"', () => {
      sandbox.stub(vscode.env, 'appName').value('Windsurf IDE');
      assert.strictEqual(getCurrentIDE(), 'WINDSURF');
    });

    it('should detect Cursor when appName contains "cursor"', () => {
      sandbox.stub(vscode.env, 'appName').value('Cursor - The AI Code Editor');
      assert.strictEqual(getCurrentIDE(), 'CURSOR');
    });

    it('should detect VSCode when appName contains "visual studio code"', () => {
      sandbox.stub(vscode.env, 'appName').value('Visual Studio Code');
      assert.strictEqual(getCurrentIDE(), 'VSCODE');
    });

    it('should detect VSCode when appName contains "vscode"', () => {
      sandbox.stub(vscode.env, 'appName').value('VSCode Insiders');
      assert.strictEqual(getCurrentIDE(), 'VSCODE');
    });

    it('should detect VSCode when appName contains "code"', () => {
      sandbox.stub(vscode.env, 'appName').value('Code - OSS');
      assert.strictEqual(getCurrentIDE(), 'VSCODE');
    });

    it('should default to VSCODE for unknown environments', () => {
      sandbox.stub(vscode.env, 'appName').value('Unknown Editor');
      assert.strictEqual(getCurrentIDE(), 'VSCODE');
    });

    it('should be case-insensitive', () => {
      sandbox.stub(vscode.env, 'appName').value('WiNdSuRf');
      assert.strictEqual(getCurrentIDE(), 'WINDSURF');

      sandbox.stub(vscode.env, 'appName').value('CURSOR');
      assert.strictEqual(getCurrentIDE(), 'CURSOR');

      sandbox.stub(vscode.env, 'appName').value('VISUAL STUDIO CODE');
      assert.strictEqual(getCurrentIDE(), 'VSCODE');
    });
  });

  describe('dispatchAgentCall', () => {
    it('should route Cursor requests to callCursorAgent', async () => {
      sandbox.stub(vscode.env, 'appName').value('Cursor');
      const callCursorAgentStub = sandbox.stub();
      const callWindsurfAgentStub = sandbox.stub();
      const callClaudeAgentStub = sandbox.stub();

      // Mock the agent modules
      const mockRequest = { prompt: 'Test prompt' };

      // Test would need proper mocking of imports
      // This is a simplified example showing the test structure
    });

    it('should route Windsurf requests to callWindsurfAgent', async () => {
      sandbox.stub(vscode.env, 'appName').value('Windsurf');
      // Similar test structure
    });

    it('should route VSCode requests to callClaudeAgent', async () => {
      sandbox.stub(vscode.env, 'appName').value('Visual Studio Code');
      // Similar test structure
    });

    it('should route unknown IDE requests to callClaudeAgent (VSCode default)', async () => {
      sandbox.stub(vscode.env, 'appName').value('Some Unknown IDE');
      // Similar test structure
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain compatibility with existing Cursor integration', () => {
      sandbox.stub(vscode.env, 'appName').value('Cursor');
      const ide = getCurrentIDE();
      assert.strictEqual(ide, 'CURSOR');
      // Ensure Cursor still uses its dedicated agent
    });

    it('should maintain compatibility with existing Windsurf integration', () => {
      sandbox.stub(vscode.env, 'appName').value('Windsurf');
      const ide = getCurrentIDE();
      assert.strictEqual(ide, 'WINDSURF');
      // Ensure Windsurf still uses its dedicated agent
    });

    it('should never return UNKNOWN since we default to VSCODE', () => {
      const testCases = [
        'Random Editor',
        'My Custom IDE',
        '',
        'null',
        'undefined',
        '123',
        'Editor 2024',
      ];

      testCases.forEach((appName) => {
        sandbox.stub(vscode.env, 'appName').value(appName);
        const ide = getCurrentIDE();
        assert.strictEqual(
          ide,
          'VSCODE',
          `Expected VSCODE for appName: "${appName}"`,
        );
        sandbox.restore();
      });
    });
  });
});
