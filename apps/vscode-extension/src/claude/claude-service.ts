import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { ClaudeSubprocessWrapper } from './subprocess-wrapper';
import { ClaudeAuthService } from './auth-service';
import { ClaudeConfigService } from './config-service';
import {
  ClaudeSession,
  ClaudeRequest,
  ClaudeCompleteResponse,
  ClaudeStreamResponse,
  ServiceHealth,
  HealthStatus,
  ComponentHealth,
  SessionManager,
  ContextEnricher,
  SessionContext,
  WorkspaceContext,
  FileContext,
  DomContext,
  ContextOptions,
  ConversationEntry,
  ResponseMetadata
} from './service-types';
import { AuthStatus } from './auth-types';
import { ClaudeResponse } from './types';
import { PromptTransformer } from './prompt-transformer';
import { WorkspaceCollector } from './workspace-collector';
import type { ClaudePromptContext } from './prompt-context';

export class ClaudeService extends EventEmitter {
  private static instance: ClaudeService;
  private subprocess: ClaudeSubprocessWrapper | null = null;
  private sessionManager: SessionManagerImpl;
  private contextEnricher: ContextEnricherImpl;
  private promptTransformer: PromptTransformer;
  private workspaceCollector: WorkspaceCollector;
  private responseCache: Map<string, ClaudeCompleteResponse> = new Map();
  private isInitialized = false;
  
  private constructor(
    private context: vscode.ExtensionContext,
    private authService: ClaudeAuthService,
    private configService: ClaudeConfigService,
    private outputChannel: vscode.OutputChannel
  ) {
    super();
    this.sessionManager = new SessionManagerImpl(context, outputChannel);
    this.contextEnricher = new ContextEnricherImpl(outputChannel);
    this.promptTransformer = new PromptTransformer();
    this.workspaceCollector = WorkspaceCollector.getInstance();
    this.setupEventHandlers();
  }
  
  static getInstance(
    context: vscode.ExtensionContext,
    authService: ClaudeAuthService,
    configService: ClaudeConfigService,
    outputChannel: vscode.OutputChannel
  ): ClaudeService {
    if (!ClaudeService.instance) {
      ClaudeService.instance = new ClaudeService(context, authService, configService, outputChannel);
    }
    return ClaudeService.instance;
  }
  
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    this.log('Initializing Claude service');
    
    // Check authentication
    if (this.authService.getStatus() !== AuthStatus.VALID) {
      throw new Error('Claude API key not configured or invalid');
    }
    
    // Initialize subprocess
    await this.initializeSubprocess();
    
    // Load saved sessions
    await this.sessionManager.loadSavedSessions();
    
    this.isInitialized = true;
    this.emit('initialized');
    this.log('Claude service initialized successfully');
  }
  
  async sendPrompt(request: ClaudeRequest): Promise<ClaudeCompleteResponse> {
    await this.ensureInitialized();
    
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      throw new Error('No active session. Please create a session first.');
    }
    
    // Build context
    const context = request.context || await this.contextEnricher.buildContext({
      includeWorkspace: true,
      includeFile: true,
      includeDom: true
    });
    
    // Check cache
    const cacheKey = this.getCacheKey(request.prompt, context);
    if (this.configService.getConfiguration().cacheResponses) {
      const cached = this.responseCache.get(cacheKey);
      if (cached) {
        this.log('Returning cached response');
        return cached;
      }
    }
    
    // Add user message to history
    const userEntry: ConversationEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      role: 'user',
      content: request.prompt,
      metadata: {
        context: {
          timestamp: new Date(),
          workspace: context.workspaceContext,
          file: context.fileContext,
          dom: context.domContext
        }
      }
    };
    session.history.push(userEntry);
    
    try {
      // Send to Claude
      const startTime = Date.now();
      const config = this.configService.getConfiguration();
      
      // Build the full prompt with context
      const fullPrompt = await this.buildFullPrompt(request.prompt, context);
      
      if (request.options?.stream ?? config.streamResponses) {
        return await this.handleStreamingResponse(fullPrompt, session, startTime);
      } else {
        return await this.handleCompleteResponse(fullPrompt, session, startTime);
      }
    } catch (error) {
      this.handleError('Failed to send prompt', error);
      throw error;
    }
  }
  
  async createSession(metadata?: any): Promise<ClaudeSession> {
    await this.ensureInitialized();
    const session = this.sessionManager.createSession(metadata);
    this.emit('sessionCreated', session);
    return session;
  }
  
  getCurrentSession(): ClaudeSession | undefined {
    return this.sessionManager.getCurrentSession();
  }
  
  setCurrentSession(id: string): void {
    this.sessionManager.setCurrentSession(id);
    this.emit('sessionChanged', id);
  }
  
  getAllSessions(): ClaudeSession[] {
    return this.sessionManager.getAllSessions();
  }
  
  async clearHistory(): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (session) {
      session.history = [];
      await this.sessionManager.saveSession(session.id);
      this.emit('historyCleared', session.id);
    }
  }
  
  async getHealth(): Promise<ServiceHealth> {
    const health: ServiceHealth = {
      subprocess: await this.getSubprocessHealth(),
      auth: this.getAuthHealth(),
      config: this.getConfigHealth(),
      overall: HealthStatus.UNKNOWN,
      lastCheck: new Date()
    };
    
    // Determine overall health
    const statuses = [health.subprocess.status, health.auth.status, health.config.status];
    if (statuses.every(s => s === HealthStatus.HEALTHY)) {
      health.overall = HealthStatus.HEALTHY;
    } else if (statuses.some(s => s === HealthStatus.UNHEALTHY)) {
      health.overall = HealthStatus.UNHEALTHY;
    } else {
      health.overall = HealthStatus.DEGRADED;
    }
    
    return health;
  }
  
  async shutdown(): Promise<void> {
    this.log('Shutting down Claude service');
    
    // Save all sessions
    for (const session of this.sessionManager.getAllSessions()) {
      await this.sessionManager.saveSession(session.id);
    }
    
    // Stop subprocess
    if (this.subprocess) {
      await this.subprocess.stop();
      this.subprocess = null;
    }
    
    // Clear caches
    this.responseCache.clear();
    
    this.isInitialized = false;
    this.emit('shutdown');
    this.log('Claude service shut down successfully');
  }
  
  private async initializeSubprocess(): Promise<void> {
    const apiKey = await this.authService.getApiKey();
    if (!apiKey) {
      throw new Error('API key not available');
    }
    
    const config = this.configService.getConfiguration();
    
    this.subprocess = new ClaudeSubprocessWrapper({
      apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      workingDirectory: vscode.workspace.rootPath
    });
    
    // Set up subprocess event handlers
    this.subprocess.on('ready', () => {
      this.log('Subprocess ready');
    });
    
    this.subprocess.on('error', (error) => {
      this.handleError('Subprocess error', error);
    });
    
    this.subprocess.on('close', (code, signal) => {
      this.log(`Subprocess closed with code ${code} and signal ${signal}`);
      if (this.isInitialized) {
        // Attempt to restart
        this.initializeSubprocess().catch(error => {
          this.handleError('Failed to restart subprocess', error);
        });
      }
    });
    
    await this.subprocess.start();
  }
  
  private async handleStreamingResponse(
    prompt: string,
    session: ClaudeSession,
    startTime: number
  ): Promise<ClaudeCompleteResponse> {
    return new Promise((resolve, reject) => {
      let fullResponse = '';
      const responseId = this.generateId();
      
      this.subprocess!.on('data', (response: ClaudeResponse) => {
        if (response.isStreaming) {
          fullResponse += response.content;
          const streamResponse: ClaudeStreamResponse = {
            id: responseId,
            chunk: response.content,
            isComplete: false
          };
          this.emit('stream', streamResponse);
        } else {
          // Complete response
          fullResponse += response.content;
          const processingTime = Date.now() - startTime;
          
          const metadata: ResponseMetadata = {
            model: this.configService.getConfiguration().model,
            processingTime,
            cached: false
          };
          
          const completeResponse: ClaudeCompleteResponse = {
            id: responseId,
            content: fullResponse,
            metadata
          };
          
          // Add to session history
          const assistantEntry: ConversationEntry = {
            id: this.generateId(),
            timestamp: new Date(),
            role: 'assistant',
            content: fullResponse,
            metadata: {
              model: metadata.model,
              processingTime: metadata.processingTime
            }
          };
          session.history.push(assistantEntry);
          
          // Cache response
          if (this.configService.getConfiguration().cacheResponses) {
            const cacheKey = this.getCacheKey(prompt, session.context);
            this.responseCache.set(cacheKey, completeResponse);
          }
          
          resolve(completeResponse);
        }
      });
      
      this.subprocess!.send(prompt).catch(reject);
    });
  }
  
  private async handleCompleteResponse(
    prompt: string,
    session: ClaudeSession,
    startTime: number
  ): Promise<ClaudeCompleteResponse> {
    return new Promise((resolve, reject) => {
      const responseId = this.generateId();
      
      this.subprocess!.once('data', (response: ClaudeResponse) => {
        const processingTime = Date.now() - startTime;
        
        const metadata: ResponseMetadata = {
          model: this.configService.getConfiguration().model,
          processingTime,
          cached: false
        };
        
        const completeResponse: ClaudeCompleteResponse = {
          id: responseId,
          content: response.content,
          metadata
        };
        
        // Add to session history
        const assistantEntry: ConversationEntry = {
          id: this.generateId(),
          timestamp: new Date(),
          role: 'assistant',
          content: response.content,
          metadata: {
            model: metadata.model,
            processingTime: metadata.processingTime
          }
        };
        session.history.push(assistantEntry);
        
        // Cache response
        if (this.configService.getConfiguration().cacheResponses) {
          const cacheKey = this.getCacheKey(prompt, session.context);
          this.responseCache.set(cacheKey, completeResponse);
        }
        
        resolve(completeResponse);
      });
      
      this.subprocess!.send(prompt).catch(reject);
    });
  }
  
  private async buildFullPrompt(prompt: string, context: SessionContext): Promise<string> {
    try {
      // Gather workspace info
      const workspaceInfo = await this.workspaceCollector.gatherWorkspaceInfo();
      
      // Convert SessionContext to ClaudePromptContext
      const claudeContext: ClaudePromptContext = {
        userMessage: prompt,
        timestamp: new Date(),
        workspaceMetadata: workspaceInfo,
        currentUrl: context.domContext?.url,
        domElements: context.domContext?.elementInfo ? [{
          tagName: context.domContext.elementInfo.tagName,
          attributes: context.domContext.elementInfo.attributes || {},
          textContent: '',
          selector: '',
          metadata: {
            isInteractive: false,
            hasEventListeners: false,
            isVisible: true
          }
        }] : undefined,
        strategy: 'standard',
        maxTokens: this.configService.getConfiguration().maxTokens || 100000
      };
      
      // Use the prompt transformer
      return await this.promptTransformer.transform(claudeContext);
    } catch (error) {
      this.log(`Failed to transform prompt: ${error}`);
      // Fallback to simple prompt
      return prompt;
    }
  }
  
  private getCacheKey(prompt: string, context: SessionContext): string {
    const contextKey = JSON.stringify({
      workspace: context.workspaceContext?.name,
      file: context.fileContext?.filePath,
      dom: context.domContext?.url
    });
    return `${prompt}::${contextKey}`;
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
  
  private setupEventHandlers(): void {
    // Listen for auth status changes
    this.authService.on('statusChange', (event) => {
      if (event.currentStatus !== AuthStatus.VALID && this.isInitialized) {
        this.shutdown().catch(error => {
          this.handleError('Failed to shutdown after auth status change', error);
        });
      }
    });
    
    // Listen for config changes
    this.configService.on('configurationChanged', (event) => {
      if (this.subprocess) {
        // Restart subprocess with new config
        this.initializeSubprocess().catch(error => {
          this.handleError('Failed to restart subprocess after config change', error);
        });
      }
    });
  }
  
  private async getSubprocessHealth(): Promise<ComponentHealth> {
    if (!this.subprocess) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Subprocess not initialized'
      };
    }
    
    if (this.subprocess.isHealthy()) {
      return {
        status: HealthStatus.HEALTHY,
        message: 'Subprocess is running',
        details: this.subprocess.getState()
      };
    }
    
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Subprocess is not healthy',
      details: this.subprocess.getState()
    };
  }
  
  private getAuthHealth(): ComponentHealth {
    const status = this.authService.getStatus();
    
    switch (status) {
      case AuthStatus.VALID:
        return {
          status: HealthStatus.HEALTHY,
          message: 'Authentication is valid'
        };
      case AuthStatus.INVALID:
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Authentication is invalid'
        };
      case AuthStatus.NOT_CONFIGURED:
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Authentication not configured'
        };
      default:
        return {
          status: HealthStatus.DEGRADED,
          message: `Authentication status: ${status}`
        };
    }
  }
  
  private getConfigHealth(): ComponentHealth {
    try {
      const config = this.configService.getConfiguration();
      const validation = this.configService.validateConfiguration(config);
      
      if (validation.isValid) {
        return {
          status: HealthStatus.HEALTHY,
          message: 'Configuration is valid'
        };
      }
      
      return {
        status: HealthStatus.DEGRADED,
        message: 'Configuration has errors',
        details: validation.errors
      };
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Failed to validate configuration'
      };
    }
  }
  
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private handleError(message: string, error: any): void {
    const errorMessage = `${message}: ${error?.message || error}`;
    this.log(errorMessage, 'error');
    this.emit('error', new Error(errorMessage));
  }
  
  private log(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [SERVICE] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);
  }
}

// Implementation classes for SessionManager and ContextEnricher
class SessionManagerImpl implements SessionManager {
  private sessions: Map<string, ClaudeSession> = new Map();
  private currentSessionId: string | null = null;
  
  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel
  ) {}
  
  createSession(metadata?: any): ClaudeSession {
    const session: ClaudeSession = {
      id: this.generateId(),
      startTime: new Date(),
      lastActivity: new Date(),
      history: [],
      context: {},
      metadata: metadata || {}
    };
    
    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;
    return session;
  }
  
  getSession(id: string): ClaudeSession | undefined {
    return this.sessions.get(id);
  }
  
  getCurrentSession(): ClaudeSession | undefined {
    if (this.currentSessionId) {
      return this.sessions.get(this.currentSessionId);
    }
    return undefined;
  }
  
  setCurrentSession(id: string): void {
    if (this.sessions.has(id)) {
      this.currentSessionId = id;
    }
  }
  
  updateSession(id: string, updates: Partial<ClaudeSession>): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, updates);
      session.lastActivity = new Date();
    }
  }
  
  deleteSession(id: string): void {
    this.sessions.delete(id);
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }
  }
  
  getAllSessions(): ClaudeSession[] {
    return Array.from(this.sessions.values());
  }
  
  async saveSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      await this.context.globalState.update(`claude.session.${id}`, session);
    }
  }
  
  async loadSession(id: string): Promise<ClaudeSession | undefined> {
    const session = await this.context.globalState.get<ClaudeSession>(`claude.session.${id}`);
    if (session) {
      this.sessions.set(id, session);
    }
    return session;
  }
  
  async loadSavedSessions(): Promise<void> {
    // This would need to be implemented with a list of saved session IDs
  }
  
  async exportSession(id: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error('Session not found');
    }
    return JSON.stringify(session, null, 2);
  }
  
  async importSession(data: string): Promise<ClaudeSession> {
    const session = JSON.parse(data) as ClaudeSession;
    session.id = this.generateId(); // Generate new ID
    this.sessions.set(session.id, session);
    return session;
  }
  
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

class ContextEnricherImpl implements ContextEnricher {
  constructor(private outputChannel: vscode.OutputChannel) {}
  
  async enrichWorkspaceContext(): Promise<WorkspaceContext> {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const rootPath = workspaceFolders[0]?.uri.fsPath || '';
    
    return {
      rootPath,
      name: vscode.workspace.name || 'Untitled',
      folders: workspaceFolders.map(f => f.uri.fsPath),
      openFiles: vscode.workspace.textDocuments
        .filter(doc => !doc.isUntitled && doc.uri.scheme === 'file')
        .map(doc => doc.uri.fsPath)
    };
  }
  
  async enrichFileContext(uri?: string): Promise<FileContext | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return undefined;
    }
    
    const document = activeEditor.document;
    const selection = activeEditor.selection;
    
    return {
      filePath: document.uri.fsPath,
      content: document.getText(),
      language: document.languageId,
      selection: !selection.isEmpty ? {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character },
        text: document.getText(selection)
      } : undefined
    };
  }
  
  async enrichDomContext(data?: any): Promise<DomContext | undefined> {
    // This would be populated from browser toolbar data
    return data;
  }
  
  async buildContext(options: ContextOptions): Promise<SessionContext> {
    const context: SessionContext = {};
    
    if (options.includeWorkspace) {
      context.workspaceContext = await this.enrichWorkspaceContext();
    }
    
    if (options.includeFile) {
      context.fileContext = await this.enrichFileContext(options.fileUri);
    }
    
    if (options.includeDom && options.domData) {
      context.domContext = await this.enrichDomContext(options.domData);
    }
    
    if (options.custom) {
      context.customContext = options.custom;
    }
    
    return context;
  }
}