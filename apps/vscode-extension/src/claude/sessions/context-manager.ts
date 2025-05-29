import { Logger } from '../logger';
import type {
  Session,
  Message,
  ConversationContext,
  KeyPoint,
  ContextStrategy,
} from './session-types';

interface ContextOptions {
  strategy: ContextStrategy;
  maxTokens: number;
  includeSystemMessages: boolean;
  compressionEnabled: boolean;
}

/**
 * Manages conversation context and memory
 */
export class ContextManager {
  private readonly logger = new Logger('ContextManager');
  private keyPoints = new Map<string, KeyPoint[]>();
  private readonly defaultMaxTokens = 100000;
  private readonly tokenEstimateRatio = 0.75; // Approximate tokens per character

  /**
   * Build context for a session
   */
  async buildContext(
    session: Session,
    options?: Partial<ContextOptions>,
  ): Promise<ConversationContext> {
    const opts: ContextOptions = {
      strategy: ContextStrategy.RECENT,
      maxTokens: session.context.maxTokens || this.defaultMaxTokens,
      includeSystemMessages: true,
      compressionEnabled: true,
      ...options,
    };

    this.logger.debug(
      `Building context for session ${session.id} with strategy: ${opts.strategy}`,
    );

    let messages: Message[];

    switch (opts.strategy) {
      case ContextStrategy.FULL:
        messages = this.getFullContext(session);
        break;
      case ContextStrategy.RECENT:
        messages = this.getRecentContext(session, opts.maxTokens);
        break;
      case ContextStrategy.RELEVANT:
        messages = await this.getRelevantContext(session, opts.maxTokens);
        break;
      case ContextStrategy.SUMMARY:
        messages = await this.getSummaryContext(session, opts.maxTokens);
        break;
      default:
        messages = this.getRecentContext(session, opts.maxTokens);
    }

    // Filter system messages if needed
    if (!opts.includeSystemMessages) {
      messages = messages.filter((m) => m.role !== 'system');
    }

    // Apply compression if enabled
    if (opts.compressionEnabled) {
      messages = this.compressMessages(messages, opts.maxTokens);
    }

    const context: ConversationContext = {
      messages,
      systemPrompt: this.buildSystemPrompt(session),
      contextWindow: opts.maxTokens,
      includeSystemMessages: opts.includeSystemMessages,
      compressionEnabled: opts.compressionEnabled,
    };

    return context;
  }

  /**
   * Update context when a new message is added
   */
  updateContext(session: Session, message: Message): void {
    // Update token count
    const tokenCount = this.estimateTokens(message.content);
    if (message.metadata) {
      message.metadata.tokenCount = tokenCount;
    }

    // Extract key points from important messages
    if (this.isImportantMessage(message)) {
      const keyPoint = this.extractKeyPoint(session.id, message);
      if (keyPoint) {
        this.addKeyPoint(session.id, keyPoint);
      }
    }

    this.logger.debug(`Updated context for session ${session.id}`);
  }

  /**
   * Prune context to fit within token limit
   */
  pruneContext(session: Session, maxTokens: number): void {
    let totalTokens = 0;
    const prunedMessages: Message[] = [];

    // Keep messages from the end until we hit the limit
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const message = session.messages[i];
      const tokens =
        message.metadata?.tokenCount || this.estimateTokens(message.content);

      if (totalTokens + tokens > maxTokens) {
        break;
      }

      prunedMessages.unshift(message);
      totalTokens += tokens;
    }

    session.messages = prunedMessages;
    session.context.tokenCount = totalTokens;

    this.logger.info(
      `Pruned context for session ${session.id}: ${prunedMessages.length} messages, ${totalTokens} tokens`,
    );
  }

  /**
   * Extract key points from a session
   */
  extractKeyPoints(session: Session): KeyPoint[] {
    const sessionKeyPoints = this.keyPoints.get(session.id) || [];

    // Also extract new key points from recent messages
    const recentMessages = session.messages.slice(-10);
    for (const message of recentMessages) {
      if (this.isImportantMessage(message)) {
        const keyPoint = this.extractKeyPoint(session.id, message);
        if (keyPoint && !sessionKeyPoints.some((kp) => kp.id === keyPoint.id)) {
          sessionKeyPoints.push(keyPoint);
        }
      }
    }

    return sessionKeyPoints;
  }

  /**
   * Summarize context
   */
  summarizeContext(session: Session): string {
    const keyPoints = this.extractKeyPoints(session);
    const topics = this.extractTopics(session);
    const stats = this.calculateStats(session);

    const summary = [
      `Session: ${session.name || session.id}`,
      `Duration: ${this.formatDuration(session.createdAt, session.lastActiveAt)}`,
      `Messages: ${session.messages.length}`,
      `Tokens: ${session.context.tokenCount}`,
      '',
      'Key Points:',
      ...keyPoints.slice(0, 5).map((kp) => `- ${kp.content}`),
      '',
      'Main Topics:',
      ...topics.slice(0, 5).map((topic) => `- ${topic}`),
    ].join('\n');

    return summary;
  }

  /**
   * Get full context (all messages)
   */
  private getFullContext(session: Session): Message[] {
    return [...session.messages];
  }

  /**
   * Get recent context (last N messages that fit in token limit)
   */
  private getRecentContext(session: Session, maxTokens: number): Message[] {
    const messages: Message[] = [];
    let totalTokens = 0;

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const message = session.messages[i];
      const tokens =
        message.metadata?.tokenCount || this.estimateTokens(message.content);

      if (totalTokens + tokens > maxTokens) {
        break;
      }

      messages.unshift(message);
      totalTokens += tokens;
    }

    return messages;
  }

  /**
   * Get relevant context (messages related to current topic)
   */
  private async getRelevantContext(
    session: Session,
    maxTokens: number,
  ): Promise<Message[]> {
    // Get recent messages as base
    const recentMessages = session.messages.slice(-5);
    if (recentMessages.length === 0) {
      return [];
    }

    // Extract topics from recent messages
    const recentTopics = this.extractTopicsFromMessages(recentMessages);

    // Find relevant older messages
    const relevantMessages: Message[] = [];
    let totalTokens = 0;

    // Always include recent messages
    for (const message of recentMessages) {
      const tokens =
        message.metadata?.tokenCount || this.estimateTokens(message.content);
      relevantMessages.push(message);
      totalTokens += tokens;
    }

    // Add relevant older messages
    for (
      let i = session.messages.length - recentMessages.length - 1;
      i >= 0;
      i--
    ) {
      const message = session.messages[i];
      const tokens =
        message.metadata?.tokenCount || this.estimateTokens(message.content);

      if (totalTokens + tokens > maxTokens) {
        break;
      }

      if (this.isRelevantMessage(message, recentTopics)) {
        relevantMessages.unshift(message);
        totalTokens += tokens;
      }
    }

    return relevantMessages;
  }

  /**
   * Get summary context (summarized older messages + recent full messages)
   */
  private async getSummaryContext(
    session: Session,
    maxTokens: number,
  ): Promise<Message[]> {
    const recentCount = 10;
    const recentMessages = session.messages.slice(-recentCount);
    const olderMessages = session.messages.slice(0, -recentCount);

    if (olderMessages.length === 0) {
      return recentMessages;
    }

    // Create summary of older messages
    const summary = this.summarizeMessages(olderMessages);
    const summaryMessage: Message = {
      id: 'summary',
      role: 'system',
      content: `Previous conversation summary:\n${summary}`,
      timestamp: olderMessages[olderMessages.length - 1].timestamp,
    };

    return [summaryMessage, ...recentMessages];
  }

  /**
   * Compress messages to fit token limit
   */
  private compressMessages(messages: Message[], maxTokens: number): Message[] {
    let totalTokens = 0;
    const compressed: Message[] = [];

    for (const message of messages) {
      const tokens =
        message.metadata?.tokenCount || this.estimateTokens(message.content);

      if (totalTokens + tokens > maxTokens && compressed.length > 0) {
        // Compress earlier messages
        const toCompress = Math.floor(compressed.length / 2);
        for (let i = 0; i < toCompress; i++) {
          compressed[i] = this.compressMessage(compressed[i]);
        }

        // Recalculate tokens
        totalTokens = compressed.reduce(
          (sum, m) =>
            sum + (m.metadata?.tokenCount || this.estimateTokens(m.content)),
          0,
        );
      }

      compressed.push(message);
      totalTokens += tokens;
    }

    return compressed;
  }

  /**
   * Compress a single message
   */
  private compressMessage(message: Message): Message {
    // Simple compression: keep first and last parts
    const maxLength = 500;
    if (message.content.length <= maxLength) {
      return message;
    }

    const halfLength = Math.floor(maxLength / 2);
    const compressed = `${message.content.substring(0, halfLength)}\n... (content compressed) ...\n${message.content.substring(message.content.length - halfLength)}`;

    return {
      ...message,
      content: compressed,
      metadata: {
        ...message.metadata,
        compressed: true,
        originalLength: message.content.length,
      },
    };
  }

  /**
   * Build system prompt for session
   */
  private buildSystemPrompt(session: Session): string {
    const parts = ['You are Claude, an AI assistant integrated into VSCode.'];

    if (session.context.workspaceFiles.length > 0) {
      parts.push(
        `Current workspace contains ${session.context.workspaceFiles.length} files.`,
      );
    }

    if (session.context.activeFile) {
      parts.push(`Currently editing: ${session.context.activeFile}`);
    }

    if (session.metadata.tags && session.metadata.tags.length > 0) {
      parts.push(`Session tags: ${session.metadata.tags.join(', ')}`);
    }

    return parts.join(' ');
  }

  /**
   * Check if a message is important
   */
  private isImportantMessage(message: Message): boolean {
    // Messages with code changes
    if (
      message.metadata?.operations &&
      message.metadata.operations.length > 0
    ) {
      return true;
    }

    // Messages with high token count (likely detailed)
    if (message.metadata?.tokenCount && message.metadata.tokenCount > 500) {
      return true;
    }

    // Messages with certain keywords
    const importantKeywords = [
      'error',
      'bug',
      'fix',
      'implement',
      'create',
      'solution',
    ];
    const lowerContent = message.content.toLowerCase();
    return importantKeywords.some((keyword) => lowerContent.includes(keyword));
  }

  /**
   * Extract key point from message
   */
  private extractKeyPoint(
    sessionId: string,
    message: Message,
  ): KeyPoint | null {
    // Simple extraction: first sentence or line
    const firstLine = message.content.split('\n')[0];
    const firstSentence = firstLine.split(/[.!?]/)[0];

    if (firstSentence.length < 10 || firstSentence.length > 200) {
      return null;
    }

    return {
      id: `${sessionId}_${message.id}`,
      content: firstSentence.trim(),
      importance: this.calculateImportance(message),
      timestamp: message.timestamp,
      messageId: message.id,
    };
  }

  /**
   * Calculate message importance
   */
  private calculateImportance(message: Message): 'high' | 'medium' | 'low' {
    if (
      message.metadata?.operations &&
      message.metadata.operations.length > 0
    ) {
      return 'high';
    }

    if (message.role === 'user' && message.content.includes('?')) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Add key point
   */
  private addKeyPoint(sessionId: string, keyPoint: KeyPoint): void {
    const points = this.keyPoints.get(sessionId) || [];
    points.push(keyPoint);

    // Keep only most recent/important points
    points.sort((a, b) => {
      if (a.importance !== b.importance) {
        const importanceOrder = { high: 3, medium: 2, low: 1 };
        return importanceOrder[b.importance] - importanceOrder[a.importance];
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    this.keyPoints.set(sessionId, points.slice(0, 20));
  }

  /**
   * Extract topics from session
   */
  private extractTopics(session: Session): string[] {
    const topics = new Map<string, number>();

    // Simple topic extraction based on frequently mentioned terms
    for (const message of session.messages) {
      const words = message.content
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4);

      for (const word of words) {
        topics.set(word, (topics.get(word) || 0) + 1);
      }
    }

    // Sort by frequency and return top topics
    return Array.from(topics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);
  }

  /**
   * Extract topics from messages
   */
  private extractTopicsFromMessages(messages: Message[]): Set<string> {
    const topics = new Set<string>();

    for (const message of messages) {
      const words = message.content
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4);

      words.forEach((word) => topics.add(word));
    }

    return topics;
  }

  /**
   * Check if message is relevant to topics
   */
  private isRelevantMessage(message: Message, topics: Set<string>): boolean {
    const messageWords = new Set(
      message.content
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4),
    );

    // Check for topic overlap
    let overlap = 0;
    for (const topic of topics) {
      if (messageWords.has(topic)) {
        overlap++;
      }
    }

    return overlap >= 2; // At least 2 common topics
  }

  /**
   * Summarize messages
   */
  private summarizeMessages(messages: Message[]): string {
    // Simple summarization: key points from each message
    const summaryPoints: string[] = [];

    for (const message of messages) {
      if (message.role === 'user') {
        summaryPoints.push(`User: ${message.content.substring(0, 100)}...`);
      } else if (
        message.metadata?.operations &&
        message.metadata.operations.length > 0
      ) {
        summaryPoints.push(
          `Assistant: Made ${message.metadata.operations.length} file changes`,
        );
      }
    }

    return summaryPoints.join('\n');
  }

  /**
   * Calculate session statistics
   */
  private calculateStats(session: Session): {
    messageCount: number;
    tokenCount: number;
    averageMessageLength: number;
  } {
    const messageCount = session.messages.length;
    const tokenCount = session.context.tokenCount;
    const totalLength = session.messages.reduce(
      (sum, m) => sum + m.content.length,
      0,
    );

    return {
      messageCount,
      tokenCount,
      averageMessageLength:
        messageCount > 0 ? Math.round(totalLength / messageCount) : 0,
    };
  }

  /**
   * Estimate tokens in text
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~0.75 tokens per character
    return Math.ceil(text.length * this.tokenEstimateRatio);
  }

  /**
   * Format duration
   */
  private formatDuration(start: Date, end: Date): string {
    const ms = end.getTime() - start.getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}
