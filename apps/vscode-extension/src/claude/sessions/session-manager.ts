import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import { Logger } from '../logger';
import type {
  Session,
  SessionInfo,
  SessionContext,
  Message,
} from './session-types';

interface SessionOptions {
  name?: string;
  context?: Partial<SessionContext>;
  metadata?: Record<string, any>;
}

/**
 * Manages conversation sessions lifecycle
 */
export class SessionManager extends EventEmitter {
  private readonly logger = new Logger('SessionManager');
  private sessions = new Map<string, Session>();
  private activeSessionId?: string;
  private sessionTimers = new Map<string, NodeJS.Timeout>();
  private readonly maxSessions = 10;
  private readonly sessionTimeout = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceId: string,
  ) {
    super();
    this.loadSessions();
  }

  /**
   * Create a new session
   */
  async createSession(options: SessionOptions = {}): Promise<Session> {
    const sessionId = randomUUID();
    const now = new Date();

    const session: Session = {
      id: sessionId,
      workspaceId: this.workspaceId,
      name: options.name || `Session ${now.toLocaleString()}`,
      createdAt: now,
      lastActiveAt: now,
      messages: [],
      turns: [],
      context: {
        workspaceFiles: [],
        maxTokens: 100000,
        tokenCount: 0,
        ...options.context,
      },
      metadata: {
        ...options.metadata,
      },
      config: {
        maxTurns: 100,
        maxTokens: 100000,
        autoSave: true,
      },
      status: 'active',
      state: SessionState.ACTIVE,
      version: '1.0.0',
    };

    this.sessions.set(sessionId, session);
    this.setActiveSession(sessionId);

    // Start session timer
    this.startSessionTimer(sessionId);

    // Save to storage
    await this.saveSession(session);

    this.logger.info(`Created session: ${sessionId}`);
    this.emit('sessionCreated', session);

    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(id: string): Promise<Session | undefined> {
    let session = this.sessions.get(id);

    if (!session) {
      // Try to load from storage
      session = await this.loadSession(id);
      if (session) {
        this.sessions.set(id, session);
      }
    }

    if (session) {
      // Update last accessed time
      session.lastActiveAt = new Date();
      this.resetSessionTimer(id);
    }

    return session;
  }

  /**
   * Get the active session
   */
  getActiveSession(): Session | undefined {
    if (!this.activeSessionId) {
      return undefined;
    }
    return this.sessions.get(this.activeSessionId);
  }

  /**
   * Set the active session
   */
  async setActiveSession(id: string): Promise<void> {
    const session = await this.getSession(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }

    // Suspend previous active session
    if (this.activeSessionId && this.activeSessionId !== id) {
      const prevSession = this.sessions.get(this.activeSessionId);
      if (prevSession) {
        prevSession.state = SessionState.SUSPENDED;
        await this.saveSession(prevSession);
      }
    }

    this.activeSessionId = id;
    session.state = SessionState.ACTIVE;

    await this.context.workspaceState.update('activeSessionId', id);

    this.logger.info(`Set active session: ${id}`);
    this.emit('sessionActivated', session);
  }

  /**
   * Close a session
   */
  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    session.state = SessionState.CLOSED;
    session.status = 'archived';

    // Stop session timer
    this.stopSessionTimer(id);

    // Save final state
    await this.saveSession(session);

    // Remove from active sessions
    this.sessions.delete(id);

    if (this.activeSessionId === id) {
      this.activeSessionId = undefined;
      await this.context.workspaceState.update('activeSessionId', undefined);
    }

    this.logger.info(`Closed session: ${id}`);
    this.emit('sessionClosed', id);
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionInfo[]> {
    const allSessions: SessionInfo[] = [];

    // Add active sessions
    for (const session of this.sessions.values()) {
      allSessions.push(this.getSessionInfo(session));
    }

    // Load archived sessions from storage
    const storedSessionIds = await this.getStoredSessionIds();
    for (const id of storedSessionIds) {
      if (!this.sessions.has(id)) {
        const session = await this.loadSession(id);
        if (session) {
          allSessions.push(this.getSessionInfo(session));
        }
      }
    }

    // Sort by last active
    allSessions.sort(
      (a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime(),
    );

    return allSessions;
  }

  /**
   * Add a message to the active session
   */
  async addMessage(message: Message): Promise<void> {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error('No active session');
    }

    session.messages.push(message);
    session.lastActiveAt = new Date();

    // Update token count
    if (message.metadata?.tokenCount) {
      session.context.tokenCount += message.metadata.tokenCount;
    }

    // Auto-save if enabled
    if (session.config.autoSave) {
      await this.saveSession(session);
    }

    this.emit('messageAdded', session.id, message);
  }

  /**
   * Update session context
   */
  async updateContext(
    sessionId: string,
    context: Partial<SessionContext>,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.context = { ...session.context, ...context };
    await this.saveSession(session);

    this.emit('contextUpdated', sessionId, session.context);
  }

  /**
   * Archive old sessions
   */
  async archiveOldSessions(daysOld = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let archivedCount = 0;

    for (const session of this.sessions.values()) {
      if (
        session.lastActiveAt < cutoffDate &&
        session.state !== SessionState.ARCHIVED
      ) {
        session.state = SessionState.ARCHIVED;
        session.status = 'archived';
        await this.saveSession(session);
        this.sessions.delete(session.id);
        archivedCount++;
      }
    }

    this.logger.info(`Archived ${archivedCount} old sessions`);
    return archivedCount;
  }

  /**
   * Cleanup and dispose
   */
  dispose(): void {
    // Stop all timers
    for (const timer of this.sessionTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionTimers.clear();

    // Save all active sessions
    for (const session of this.sessions.values()) {
      this.saveSession(session).catch((error) => {
        this.logger.error('Failed to save session on dispose:', error);
      });
    }

    this.removeAllListeners();
  }

  /**
   * Get session info for display
   */
  private getSessionInfo(session: Session): SessionInfo {
    return {
      id: session.id,
      name: session.metadata.title || session.name || 'Untitled Session',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastActiveAt,
      messageCount: session.messages.length,
      state: session.state,
    };
  }

  /**
   * Save session to storage
   */
  private async saveSession(session: Session): Promise<void> {
    const key = `session.${session.id}`;

    try {
      // Prepare session for storage
      const storedSession = {
        ...session,
        // Remove large data that can be reconstructed
        messages: session.messages.slice(-100), // Keep last 100 messages
      };

      await this.context.workspaceState.update(key, storedSession);

      // Update session index
      await this.updateSessionIndex(session.id);
    } catch (error) {
      this.logger.error(`Failed to save session ${session.id}:`, error);
      throw error;
    }
  }

  /**
   * Load session from storage
   */
  private async loadSession(id: string): Promise<Session | undefined> {
    const key = `session.${id}`;

    try {
      const storedSession = this.context.workspaceState.get<Session>(key);
      if (!storedSession) {
        return undefined;
      }

      // Restore session with proper types
      const session: Session = {
        ...storedSession,
        createdAt: new Date(storedSession.createdAt),
        lastActiveAt: new Date(storedSession.lastActiveAt),
        messages: storedSession.messages.map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      };

      return session;
    } catch (error) {
      this.logger.error(`Failed to load session ${id}:`, error);
      return undefined;
    }
  }

  /**
   * Load sessions on startup
   */
  private async loadSessions(): Promise<void> {
    try {
      // Load active session
      const activeSessionId =
        this.context.workspaceState.get<string>('activeSessionId');
      if (activeSessionId) {
        const session = await this.loadSession(activeSessionId);
        if (session) {
          this.sessions.set(activeSessionId, session);
          this.activeSessionId = activeSessionId;
          this.startSessionTimer(activeSessionId);
        }
      }

      // Load recent sessions
      const recentSessionIds = await this.getRecentSessionIds(5);
      for (const id of recentSessionIds) {
        if (!this.sessions.has(id)) {
          const session = await this.loadSession(id);
          if (session && session.state !== SessionState.CLOSED) {
            this.sessions.set(id, session);
            if (session.state === SessionState.ACTIVE) {
              this.startSessionTimer(id);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to load sessions:', error);
    }
  }

  /**
   * Get stored session IDs
   */
  private async getStoredSessionIds(): Promise<string[]> {
    const index = this.context.workspaceState.get<string[]>('sessionIndex', []);
    return index;
  }

  /**
   * Get recent session IDs
   */
  private async getRecentSessionIds(limit: number): Promise<string[]> {
    const allIds = await this.getStoredSessionIds();
    return allIds.slice(0, limit);
  }

  /**
   * Update session index
   */
  private async updateSessionIndex(sessionId: string): Promise<void> {
    let index = this.context.workspaceState.get<string[]>('sessionIndex', []);

    // Remove if exists and add to front
    index = index.filter((id) => id !== sessionId);
    index.unshift(sessionId);

    // Keep only last 100 sessions
    index = index.slice(0, 100);

    await this.context.workspaceState.update('sessionIndex', index);
  }

  /**
   * Start session timer for auto-suspend
   */
  private startSessionTimer(sessionId: string): void {
    this.stopSessionTimer(sessionId);

    const timer = setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && session.state === SessionState.ACTIVE) {
        session.state = SessionState.IDLE;
        this.saveSession(session).catch((error) => {
          this.logger.error('Failed to save idle session:', error);
        });
        this.emit('sessionIdle', sessionId);
      }
    }, this.sessionTimeout);

    this.sessionTimers.set(sessionId, timer);
  }

  /**
   * Reset session timer
   */
  private resetSessionTimer(sessionId: string): void {
    this.startSessionTimer(sessionId);
  }

  /**
   * Stop session timer
   */
  private stopSessionTimer(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }
}
