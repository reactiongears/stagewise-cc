import * as vscode from 'vscode';
import {
  type Session,
  type SessionConfig,
  type SessionMetadata,
  type ConversationTurn,
  SessionEventType,
  type SessionStats,
  type SessionListItem,
} from './session-types';
import { SessionStorage } from './session-storage';
import { ConversationHistory } from './conversation-history';
import { Logger } from './logger';

/**
 * Session lifecycle events
 */
export interface SessionLifecycleEvent {
  type:
    | 'created'
    | 'activated'
    | 'deactivated'
    | 'expired'
    | 'archived'
    | 'restored';
  sessionId: string;
  previousSessionId?: string;
  timestamp: Date;
  reason?: string;
}

/**
 * Session manager configuration
 */
export interface SessionManagerConfig {
  autoArchiveAfterDays?: number;
  maxActiveSessions?: number;
  sessionTimeout?: number; // in milliseconds
  autoSaveInterval?: number; // in milliseconds
  enableAutoRecovery?: boolean;
}

/**
 * Session creation options
 */
export interface CreateSessionOptions {
  metadata?: SessionMetadata;
  config?: SessionConfig;
  activate?: boolean;
}

/**
 * Manages session lifecycle, coordination, and policies
 */
export class SessionManager {
  private logger: Logger;
  private storage: SessionStorage;
  private history: ConversationHistory;
  private config: SessionManagerConfig;

  private activeSessionId: string | null = null;
  private sessionTimers: Map<string, NodeJS.Timeout> = new Map();
  private autoSaveTimer?: NodeJS.Timeout;
  private lifecycleEmitter: vscode.EventEmitter<SessionLifecycleEvent>;

  private readonly defaultSessionConfig: SessionConfig = {
    maxTurns: 100,
    maxTokens: 90000,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    autoSave: true,
    compressionEnabled: true,
  };

  constructor(context: vscode.ExtensionContext, config?: SessionManagerConfig) {
    const outputChannel = vscode.window.createOutputChannel(
      'Claude Session Manager',
    );
    this.logger = new Logger(outputChannel);

    this.storage = new SessionStorage(context);
    this.history = new ConversationHistory();
    this.lifecycleEmitter = new vscode.EventEmitter<SessionLifecycleEvent>();

    this.config = {
      autoArchiveAfterDays: config?.autoArchiveAfterDays ?? 7,
      maxActiveSessions: config?.maxActiveSessions ?? 5,
      sessionTimeout: config?.sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
      autoSaveInterval: config?.autoSaveInterval ?? 60 * 1000, // 1 minute
      enableAutoRecovery: config?.enableAutoRecovery ?? true,
    };

    this.initialize();
  }

  /**
   * Initialize session manager
   */
  private async initialize(): Promise<void> {
    // Restore active session
    const activeId = await this.storage.getActiveSessionId();
    if (activeId) {
      const session = await this.storage.getSession(activeId);
      if (session && session.status === 'active') {
        await this.activateSession(activeId);
      }
    }

    // Start auto-save timer
    if (this.config.autoSaveInterval) {
      this.startAutoSave();
    }

    // Start cleanup timer
    this.startCleanupTimer();

    // Subscribe to storage events
    this.storage.onSessionEvent((event) => {
      this.handleStorageEvent(event);
    });

    this.logger.info('Session manager initialized');
  }

  /**
   * Create a new session
   */
  async createSession(options?: CreateSessionOptions): Promise<Session> {
    const sessionId = this.generateSessionId();
    const now = new Date();

    const session: Session = {
      id: sessionId,
      workspaceId:
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'default',
      createdAt: now,
      lastActiveAt: now,
      turns: [],
      metadata: options?.metadata || {},
      config: { ...this.defaultSessionConfig, ...options?.config },
      status: 'active',
      version: '1.0.0',
    };

    // Save session
    await this.storage.saveSession(session);

    // Activate if requested
    if (options?.activate !== false) {
      await this.activateSession(sessionId);
    }

    // Emit lifecycle event
    this.emitLifecycleEvent({
      type: 'created',
      sessionId,
      timestamp: now,
    });

    this.logger.info(`Created new session: ${sessionId}`);
    return session;
  }

  /**
   * Activate a session
   */
  async activateSession(sessionId: string): Promise<boolean> {
    const session = await this.storage.getSession(sessionId);

    if (!session) {
      this.logger.error(`Session not found: ${sessionId}`);
      return false;
    }

    // Deactivate current session if different
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      await this.deactivateCurrentSession();
    }

    // Update session
    session.lastActiveAt = new Date();
    session.status = 'active';

    // Load conversation history
    this.history.loadFromSession(session);

    // Set as active
    this.activeSessionId = sessionId;
    await this.storage.setActiveSession(sessionId);
    await this.storage.saveSession(session);

    // Start session timer
    this.startSessionTimer(sessionId);

    // Emit lifecycle event
    this.emitLifecycleEvent({
      type: 'activated',
      sessionId,
      timestamp: new Date(),
    });

    this.logger.info(`Activated session: ${sessionId}`);
    return true;
  }

  /**
   * Deactivate current session
   */
  async deactivateCurrentSession(): Promise<void> {
    if (!this.activeSessionId) return;

    const sessionId = this.activeSessionId;
    const session = await this.storage.getSession(sessionId);

    if (session) {
      // Save final state
      await this.saveCurrentSession();

      // Stop session timer
      this.stopSessionTimer(sessionId);

      // Clear active session
      this.activeSessionId = null;
      await this.storage.setActiveSession(null);

      // Emit lifecycle event
      this.emitLifecycleEvent({
        type: 'deactivated',
        sessionId,
        timestamp: new Date(),
      });

      this.logger.info(`Deactivated session: ${sessionId}`);
    }
  }

  /**
   * Get current active session
   */
  async getActiveSession(): Promise<Session | null> {
    if (!this.activeSessionId) {
      return null;
    }

    return await this.storage.getSession(this.activeSessionId);
  }

  /**
   * Add a turn to the active session
   */
  async addTurn(
    userMessage: string,
    assistantMessage?: string,
  ): Promise<ConversationTurn | null> {
    const session = await this.getActiveSession();
    if (!session) {
      this.logger.error('No active session to add turn to');
      return null;
    }

    const turn: ConversationTurn = {
      id: this.generateTurnId(),
      userMessage: {
        id: this.generateMessageId(),
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      },
      startTime: new Date(),
      status: assistantMessage ? 'complete' : 'pending',
    };

    if (assistantMessage) {
      turn.assistantMessage = {
        id: this.generateMessageId(),
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
      };
      turn.endTime = new Date();
    }

    // Add to session
    session.turns.push(turn);
    session.lastActiveAt = new Date();

    // Add to history manager
    await this.history.addTurn(session.id, turn);

    // Reset session timer
    this.resetSessionTimer(session.id);

    // Save if auto-save is disabled
    if (!session.config.autoSave) {
      await this.storage.saveSession(session);
    }

    this.logger.debug(`Added turn to session ${session.id}`);
    return turn;
  }

  /**
   * Update the last turn with assistant response
   */
  async updateTurnWithResponse(
    turnId: string,
    assistantMessage: string,
    metadata?: any,
  ): Promise<boolean> {
    const session = await this.getActiveSession();
    if (!session) return false;

    const turn = session.turns.find((t) => t.id === turnId);
    if (!turn) return false;

    turn.assistantMessage = {
      id: this.generateMessageId(),
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date(),
      metadata,
    };

    turn.endTime = new Date();
    turn.status = 'complete';

    // Update in history
    await this.history.addTurn(session.id, turn);

    // Save if auto-save is disabled
    if (!session.config.autoSave) {
      await this.storage.saveSession(session);
    }

    return true;
  }

  /**
   * Archive a session
   */
  async archiveSession(sessionId: string): Promise<boolean> {
    const session = await this.storage.getSession(sessionId);
    if (!session) return false;

    // Cannot archive active session
    if (sessionId === this.activeSessionId) {
      await this.deactivateCurrentSession();
    }

    // Update status
    session.status = 'archived';
    await this.storage.saveSession(session);

    // Clear from history manager
    this.history.clearHistory(sessionId);

    // Emit lifecycle event
    this.emitLifecycleEvent({
      type: 'archived',
      sessionId,
      timestamp: new Date(),
    });

    this.logger.info(`Archived session: ${sessionId}`);
    return true;
  }

  /**
   * Restore an archived session
   */
  async restoreSession(sessionId: string): Promise<boolean> {
    const session = await this.storage.getSession(sessionId);

    if (!session || session.status !== 'archived') {
      return false;
    }

    // Update status
    session.status = 'active';
    session.lastActiveAt = new Date();
    await this.storage.saveSession(session);

    // Emit lifecycle event
    this.emitLifecycleEvent({
      type: 'restored',
      sessionId,
      timestamp: new Date(),
    });

    this.logger.info(`Restored session: ${sessionId}`);
    return true;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    // Cannot delete active session
    if (sessionId === this.activeSessionId) {
      await this.deactivateCurrentSession();
    }

    // Remove from storage
    const deleted = await this.storage.deleteSession(sessionId);

    if (deleted) {
      // Clear from history
      this.history.clearHistory(sessionId);

      // Stop any timers
      this.stopSessionTimer(sessionId);

      this.logger.info(`Deleted session: ${sessionId}`);
    }

    return deleted;
  }

  /**
   * List all sessions
   */
  async listSessions(includeArchived = false): Promise<SessionListItem[]> {
    const allItems = await this.storage.searchSessions({});

    if (includeArchived) {
      return allItems;
    }

    return allItems.filter((item) => item.status !== 'archived');
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string): Promise<SessionStats | null> {
    const session = await this.storage.getSession(sessionId);
    if (!session) return null;

    const historyStats = this.history.getStats(sessionId);

    return {
      totalTurns: session.turns.length,
      totalTokens: historyStats.estimatedTokens,
      totalOperations: session.turns.reduce((sum, turn) => {
        return sum + (turn.assistantMessage?.metadata?.operations?.length || 0);
      }, 0),
      duration: session.lastActiveAt.getTime() - session.createdAt.getTime(),
      branches: session.branches?.length || 0,
    };
  }

  /**
   * Export session data
   */
  async exportSession(sessionId: string): Promise<string> {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const conversationExport = this.history.exportConversation(sessionId);
    const stats = await this.getSessionStats(sessionId);

    let output = `# Session Export\n\n`;
    output += `## Metadata\n`;
    output += `- ID: ${session.id}\n`;
    output += `- Created: ${session.createdAt.toISOString()}\n`;
    output += `- Last Active: ${session.lastActiveAt.toISOString()}\n`;
    output += `- Status: ${session.status}\n`;
    output += `- Turns: ${stats?.totalTurns || 0}\n`;
    output += `- Estimated Tokens: ${stats?.totalTokens || 0}\n\n`;

    output += conversationExport;

    return output;
  }

  /**
   * Subscribe to lifecycle events
   */
  onLifecycleEvent(
    handler: (event: SessionLifecycleEvent) => void,
  ): vscode.Disposable {
    return this.lifecycleEmitter.event(handler);
  }

  // Private helper methods

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return `ses_${timestamp}_${random}`;
  }

  private generateTurnId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `turn_${timestamp}_${random}`;
  }

  private generateMessageId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `msg_${timestamp}_${random}`;
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(async () => {
      await this.saveCurrentSession();
    }, this.config.autoSaveInterval!);

    this.logger.debug('Started auto-save timer');
  }

  private async saveCurrentSession(): Promise<void> {
    if (!this.activeSessionId) return;

    const session = await this.storage.getSession(this.activeSessionId);
    if (session && session.config.autoSave) {
      await this.storage.saveSession(session);
      this.logger.debug(`Auto-saved session: ${this.activeSessionId}`);
    }
  }

  private startSessionTimer(sessionId: string): void {
    this.stopSessionTimer(sessionId);

    const timer = setTimeout(async () => {
      await this.handleSessionTimeout(sessionId);
    }, this.config.sessionTimeout!);

    this.sessionTimers.set(sessionId, timer);
  }

  private stopSessionTimer(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }

  private resetSessionTimer(sessionId: string): void {
    this.startSessionTimer(sessionId);
  }

  private async handleSessionTimeout(sessionId: string): Promise<void> {
    this.logger.info(`Session timeout: ${sessionId}`);

    if (sessionId === this.activeSessionId) {
      await this.deactivateCurrentSession();
    }

    // Mark session as expired
    const session = await this.storage.getSession(sessionId);
    if (session && session.status === 'active') {
      session.status = 'expired';
      await this.storage.saveSession(session);

      this.emitLifecycleEvent({
        type: 'expired',
        sessionId,
        timestamp: new Date(),
        reason: 'timeout',
      });
    }
  }

  private startCleanupTimer(): void {
    // Run cleanup daily
    setInterval(
      async () => {
        await this.performCleanup();
      },
      24 * 60 * 60 * 1000,
    );

    // Run initial cleanup after 1 minute
    setTimeout(async () => {
      await this.performCleanup();
    }, 60 * 1000);
  }

  private async performCleanup(): Promise<void> {
    this.logger.info('Performing session cleanup');

    const sessions = await this.storage.getAllSessions();
    const now = Date.now();
    const archiveThreshold =
      this.config.autoArchiveAfterDays! * 24 * 60 * 60 * 1000;

    let archivedCount = 0;
    let deletedCount = 0;

    for (const session of sessions) {
      const age = now - session.lastActiveAt.getTime();

      // Auto-archive old active sessions
      if (session.status === 'active' && age > archiveThreshold) {
        await this.archiveSession(session.id);
        archivedCount++;
      }

      // Delete very old archived sessions (2x archive threshold)
      if (session.status === 'archived' && age > archiveThreshold * 2) {
        await this.deleteSession(session.id);
        deletedCount++;
      }
    }

    // Archive old conversations in history
    await this.history.archiveOldConversations(sessions);

    // Enforce max active sessions
    const activeSessions = sessions
      .filter((s) => s.status === 'active')
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

    if (activeSessions.length > this.config.maxActiveSessions!) {
      const toArchive = activeSessions.slice(this.config.maxActiveSessions!);
      for (const session of toArchive) {
        await this.archiveSession(session.id);
        archivedCount++;
      }
    }

    this.logger.info(
      `Cleanup complete: archived ${archivedCount}, deleted ${deletedCount} sessions`,
    );
  }

  private handleStorageEvent(event: any): void {
    // Handle storage events if needed
    if (
      event.type === SessionEventType.DELETED &&
      event.sessionId === this.activeSessionId
    ) {
      this.activeSessionId = null;
    }
  }

  private emitLifecycleEvent(event: SessionLifecycleEvent): void {
    this.lifecycleEmitter.fire(event);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionManagerConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart timers if intervals changed
    if (config.autoSaveInterval !== undefined) {
      if (this.autoSaveTimer) {
        clearInterval(this.autoSaveTimer);
      }
      if (config.autoSaveInterval > 0) {
        this.startAutoSave();
      }
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // Stop all timers
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    for (const timer of this.sessionTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionTimers.clear();

    // Dispose sub-components
    this.storage.dispose();
    this.history.dispose();
    this.lifecycleEmitter.dispose();
  }
}
