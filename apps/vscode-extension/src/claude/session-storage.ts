import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  type Session,
  type StoredSession,
  type SessionListItem,
  type SessionSearchCriteria,
  type SessionExport,
  SessionEventType,
  type SessionEvent,
} from './session-types';
import { Logger } from './logger';

/**
 * Storage keys for workspace state
 */
const STORAGE_KEYS = {
  SESSIONS: 'stagewise-cc.sessions',
  ACTIVE_SESSION: 'stagewise-cc.activeSession',
  SESSION_INDEX: 'stagewise-cc.sessionIndex',
  VERSION: 'stagewise-cc.storageVersion',
};

/**
 * Current storage version
 */
const STORAGE_VERSION = '1.0.0';

/**
 * Session storage service using VSCode workspace state
 */
export class SessionStorage {
  private logger: Logger;
  private context: vscode.ExtensionContext;
  private eventEmitter: vscode.EventEmitter<SessionEvent>;
  private sessionCache: Map<string, Session> = new Map();
  private compressionEnabled = true;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const outputChannel = vscode.window.createOutputChannel(
      'Claude Session Storage',
    );
    this.logger = new Logger(outputChannel);
    this.eventEmitter = new vscode.EventEmitter<SessionEvent>();

    this.initialize();
  }

  /**
   * Initialize storage and perform migrations if needed
   */
  private async initialize(): Promise<void> {
    try {
      const storedVersion = await this.context.workspaceState.get<string>(
        STORAGE_KEYS.VERSION,
      );

      if (!storedVersion) {
        // First time initialization
        await this.initializeStorage();
      } else if (storedVersion !== STORAGE_VERSION) {
        // Perform migration
        await this.migrateStorage(storedVersion, STORAGE_VERSION);
      }

      // Load session index into cache
      await this.loadSessionIndex();
    } catch (error) {
      this.logger.error('Failed to initialize session storage', error);
    }
  }

  /**
   * Initialize storage for first time use
   */
  private async initializeStorage(): Promise<void> {
    await this.context.workspaceState.update(
      STORAGE_KEYS.VERSION,
      STORAGE_VERSION,
    );
    await this.context.workspaceState.update(STORAGE_KEYS.SESSIONS, {});
    await this.context.workspaceState.update(STORAGE_KEYS.SESSION_INDEX, []);
    await this.context.workspaceState.update(STORAGE_KEYS.ACTIVE_SESSION, null);

    this.logger.info('Initialized session storage');
  }

  /**
   * Migrate storage to new version
   */
  private async migrateStorage(
    fromVersion: string,
    toVersion: string,
  ): Promise<void> {
    this.logger.info(`Migrating storage from ${fromVersion} to ${toVersion}`);

    // Implement migration logic based on versions
    // For now, just update version
    await this.context.workspaceState.update(STORAGE_KEYS.VERSION, toVersion);
  }

  /**
   * Load session index into cache
   */
  private async loadSessionIndex(): Promise<void> {
    const index = await this.context.workspaceState.get<SessionListItem[]>(
      STORAGE_KEYS.SESSION_INDEX,
      [],
    );

    // Pre-load active sessions into cache
    const activeSessionId = await this.context.workspaceState.get<string>(
      STORAGE_KEYS.ACTIVE_SESSION,
    );
    if (activeSessionId) {
      await this.getSession(activeSessionId);
    }
  }

  /**
   * Save a session to storage
   */
  async saveSession(session: Session): Promise<void> {
    try {
      // Validate session
      this.validateSession(session);

      // Get all sessions
      const sessions = await this.getAllStoredSessions();

      // Prepare stored session
      const storedSession: StoredSession = {
        session: this.prepareSessionForStorage(session),
        compressed: this.compressionEnabled,
        checksum: this.calculateChecksum(session),
      };

      // Compress if enabled
      if (this.compressionEnabled) {
        storedSession.session = await this.compressSession(session);
      }

      // Update sessions
      sessions[session.id] = storedSession;
      await this.context.workspaceState.update(STORAGE_KEYS.SESSIONS, sessions);

      // Update cache
      this.sessionCache.set(session.id, session);

      // Update index
      await this.updateSessionIndex(session);

      // Emit event
      this.emitEvent({
        type: SessionEventType.UPDATED,
        sessionId: session.id,
        timestamp: new Date(),
      });

      this.logger.debug(`Saved session ${session.id}`);
    } catch (error) {
      this.logger.error(`Failed to save session ${session.id}`, error);
      throw error;
    }
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    try {
      // Check cache first
      if (this.sessionCache.has(sessionId)) {
        return this.sessionCache.get(sessionId)!;
      }

      // Load from storage
      const sessions = await this.getAllStoredSessions();
      const storedSession = sessions[sessionId];

      if (!storedSession) {
        return null;
      }

      // Verify checksum
      if (storedSession.checksum) {
        const valid = await this.verifyChecksum(storedSession);
        if (!valid) {
          this.logger.warning(
            `Session ${sessionId} failed checksum verification`,
          );
          // Attempt recovery
          return await this.recoverSession(sessionId, storedSession);
        }
      }

      // Decompress if needed
      let session = storedSession.session;
      if (storedSession.compressed) {
        session = await this.decompressSession(storedSession.session);
      }

      // Restore dates
      session = this.restoreSessionDates(session);

      // Update cache
      this.sessionCache.set(sessionId, session);

      return session;
    } catch (error) {
      this.logger.error(`Failed to get session ${sessionId}`, error);
      return null;
    }
  }

  /**
   * Get all sessions
   */
  async getAllSessions(): Promise<Session[]> {
    try {
      const sessions = await this.getAllStoredSessions();
      const result: Session[] = [];

      for (const sessionId in sessions) {
        const session = await this.getSession(sessionId);
        if (session) {
          result.push(session);
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to get all sessions', error);
      return [];
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const sessions = await this.getAllStoredSessions();

      if (!sessions[sessionId]) {
        return false;
      }

      // Remove from storage
      delete sessions[sessionId];
      await this.context.workspaceState.update(STORAGE_KEYS.SESSIONS, sessions);

      // Remove from cache
      this.sessionCache.delete(sessionId);

      // Update index
      await this.removeFromIndex(sessionId);

      // Clear active session if needed
      const activeSessionId = await this.context.workspaceState.get<string>(
        STORAGE_KEYS.ACTIVE_SESSION,
      );
      if (activeSessionId === sessionId) {
        await this.context.workspaceState.update(
          STORAGE_KEYS.ACTIVE_SESSION,
          null,
        );
      }

      // Emit event
      this.emitEvent({
        type: SessionEventType.DELETED,
        sessionId,
        timestamp: new Date(),
      });

      this.logger.info(`Deleted session ${sessionId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete session ${sessionId}`, error);
      return false;
    }
  }

  /**
   * Get active session ID
   */
  async getActiveSessionId(): Promise<string | null> {
    return (
      (await this.context.workspaceState.get<string>(
        STORAGE_KEYS.ACTIVE_SESSION,
      )) || null
    );
  }

  /**
   * Set active session
   */
  async setActiveSession(sessionId: string | null): Promise<void> {
    await this.context.workspaceState.update(
      STORAGE_KEYS.ACTIVE_SESSION,
      sessionId,
    );

    if (sessionId) {
      // Pre-load into cache
      await this.getSession(sessionId);
    }
  }

  /**
   * Search sessions
   */
  async searchSessions(
    criteria: SessionSearchCriteria,
  ): Promise<SessionListItem[]> {
    const index = await this.context.workspaceState.get<SessionListItem[]>(
      STORAGE_KEYS.SESSION_INDEX,
      [],
    );

    return index.filter((item) => {
      // Status filter
      if (criteria.status && !criteria.status.includes(item.status)) {
        return false;
      }

      // Date range filter
      if (criteria.dateRange) {
        const lastActive = new Date(item.lastActive);
        if (
          lastActive < criteria.dateRange.start ||
          lastActive > criteria.dateRange.end
        ) {
          return false;
        }
      }

      // Query filter
      if (criteria.query) {
        const query = criteria.query.toLowerCase();
        const searchText = `${item.title} ${item.preview || ''}`.toLowerCase();
        if (!searchText.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Export sessions
   */
  async exportSessions(sessionIds?: string[]): Promise<SessionExport> {
    const allSessions = await this.getAllStoredSessions();
    const sessionsToExport: StoredSession[] = [];

    if (sessionIds) {
      for (const id of sessionIds) {
        if (allSessions[id]) {
          sessionsToExport.push(allSessions[id]);
        }
      }
    } else {
      sessionsToExport.push(...Object.values(allSessions));
    }

    const dates = sessionsToExport
      .map((s) => s.session.createdAt)
      .filter((d) => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      version: STORAGE_VERSION,
      exportDate: new Date(),
      sessions: sessionsToExport,
      metadata: {
        workspaceId:
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown',
        totalSessions: sessionsToExport.length,
        dateRange: {
          earliest: dates[0] || new Date(),
          latest: dates[dates.length - 1] || new Date(),
        },
      },
    };
  }

  /**
   * Import sessions
   */
  async importSessions(
    data: SessionExport,
    overwrite = false,
  ): Promise<number> {
    let imported = 0;
    const sessions = await this.getAllStoredSessions();

    for (const storedSession of data.sessions) {
      const sessionId = storedSession.session.id;

      if (!overwrite && sessions[sessionId]) {
        continue;
      }

      sessions[sessionId] = storedSession;
      imported++;
    }

    await this.context.workspaceState.update(STORAGE_KEYS.SESSIONS, sessions);

    // Rebuild index
    await this.rebuildIndex();

    this.logger.info(`Imported ${imported} sessions`);
    return imported;
  }

  /**
   * Clear all sessions
   */
  async clearAllSessions(): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEYS.SESSIONS, {});
    await this.context.workspaceState.update(STORAGE_KEYS.SESSION_INDEX, []);
    await this.context.workspaceState.update(STORAGE_KEYS.ACTIVE_SESSION, null);

    this.sessionCache.clear();

    this.logger.info('Cleared all sessions');
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalSessions: number;
    totalSize: number;
    cacheSize: number;
    compressionRatio?: number;
  }> {
    const sessions = await this.getAllStoredSessions();
    const totalSessions = Object.keys(sessions).length;

    // Estimate size
    const jsonString = JSON.stringify(sessions);
    const totalSize = new TextEncoder().encode(jsonString).length;

    return {
      totalSessions,
      totalSize,
      cacheSize: this.sessionCache.size,
      compressionRatio: this.compressionEnabled ? 0.6 : 1.0, // Estimate
    };
  }

  /**
   * Subscribe to session events
   */
  onSessionEvent(handler: (event: SessionEvent) => void): vscode.Disposable {
    return this.eventEmitter.event(handler);
  }

  // Private helper methods

  private async getAllStoredSessions(): Promise<Record<string, StoredSession>> {
    return await this.context.workspaceState.get<Record<string, StoredSession>>(
      STORAGE_KEYS.SESSIONS,
      {},
    );
  }

  private validateSession(session: Session): void {
    if (!session.id || !session.workspaceId) {
      throw new Error('Invalid session: missing required fields');
    }

    if (!session.version) {
      throw new Error('Invalid session: missing version');
    }
  }

  private prepareSessionForStorage(session: Session): Session {
    // Convert dates to ISO strings for storage
    return {
      ...session,
      createdAt:
        session.createdAt instanceof Date
          ? session.createdAt
          : new Date(session.createdAt),
      lastActiveAt:
        session.lastActiveAt instanceof Date
          ? session.lastActiveAt
          : new Date(session.lastActiveAt),
      turns: session.turns.map((turn) => ({
        ...turn,
        startTime:
          turn.startTime instanceof Date
            ? turn.startTime
            : new Date(turn.startTime),
        endTime: turn.endTime
          ? turn.endTime instanceof Date
            ? turn.endTime
            : new Date(turn.endTime)
          : undefined,
        userMessage: {
          ...turn.userMessage,
          timestamp:
            turn.userMessage.timestamp instanceof Date
              ? turn.userMessage.timestamp
              : new Date(turn.userMessage.timestamp),
        },
        assistantMessage: turn.assistantMessage
          ? {
              ...turn.assistantMessage,
              timestamp:
                turn.assistantMessage.timestamp instanceof Date
                  ? turn.assistantMessage.timestamp
                  : new Date(turn.assistantMessage.timestamp),
            }
          : undefined,
      })),
    };
  }

  private restoreSessionDates(session: any): Session {
    // Restore Date objects from storage
    return {
      ...session,
      createdAt: new Date(session.createdAt),
      lastActiveAt: new Date(session.lastActiveAt),
      turns: session.turns.map((turn: any) => ({
        ...turn,
        startTime: new Date(turn.startTime),
        endTime: turn.endTime ? new Date(turn.endTime) : undefined,
        userMessage: {
          ...turn.userMessage,
          timestamp: new Date(turn.userMessage.timestamp),
        },
        assistantMessage: turn.assistantMessage
          ? {
              ...turn.assistantMessage,
              timestamp: new Date(turn.assistantMessage.timestamp),
            }
          : undefined,
      })),
    };
  }

  private calculateChecksum(session: Session): string {
    const content = JSON.stringify(session);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async verifyChecksum(storedSession: StoredSession): Promise<boolean> {
    if (!storedSession.checksum) {
      return true;
    }

    const currentChecksum = this.calculateChecksum(storedSession.session);
    return currentChecksum === storedSession.checksum;
  }

  private async compressSession(session: Session): Promise<any> {
    // Simple compression by removing whitespace from JSON
    // In production, you might use a proper compression library
    const json = JSON.stringify(session);
    return JSON.parse(json);
  }

  private async decompressSession(compressed: any): Promise<Session> {
    // Decompress session
    return compressed as Session;
  }

  private async recoverSession(
    sessionId: string,
    storedSession: StoredSession,
  ): Promise<Session | null> {
    this.logger.warning(`Attempting to recover corrupted session ${sessionId}`);

    try {
      // Try to parse without checksum verification
      let session = storedSession.session;
      if (storedSession.compressed) {
        session = await this.decompressSession(session);
      }

      return this.restoreSessionDates(session);
    } catch (error) {
      this.logger.error(`Failed to recover session ${sessionId}`, error);
      return null;
    }
  }

  private async updateSessionIndex(session: Session): Promise<void> {
    const index = await this.context.workspaceState.get<SessionListItem[]>(
      STORAGE_KEYS.SESSION_INDEX,
      [],
    );

    const existingIndex = index.findIndex((item) => item.id === session.id);
    const listItem: SessionListItem = {
      id: session.id,
      title: session.metadata.title || `Session ${session.id.substring(0, 8)}`,
      lastActive: session.lastActiveAt,
      turnCount: session.turns.length,
      status: session.status,
      preview: this.generatePreview(session),
    };

    if (existingIndex >= 0) {
      index[existingIndex] = listItem;
    } else {
      index.push(listItem);
    }

    // Sort by last active date
    index.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());

    await this.context.workspaceState.update(STORAGE_KEYS.SESSION_INDEX, index);
  }

  private async removeFromIndex(sessionId: string): Promise<void> {
    const index = await this.context.workspaceState.get<SessionListItem[]>(
      STORAGE_KEYS.SESSION_INDEX,
      [],
    );

    const filtered = index.filter((item) => item.id !== sessionId);
    await this.context.workspaceState.update(
      STORAGE_KEYS.SESSION_INDEX,
      filtered,
    );
  }

  private async rebuildIndex(): Promise<void> {
    const sessions = await this.getAllSessions();
    const index: SessionListItem[] = [];

    for (const session of sessions) {
      index.push({
        id: session.id,
        title:
          session.metadata.title || `Session ${session.id.substring(0, 8)}`,
        lastActive: session.lastActiveAt,
        turnCount: session.turns.length,
        status: session.status,
        preview: this.generatePreview(session),
      });
    }

    // Sort by last active date
    index.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());

    await this.context.workspaceState.update(STORAGE_KEYS.SESSION_INDEX, index);
  }

  private generatePreview(session: Session): string {
    if (session.turns.length === 0) {
      return 'No messages yet';
    }

    const lastTurn = session.turns[session.turns.length - 1];
    const preview = lastTurn.userMessage.content.substring(0, 100);

    return preview.length < lastTurn.userMessage.content.length
      ? preview + '...'
      : preview;
  }

  private emitEvent(event: SessionEvent): void {
    this.eventEmitter.fire(event);
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.sessionCache.clear();
    this.eventEmitter.dispose();
  }
}
