import * as vscode from 'vscode';
import type {
  ClaudePromptContext,
  DOMElementContext,
  ImageContext,
  WorkspaceInfo,
} from './prompt-context';
import { DOMSerializer } from './dom-serializer';
import { Logger } from './logger';
import { WorkspaceCollector } from './workspace-collector';

/**
 * Enhanced prompt transformer that handles all context types including images
 */
export class EnhancedPromptTransformer {
  private readonly logger = new Logger('EnhancedPromptTransformer');
  private readonly domSerializer = new DOMSerializer();
  private readonly workspaceCollector = WorkspaceCollector.getInstance();

  // Token limits for different sections
  private readonly TOKEN_LIMITS = {
    total: 100000,
    userMessage: 10000,
    workspace: 20000,
    domElements: 15000,
    images: 5000,
    metadata: 1000,
  };

  /**
   * Transform a full context into a Claude-optimized prompt
   */
  async transformContext(
    context: ClaudePromptContext,
    options?: TransformOptions,
  ): Promise<TransformedPrompt> {
    const startTime = Date.now();

    try {
      // Build prompt sections
      const sections: PromptSection[] = [];

      // 1. User message (highest priority)
      sections.push({
        type: 'user_message',
        content: this.formatUserMessage(context.userMessage),
        priority: 1,
        tokens: this.estimateTokens(context.userMessage),
      });

      // 2. DOM elements context
      if (context.selectedElements && context.selectedElements.length > 0) {
        sections.push({
          type: 'dom_elements',
          content: this.formatDOMElements(context.selectedElements),
          priority: 2,
          tokens: this.estimateTokens(JSON.stringify(context.selectedElements)),
        });
      }

      // 3. Workspace context
      if (context.workspaceInfo) {
        const workspaceSection = await this.formatWorkspaceContext(
          context.workspaceInfo,
          options,
        );
        sections.push({
          type: 'workspace',
          content: workspaceSection,
          priority: 3,
          tokens: this.estimateTokens(workspaceSection),
        });
      }

      // 4. Image context
      if (context.images && context.images.length > 0) {
        sections.push({
          type: 'images',
          content: this.formatImageContext(context.images),
          priority: 4,
          tokens: this.estimateTokens(JSON.stringify(context.images)),
        });
      }

      // 5. Page context
      if (context.currentUrl || context.pageTitle) {
        sections.push({
          type: 'page_context',
          content: this.formatPageContext(
            context.currentUrl,
            context.pageTitle,
          ),
          priority: 5,
          tokens: 100,
        });
      }

      // Optimize sections for token limits
      const optimizedSections = this.optimizeSections(sections, options);

      // Build final prompt
      const prompt = this.buildFinalPrompt(optimizedSections, context.metadata);

      // Prepare image data for API
      const imageData = context.images
        ? this.prepareImageData(context.images)
        : undefined;

      const transformTime = Date.now() - startTime;

      return {
        prompt,
        imageData,
        metadata: {
          totalTokens: this.estimateTokens(prompt),
          sectionCount: optimizedSections.length,
          transformTime,
          truncated: this.wasTruncated(sections, optimizedSections),
        },
      };
    } catch (error) {
      this.logger.error('Failed to transform context', error);
      throw new Error(`Prompt transformation failed: ${error}`);
    }
  }

  /**
   * Format user message
   */
  private formatUserMessage(message: string): string {
    return `### User Request\n\n${message}`;
  }

  /**
   * Format DOM elements section
   */
  private formatDOMElements(elements: DOMElementContext[]): string {
    const lines: string[] = ['### Selected DOM Elements\n'];

    elements.forEach((element, index) => {
      lines.push(
        `#### Element ${index + 1}: ${this.domSerializer.generateElementDescription(element)}`,
      );

      // Element details
      if (element.id || element.className) {
        lines.push(`**Identification:**`);
        if (element.id) lines.push(`- ID: \`${element.id}\``);
        if (element.className)
          lines.push(`- Classes: \`${element.className}\``);
        lines.push('');
      }

      // Attributes
      if (Object.keys(element.attributes).length > 0) {
        lines.push(`**Attributes:**`);
        Object.entries(element.attributes).forEach(([key, value]) => {
          lines.push(`- ${key}: "${value}"`);
        });
        lines.push('');
      }

      // Position and visibility
      if (element.boundingBox) {
        const { x, y, width, height } = element.boundingBox;
        lines.push(`**Position:** (${x}, ${y}), Size: ${width}×${height}`);
      }
      lines.push(`**Visible:** ${element.isVisible ? 'Yes' : 'No'}`);
      lines.push('');

      // Text content
      if (element.textContent) {
        lines.push(`**Text Content:**`);
        lines.push('```');
        lines.push(element.textContent);
        lines.push('```\n');
      }

      // Computed styles if relevant
      if (
        element.computedStyles &&
        Object.keys(element.computedStyles).length > 0
      ) {
        lines.push(`**Key Styles:**`);
        Object.entries(element.computedStyles).forEach(([prop, value]) => {
          lines.push(`- ${prop}: ${value}`);
        });
        lines.push('');
      }

      // Event listeners
      if (element.eventListeners && element.eventListeners.length > 0) {
        lines.push(`**Event Listeners:** ${element.eventListeners.join(', ')}`);
        lines.push('');
      }
    });

    return lines.join('\n');
  }

  /**
   * Format workspace context
   */
  private async formatWorkspaceContext(
    workspace: WorkspaceInfo,
    options?: TransformOptions,
  ): Promise<string> {
    const lines: string[] = ['### Workspace Context\n'];

    // Project overview
    lines.push(`**Project Root:** ${workspace.rootPath}`);

    if (workspace.projectStructure) {
      lines.push(
        `**Project Type:** ${workspace.projectStructure.projectType || 'Unknown'}`,
      );

      if (workspace.projectStructure.keyFiles.length > 0) {
        lines.push(`\n**Key Files:**`);
        workspace.projectStructure.keyFiles.slice(0, 10).forEach((file) => {
          lines.push(`- ${file}`);
        });
      }

      if (workspace.projectStructure.dependencies) {
        const deps = Object.entries(
          workspace.projectStructure.dependencies,
        ).slice(0, 10);
        if (deps.length > 0) {
          lines.push(`\n**Main Dependencies:**`);
          deps.forEach(([name, version]) => {
            lines.push(`- ${name}: ${version}`);
          });
        }
      }
    }

    // Git info
    if (workspace.gitInfo) {
      lines.push(`\n**Git Information:**`);
      lines.push(`- Branch: ${workspace.gitInfo.branch || 'unknown'}`);
      lines.push(`- Status: ${workspace.gitInfo.status || 'unknown'}`);

      if (
        workspace.gitInfo.modifiedFiles &&
        workspace.gitInfo.modifiedFiles.length > 0
      ) {
        lines.push(
          `- Modified Files: ${workspace.gitInfo.modifiedFiles.length}`,
        );
      }
    }

    // Active file
    if (workspace.activeFile) {
      lines.push(`\n**Active File:** ${workspace.activeFile.path}`);
      lines.push(`**Language:** ${workspace.activeFile.language}`);

      if (workspace.activeFile.selection) {
        const sel = workspace.activeFile.selection;
        lines.push(
          `**Selection:** Lines ${sel.startLine + 1}-${sel.endLine + 1}`,
        );
        lines.push(`\`\`\`${workspace.activeFile.language}`);
        lines.push(sel.text);
        lines.push('```');
      } else if (workspace.activeFile.content && options?.includeFileContent) {
        // Include file content if requested and no selection
        const preview = workspace.activeFile.content.substring(0, 1000);
        lines.push(`**File Preview:**`);
        lines.push(`\`\`\`${workspace.activeFile.language}`);
        lines.push(preview);
        if (workspace.activeFile.content.length > 1000) {
          lines.push('... (truncated)');
        }
        lines.push('```');
      }

      // Diagnostics
      if (
        workspace.activeFile.diagnostics &&
        workspace.activeFile.diagnostics.length > 0
      ) {
        lines.push(`\n**Diagnostics:**`);
        workspace.activeFile.diagnostics.slice(0, 5).forEach((diag) => {
          const severity = this.getDiagnosticSeverity(diag.severity);
          lines.push(
            `- ${severity}: ${diag.message} (Line ${diag.range.start.line + 1})`,
          );
        });
      }
    }

    // Open files summary
    if (workspace.openFiles.length > 0) {
      lines.push(`\n**Open Files:** ${workspace.openFiles.length} files`);
      workspace.openFiles.slice(0, 5).forEach((file) => {
        lines.push(`- ${file.path} (${file.language})`);
      });
      if (workspace.openFiles.length > 5) {
        lines.push(`- ... and ${workspace.openFiles.length - 5} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format image context
   */
  private formatImageContext(images: ImageContext[]): string {
    const lines: string[] = ['### Attached Images\n'];

    images.forEach((image, index) => {
      lines.push(`#### Image ${index + 1}`);
      lines.push(`**Type:** ${image.type}`);

      if (image.description) {
        lines.push(`**Description:** ${image.description}`);
      }

      if (image.metadata) {
        const { width, height, format } = image.metadata;
        const details: string[] = [];
        if (width && height) details.push(`${width}×${height}`);
        if (format) details.push(format.toUpperCase());
        if (details.length > 0) {
          lines.push(`**Details:** ${details.join(', ')}`);
        }
      }

      if (image.associatedElement) {
        lines.push(
          `**Associated Element:** ${this.domSerializer.generateElementDescription(image.associatedElement)}`,
        );
      }

      lines.push(''); // Empty line between images
    });

    lines.push(
      '*Note: Image data will be provided separately in the API request.*',
    );

    return lines.join('\n');
  }

  /**
   * Format page context
   */
  private formatPageContext(url?: string, title?: string): string {
    const lines: string[] = ['### Page Context\n'];

    if (url) lines.push(`**URL:** ${url}`);
    if (title) lines.push(`**Title:** ${title}`);

    return lines.join('\n');
  }

  /**
   * Optimize sections to fit token limits
   */
  private optimizeSections(
    sections: PromptSection[],
    options?: TransformOptions,
  ): PromptSection[] {
    const maxTokens = options?.maxTokens || this.TOKEN_LIMITS.total;
    const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);

    if (totalTokens <= maxTokens) {
      return sections;
    }

    // Sort by priority (lower number = higher priority)
    const sortedSections = [...sections].sort(
      (a, b) => a.priority - b.priority,
    );
    const optimized: PromptSection[] = [];
    let currentTokens = 0;

    for (const section of sortedSections) {
      if (currentTokens + section.tokens <= maxTokens) {
        optimized.push(section);
        currentTokens += section.tokens;
      } else {
        // Try to truncate the section
        const remainingTokens = maxTokens - currentTokens;
        if (remainingTokens > 1000) {
          // Only include if we have reasonable space
          const truncated = this.truncateSection(section, remainingTokens);
          optimized.push(truncated);
          currentTokens += truncated.tokens;
        }
        break;
      }
    }

    return optimized;
  }

  /**
   * Truncate a section to fit token limit
   */
  private truncateSection(
    section: PromptSection,
    maxTokens: number,
  ): PromptSection {
    const ratio = maxTokens / section.tokens;
    const contentLength = Math.floor(section.content.length * ratio * 0.9); // 90% to be safe

    return {
      ...section,
      content: `${section.content.substring(0, contentLength)}\n\n... (truncated)`,
      tokens: maxTokens,
    };
  }

  /**
   * Build final prompt from sections
   */
  private buildFinalPrompt(sections: PromptSection[], metadata: any): string {
    const header = `## Context Information
Generated at: ${new Date(metadata.timestamp).toISOString()}
Source: ${metadata.source}
${metadata.action ? `Action: ${metadata.action}` : ''}

---

`;

    const content = sections
      .sort((a, b) => a.priority - b.priority)
      .map((s) => s.content)
      .join('\n\n---\n\n');

    return header + content;
  }

  /**
   * Prepare image data for API
   */
  private prepareImageData(images: ImageContext[]): PreparedImageData[] {
    return images.map((image, index) => ({
      index,
      type: image.type,
      data: image.data,
      metadata: image.metadata,
    }));
  }

  /**
   * Estimate token count (simple approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if content was truncated
   */
  private wasTruncated(
    original: PromptSection[],
    optimized: PromptSection[],
  ): boolean {
    return (
      original.length !== optimized.length ||
      original.some(
        (o, i) => !optimized[i] || o.content !== optimized[i].content,
      )
    );
  }

  /**
   * Get diagnostic severity string
   */
  private getDiagnosticSeverity(severity?: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'Error';
      case vscode.DiagnosticSeverity.Warning:
        return 'Warning';
      case vscode.DiagnosticSeverity.Information:
        return 'Info';
      case vscode.DiagnosticSeverity.Hint:
        return 'Hint';
      default:
        return 'Unknown';
    }
  }
}

/**
 * Options for prompt transformation
 */
export interface TransformOptions {
  maxTokens?: number;
  includeFileContent?: boolean;
  includeGitInfo?: boolean;
  includeDiagnostics?: boolean;
}

/**
 * Prompt section with metadata
 */
interface PromptSection {
  type: string;
  content: string;
  priority: number;
  tokens: number;
}

/**
 * Result of prompt transformation
 */
export interface TransformedPrompt {
  prompt: string;
  imageData?: PreparedImageData[];
  metadata: {
    totalTokens: number;
    sectionCount: number;
    transformTime: number;
    truncated: boolean;
  };
}

/**
 * Prepared image data for API
 */
interface PreparedImageData {
  index: number;
  type: string;
  data: string;
  metadata: any;
}
