export interface ClaudeSession {
  id: string;
  startTime: Date;
  lastActivity: Date;
  history: ConversationEntry[];
  context: SessionContext;
  metadata: SessionMetadata;
}

export interface ConversationEntry {
  id: string;
  timestamp: Date;
  role: 'user' | 'assistant';
  content: string;
  metadata?: EntryMetadata;
}

export interface EntryMetadata {
  model?: string;
  tokenCount?: number;
  processingTime?: number;
  error?: string;
  context?: ContextSnapshot;
}

export interface SessionContext {
  workspaceContext?: WorkspaceContext;
  fileContext?: FileContext;
  domContext?: DomContext;
  customContext?: Record<string, any>;
}

export interface WorkspaceContext {
  rootPath: string;
  name: string;
  folders: string[];
  openFiles: string[];
  gitBranch?: string;
  gitStatus?: string;
}

export interface FileContext {
  filePath: string;
  content: string;
  language: string;
  selection?: TextSelection;
  symbols?: SymbolInfo[];
}

export interface TextSelection {
  start: Position;
  end: Position;
  text: string;
}

export interface Position {
  line: number;
  character: number;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  location: Position;
}

export interface DomContext {
  url?: string;
  selector?: string;
  elementInfo?: ElementInfo;
  screenshot?: string;
  pageTitle?: string;
}

export interface ElementInfo {
  tagName: string;
  className?: string;
  id?: string;
  attributes: Record<string, string>;
  computedStyles?: Record<string, string>;
  boundingRect?: BoundingRect;
  innerHTML?: string;
  outerHTML?: string;
}

export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionMetadata {
  name?: string;
  description?: string;
  tags?: string[];
  projectId?: string;
  userId?: string;
}

export interface ContextSnapshot {
  timestamp: Date;
  workspace?: WorkspaceContext;
  file?: FileContext;
  dom?: DomContext;
}

export interface ClaudeRequest {
  prompt: string;
  context?: SessionContext;
  options?: RequestOptions;
}

export interface RequestOptions {
  stream?: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ClaudeStreamResponse {
  id: string;
  chunk: string;
  isComplete: boolean;
  metadata?: ResponseMetadata;
}

export interface ClaudeCompleteResponse {
  id: string;
  content: string;
  metadata: ResponseMetadata;
}

export interface ResponseMetadata {
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  processingTime: number;
  cached?: boolean;
}

export interface ServiceHealth {
  subprocess: ComponentHealth;
  auth: ComponentHealth;
  config: ComponentHealth;
  overall: HealthStatus;
  lastCheck: Date;
}

export interface ComponentHealth {
  status: HealthStatus;
  message?: string;
  details?: Record<string, any>;
}

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown'
}

export interface SessionManager {
  createSession(metadata?: SessionMetadata): ClaudeSession;
  getSession(id: string): ClaudeSession | undefined;
  getCurrentSession(): ClaudeSession | undefined;
  setCurrentSession(id: string): void;
  updateSession(id: string, updates: Partial<ClaudeSession>): void;
  deleteSession(id: string): void;
  getAllSessions(): ClaudeSession[];
  saveSession(id: string): Promise<void>;
  loadSession(id: string): Promise<ClaudeSession | undefined>;
  exportSession(id: string): Promise<string>;
  importSession(data: string): Promise<ClaudeSession>;
}

export interface ContextEnricher {
  enrichWorkspaceContext(): Promise<WorkspaceContext>;
  enrichFileContext(uri?: string): Promise<FileContext | undefined>;
  enrichDomContext(data?: any): Promise<DomContext | undefined>;
  buildContext(options: ContextOptions): Promise<SessionContext>;
}

export interface ContextOptions {
  includeWorkspace?: boolean;
  includeFile?: boolean;
  includeDom?: boolean;
  fileUri?: string;
  domData?: any;
  custom?: Record<string, any>;
}