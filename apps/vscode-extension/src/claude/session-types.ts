import { FileOperation } from './code-extractor';

/**
 * Represents a single message in a conversation
 */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    tokenCount?: number;
    model?: string;
    temperature?: number;
    operations?: FileOperation[];
    error?: string;
  };
}

/**
 * Represents a conversation turn (user message + assistant response)
 */
export interface ConversationTurn {
  id: string;
  userMessage: ConversationMessage;
  assistantMessage?: ConversationMessage;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'complete' | 'error';
  branchId?: string;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  maxTurns?: number;
  maxTokens?: number;
  maxAge?: number; // in milliseconds
  autoSave?: boolean;
  compressionEnabled?: boolean;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  projectPath?: string;
  language?: string;
  framework?: string;
}

/**
 * Represents a conversation session
 */
export interface Session {
  id: string;
  workspaceId: string;
  createdAt: Date;
  lastActiveAt: Date;
  turns: ConversationTurn[];
  metadata: SessionMetadata;
  config: SessionConfig;
  status: 'active' | 'archived' | 'expired';
  version: string;
  branches?: SessionBranch[];
  currentBranchId?: string;
}

/**
 * Represents a branch in conversation
 */
export interface SessionBranch {
  id: string;
  parentBranchId?: string;
  branchPointTurnId: string;
  createdAt: Date;
  name?: string;
  description?: string;
  turns: ConversationTurn[];
}

/**
 * Session storage format for persistence
 */
export interface StoredSession {
  session: Session;
  compressed?: boolean;
  checksum?: string;
}

/**
 * Session list item for UI display
 */
export interface SessionListItem {
  id: string;
  title: string;
  lastActive: Date;
  turnCount: number;
  status: Session['status'];
  preview?: string;
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalTurns: number;
  totalTokens: number;
  totalOperations: number;
  duration: number;
  branches: number;
}

/**
 * Session event types
 */
export enum SessionEventType {
  CREATED = 'session.created',
  UPDATED = 'session.updated',
  ARCHIVED = 'session.archived',
  DELETED = 'session.deleted',
  BRANCHED = 'session.branched',
  RESTORED = 'session.restored'
}

/**
 * Session event
 */
export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: Date;
  data?: any;
}

/**
 * Session search criteria
 */
export interface SessionSearchCriteria {
  query?: string;
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  status?: Session['status'][];
  hasOperations?: boolean;
}

/**
 * Session export format
 */
export interface SessionExport {
  version: string;
  exportDate: Date;
  sessions: StoredSession[];
  metadata: {
    workspaceId: string;
    totalSessions: number;
    dateRange: {
      earliest: Date;
      latest: Date;
    };
  };
}