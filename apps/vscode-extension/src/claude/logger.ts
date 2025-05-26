import * as vscode from 'vscode';
import { LogLevel } from './config-types';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
  error?: Error;
}

export interface LoggerOptions {
  defaultLevel?: LogLevel;
  maxEntries?: number;
  enableConsole?: boolean;
  enableFile?: boolean;
}

export class Logger {
  private entries: LogEntry[] = [];
  private currentLevel: LogLevel;
  private maxEntries: number;
  private enableConsole: boolean;
  private enableFile: boolean;
  
  constructor(
    private outputChannel: vscode.OutputChannel,
    options: LoggerOptions = {}
  ) {
    this.currentLevel = options.defaultLevel || LogLevel.INFO;
    this.maxEntries = options.maxEntries || 10000;
    this.enableConsole = options.enableConsole ?? true;
    this.enableFile = options.enableFile ?? false;
  }
  
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.info(`Log level changed to ${level}`);
  }
  
  trace(message: string, data?: any, component: string = 'General'): void {
    this.log(LogLevel.TRACE, component, message, data);
  }
  
  debug(message: string, data?: any, component: string = 'General'): void {
    this.log(LogLevel.DEBUG, component, message, data);
  }
  
  info(message: string, data?: any, component: string = 'General'): void {
    this.log(LogLevel.INFO, component, message, data);
  }
  
  warning(message: string, data?: any, component: string = 'General'): void {
    this.log(LogLevel.WARNING, component, message, data);
  }
  
  error(message: string, error?: Error | any, component: string = 'General'): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    this.log(LogLevel.ERROR, component, message, undefined, errorObj);
  }
  
  logPerformance(operation: string, duration: number, component: string = 'Performance'): void {
    const message = `${operation} completed in ${duration}ms`;
    const data = { operation, duration };
    this.log(LogLevel.INFO, component, message, data);
  }
  
  logApiCall(
    method: string,
    endpoint: string,
    statusCode?: number,
    duration?: number,
    component: string = 'API'
  ): void {
    const message = `${method} ${endpoint} - ${statusCode || 'pending'}`;
    const data = { method, endpoint, statusCode, duration };
    this.log(LogLevel.INFO, component, message, data);
  }
  
  getEntries(filter?: {
    level?: LogLevel;
    component?: string;
    startTime?: Date;
    endTime?: Date;
  }): LogEntry[] {
    let filtered = [...this.entries];
    
    if (filter) {
      if (filter.level) {
        filtered = filtered.filter(e => e.level === filter.level);
      }
      if (filter.component) {
        filtered = filtered.filter(e => e.component === filter.component);
      }
      if (filter.startTime) {
        filtered = filtered.filter(e => e.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        filtered = filtered.filter(e => e.timestamp <= filter.endTime!);
      }
    }
    
    return filtered;
  }
  
  exportLogs(format: 'json' | 'text' = 'text'): string {
    if (format === 'json') {
      return JSON.stringify(this.entries, null, 2);
    }
    
    return this.entries.map(entry => this.formatEntry(entry)).join('\n');
  }
  
  clear(): void {
    this.entries = [];
    this.outputChannel.clear();
    this.info('Logs cleared');
  }
  
  private log(
    level: LogLevel,
    component: string,
    message: string,
    data?: any,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      data,
      error
    };
    
    // Add to entries array
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    
    // Format and output
    const formatted = this.formatEntry(entry);
    
    // Write to output channel
    this.outputChannel.appendLine(formatted);
    
    // Write to console if enabled
    if (this.enableConsole) {
      this.logToConsole(entry, formatted);
    }
    
    // Write to file if enabled (would need implementation)
    if (this.enableFile) {
      // This would write to a log file
    }
  }
  
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.TRACE, LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.currentLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }
  
  private formatEntry(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = entry.level.toUpperCase().padEnd(7);
    const component = `[${entry.component}]`.padEnd(20);
    
    let message = `[${timestamp}] [${level}] ${component} ${entry.message}`;
    
    if (entry.data) {
      message += `\n  Data: ${JSON.stringify(entry.data, null, 2).replace(/\n/g, '\n  ')}`;
    }
    
    if (entry.error) {
      message += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\n  Stack: ${entry.error.stack.replace(/\n/g, '\n  ')}`;
      }
    }
    
    return message;
  }
  
  private logToConsole(entry: LogEntry, formatted: string): void {
    switch (entry.level) {
      case LogLevel.TRACE:
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARNING:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
        console.error(formatted);
        break;
    }
  }
}

export class ScopedLogger {
  constructor(
    private logger: Logger,
    private component: string
  ) {}
  
  trace(message: string, data?: any): void {
    this.logger.trace(message, data, this.component);
  }
  
  debug(message: string, data?: any): void {
    this.logger.debug(message, data, this.component);
  }
  
  info(message: string, data?: any): void {
    this.logger.info(message, data, this.component);
  }
  
  warning(message: string, data?: any): void {
    this.logger.warning(message, data, this.component);
  }
  
  error(message: string, error?: Error | any): void {
    this.logger.error(message, error, this.component);
  }
  
  logPerformance(operation: string, duration: number): void {
    this.logger.logPerformance(operation, duration, this.component);
  }
  
  createChild(subComponent: string): ScopedLogger {
    return new ScopedLogger(this.logger, `${this.component}:${subComponent}`);
  }
}

export function createLogger(
  outputChannel: vscode.OutputChannel,
  options?: LoggerOptions
): Logger {
  return new Logger(outputChannel, options);
}

export function createScopedLogger(
  logger: Logger,
  component: string
): ScopedLogger {
  return new ScopedLogger(logger, component);
}