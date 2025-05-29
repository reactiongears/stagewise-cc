import * as vscode from 'vscode';
import type { ConversationTurn, Session } from './session-types';
import { Logger } from './logger';

/**
 * Token estimation constants
 */
const TOKEN_ESTIMATION = {
  CHARS_PER_TOKEN: 4, // Rough estimate for English text
  OVERHEAD_PER_MESSAGE: 10, // Additional tokens for message metadata
  MAX_CONTEXT_TOKENS: 100000, // Claude's context limit
  SAFETY_MARGIN: 0.9, // Use only 90% of max to be safe
};

/**
 * Memory management configuration
 */
export interface MemoryConfig {
  maxTurns: number;
  maxTokens: number;
  compressionThreshold: number;
  pruningStrategy: 'fifo' | 'importance' | 'smart';
  keepSystemMessages: boolean;
  keepErrorMessages: boolean;
}

/**
 * Conversation statistics
 */
export interface ConversationStats {
  totalTurns: number;
  totalMessages: number;
  estimatedTokens: number;
  compressionRatio: number;
  pruningCount: number;
}

/**
 * Message importance score
 */
interface MessageImportance {
  score: number;
  hasCode: boolean;
  hasError: boolean;
  hasOperations: boolean;
  isRecent: boolean;
  isReferenced: boolean;
}

/**
 * Manages conversation history with intelligent memory management
 */
export class ConversationHistory {
  private logger: Logger;
  private config: MemoryConfig;
  private conversationCache: Map<string, ConversationTurn[]> = new Map();
  private tokenCache: Map<string, number> = new Map();
  private importanceCache: Map<string, MessageImportance> = new Map();

  constructor(config?: Partial<MemoryConfig>) {
    const outputChannel = vscode.window.createOutputChannel(
      'Claude Conversation History',
    );
    this.logger = new Logger(outputChannel);

    this.config = {
      maxTurns: config?.maxTurns ?? 100,
      maxTokens:
        config?.maxTokens ??
        TOKEN_ESTIMATION.MAX_CONTEXT_TOKENS * TOKEN_ESTIMATION.SAFETY_MARGIN,
      compressionThreshold: config?.compressionThreshold ?? 0.7,
      pruningStrategy: config?.pruningStrategy ?? 'smart',
      keepSystemMessages: config?.keepSystemMessages ?? true,
      keepErrorMessages: config?.keepErrorMessages ?? true,
    };
  }

  /**
   * Add a new turn to the conversation history
   */
  async addTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
    let turns = this.conversationCache.get(sessionId) || [];
    turns.push(turn);

    // Calculate token usage
    const turnTokens = this.estimateTokens(turn);
    this.updateTokenCache(sessionId, turnTokens);

    // Check if we need to manage memory
    const totalTokens = this.getTotalTokens(sessionId);
    if (
      totalTokens > this.config.maxTokens ||
      turns.length > this.config.maxTurns
    ) {
      turns = await this.manageMemory(sessionId, turns);
    }

    this.conversationCache.set(sessionId, turns);
    this.logger.debug(
      `Added turn to session ${sessionId}, total turns: ${turns.length}`,
    );
  }

  /**
   * Get conversation history for a session
   */
  getHistory(sessionId: string, maxTurns?: number): ConversationTurn[] {
    const turns = this.conversationCache.get(sessionId) || [];

    if (maxTurns && maxTurns < turns.length) {
      // Return most recent turns
      return turns.slice(-maxTurns);
    }

    return [...turns];
  }

  /**
   * Get formatted conversation for Claude context
   */
  getFormattedContext(sessionId: string, maxTokens?: number): string {
    const turns = this.getHistory(sessionId);
    const targetTokens = maxTokens || this.config.maxTokens;

    let context = '';
    let currentTokens = 0;

    // Build context from most recent messages backwards
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const turnText = this.formatTurn(turn);
      const turnTokens = this.estimateStringTokens(turnText);

      if (currentTokens + turnTokens > targetTokens) {
        break;
      }

      context = `${turnText}\n\n${context}`;
      currentTokens += turnTokens;
    }

    return context.trim();
  }

  /**
   * Compress conversation history
   */
  async compressHistory(sessionId: string): Promise<void> {
    const turns = this.conversationCache.get(sessionId) || [];

    if (turns.length === 0) return;

    this.logger.info(`Compressing history for session ${sessionId}`);

    const compressedTurns = await this.compressTurns(turns);
    const compressionRatio = compressedTurns.length / turns.length;

    if (compressionRatio < this.config.compressionThreshold) {
      this.conversationCache.set(sessionId, compressedTurns);
      this.rebuildTokenCache(sessionId, compressedTurns);

      this.logger.info(
        `Compressed session ${sessionId} from ${turns.length} to ${compressedTurns.length} turns`,
      );
    }
  }

  /**
   * Clear history for a session
   */
  clearHistory(sessionId: string): void {
    this.conversationCache.delete(sessionId);
    this.tokenCache.delete(sessionId);
    this.importanceCache.delete(sessionId);

    this.logger.debug(`Cleared history for session ${sessionId}`);
  }

  /**
   * Get conversation statistics
   */
  getStats(sessionId: string): ConversationStats {
    const turns = this.conversationCache.get(sessionId) || [];
    const totalMessages = turns.reduce((sum, turn) => {
      return sum + 1 + (turn.assistantMessage ? 1 : 0);
    }, 0);

    return {
      totalTurns: turns.length,
      totalMessages,
      estimatedTokens: this.getTotalTokens(sessionId),
      compressionRatio: 1.0, // TODO: Track actual compression
      pruningCount: 0, // TODO: Track pruning
    };
  }

  /**
   * Archive old conversations
   */
  async archiveOldConversations(sessions: Session[]): Promise<void> {
    const now = Date.now();
    const archiveThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const session of sessions) {
      const age = now - session.lastActiveAt.getTime();

      if (age > archiveThreshold && this.conversationCache.has(session.id)) {
        // Compress before archiving
        await this.compressHistory(session.id);

        // Remove from active cache
        this.conversationCache.delete(session.id);
        this.tokenCache.delete(session.id);

        this.logger.info(`Archived conversation for session ${session.id}`);
      }
    }
  }

  // Private helper methods

  private async manageMemory(
    sessionId: string,
    turns: ConversationTurn[],
  ): Promise<ConversationTurn[]> {
    switch (this.config.pruningStrategy) {
      case 'fifo':
        return this.pruneFIFO(turns);

      case 'importance':
        return this.pruneByImportance(turns);

      case 'smart':
        return this.pruneSmartly(sessionId, turns);

      default:
        return this.pruneFIFO(turns);
    }
  }

  private pruneFIFO(turns: ConversationTurn[]): ConversationTurn[] {
    const maxTurns = Math.floor(this.config.maxTurns * 0.8); // Keep 80%

    if (turns.length <= maxTurns) {
      return turns;
    }

    // Keep most recent turns
    return turns.slice(-maxTurns);
  }

  private pruneByImportance(turns: ConversationTurn[]): ConversationTurn[] {
    // Calculate importance for each turn
    const scoredTurns = turns.map((turn) => ({
      turn,
      importance: this.calculateImportance(turn),
    }));

    // Sort by importance (descending) and recency
    scoredTurns.sort((a, b) => {
      if (Math.abs(a.importance.score - b.importance.score) < 0.1) {
        // If scores are similar, prefer more recent
        return a.turn.startTime.getTime() - b.turn.startTime.getTime();
      }
      return b.importance.score - a.importance.score;
    });

    // Keep most important turns up to token limit
    let totalTokens = 0;
    const keptTurns: ConversationTurn[] = [];

    for (const { turn } of scoredTurns) {
      const turnTokens = this.estimateTokens(turn);

      if (totalTokens + turnTokens > this.config.maxTokens * 0.8) {
        break;
      }

      keptTurns.push(turn);
      totalTokens += turnTokens;
    }

    // Sort back by time
    keptTurns.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return keptTurns;
  }

  private pruneSmartly(
    sessionId: string,
    turns: ConversationTurn[],
  ): ConversationTurn[] {
    // Smart pruning combines multiple strategies
    const recentCount = Math.min(10, Math.floor(turns.length * 0.3));
    const recentTurns = turns.slice(-recentCount);
    const olderTurns = turns.slice(0, -recentCount);

    // Always keep recent turns
    const keptTurns = [...recentTurns];
    let currentTokens = recentTurns.reduce(
      (sum, turn) => sum + this.estimateTokens(turn),
      0,
    );

    // Intelligently select from older turns
    const importantOlderTurns = olderTurns.filter((turn) => {
      const importance = this.calculateImportance(turn);

      // Keep if it has important characteristics
      return (
        importance.hasError ||
        importance.hasOperations ||
        importance.score > 0.7
      );
    });

    // Add important older turns if we have space
    for (const turn of importantOlderTurns) {
      const turnTokens = this.estimateTokens(turn);

      if (currentTokens + turnTokens > this.config.maxTokens * 0.8) {
        break;
      }

      keptTurns.unshift(turn);
      currentTokens += turnTokens;
    }

    return keptTurns;
  }

  private async compressTurns(
    turns: ConversationTurn[],
  ): Promise<ConversationTurn[]> {
    const compressed: ConversationTurn[] = [];
    let consecutiveSimilar: ConversationTurn[] = [];

    for (const turn of turns) {
      if (this.shouldCompress(turn)) {
        consecutiveSimilar.push(turn);
      } else {
        // Compress accumulated similar turns
        if (consecutiveSimilar.length > 1) {
          const summary = await this.summarizeTurns(consecutiveSimilar);
          if (summary) {
            compressed.push(summary);
          }
        } else if (consecutiveSimilar.length === 1) {
          compressed.push(consecutiveSimilar[0]);
        }

        // Reset and add current turn
        consecutiveSimilar = [];
        compressed.push(turn);
      }
    }

    // Handle remaining turns
    if (consecutiveSimilar.length > 1) {
      const summary = await this.summarizeTurns(consecutiveSimilar);
      if (summary) {
        compressed.push(summary);
      }
    } else if (consecutiveSimilar.length === 1) {
      compressed.push(consecutiveSimilar[0]);
    }

    return compressed;
  }

  private shouldCompress(turn: ConversationTurn): boolean {
    // Don't compress turns with errors or operations
    if (turn.status === 'error') return false;

    if (turn.assistantMessage?.metadata?.operations?.length) {
      return false;
    }

    // Compress simple Q&A turns
    return true;
  }

  private async summarizeTurns(
    turns: ConversationTurn[],
  ): Promise<ConversationTurn | null> {
    if (turns.length === 0) return null;

    // Create a summary turn
    const firstTurn = turns[0];
    const lastTurn = turns[turns.length - 1];

    const summaryContent = `[Summarized ${turns.length} turns: ${turns
      .map((t) => t.userMessage.content.substring(0, 50))
      .join('; ')}]`;

    return {
      id: `summary_${firstTurn.id}_${lastTurn.id}`,
      userMessage: {
        id: `summary_user_${Date.now()}`,
        role: 'user',
        content: summaryContent,
        timestamp: firstTurn.startTime,
        metadata: {
          tokenCount: this.estimateStringTokens(summaryContent),
        },
      },
      assistantMessage: {
        id: `summary_assistant_${Date.now()}`,
        role: 'assistant',
        content: '[Summarized responses]',
        timestamp: lastTurn.endTime || lastTurn.startTime,
        metadata: {
          tokenCount: 20,
        },
      },
      startTime: firstTurn.startTime,
      endTime: lastTurn.endTime,
      status: 'complete',
    };
  }

  private calculateImportance(turn: ConversationTurn): MessageImportance {
    let score = 0.5; // Base score

    const hasCode =
      /```[\s\S]*?```/.test(turn.userMessage.content) ||
      (turn.assistantMessage
        ? /```[\s\S]*?```/.test(turn.assistantMessage.content)
        : false);

    const hasError =
      turn.status === 'error' ||
      turn.assistantMessage?.metadata?.error !== undefined;

    const hasOperations =
      (turn.assistantMessage?.metadata?.operations?.length || 0) > 0;

    const isRecent = Date.now() - turn.startTime.getTime() < 3600000; // Last hour

    // Calculate score
    if (hasCode) score += 0.2;
    if (hasError) score += 0.3;
    if (hasOperations) score += 0.3;
    if (isRecent) score += 0.2;

    // Check if referenced by other messages
    const isReferenced = false; // TODO: Implement reference detection

    return {
      score: Math.min(1.0, score),
      hasCode,
      hasError,
      hasOperations,
      isRecent,
      isReferenced,
    };
  }

  private estimateTokens(turn: ConversationTurn): number {
    let tokens = TOKEN_ESTIMATION.OVERHEAD_PER_MESSAGE * 2; // User + assistant

    tokens += this.estimateStringTokens(turn.userMessage.content);

    if (turn.assistantMessage) {
      tokens += this.estimateStringTokens(turn.assistantMessage.content);
    }

    return Math.ceil(tokens);
  }

  private estimateStringTokens(text: string): number {
    // Use cached value if available
    const cached = this.tokenCache.get(text);
    if (cached !== undefined) {
      return cached;
    }

    // Simple estimation: characters / 4
    const estimate = Math.ceil(text.length / TOKEN_ESTIMATION.CHARS_PER_TOKEN);

    // Cache for small strings
    if (text.length < 1000) {
      this.tokenCache.set(text, estimate);
    }

    return estimate;
  }

  private getTotalTokens(sessionId: string): number {
    const turns = this.conversationCache.get(sessionId) || [];

    return turns.reduce((sum, turn) => sum + this.estimateTokens(turn), 0);
  }

  private updateTokenCache(sessionId: string, additionalTokens: number): void {
    const current = this.tokenCache.get(sessionId) || 0;
    this.tokenCache.set(sessionId, current + additionalTokens);
  }

  private rebuildTokenCache(
    sessionId: string,
    turns: ConversationTurn[],
  ): void {
    const total = turns.reduce(
      (sum, turn) => sum + this.estimateTokens(turn),
      0,
    );
    this.tokenCache.set(sessionId, total);
  }

  private formatTurn(turn: ConversationTurn): string {
    let formatted = `User: ${turn.userMessage.content}`;

    if (turn.assistantMessage) {
      formatted += `\n\nAssistant: ${turn.assistantMessage.content}`;
    }

    return formatted;
  }

  /**
   * Export conversation for debugging
   */
  exportConversation(sessionId: string): string {
    const turns = this.getHistory(sessionId);
    const stats = this.getStats(sessionId);

    let output = `# Conversation Export\n`;
    output += `Session: ${sessionId}\n`;
    output += `Turns: ${stats.totalTurns}\n`;
    output += `Estimated Tokens: ${stats.estimatedTokens}\n\n`;

    for (const turn of turns) {
      output += `## Turn ${turn.id}\n`;
      output += `Time: ${turn.startTime.toISOString()}\n\n`;
      output += `### User\n${turn.userMessage.content}\n\n`;

      if (turn.assistantMessage) {
        output += `### Assistant\n${turn.assistantMessage.content}\n\n`;
      }
    }

    return output;
  }

  /**
   * Load conversation history from session
   */
  loadFromSession(session: Session): void {
    this.conversationCache.set(session.id, session.turns);
    this.rebuildTokenCache(session.id, session.turns);

    this.logger.debug(
      `Loaded ${session.turns.length} turns for session ${session.id}`,
    );
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.conversationCache.clear();
    this.tokenCache.clear();
    this.importanceCache.clear();
  }
}
