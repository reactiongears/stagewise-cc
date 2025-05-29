import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { Logger } from '../logger';
import type { Session } from './session-types';
import type { StoredSession } from '../session-types';

interface CompressionResult {
  data: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

/**
 * Handles session persistence and retrieval
 */
export class SessionStore {
  private readonly logger = new Logger('SessionStore');
  private readonly storagePrefix = 'claude.sessions';
  private readonly maxStorageSize = 50 * 1024 * 1024; // 50MB
  private memoryCache = new Map<string, Session>();
  private readonly cacheSize = 10;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly fileSystem: vscode.FileSystem = vscode.workspace.fs,
  ) {}

  /**
   * Save a session
   */
  async save(session: Session): Promise<void> {
    try {
      // Update memory cache
      this.updateCache(session);

      // Prepare for storage
      const storedSession = await this.prepareForStorage(session);

      // Save to workspace state for quick access
      const stateKey = `${this.storagePrefix}.${session.id}`;
      await this.context.workspaceState.update(stateKey, storedSession);

      // Also save to file for long-term storage
      await this.saveToFile(session.id, storedSession);

      this.logger.debug(`Saved session ${session.id}`);
    } catch (error) {
      this.logger.error(`Failed to save session ${session.id}:`, error);
      throw error;
    }
  }

  /**
   * Load a session
   */
  async load(id: string): Promise<Session | undefined> {
    try {
      // Check memory cache first
      const cached = this.memoryCache.get(id);
      if (cached) {
        this.logger.debug(`Loaded session ${id} from cache`);
        return cached;
      }

      // Try workspace state
      const stateKey = `${this.storagePrefix}.${id}`;
      let storedSession =
        this.context.workspaceState.get<StoredSession>(stateKey);

      // If not in state, try file
      if (!storedSession) {
        storedSession = await this.loadFromFile(id);
      }

      if (!storedSession) {
        return undefined;
      }

      // Restore session
      const session = await this.restoreFromStorage(storedSession);

      // Update cache
      this.updateCache(session);

      return session;
    } catch (error) {
      this.logger.error(`Failed to load session ${id}:`, error);
      return undefined;
    }
  }

  /**
   * Delete a session
   */
  async delete(id: string): Promise<void> {
    try {
      // Remove from cache
      this.memoryCache.delete(id);

      // Remove from workspace state
      const stateKey = `${this.storagePrefix}.${id}`;
      await this.context.workspaceState.update(stateKey, undefined);

      // Remove file
      await this.deleteFile(id);

      // Update index
      await this.removeFromIndex(id);

      this.logger.info(`Deleted session ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete session ${id}:`, error);
      throw error;
    }
  }

  /**
   * List all session IDs
   */
  async list(): Promise<string[]> {
    try {
      // Get from index
      const index = await this.getIndex();
      return index.sessionIds;
    } catch (error) {
      this.logger.error('Failed to list sessions:', error);
      return [];
    }
  }

  /**
   * Export a session
   */
  async export(id: string): Promise<string> {
    const session = await this.load(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }

    const exportData = {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      session: session,
      metadata: {
        messageCount: session.messages.length,
        tokenCount: session.context.tokenCount,
        duration: session.lastActiveAt.getTime() - session.createdAt.getTime(),
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import a session
   */
  async import(data: string): Promise<Session> {
    try {
      const importData = JSON.parse(data);

      if (!importData.session) {
        throw new Error('Invalid import data: missing session');
      }

      // Restore dates
      const session: Session = {
        ...importData.session,
        id: `imported_${Date.now()}`, // Generate new ID
        createdAt: new Date(importData.session.createdAt),
        lastActiveAt: new Date(importData.session.lastActiveAt),
        messages: importData.session.messages.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
      };

      // Save imported session
      await this.save(session);

      return session;
    } catch (error) {
      this.logger.error('Failed to import session:', error);
      throw new Error(`Failed to import session: ${error}`);
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    sessionCount: number;
    totalSize: number;
    averageSize: number;
    largestSession: string | null;
  }> {
    const index = await this.getIndex();
    let totalSize = 0;
    let largestSize = 0;
    let largestSession: string | null = null;

    for (const id of index.sessionIds) {
      const size = await this.getSessionSize(id);
      totalSize += size;

      if (size > largestSize) {
        largestSize = size;
        largestSession = id;
      }
    }

    return {
      sessionCount: index.sessionIds.length,
      totalSize,
      averageSize:
        index.sessionIds.length > 0 ? totalSize / index.sessionIds.length : 0,
      largestSession,
    };
  }

  /**
   * Clean up old sessions
   */
  async cleanup(options: {
    maxAge?: number; // Days
    maxSessions?: number;
    maxSize?: number; // Bytes
  }): Promise<number> {
    let deletedCount = 0;
    const index = await this.getIndex();
    const now = Date.now();

    // Sort sessions by last active date
    const sessions: Array<{ id: string; lastActive: number; size: number }> =
      [];

    for (const id of index.sessionIds) {
      const session = await this.load(id);
      if (session) {
        sessions.push({
          id,
          lastActive: session.lastActiveAt.getTime(),
          size: await this.getSessionSize(id),
        });
      }
    }

    sessions.sort((a, b) => b.lastActive - a.lastActive);

    // Apply cleanup rules
    let totalSize = 0;
    const toDelete: string[] = [];

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const age = (now - session.lastActive) / (1000 * 60 * 60 * 24); // Days

      // Check age
      if (options.maxAge && age > options.maxAge) {
        toDelete.push(session.id);
        continue;
      }

      // Check count
      if (options.maxSessions && i >= options.maxSessions) {
        toDelete.push(session.id);
        continue;
      }

      // Check total size
      totalSize += session.size;
      if (options.maxSize && totalSize > options.maxSize) {
        toDelete.push(session.id);
      }
    }

    // Delete sessions
    for (const id of toDelete) {
      await this.delete(id);
      deletedCount++;
    }

    this.logger.info(`Cleaned up ${deletedCount} sessions`);
    return deletedCount;
  }

  /**
   * Prepare session for storage
   */
  private async prepareForStorage(session: Session): Promise<StoredSession> {
    // Create a copy for storage
    const sessionCopy = JSON.parse(JSON.stringify(session));

    // Compress if large
    const size = JSON.stringify(sessionCopy).length;
    const compressed = size > 10000; // Compress if > 10KB

    const storedSession: StoredSession = {
      session: sessionCopy,
      compressed,
      checksum: this.calculateChecksum(sessionCopy),
    };

    if (compressed) {
      // In a real implementation, we'd compress the data
      // For now, we'll just mark it as compressed
      this.logger.debug(
        `Session ${session.id} marked for compression (${size} bytes)`,
      );
    }

    return storedSession;
  }

  /**
   * Restore session from storage
   */
  private async restoreFromStorage(stored: StoredSession): Promise<Session> {
    // Verify checksum
    const checksum = this.calculateChecksum(stored.session);
    if (checksum !== stored.checksum) {
      this.logger.warn('Session checksum mismatch, data may be corrupted');
    }

    // Decompress if needed
    if (stored.compressed) {
      // In a real implementation, we'd decompress the data
      this.logger.debug('Session marked as compressed, would decompress here');
    }

    // Restore proper types
    const session: Session = {
      ...stored.session,
      createdAt: new Date(stored.session.createdAt),
      lastActiveAt: new Date(stored.session.lastActiveAt),
      messages: stored.session.messages.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
        editedAt: m.editedAt ? new Date(m.editedAt) : undefined,
      })),
    };

    return session;
  }

  /**
   * Update memory cache
   */
  private updateCache(session: Session): void {
    this.memoryCache.set(session.id, session);

    // Evict oldest if cache is full
    if (this.memoryCache.size > this.cacheSize) {
      const oldestId = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestId);
    }
  }

  /**
   * Save session to file
   */
  private async saveToFile(id: string, stored: StoredSession): Promise<void> {
    const filePath = this.getSessionFilePath(id);
    const data = Buffer.from(JSON.stringify(stored), 'utf-8');
    await this.fileSystem.writeFile(filePath, data);
  }

  /**
   * Load session from file
   */
  private async loadFromFile(id: string): Promise<StoredSession | undefined> {
    try {
      const filePath = this.getSessionFilePath(id);
      const data = await this.fileSystem.readFile(filePath);
      return JSON.parse(Buffer.from(data).toString('utf-8'));
    } catch (error) {
      // File doesn't exist or is corrupted
      return undefined;
    }
  }

  /**
   * Delete session file
   */
  private async deleteFile(id: string): Promise<void> {
    try {
      const filePath = this.getSessionFilePath(id);
      await this.fileSystem.delete(filePath);
    } catch (error) {
      // File doesn't exist, ignore
    }
  }

  /**
   * Get session file path
   */
  private getSessionFilePath(id: string): vscode.Uri {
    const storagePath = this.context.globalStorageUri;
    return vscode.Uri.joinPath(storagePath, 'sessions', `${id}.json`);
  }

  /**
   * Get session size
   */
  private async getSessionSize(id: string): Promise<number> {
    try {
      const filePath = this.getSessionFilePath(id);
      const stat = await this.fileSystem.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate checksum
   */
  private calculateChecksum(data: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  /**
   * Get session index
   */
  private async getIndex(): Promise<{
    sessionIds: string[];
    lastUpdated: Date;
  }> {
    const index = this.context.workspaceState.get<{
      sessionIds: string[];
      lastUpdated: string;
    }>(`${this.storagePrefix}.index`, {
      sessionIds: [],
      lastUpdated: new Date().toISOString(),
    });

    return {
      sessionIds: index.sessionIds,
      lastUpdated: new Date(index.lastUpdated),
    };
  }

  /**
   * Update session index
   */
  private async updateIndex(sessionId: string): Promise<void> {
    const index = await this.getIndex();

    if (!index.sessionIds.includes(sessionId)) {
      index.sessionIds.unshift(sessionId);
    }

    await this.context.workspaceState.update(`${this.storagePrefix}.index`, {
      sessionIds: index.sessionIds,
      lastUpdated: new Date().toISOString(),
    });
  }

  /**
   * Remove from index
   */
  private async removeFromIndex(sessionId: string): Promise<void> {
    const index = await this.getIndex();
    index.sessionIds = index.sessionIds.filter((id) => id !== sessionId);

    await this.context.workspaceState.update(`${this.storagePrefix}.index`, {
      sessionIds: index.sessionIds,
      lastUpdated: new Date().toISOString(),
    });
  }
}
