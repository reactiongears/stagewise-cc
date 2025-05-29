import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type {
  ClaudePromptContext,
  DOMElementContext,
} from '../claude/prompt-context';
import { DOMSerializer } from '../claude/dom-serializer';
import { EnhancedPromptTransformer } from '../claude/prompt-transformer-enhanced';
import { PromptIntegration } from '../claude/prompt-integration';

describe('Prompt Formatting and Context Enhancement', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('ClaudePromptContext Interface', () => {
    it('should create valid context with all fields', () => {
      const context: ClaudePromptContext = {
        userMessage: 'Fix the error in my code',
        selectedElements: [
          {
            tagName: 'button',
            id: 'submit-btn',
            className: 'btn btn-primary',
            attributes: { type: 'submit', disabled: 'false' },
            textContent: 'Submit',
            isVisible: true,
          },
        ],
        currentUrl: 'http://localhost:3000/form',
        pageTitle: 'Contact Form',
        workspaceInfo: {
          rootPath: '/project',
          activeFile: {
            path: 'src/form.tsx',
            language: 'typescriptreact',
            content: 'const Form = () => { return <form>...</form> }',
          },
          openFiles: [],
        },
        images: [
          {
            data: 'base64...',
            type: 'screenshot',
            metadata: {
              width: 1920,
              height: 1080,
              format: 'png',
              timestamp: Date.now(),
            },
            description: 'Form validation error',
          },
        ],
        metadata: {
          timestamp: Date.now(),
          source: 'toolbar',
          action: 'fix-error',
          sessionId: 'test-session',
          priority: 'high',
        },
      };

      assert.strictEqual(context.userMessage, 'Fix the error in my code');
      assert.strictEqual(context.selectedElements?.length, 1);
      assert.strictEqual(context.images?.length, 1);
      assert.strictEqual(context.metadata.source, 'toolbar');
    });
  });

  describe('DOMSerializer', () => {
    let serializer: DOMSerializer;

    beforeEach(() => {
      serializer = new DOMSerializer();
    });

    it('should serialize DOM element with all properties', () => {
      const elementData = {
        tagName: 'INPUT',
        id: 'email-input',
        className: 'form-control',
        attributes: {
          type: 'email',
          name: 'email',
          placeholder: 'Enter email',
          required: 'true',
        },
        textContent: '',
        boundingBox: { x: 100, y: 200, width: 300, height: 40 },
        isVisible: true,
        computedStyles: {
          display: 'block',
          fontSize: '16px',
        },
        eventListeners: ['change', 'blur'],
      };

      const serialized = serializer.serializeDOMElement(elementData);

      assert.strictEqual(serialized?.tagName, 'input');
      assert.strictEqual(serialized?.id, 'email-input');
      assert.strictEqual(serialized?.className, 'form-control');
      assert.strictEqual(serialized?.attributes.type, 'email');
      assert.strictEqual(serialized?.boundingBox?.width, 300);
      assert.deepStrictEqual(serialized?.eventListeners, ['change', 'blur']);
    });

    it('should handle nested elements', () => {
      const elementData = {
        tagName: 'DIV',
        className: 'container',
        children: [
          {
            tagName: 'H1',
            textContent: 'Title',
            isVisible: true,
          },
          {
            tagName: 'P',
            textContent: 'Description',
            isVisible: true,
          },
        ],
        isVisible: true,
      };

      const serialized = serializer.serializeDOMElement(elementData);

      assert.strictEqual(serialized?.childElements?.length, 2);
      assert.strictEqual(serialized?.childElements?.[0].tagName, 'h1');
      assert.strictEqual(
        serialized?.childElements?.[1].textContent,
        'Description',
      );
    });

    it('should generate human-readable description', () => {
      const element: DOMElementContext = {
        tagName: 'button',
        id: 'save-btn',
        className: 'btn primary',
        attributes: {
          type: 'submit',
          'aria-label': 'Save changes',
        },
        textContent: 'Save',
        isVisible: true,
        boundingBox: { x: 50, y: 100, width: 100, height: 40 },
      };

      const description = serializer.generateElementDescription(element);

      assert(description.includes('<button'));
      assert(description.includes('id="save-btn"'));
      assert(description.includes('class="btn primary"'));
      assert(description.includes('Save'));
      assert(description.includes('@ (50,100) 100x40'));
    });
  });

  describe('EnhancedPromptTransformer', () => {
    let transformer: EnhancedPromptTransformer;

    beforeEach(() => {
      transformer = new EnhancedPromptTransformer();
    });

    it('should transform context with all sections', async () => {
      const context: ClaudePromptContext = {
        userMessage: 'Help me fix this bug',
        selectedElements: [
          {
            tagName: 'div',
            className: 'error-message',
            textContent: 'TypeError: Cannot read property',
            attributes: {},
            isVisible: true,
          },
        ],
        currentUrl: 'http://localhost:3000',
        pageTitle: 'My App',
        workspaceInfo: {
          rootPath: '/project',
          activeFile: {
            path: 'src/app.js',
            language: 'javascript',
            content: 'const app = () => { console.log(data.value) }',
            selection: {
              startLine: 0,
              startColumn: 32,
              endLine: 0,
              endColumn: 42,
              text: 'data.value',
            },
          },
          openFiles: [],
          projectStructure: {
            name: 'my-app',
            tree: { name: 'my-app', path: '.', type: 'directory' },
            keyFiles: ['package.json', 'tsconfig.json'],
            projectType: 'react',
          },
        },
        metadata: {
          timestamp: Date.now(),
          source: 'toolbar',
        },
      };

      const result = await transformer.transformContext(context);

      assert(result.prompt.includes('### User Request'));
      assert(result.prompt.includes('Help me fix this bug'));
      assert(result.prompt.includes('### Selected DOM Elements'));
      assert(result.prompt.includes('error-message'));
      assert(result.prompt.includes('### Workspace Context'));
      assert(result.prompt.includes('src/app.js'));
      assert(result.prompt.includes('data.value'));
      assert(result.metadata.totalTokens > 0);
    });

    it('should handle images correctly', async () => {
      const context: ClaudePromptContext = {
        userMessage: 'What is shown in this screenshot?',
        workspaceInfo: {
          rootPath: '/project',
          openFiles: [],
        },
        images: [
          {
            data: 'base64encodeddata...',
            type: 'screenshot',
            metadata: {
              width: 1920,
              height: 1080,
              format: 'png',
            },
            description: 'Application error state',
          },
        ],
        metadata: {
          timestamp: Date.now(),
          source: 'toolbar',
        },
      };

      const result = await transformer.transformContext(context);

      assert(result.prompt.includes('### Attached Images'));
      assert(result.prompt.includes('Application error state'));
      assert(result.prompt.includes('1920×1080'));
      assert(result.imageData?.length === 1);
      assert.strictEqual(result.imageData?.[0].type, 'screenshot');
    });

    it('should respect token limits', async () => {
      const largeContent = 'x'.repeat(50000); // Large content
      const context: ClaudePromptContext = {
        userMessage: 'Analyze this',
        workspaceInfo: {
          rootPath: '/project',
          activeFile: {
            path: 'large.js',
            language: 'javascript',
            content: largeContent,
          },
          openFiles: [],
        },
        metadata: {
          timestamp: Date.now(),
          source: 'toolbar',
        },
      };

      const result = await transformer.transformContext(context, {
        maxTokens: 10000,
      });

      assert(result.metadata.truncated);
      assert(result.metadata.totalTokens <= 10000);
      assert(result.prompt.includes('(truncated)'));
    });
  });

  describe('PromptIntegration', () => {
    let integration: PromptIntegration;

    beforeEach(() => {
      integration = new PromptIntegration();

      // Mock workspace collector
      sandbox
        .stub(integration.workspaceCollector, 'gatherWorkspaceInfo')
        .resolves({
          rootPath: '/test-project',
          name: 'Test Project',
          folders: [],
          activeFile: {
            path: 'test.js',
            language: 'javascript',
            isModified: false,
            lineCount: 10,
            lastModified: new Date(),
          },
          openFiles: [],
        });
    });

    it('should process prompt request end-to-end', async () => {
      const request = {
        message: 'Fix the error',
        domElements: [
          {
            tagName: 'DIV',
            className: 'error',
            textContent: 'Error occurred',
            isVisible: true,
          },
        ],
        images: [
          {
            data: 'base64...',
            type: 'screenshot',
            width: 800,
            height: 600,
          },
        ],
        url: 'http://localhost:3000',
        pageTitle: 'Test Page',
        source: 'toolbar' as const,
      };

      const result = await integration.processPromptRequest(request);

      assert.strictEqual(result.context.userMessage, 'Fix the error');
      assert(result.prompt.includes('Fix the error'));
      assert(result.prompt.includes('error'));
      assert(result.images?.length === 1);
      assert(result.metadata.processingTime > 0);
      assert(result.metadata.totalTokens > 0);
    });

    it('should handle minimal request', async () => {
      const request = {
        message: 'Help me',
      };

      const result = await integration.processPromptRequest(request);

      assert.strictEqual(result.context.userMessage, 'Help me');
      assert(result.prompt.includes('Help me'));
      assert(result.metadata.sectionCount >= 1);
    });
  });
});
