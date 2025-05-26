import { FileOperation, OperationType, RiskLevel } from './code-extractor';

/**
 * Complete diff preview for multiple files
 */
export interface DiffPreview {
  fileOperations: FileDiff[];
  summary: DiffSummary;
  metadata: DiffMetadata;
}

/**
 * Diff information for a single file
 */
export interface FileDiff {
  path: string;
  operation: FileOperation;
  hunks: DiffHunk[];
  language?: string;
  originalContent?: string;
  modifiedContent?: string;
  stats: DiffStats;
}

/**
 * A contiguous section of changes
 */
export interface DiffHunk {
  startLine: number;
  endLine: number;
  additions: number;
  deletions: number;
  changes: DiffChange[];
  context?: string;
}

/**
 * Individual line change
 */
export interface DiffChange {
  type: 'add' | 'delete' | 'context' | 'modify';
  lineNumber: number;
  content: string;
  originalLine?: number;
  modifiedLine?: number;
}

/**
 * Summary of all changes
 */
export interface DiffSummary {
  totalFiles: number;
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  totalAdditions: number;
  totalDeletions: number;
  riskLevel: RiskLevel;
  estimatedReviewTime: number; // in minutes
}

/**
 * Metadata about the diff
 */
export interface DiffMetadata {
  generatedAt: Date;
  generatedBy: string;
  sessionId?: string;
  context?: string;
  warnings: string[];
  suggestions: string[];
}

/**
 * Statistics for a single file diff
 */
export interface DiffStats {
  additions: number;
  deletions: number;
  modifications: number;
  totalChanges: number;
  percentageChanged: number;
}

/**
 * Result of showing a preview
 */
export interface PreviewResult {
  action: 'apply' | 'reject' | 'modify' | 'cancel';
  selectedOperations?: string[]; // Operation IDs
  modifiedOperations?: FileOperation[];
  userFeedback?: string;
}

/**
 * Side-by-side view structure
 */
export interface SideBySideView {
  left: SideContent;
  right: SideContent;
  synchronizedScrolling: boolean;
}

/**
 * Content for one side of side-by-side view
 */
export interface SideContent {
  lines: SideLine[];
  title: string;
  language?: string;
}

/**
 * Line in side-by-side view
 */
export interface SideLine {
  lineNumber?: number;
  content: string;
  type: 'normal' | 'added' | 'deleted' | 'modified' | 'empty';
  highlight?: boolean;
}

/**
 * Inline view structure
 */
export interface InlineView {
  lines: InlineLine[];
  title: string;
  language?: string;
}

/**
 * Line in inline view
 */
export interface InlineLine {
  lineNumber: number;
  content: string;
  type: 'context' | 'addition' | 'deletion' | 'modification';
  oldContent?: string; // For modifications
}

/**
 * Options for diff generation
 */
export interface DiffOptions {
  contextLines?: number;
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  algorithm?: 'myers' | 'patience' | 'histogram';
  format?: 'unified' | 'sideBySide' | 'inline';
}

/**
 * Change categorization
 */
export interface ChangeCategory {
  type: 'refactor' | 'feature' | 'bugfix' | 'style' | 'docs' | 'test' | 'other';
  confidence: number;
  description: string;
}

/**
 * Risk assessment for changes
 */
export interface RiskAssessment {
  level: RiskLevel;
  factors: RiskFactor[];
  recommendations: string[];
  requiresReview: boolean;
}

/**
 * Individual risk factor
 */
export interface RiskFactor {
  type: 'breaking-change' | 'security' | 'performance' | 'complexity' | 'dependency';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation?: string;
}