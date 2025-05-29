import { EventEmitter } from 'node:events';
import { Logger } from '../logger';
import type {
  Session,
  Message,
  HistoryOptions,
  SearchResult,
  ExportFormat,
} from './session-types';

interface MessageEdit {
  messageId: string;
  previousContent: string;
  newContent: string;
  editedAt: Date;
  reason?: string;
}

/**
 * Manages conversation history operations
 */
export class HistoryManager extends EventEmitter {
  private readonly logger = new Logger('HistoryManager');
  private messageEdits = new Map<string, MessageEdit[]>();
  private deletedMessages = new Map<string, Message>();
  private bookmarkedMessages = new Set<string>();

  /**
   * Add a message to session history
   */
  addMessage(session: Session, message: Message): void {
    // Validate message
    if (!message.id || !message.content) {
      throw new Error('Invalid message: missing required fields');
    }

    // Add metadata
    if (!message.metadata) {
      message.metadata = {};
    }
    message.metadata.addedAt = new Date();

    // Add to session
    session.messages.push(message);
    session.lastActiveAt = new Date();

    // Update conversation turn if applicable
    if (message.role === 'user') {
      session.turns.push({
        id: `turn_${Date.now()}`,
        userMessage: message,
        startTime: new Date(),
        status: 'pending',
      });
    } else if (message.role === 'assistant' && session.turns.length > 0) {
      const lastTurn = session.turns[session.turns.length - 1];
      if (lastTurn.status === 'pending') {
        lastTurn.assistantMessage = message;
        lastTurn.endTime = new Date();
        lastTurn.status = 'complete';
      }
    }

    this.logger.debug(`Added message ${message.id} to session ${session.id}`);
    this.emit('messageAdded', session.id, message);
  }

  /**
   * Get history with options
   */
  getHistory(session: Session, options: HistoryOptions = {}): Message[] {
    let messages = [...session.messages];

    // Filter by date range
    if (options.startDate || options.endDate) {
      messages = messages.filter((m) => {
        const timestamp = m.timestamp.getTime();
        if (options.startDate && timestamp < options.startDate.getTime()) {
          return false;
        }
        if (options.endDate && timestamp > options.endDate.getTime()) {
          return false;
        }
        return true;
      });
    }

    // Include deleted messages if requested
    if (options.includeDeleted) {
      const deletedInSession = Array.from(this.deletedMessages.values()).filter(
        (m) => this.isMessageInSession(m, session),
      );
      messages = [...messages, ...deletedInSession];
    }

    // Sort
    messages.sort((a, b) => {
      const timeA = a.timestamp.getTime();
      const timeB = b.timestamp.getTime();
      return options.sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });

    // Apply pagination
    if (options.offset !== undefined || options.limit !== undefined) {
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : undefined;
      messages = messages.slice(start, end);
    }

    return messages;
  }

  /**
   * Search history across sessions
   */
  searchHistory(query: string, sessionIds?: string[]): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // Search function
    const searchSession = (session: Session) => {
      for (const message of session.messages) {
        const lowerContent = message.content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);

        if (index !== -1) {
          const matches = this.findAllMatches(message.content, query);
          results.push({
            messageId: message.id,
            sessionId: session.id,
            content: message.content,
            matches,
            score: this.calculateSearchScore(message, matches, query),
          });
        }
      }
    };

    // Search in specified sessions or all available
    if (sessionIds) {
      // In a real implementation, we'd get sessions from a store
      // For now, we'll just note this is where session lookup would happen
      this.logger.warn('Session-specific search not fully implemented');
    }

    // Sort by relevance score
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Clear history for a session
   */
  clearHistory(session: Session): void {
    const messageCount = session.messages.length;

    // Store deleted messages
    for (const message of session.messages) {
      this.deletedMessages.set(message.id, message);
    }

    // Clear session messages
    session.messages = [];
    session.turns = [];
    session.context.tokenCount = 0;

    this.logger.info(
      `Cleared ${messageCount} messages from session ${session.id}`,
    );
    this.emit('historyCleared', session.id);
  }

  /**
   * Export history in specified format
   */
  exportHistory(session: Session, format: ExportFormat): string {
    switch (format) {
      case ExportFormat.JSON:
        return this.exportAsJSON(session);
      case ExportFormat.MARKDOWN:
        return this.exportAsMarkdown(session);
      case ExportFormat.HTML:
        return this.exportAsHTML(session);
      case ExportFormat.PDF:
        // PDF export would require additional libraries
        throw new Error('PDF export not yet implemented');
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Edit a message
   */
  editMessage(
    session: Session,
    messageId: string,
    newContent: string,
    reason?: string,
  ): void {
    const message = session.messages.find((m) => m.id === messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Store edit history
    const edit: MessageEdit = {
      messageId,
      previousContent: message.content,
      newContent,
      editedAt: new Date(),
      reason,
    };

    const edits = this.messageEdits.get(messageId) || [];
    edits.push(edit);
    this.messageEdits.set(messageId, edits);

    // Update message
    message.content = newContent;
    message.editedAt = new Date();

    this.logger.info(`Edited message ${messageId}`);
    this.emit('messageEdited', session.id, messageId, edit);
  }

  /**
   * Delete a message
   */
  deleteMessage(session: Session, messageId: string): void {
    const index = session.messages.findIndex((m) => m.id === messageId);
    if (index === -1) {
      throw new Error(`Message ${messageId} not found`);
    }

    const message = session.messages[index];

    // Store deleted message
    this.deletedMessages.set(messageId, message);

    // Remove from session
    session.messages.splice(index, 1);

    // Update turns if needed
    session.turns = session.turns.filter(
      (turn) =>
        turn.userMessage.id !== messageId &&
        turn.assistantMessage?.id !== messageId,
    );

    this.logger.info(`Deleted message ${messageId}`);
    this.emit('messageDeleted', session.id, messageId);
  }

  /**
   * Bookmark a message
   */
  bookmarkMessage(messageId: string): void {
    if (this.bookmarkedMessages.has(messageId)) {
      this.bookmarkedMessages.delete(messageId);
      this.logger.debug(`Removed bookmark from message ${messageId}`);
    } else {
      this.bookmarkedMessages.add(messageId);
      this.logger.debug(`Bookmarked message ${messageId}`);
    }

    this.emit(
      'messageBookmarked',
      messageId,
      this.bookmarkedMessages.has(messageId),
    );
  }

  /**
   * Get bookmarked messages
   */
  getBookmarkedMessages(session: Session): Message[] {
    return session.messages.filter((m) => this.bookmarkedMessages.has(m.id));
  }

  /**
   * Get message edit history
   */
  getEditHistory(messageId: string): MessageEdit[] {
    return this.messageEdits.get(messageId) || [];
  }

  /**
   * Calculate conversation statistics
   */
  getStatistics(session: Session): {
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    totalTokens: number;
    averageResponseTime: number;
    editedMessages: number;
    deletedMessages: number;
    bookmarkedMessages: number;
    topicsDiscussed: string[];
  } {
    const userMessages = session.messages.filter(
      (m) => m.role === 'user',
    ).length;
    const assistantMessages = session.messages.filter(
      (m) => m.role === 'assistant',
    ).length;
    const totalTokens = session.messages.reduce(
      (sum, m) => sum + (m.metadata?.tokenCount || 0),
      0,
    );

    // Calculate average response time
    let totalResponseTime = 0;
    let responseCount = 0;
    for (const turn of session.turns) {
      if (turn.status === 'complete' && turn.endTime) {
        totalResponseTime += turn.endTime.getTime() - turn.startTime.getTime();
        responseCount++;
      }
    }
    const averageResponseTime =
      responseCount > 0 ? totalResponseTime / responseCount : 0;

    // Count edited messages
    const editedMessages = session.messages.filter((m) => m.editedAt).length;

    // Count deleted messages for this session
    const deletedMessages = Array.from(this.deletedMessages.values()).filter(
      (m) => this.isMessageInSession(m, session),
    ).length;

    // Count bookmarked messages
    const bookmarkedMessages = session.messages.filter((m) =>
      this.bookmarkedMessages.has(m.id),
    ).length;

    // Extract topics (simple implementation)
    const topicsDiscussed = this.extractTopics(session);

    return {
      totalMessages: session.messages.length,
      userMessages,
      assistantMessages,
      totalTokens,
      averageResponseTime,
      editedMessages,
      deletedMessages,
      bookmarkedMessages,
      topicsDiscussed,
    };
  }

  /**
   * Find all matches in content
   */
  private findAllMatches(
    content: string,
    query: string,
  ): Array<{ start: number; end: number; text: string }> {
    const matches: Array<{ start: number; end: number; text: string }> = [];
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    let index = 0;
    let foundIndex = lowerContent.indexOf(lowerQuery, index);
    while (foundIndex !== -1) {
      matches.push({
        start: foundIndex,
        end: foundIndex + query.length,
        text: content.substring(foundIndex, foundIndex + query.length),
      });
      index = foundIndex + query.length;
      foundIndex = lowerContent.indexOf(lowerQuery, index);
    }

    return matches;
  }

  /**
   * Calculate search relevance score
   */
  private calculateSearchScore(
    message: Message,
    matches: any[],
    query: string,
  ): number {
    let score = matches.length * 10; // Base score for match count

    // Boost for exact matches
    if (message.content.includes(query)) {
      score += 20;
    }

    // Boost for matches in user messages
    if (message.role === 'user') {
      score += 5;
    }

    // Boost for recent messages
    const ageInDays =
      (Date.now() - message.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    score -= ageInDays * 0.5;

    // Boost for bookmarked messages
    if (this.bookmarkedMessages.has(message.id)) {
      score += 15;
    }

    return Math.max(0, score);
  }

  /**
   * Check if message belongs to session
   */
  private isMessageInSession(message: Message, session: Session): boolean {
    // Simple check based on timestamp range
    return (
      message.timestamp >= session.createdAt &&
      message.timestamp <= session.lastActiveAt
    );
  }

  /**
   * Export as JSON
   */
  private exportAsJSON(session: Session): string {
    const exportData = {
      session: {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        metadata: session.metadata,
      },
      messages: session.messages,
      statistics: this.getStatistics(session),
      bookmarks: Array.from(this.bookmarkedMessages),
      edits: Array.from(this.messageEdits.entries()),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export as Markdown
   */
  private exportAsMarkdown(session: Session): string {
    const lines: string[] = [
      `# Conversation: ${session.name || session.id}`,
      ``,
      `**Created:** ${session.createdAt.toLocaleString()}`,
      `**Last Active:** ${session.lastActiveAt.toLocaleString()}`,
      ``,
      `## Messages`,
      ``,
    ];

    for (const message of session.messages) {
      const role = message.role.charAt(0).toUpperCase() + message.role.slice(1);
      const bookmark = this.bookmarkedMessages.has(message.id) ? ' 🔖' : '';
      const edited = message.editedAt ? ' ✏️' : '';

      lines.push(`### ${role}${bookmark}${edited}`);
      lines.push(`*${message.timestamp.toLocaleString()}*`);
      lines.push(``);
      lines.push(message.content);
      lines.push(``);
    }

    const stats = this.getStatistics(session);
    lines.push(`## Statistics`);
    lines.push(`- Total Messages: ${stats.totalMessages}`);
    lines.push(`- User Messages: ${stats.userMessages}`);
    lines.push(`- Assistant Messages: ${stats.assistantMessages}`);
    lines.push(`- Total Tokens: ${stats.totalTokens}`);
    lines.push(
      `- Average Response Time: ${Math.round(stats.averageResponseTime / 1000)}s`,
    );

    return lines.join('\n');
  }

  /**
   * Export as HTML
   */
  private exportAsHTML(session: Session): string {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Conversation: ${session.name || session.id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }
    .user { background: #e3f2fd; }
    .assistant { background: #f5f5f5; }
    .system { background: #fff3e0; }
    .role { font-weight: bold; margin-bottom: 5px; }
    .timestamp { color: #666; font-size: 0.9em; }
    .content { white-space: pre-wrap; }
    .bookmark { color: #ff9800; }
    .edited { color: #4caf50; }
  </style>
</head>
<body>
  <h1>Conversation: ${session.name || session.id}</h1>
  <p><strong>Created:</strong> ${session.createdAt.toLocaleString()}</p>
  <p><strong>Last Active:</strong> ${session.lastActiveAt.toLocaleString()}</p>
  
  <h2>Messages</h2>
  ${session.messages
    .map((message) => {
      const bookmark = this.bookmarkedMessages.has(message.id)
        ? '<span class="bookmark">🔖</span>'
        : '';
      const edited = message.editedAt ? '<span class="edited">✏️</span>' : '';

      return `
    <div class="message ${message.role}">
      <div class="role">${message.role.charAt(0).toUpperCase() + message.role.slice(1)} ${bookmark} ${edited}</div>
      <div class="timestamp">${message.timestamp.toLocaleString()}</div>
      <div class="content">${this.escapeHtml(message.content)}</div>
    </div>`;
    })
    .join('')}
</body>
</html>`;

    return html;
  }

  /**
   * Escape HTML characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Extract topics from session
   */
  private extractTopics(session: Session): string[] {
    // Simple topic extraction - in production would use NLP
    const wordFrequency = new Map<string, number>();
    const stopWords = new Set([
      'the',
      'is',
      'at',
      'which',
      'on',
      'and',
      'a',
      'an',
      'as',
      'are',
      'was',
      'were',
      'been',
      'be',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'can',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'them',
      'their',
      'what',
      'which',
      'who',
      'when',
      'where',
      'why',
      'how',
      'all',
      'each',
      'every',
      'some',
      'any',
      'few',
      'more',
      'most',
      'other',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'to',
      'from',
      'in',
      'out',
      'off',
      'over',
      'under',
      'again',
      'then',
      'once',
    ]);

    for (const message of session.messages) {
      const words = message.content
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3 && !stopWords.has(word));

      for (const word of words) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }

    // Get top 10 most frequent words as topics
    return Array.from(wordFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }
}
