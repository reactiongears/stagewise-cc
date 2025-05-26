import * as vscode from 'vscode';
import { SessionManager } from './session-manager';
import { ConversationBranching } from './conversation-branching';
import { ClaudeIntegration } from './claude-integration';
import { 
  Session,
  SessionMetadata,
  SessionConfig
} from './session-types';
import { Logger } from './logger';

/**
 * Session integration configuration
 */
export interface SessionIntegrationConfig {
  enableBranching?: boolean;
  autoCreateSession?: boolean;
  sessionDefaults?: Partial<SessionConfig>;
}

/**
 * Integrates session management with Claude integration
 */
export class SessionIntegration {
  private logger: Logger;
  private sessionManager: SessionManager;
  private branching: ConversationBranching;
  private claudeIntegration: ClaudeIntegration;
  private config: SessionIntegrationConfig;
  
  constructor(
    context: vscode.ExtensionContext,
    config?: SessionIntegrationConfig
  ) {
    const outputChannel = vscode.window.createOutputChannel('Claude Session Integration');
    this.logger = new Logger(outputChannel);
    
    this.config = {
      enableBranching: config?.enableBranching ?? true,
      autoCreateSession: config?.autoCreateSession ?? true,
      sessionDefaults: config?.sessionDefaults || {}
    };
    
    // Initialize components
    this.sessionManager = new SessionManager(context);
    this.branching = new ConversationBranching();
    this.claudeIntegration = new ClaudeIntegration();
    
    this.setupEventHandlers();
  }

  /**
   * Send a message to Claude
   */
  async sendMessage(content: string): Promise<void> {
    try {
      // Ensure we have an active session
      let session = await this.sessionManager.getActiveSession();
      
      if (!session && this.config.autoCreateSession) {
        session = await this.sessionManager.createSession({
          metadata: {
            title: content.substring(0, 50) + '...',
            projectPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
          },
          config: this.config.sessionDefaults
        });
      }
      
      if (!session) {
        throw new Error('No active session. Please create a session first.');
      }
      
      // Add user turn
      const turn = await this.sessionManager.addTurn(content);
      
      if (!turn) {
        throw new Error('Failed to add message to session');
      }
      
      // Process with Claude
      await this.claudeIntegration.processClaudeResponse({
        type: 'complete',
        data: content
      });
      
      this.logger.info('Message sent to Claude');
      
    } catch (error) {
      this.logger.error('Failed to send message', error);
      vscode.window.showErrorMessage(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create a new session
   */
  async createNewSession(metadata?: SessionMetadata): Promise<Session> {
    return await this.sessionManager.createSession({
      metadata,
      config: this.config.sessionDefaults,
      activate: true
    });
  }

  /**
   * Switch to a different session
   */
  async switchSession(sessionId: string): Promise<void> {
    const success = await this.sessionManager.activateSession(sessionId);
    
    if (!success) {
      throw new Error(`Failed to switch to session ${sessionId}`);
    }
    
    this.logger.info(`Switched to session ${sessionId}`);
  }

  /**
   * Create a new branch
   */
  async createBranch(
    name?: string,
    fromTurnId?: string
  ): Promise<void> {
    if (!this.config.enableBranching) {
      throw new Error('Branching is not enabled');
    }
    
    const session = await this.sessionManager.getActiveSession();
    if (!session) {
      throw new Error('No active session');
    }
    
    // Use last turn if not specified
    if (!fromTurnId && session.turns.length > 0) {
      fromTurnId = session.turns[session.turns.length - 1].id;
    }
    
    if (!fromTurnId) {
      throw new Error('No turn to branch from');
    }
    
    const branch = await this.branching.createBranch(session, {
      name,
      branchFromTurnId: fromTurnId,
      copySubsequentTurns: false
    });
    
    // Switch to new branch
    await this.branching.switchBranch(session, branch.id);
    
    // Save session through storage
    const storage = (this.sessionManager as any).storage;
    if (storage) {
      await storage.saveSession(session);
    }
    
    this.logger.info(`Created and switched to branch ${branch.id}`);
  }

  /**
   * Get session quick pick items
   */
  async getSessionQuickPicks(): Promise<vscode.QuickPickItem[]> {
    const sessions = await this.sessionManager.listSessions();
    const activeSession = await this.sessionManager.getActiveSession();
    
    return sessions.map(item => ({
      label: item.title,
      description: `${item.turnCount} turns • ${this.formatRelativeTime(item.lastActive)}`,
      detail: item.preview,
      picked: item.id === activeSession?.id,
      sessionId: item.id
    } as any));
  }

  /**
   * Show session picker
   */
  async showSessionPicker(): Promise<void> {
    const items = await this.getSessionQuickPicks();
    
    // Add create new option
    items.unshift({
      label: '$(add) Create New Session',
      description: 'Start a fresh conversation',
      alwaysShow: true,
      isNew: true
    } as any);
    
    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a session or create a new one',
      title: 'Claude Sessions'
    });
    
    if (!selection) return;
    
    if ((selection as any).isNew) {
      await this.createNewSession();
    } else {
      await this.switchSession((selection as any).sessionId);
    }
  }

  /**
   * Export current session
   */
  async exportCurrentSession(): Promise<void> {
    const session = await this.sessionManager.getActiveSession();
    if (!session) {
      vscode.window.showWarningMessage('No active session to export');
      return;
    }
    
    const content = await this.sessionManager.exportSession(session.id);
    
    // Show in new document
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown'
    });
    
    await vscode.window.showTextDocument(doc);
  }

  /**
   * Get session statistics for status bar
   */
  async getStatusBarInfo(): Promise<string> {
    const session = await this.sessionManager.getActiveSession();
    if (!session) {
      return 'No active session';
    }
    
    const stats = await this.sessionManager.getSessionStats(session.id);
    if (!stats) {
      return 'Session';
    }
    
    let info = `Session: ${stats.totalTurns} turns`;
    
    if (session.currentBranchId) {
      const branch = this.branching.getBranch(session, session.currentBranchId);
      info += ` • Branch: ${branch?.name || 'unnamed'}`;
    }
    
    return info;
  }

  // Private helper methods

  private setupEventHandlers(): void {
    // Handle Claude responses - would need to be implemented in ClaudeIntegration
    // For now, we'll handle responses directly in sendMessage
    
    // Handle session lifecycle events
    this.sessionManager.onLifecycleEvent(event => {
      this.logger.debug(`Session lifecycle event: ${event.type} for ${event.sessionId}`);
    });
    
    // Handle branch navigation
    if (this.config.enableBranching) {
      this.branching.onBranchNavigation(event => {
        this.logger.debug(`Branch navigation: ${event.fromBranchId} -> ${event.toBranchId}`);
      });
    }
  }


  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    
    return date.toLocaleDateString();
  }

  /**
   * Register commands
   */
  registerCommands(context: vscode.ExtensionContext): void {
    // Register session commands
    context.subscriptions.push(
      vscode.commands.registerCommand('stagewise-cc.newSession', () => {
        this.createNewSession();
      }),
      
      vscode.commands.registerCommand('stagewise-cc.switchSession', () => {
        this.showSessionPicker();
      }),
      
      vscode.commands.registerCommand('stagewise-cc.exportSession', () => {
        this.exportCurrentSession();
      }),
      
      vscode.commands.registerCommand('stagewise-cc.createBranch', () => {
        vscode.window.showInputBox({
          prompt: 'Branch name (optional)',
          placeHolder: 'my-feature-branch'
        }).then(name => {
          if (name !== undefined) {
            this.createBranch(name);
          }
        });
      })
    );
    
    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    
    statusBarItem.command = 'stagewise-cc.switchSession';
    context.subscriptions.push(statusBarItem);
    
    // Update status bar periodically
    const updateStatusBar = async () => {
      statusBarItem.text = await this.getStatusBarInfo();
      statusBarItem.show();
    };
    
    updateStatusBar();
    const timer = setInterval(updateStatusBar, 5000);
    
    context.subscriptions.push({
      dispose: () => clearInterval(timer)
    });
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.sessionManager.dispose();
    this.branching.dispose();
    this.claudeIntegration.dispose();
  }
}