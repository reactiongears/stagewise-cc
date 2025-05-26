export interface ClaudeProcessOptions {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  workingDirectory?: string;
}

export interface ClaudeProcessState {
  isRunning: boolean;
  pid?: number;
  startTime?: Date;
  lastActivity?: Date;
}

export interface ClaudeResponse {
  content: string;
  isStreaming: boolean;
  metadata?: Record<string, any>;
}
