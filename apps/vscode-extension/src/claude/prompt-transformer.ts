import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import type {
  ClaudePromptContext,
  PromptValidationResult,
  PromptSection,
  ContextStrategy,
  FileInfo,
} from './prompt-context';
import { ContextFormatter } from './context-formatter';
import { TokenManager } from './token-manager';
import { SYSTEM_PROMPT_TEMPLATE } from './prompt-templates';
import { Logger } from './logger';

export class PromptTransformer extends EventEmitter {
  private formatter: ContextFormatter;
  private tokenManager: TokenManager;
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    super();
    this.formatter = new ContextFormatter();
    this.tokenManager = new TokenManager();
    this.outputChannel = vscode.window.createOutputChannel(
      'Claude Prompt Transformer',
    );
    this.logger = new Logger(this.outputChannel);
  }

  async transform(context: ClaudePromptContext): Promise<string> {
    this.logger.info('Starting prompt transformation', {
      strategy: context.strategy,
      hasWorkspace: !!context.workspaceMetadata,
      domElementCount: context.domElements?.length || 0,
      pluginCount: context.pluginContexts?.length || 0,
    });

    try {
      // Build system and user prompts
      const systemPrompt = this.buildSystemPrompt(context);
      const userPrompt = await this.buildUserPrompt(context);

      // Combine prompts
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      // Validate the prompt
      const validation = this.validatePrompt(fullPrompt);
      if (!validation.isValid) {
        this.logger.error('Prompt validation failed', validation.errors);
        throw new Error(`Invalid prompt: ${validation.errors.join(', ')}`);
      }

      this.logger.info('Prompt transformation complete', {
        totalTokens: validation.estimatedTokens,
        sections: validation.sections?.length || 0,
      });

      return fullPrompt;
    } catch (error) {
      this.logger.error('Failed to transform prompt', error);
      throw error;
    }
  }

  buildSystemPrompt(context: ClaudePromptContext): string {
    const sections: string[] = [SYSTEM_PROMPT_TEMPLATE];

    // Add workspace overview if available
    if (context.workspaceMetadata) {
      const workspaceOverview = this.formatter.formatWorkspaceContext(
        context.workspaceMetadata,
      );
      sections.push(`## Workspace Context\n${workspaceOverview}`);
    }

    // Add context strategy information
    sections.push(`## Context Strategy: ${context.strategy || 'standard'}`);

    return sections.join('\n\n');
  }

  async buildUserPrompt(context: ClaudePromptContext): Promise<string> {
    const sections: PromptSection[] = [];

    // Always include user message first
    sections.push({
      type: 'user_message',
      content: `## User Request\n${context.userMessage}`,
      priority: 1,
      tokens: this.tokenManager.estimateTokens(context.userMessage),
    });

    // Add DOM elements if present
    if (context.domElements && context.domElements.length > 0) {
      const domContent = this.formatter.formatDOMElements(context.domElements);
      sections.push({
        type: 'dom_elements',
        content: `## Selected Elements\n${domContent}`,
        priority: 2,
        tokens: this.tokenManager.estimateTokens(domContent),
      });
    }

    // Add current file context
    if (context.workspaceMetadata?.activeFile) {
      const currentFile = context.workspaceMetadata.activeFile;
      const fileContent = await this.formatter.formatFileContent([currentFile]);
      sections.push({
        type: 'current_file',
        content: `## Current File\n${fileContent}`,
        priority: 3,
        tokens: this.tokenManager.estimateTokens(fileContent),
      });
    }

    // Add related files based on strategy
    if (
      context.strategy !== 'minimal' &&
      context.workspaceMetadata?.projectStructure
    ) {
      const relatedFiles = this.selectRelatedFiles(context);
      if (relatedFiles.length > 0) {
        const relatedContent =
          await this.formatter.formatFileContent(relatedFiles);
        sections.push({
          type: 'related_files',
          content: `## Related Files\n${relatedContent}`,
          priority: 4,
          tokens: this.tokenManager.estimateTokens(relatedContent),
        });
      }
    }

    // Add plugin context
    if (context.pluginContexts && context.pluginContexts.length > 0) {
      const pluginContent = this.formatter.formatPluginContext(
        context.pluginContexts,
      );
      sections.push({
        type: 'plugin_context',
        content: `## Plugin Context\n${pluginContent}`,
        priority: 5,
        tokens: this.tokenManager.estimateTokens(pluginContent),
      });
    }

    // Allocate tokens and trim sections to fit
    const tokenBudget = this.tokenManager.calculateTokenBudget(
      context.maxTokens || 100000,
    );
    const userPromptBudget = tokenBudget.userPrompt;
    const trimmedSections = this.tokenManager.trimToFit(
      sections,
      userPromptBudget,
    );

    // Combine sections into final user prompt
    return trimmedSections
      .sort((a, b) => a.priority - b.priority)
      .map((section) => section.content)
      .join('\n\n');
  }

  validatePrompt(prompt: string): PromptValidationResult {
    const errors: string[] = [];
    const sections = prompt.split(/^##\s+/m).filter((s) => s.trim());
    const estimatedTokens = this.tokenManager.estimateTokens(prompt);

    // Check for minimum content
    if (prompt.length < 50) {
      errors.push('Prompt is too short');
    }

    // Check for user message
    if (!prompt.includes('User Request')) {
      errors.push('Missing user request section');
    }

    // Check token limits
    if (estimatedTokens > 100000) {
      errors.push(`Prompt exceeds token limit: ${estimatedTokens} > 100000`);
    }

    // Check for proper formatting
    if (!prompt.includes('## ')) {
      errors.push('Missing section headers');
    }

    return {
      isValid: errors.length === 0,
      errors,
      estimatedTokens,
      sections: sections.map((s) => s.split('\n')[0].trim()),
    };
  }

  private selectRelatedFiles(context: ClaudePromptContext): FileInfo[] {
    if (!context.workspaceMetadata?.projectStructure) return [];

    const relatedFiles: FileInfo[] = [];
    const currentFilePath = context.workspaceMetadata.activeFile?.path;

    if (!currentFilePath) return [];

    // For now, return empty array since we don't have the files list in ProjectStructure
    // This would need to be implemented based on the actual project structure
    return relatedFiles;
  }

  private applyContextStrategy(
    sections: PromptSection[],
    strategy: ContextStrategy,
  ): PromptSection[] {
    switch (strategy) {
      case 'minimal':
        // Only keep high priority sections
        return sections.filter((s) => s.priority <= 2);

      case 'comprehensive':
        // Include all sections
        return sections;

      case 'standard':
      default:
        // Include most sections but skip low priority ones if space is limited
        return sections.filter((s) => s.priority <= 4);
    }
  }
}
