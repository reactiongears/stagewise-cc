import type {
  ConversationMessage,
  Session as BaseSession,
} from '../session-types';

export interface Message extends ConversationMessage {
  attachments?: Attachment[];
  editedAt?: Date;
  reactions?: Reaction[];
}

export interface Attachment {
  id: string;
  type: 'file' | 'image' | 'code' | 'link';
  name: string;
  path?: string;
  content?: string;
  metadata?: Record<string, any>;
}

export interface Reaction {
  type: 'like' | 'dislike' | 'bookmark' | 'flag';
  userId: string;
  timestamp: Date;
}

export interface Session extends BaseSession {
  messages: Message[];
  context: SessionContext;
  state: SessionState;
}

export interface SessionContext {
  workspaceFiles: string[];
  activeFile?: string;
  selectedText?: string;
  domContext?: any;
  customContext?: Record<string, any>;
  maxTokens: number;
  tokenCount: number;
}

export enum SessionState {
  ACTIVE = 'active',
  IDLE = 'idle',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}

export interface SessionInfo {
  id: string;
  name: string;
  createdAt: Date;
  lastAccessedAt: Date;
  messageCount: number;
  state: SessionState;
}

export interface MessageMetadata {
  tokenCount?: number;
  model?: string;
  temperature?: number;
  processingTime?: number;
  cost?: number;
}

export interface ConversationContext {
  messages: Message[];
  systemPrompt?: string;
  contextWindow: number;
  includeSystemMessages: boolean;
  compressionEnabled: boolean;
}

export interface KeyPoint {
  id: string;
  content: string;
  importance: 'high' | 'medium' | 'low';
  timestamp: Date;
  messageId: string;
}

export enum ContextStrategy {
  FULL = 'full', // All messages
  RECENT = 'recent', // Last N messages
  RELEVANT = 'relevant', // Topic-relevant messages
  SUMMARY = 'summary', // Summarized context
}

export interface HistoryOptions {
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
  includeDeleted?: boolean;
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  messageId: string;
  sessionId: string;
  content: string;
  matches: Match[];
  score: number;
}

export interface Match {
  start: number;
  end: number;
  text: string;
}

export enum ExportFormat {
  JSON = 'json',
  MARKDOWN = 'markdown',
  HTML = 'html',
  PDF = 'pdf',
}

export interface ProcessMetrics {
  messagesProcessed: number;
  tokensUsed: number;
  averageResponseTime: number;
  errorRate: number;
}

export interface SessionRecoveryData {
  sessionId: string;
  lastMessageId?: string;
  unsavedMessages: Message[];
  context: SessionContext;
  timestamp: Date;
}
