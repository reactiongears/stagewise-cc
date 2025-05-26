import * as vscode from 'vscode';
import type { 
  TokenBudget, 
  TokenAllocation, 
  PromptSection,
  ClaudePromptContext 
} from './prompt-context';
import { Logger } from './logger';

export class TokenManager {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;
  
  // Token estimation constants (approximations for Claude)
  private readonly CHARS_PER_TOKEN = 4;
  private readonly CODE_TOKEN_MULTIPLIER = 1.2;
  private readonly MARKDOWN_OVERHEAD = 1.1;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Token Manager');
    this.logger = new Logger(this.outputChannel);
  }

  calculateTokenBudget(maxTokens: number): TokenBudget {
    // Use conservative strategy by default (80% of max)
    const totalBudget = Math.floor(maxTokens * 0.8);
    
    // Reserve tokens for system prompt (approximately 500 tokens)
    const systemPromptTokens = 500;
    const availableForUser = totalBudget - systemPromptTokens;

    const budget: TokenBudget = {
      total: totalBudget,
      systemPrompt: systemPromptTokens,
      userPrompt: availableForUser,
      userMessage: Math.floor(availableForUser * 0.1), // 10% for user message
      domElements: Math.floor(availableForUser * 0.3), // 30% for DOM elements
      currentFile: Math.floor(availableForUser * 0.25), // 25% for current file
      relatedFiles: Math.floor(availableForUser * 0.15), // 15% for related files
      workspaceContext: Math.floor(availableForUser * 0.1), // 10% for workspace
      pluginContext: Math.floor(availableForUser * 0.1), // 10% for plugins
    };

    this.logger.info('Calculated token budget', budget);
    return budget;
  }

  estimateTokens(text: string): number {
    if (!text) return 0;

    // Basic character-based estimation
    let tokens = Math.ceil(text.length / this.CHARS_PER_TOKEN);

    // Adjust for code content (uses more tokens)
    const codeBlockCount = (text.match(/```/g) || []).length / 2;
    if (codeBlockCount > 0) {
      tokens = Math.ceil(tokens * this.CODE_TOKEN_MULTIPLIER);
    }

    // Adjust for markdown formatting
    const markdownElements = (text.match(/^#+\s|^\*\s|^\d+\.\s|\*\*|__|```/gm) || []).length;
    if (markdownElements > 5) {
      tokens = Math.ceil(tokens * this.MARKDOWN_OVERHEAD);
    }

    return tokens;
  }

  allocateTokens(context: ClaudePromptContext): TokenAllocation {
    const maxTokens = context.maxTokens || 100000;
    const budget = this.calculateTokenBudget(maxTokens);
    
    const allocation: TokenAllocation = {
      total: budget.total,
      used: 0,
      sections: []
    };

    // Track token usage by section type
    const sectionTypes: Array<{
      type: keyof TokenBudget;
      used: number;
      budget: number;
    }> = [];

    // User message (always included)
    const userMessageTokens = this.estimateTokens(context.userMessage);
    sectionTypes.push({
      type: 'userMessage',
      used: userMessageTokens,
      budget: budget.userMessage
    });
    allocation.used += userMessageTokens;

    // DOM elements
    if (context.domElements && context.domElements.length > 0) {
      const domTokens = this.estimateTokens(JSON.stringify(context.domElements));
      sectionTypes.push({
        type: 'domElements',
        used: domTokens,
        budget: budget.domElements
      });
      allocation.used += Math.min(domTokens, budget.domElements);
    }

    // Workspace context
    if (context.workspaceMetadata) {
      const workspaceTokens = this.estimateTokens(JSON.stringify(context.workspaceMetadata));
      sectionTypes.push({
        type: 'workspaceContext',
        used: workspaceTokens,
        budget: budget.workspaceContext
      });
      allocation.used += Math.min(workspaceTokens, budget.workspaceContext);
    }

    allocation.sections = sectionTypes;
    
    this.logger.info('Token allocation complete', {
      total: allocation.total,
      used: allocation.used,
      remaining: allocation.total - allocation.used
    });

    return allocation;
  }

  trimToFit(sections: PromptSection[], budget: number): PromptSection[] {
    // Sort sections by priority (lower number = higher priority)
    const sortedSections = [...sections].sort((a, b) => a.priority - b.priority);
    
    let totalTokens = 0;
    const includedSections: PromptSection[] = [];
    const trimmedSections: PromptSection[] = [];

    for (const section of sortedSections) {
      if (totalTokens + section.tokens <= budget) {
        // Section fits completely
        includedSections.push(section);
        totalTokens += section.tokens;
      } else {
        // Try to trim the section to fit remaining budget
        const remainingBudget = budget - totalTokens;
        if (remainingBudget > 100) { // Only include if we have reasonable space
          const trimmedSection = this.trimSection(section, remainingBudget);
          if (trimmedSection) {
            trimmedSections.push(trimmedSection);
            totalTokens += trimmedSection.tokens;
          }
        }
        // Skip remaining sections as we're at budget
        break;
      }
    }

    const allSections = [...includedSections, ...trimmedSections];
    
    this.logger.info('Trimmed sections to fit budget', {
      originalCount: sections.length,
      includedCount: allSections.length,
      totalTokens,
      budget
    });

    return allSections;
  }

  private trimSection(section: PromptSection, maxTokens: number): PromptSection | null {
    const estimatedChars = maxTokens * this.CHARS_PER_TOKEN;
    
    if (section.content.length <= estimatedChars) {
      return section;
    }

    // Find a good break point (end of line, paragraph, or sentence)
    let breakPoint = estimatedChars;
    
    // Try to break at paragraph
    const paragraphBreak = section.content.lastIndexOf('\n\n', breakPoint);
    if (paragraphBreak > estimatedChars * 0.7) {
      breakPoint = paragraphBreak;
    } else {
      // Try to break at line
      const lineBreak = section.content.lastIndexOf('\n', breakPoint);
      if (lineBreak > estimatedChars * 0.7) {
        breakPoint = lineBreak;
      } else {
        // Try to break at sentence
        const sentenceBreak = section.content.lastIndexOf('. ', breakPoint);
        if (sentenceBreak > estimatedChars * 0.7) {
          breakPoint = sentenceBreak + 1;
        }
      }
    }

    const trimmedContent = section.content.substring(0, breakPoint) + '\n... (content truncated)';
    
    return {
      ...section,
      content: trimmedContent,
      tokens: this.estimateTokens(trimmedContent)
    };
  }

  getBudgetStrategy(strategy: 'conservative' | 'balanced' | 'aggressive'): number {
    switch (strategy) {
      case 'conservative':
        return 0.8; // Use 80% of max tokens
      case 'balanced':
        return 0.9; // Use 90% of max tokens
      case 'aggressive':
        return 0.95; // Use 95% of max tokens
      default:
        return 0.9;
    }
  }
}