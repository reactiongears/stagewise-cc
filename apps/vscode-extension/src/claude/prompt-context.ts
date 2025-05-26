import type { WorkspaceInfo, FileInfo } from './workspace-types';
import type { DOMElementData } from './dom-types';
import type { PluginContextData } from './transformation-types';

// Re-export for convenience
export type { WorkspaceInfo, FileInfo } from './workspace-types';
export type { DOMElementData } from './dom-types';
export type { PluginContextData } from './transformation-types';

/**
 * Main interface defining the structure for Claude prompt context data.
 * This serves as the contract between context-gathering components and the prompt transformation engine.
 */
export interface ClaudePromptContext {
  /**
   * The main user prompt/message
   */
  userMessage: string;
  
  /**
   * Current browser URL when the prompt was sent (if applicable)
   */
  currentUrl?: string;
  
  /**
   * Timestamp when the prompt was created
   */
  timestamp: Date;
  
  /**
   * Workspace metadata including file information and project context
   */
  workspaceInfo?: WorkspaceInfo;
  
  /**
   * Workspace metadata (alternative property name for compatibility)
   */
  workspaceMetadata?: WorkspaceInfo;
  
  /**
   * Selected DOM elements from the browser
   */
  selectedElements?: DOMElementData[];
  
  /**
   * DOM elements (alternative property name for compatibility)
   */
  domElements?: DOMElementData[];
  
  /**
   * Context data provided by plugins
   */
  pluginContext?: PluginContextData[];
  
  /**
   * Plugin contexts (alternative property name for compatibility)
   */
  pluginContexts?: PluginContextData[];
  
  /**
   * Metadata for transformation and optimization
   */
  metadata?: ContextMetadata;
  
  /**
   * Context strategy (can be at top level or in metadata)
   */
  strategy?: ContextStrategy | string;
  
  /**
   * Maximum tokens for the prompt
   */
  maxTokens?: number;
}

/**
 * Metadata for controlling context transformation
 */
export interface ContextMetadata {
  /**
   * Schema version for migration compatibility
   */
  version: string;
  
  /**
   * Conversation session ID for context continuity
   */
  sessionId?: string;
  
  /**
   * Strategy for building context
   */
  contextStrategy: ContextStrategy;
  
  /**
   * Maximum tokens allocated for context
   */
  tokenBudget: number;
  
  /**
   * Priority order for including context elements
   */
  priority: ContextPriority[];
}

/**
 * Strategy for context building
 */
export enum ContextStrategy {
  /**
   * Include only essential context
   */
  MINIMAL = 'minimal',
  
  /**
   * Include standard context for most use cases
   */
  STANDARD = 'standard',
  
  /**
   * Include all available context
   */
  COMPREHENSIVE = 'comprehensive'
}

/**
 * Priority levels for different context types
 */
export enum ContextPriority {
  /**
   * Currently active file content
   */
  CURRENT_FILE = 'current_file',
  
  /**
   * Selected DOM elements
   */
  SELECTED_ELEMENTS = 'selected_elements',
  
  /**
   * High-level workspace overview
   */
  WORKSPACE_OVERVIEW = 'workspace_overview',
  
  /**
   * Related files (imports, dependencies)
   */
  RELATED_FILES = 'related_files',
  
  /**
   * Plugin-provided context data
   */
  PLUGIN_DATA = 'plugin_data'
}

/**
 * Default context metadata
 */
export const DEFAULT_CONTEXT_METADATA: ContextMetadata = {
  version: '1.0.0',
  contextStrategy: ContextStrategy.STANDARD,
  tokenBudget: 4000,
  priority: [
    ContextPriority.CURRENT_FILE,
    ContextPriority.SELECTED_ELEMENTS,
    ContextPriority.WORKSPACE_OVERVIEW,
    ContextPriority.RELATED_FILES,
    ContextPriority.PLUGIN_DATA
  ]
};

/**
 * Validates if an object conforms to the ClaudePromptContext interface
 */
export function validateClaudePromptContext(context: any): context is ClaudePromptContext {
  return (
    context &&
    typeof context === 'object' &&
    typeof context.userMessage === 'string' &&
    context.timestamp instanceof Date &&
    context.workspaceInfo &&
    typeof context.workspaceInfo === 'object' &&
    context.metadata &&
    typeof context.metadata === 'object' &&
    typeof context.metadata.version === 'string' &&
    isValidContextStrategy(context.metadata.contextStrategy) &&
    typeof context.metadata.tokenBudget === 'number' &&
    Array.isArray(context.metadata.priority)
  );
}

/**
 * Type guard for ContextStrategy
 */
export function isValidContextStrategy(strategy: string): strategy is ContextStrategy {
  return Object.values(ContextStrategy).includes(strategy as ContextStrategy);
}

/**
 * Type guard for ContextPriority
 */
export function isValidContextPriority(priority: string): priority is ContextPriority {
  return Object.values(ContextPriority).includes(priority as ContextPriority);
}

/**
 * Token budget allocation
 */
export interface TokenBudget {
  total: number;
  systemPrompt: number;
  userPrompt: number;
  userMessage: number;
  domElements: number;
  currentFile: number;
  relatedFiles: number;
  workspaceContext: number;
  pluginContext: number;
}

/**
 * Token allocation result
 */
export interface TokenAllocation {
  total: number;
  used: number;
  sections: Array<{
    type: keyof TokenBudget;
    used: number;
    budget: number;
  }>;
}

/**
 * Prompt section for token management
 */
export interface PromptSection {
  type: string;
  content: string;
  priority: number;
  tokens: number;
}

/**
 * Prompt validation result
 */
export interface PromptValidationResult {
  isValid: boolean;
  errors: string[];
  estimatedTokens: number;
  sections?: string[];
}

/**
 * Creates an empty context with default values
 */
export function createEmptyContext(): ClaudePromptContext {
  return {
    userMessage: '',
    timestamp: new Date(),
    workspaceInfo: {
      rootPath: '',
      name: 'Unknown',
      folders: [],
      openFiles: [],
      recentFiles: [],
      projectStructure: {
        frameworks: [],
        dependencies: []
      }
    },
    metadata: { ...DEFAULT_CONTEXT_METADATA }
  };
}

/**
 * Merges two contexts, with the additional context taking precedence
 */
export function mergeContexts(
  base: ClaudePromptContext,
  additional: Partial<ClaudePromptContext>
): ClaudePromptContext {
  const merged: ClaudePromptContext = {
    ...base,
    ...additional
  };
  
  // Handle workspaceInfo merge
  if (base.workspaceInfo && additional.workspaceInfo) {
    merged.workspaceInfo = {
      ...base.workspaceInfo,
      ...additional.workspaceInfo
    };
  }
  
  // Handle metadata merge
  if (base.metadata && additional.metadata) {
    merged.metadata = {
      ...base.metadata,
      ...additional.metadata
    };
  }
  
  return merged;
}

/**
 * Estimates token usage for a context (rough approximation)
 * Uses ~4 characters per token as a heuristic
 */
export function estimateTokenUsage(context: ClaudePromptContext): number {
  let charCount = 0;
  
  // Count user message
  charCount += context.userMessage.length;
  
  // Count URL
  if (context.currentUrl) {
    charCount += context.currentUrl.length;
  }
  
  // Count workspace info (simplified)
  charCount += JSON.stringify(context.workspaceInfo).length;
  
  // Count DOM elements
  if (context.selectedElements) {
    charCount += JSON.stringify(context.selectedElements).length;
  }
  
  // Count plugin context
  if (context.pluginContext) {
    charCount += JSON.stringify(context.pluginContext).length;
  }
  
  // Rough estimate: 4 characters per token
  return Math.ceil(charCount / 4);
}

/**
 * Serializes context to JSON string
 */
export function serializeContext(context: ClaudePromptContext): string {
  return JSON.stringify(context, null, 2);
}

/**
 * Deserializes context from JSON string
 */
export function deserializeContext(serialized: string): ClaudePromptContext {
  const parsed = JSON.parse(serialized);
  
  // Convert timestamp string back to Date
  if (parsed.timestamp) {
    parsed.timestamp = new Date(parsed.timestamp);
  }
  
  if (!validateClaudePromptContext(parsed)) {
    throw new Error('Invalid ClaudePromptContext format');
  }
  
  return parsed;
}