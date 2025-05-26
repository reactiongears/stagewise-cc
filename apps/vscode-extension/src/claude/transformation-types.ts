/**
 * Plugin and transformation type definitions for Claude prompt context
 */

/**
 * Context data provided by plugins
 */
export interface PluginContextData {
  /**
   * Unique identifier for the plugin
   */
  pluginId: string;

  /**
   * Human-readable plugin name
   */
  name: string;

  /**
   * Plugin version
   */
  version: string;

  /**
   * Type of context provided by the plugin
   */
  contextType: PluginContextType;

  /**
   * Plugin-specific context data
   */
  data: any;

  /**
   * Metadata about the plugin context
   */
  metadata: PluginMetadata;
}

/**
 * Types of context that plugins can provide
 */
export enum PluginContextType {
  /**
   * React/Vue/Angular component information
   */
  COMPONENT_INFO = 'component_info',

  /**
   * Application state data (Redux, Vuex, etc.)
   */
  STATE_DATA = 'state_data',

  /**
   * API schema and documentation
   */
  API_SCHEMA = 'api_schema',

  /**
   * User preferences and settings
   */
  USER_PREFERENCES = 'user_preferences',

  /**
   * Design system tokens and variables
   */
  DESIGN_SYSTEM = 'design_system',

  /**
   * Database schema information
   */
  DATABASE_SCHEMA = 'database_schema',

  /**
   * Custom plugin-defined type
   */
  CUSTOM = 'custom',
}

/**
 * Metadata about plugin-provided context
 */
export interface PluginMetadata {
  /**
   * Priority order for including in final prompt (1-100)
   */
  priority: number;

  /**
   * Estimated token usage for this context
   */
  tokenWeight: number;

  /**
   * Whether this context must be included
   */
  isRequired: boolean;

  /**
   * Description of what this context provides
   */
  description: string;

  /**
   * Tags for categorizing the context
   */
  tags?: string[];

  /**
   * Timestamp when the context was generated
   */
  timestamp?: Date;
}

/**
 * Options for transforming context into prompts
 */
export interface TransformationOptions {
  /**
   * Maximum tokens for the entire context
   */
  maxTokens: number;

  /**
   * Whether to include base64 encoded images
   */
  includeImages: boolean;

  /**
   * How deep to traverse nested structures
   */
  contextDepth: number;

  /**
   * Output format preferences
   */
  formatting: FormattingOptions;

  /**
   * Whether to include code snippets
   */
  includeCode: boolean;

  /**
   * Whether to summarize long content
   */
  summarizeLongContent: boolean;

  /**
   * Language for the output
   */
  outputLanguage: string;

  /**
   * Custom transformation rules
   */
  customRules?: TransformationRule[];
}

/**
 * Formatting options for prompt output
 */
export interface FormattingOptions {
  /**
   * Style of formatting
   */
  style: FormattingStyle;

  /**
   * Whether to use markdown formatting
   */
  useMarkdown: boolean;

  /**
   * Whether to include section headers
   */
  includeSectionHeaders: boolean;

  /**
   * Line width for wrapping
   */
  lineWidth?: number;

  /**
   * Indentation style
   */
  indentStyle: 'spaces' | 'tabs';

  /**
   * Number of spaces for indentation
   */
  indentSize: number;
}

/**
 * Formatting styles
 */
export enum FormattingStyle {
  /**
   * Compact format with minimal whitespace
   */
  COMPACT = 'compact',

  /**
   * Standard readable format
   */
  STANDARD = 'standard',

  /**
   * Verbose format with detailed explanations
   */
  VERBOSE = 'verbose',

  /**
   * Technical format for code-heavy contexts
   */
  TECHNICAL = 'technical',
}

/**
 * Custom transformation rule
 */
export interface TransformationRule {
  /**
   * Rule identifier
   */
  id: string;

  /**
   * Pattern to match (regex or function)
   */
  pattern: string | ((data: any) => boolean);

  /**
   * Transformation to apply
   */
  transform: (data: any) => any;

  /**
   * Priority for rule application
   */
  priority: number;

  /**
   * Whether to continue processing after this rule
   */
  continueProcessing: boolean;
}

/**
 * Result of a transformation operation
 */
export interface TransformationResult {
  /**
   * The transformed prompt text
   */
  prompt: string;

  /**
   * Metadata about the transformation
   */
  metadata: TransformationMetadata;

  /**
   * Any warnings generated during transformation
   */
  warnings?: TransformationWarning[];

  /**
   * Statistics about the transformation
   */
  stats: TransformationStats;
}

/**
 * Metadata about a transformation
 */
export interface TransformationMetadata {
  /**
   * Total tokens used
   */
  tokenCount: number;

  /**
   * Sections included in the prompt
   */
  includedSections: string[];

  /**
   * Sections excluded due to token limits
   */
  excludedSections?: string[];

  /**
   * Transformation strategy used
   */
  strategy: string;

  /**
   * Time taken for transformation (ms)
   */
  processingTime: number;
}

/**
 * Warning generated during transformation
 */
export interface TransformationWarning {
  /**
   * Warning type
   */
  type: WarningType;

  /**
   * Warning message
   */
  message: string;

  /**
   * Context about the warning
   */
  context?: any;
}

/**
 * Types of transformation warnings
 */
export enum WarningType {
  /**
   * Content was truncated
   */
  TRUNCATION = 'truncation',

  /**
   * Content was omitted
   */
  OMISSION = 'omission',

  /**
   * Error during transformation
   */
  ERROR = 'error',

  /**
   * Performance issue
   */
  PERFORMANCE = 'performance',

  /**
   * Data quality issue
   */
  QUALITY = 'quality',
}

/**
 * Statistics about a transformation
 */
export interface TransformationStats {
  /**
   * Number of workspace files included
   */
  filesIncluded: number;

  /**
   * Number of DOM elements included
   */
  domElementsIncluded: number;

  /**
   * Number of plugin contexts included
   */
  pluginContextsIncluded: number;

  /**
   * Total characters in the prompt
   */
  totalCharacters: number;

  /**
   * Compression ratio (if applicable)
   */
  compressionRatio?: number;
}

/**
 * Default transformation options
 */
export const DEFAULT_TRANSFORMATION_OPTIONS: TransformationOptions = {
  maxTokens: 4000,
  includeImages: false,
  contextDepth: 3,
  formatting: {
    style: FormattingStyle.STANDARD,
    useMarkdown: true,
    includeSectionHeaders: true,
    indentStyle: 'spaces',
    indentSize: 2,
  },
  includeCode: true,
  summarizeLongContent: true,
  outputLanguage: 'en',
};

/**
 * Validates plugin context data
 */
export function validatePluginContextData(
  data: any,
): data is PluginContextData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.pluginId === 'string' &&
    typeof data.name === 'string' &&
    typeof data.version === 'string' &&
    Object.values(PluginContextType).includes(data.contextType) &&
    data.metadata &&
    typeof data.metadata === 'object'
  );
}

/**
 * Creates default plugin metadata
 */
export function createDefaultPluginMetadata(): PluginMetadata {
  return {
    priority: 50,
    tokenWeight: 100,
    isRequired: false,
    description: 'Plugin-provided context',
    timestamp: new Date(),
  };
}

/**
 * Estimates token usage for plugin context
 */
export function estimatePluginTokenUsage(context: PluginContextData): number {
  // Use provided estimate if available
  if (context.metadata.tokenWeight) {
    return context.metadata.tokenWeight;
  }

  // Otherwise estimate based on data size
  const dataString = JSON.stringify(context.data);
  return Math.ceil(dataString.length / 4);
}
