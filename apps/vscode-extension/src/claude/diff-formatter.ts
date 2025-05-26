import { Logger } from './logger';
import * as vscode from 'vscode';
import {
  FileDiff,
  DiffPreview,
  SideBySideView,
  SideContent,
  SideLine,
  InlineView,
  InlineLine,
  DiffChange
} from './diff-types';

/**
 * Formats diffs for various display contexts
 */
export class DiffFormatter {
  private logger: Logger;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Claude Diff Formatter');
    this.logger = new Logger(this.outputChannel);
  }

  /**
   * Format as unified diff
   */
  formatUnified(diff: FileDiff): string {
    let output = '';
    
    // File header
    output += `--- a/${diff.path}\n`;
    output += `+++ b/${diff.path}\n`;

    // Process each hunk
    for (const hunk of diff.hunks) {
      // Hunk header
      const oldStart = hunk.startLine;
      const oldLength = hunk.changes.filter(c => c.type !== 'add').length;
      const newStart = hunk.startLine;
      const newLength = hunk.changes.filter(c => c.type !== 'delete').length;
      
      output += `@@ -${oldStart},${oldLength} +${newStart},${newLength} @@`;
      
      // Add context if available
      if (hunk.context) {
        output += ` ${hunk.context}`;
      }
      output += '\n';

      // Add changes
      for (const change of hunk.changes) {
        const prefix = this.getUnifiedPrefix(change.type);
        output += `${prefix}${change.content}\n`;
      }
    }

    return output;
  }

  /**
   * Format as side-by-side view
   */
  formatSideBySide(diff: FileDiff): SideBySideView {
    const leftLines: SideLine[] = [];
    const rightLines: SideLine[] = [];

    // Process each hunk
    for (const hunk of diff.hunks) {
      let leftLineNumber = hunk.startLine;
      let rightLineNumber = hunk.startLine;

      for (const change of hunk.changes) {
        switch (change.type) {
          case 'context':
            leftLines.push({
              lineNumber: leftLineNumber++,
              content: change.content,
              type: 'normal'
            });
            rightLines.push({
              lineNumber: rightLineNumber++,
              content: change.content,
              type: 'normal'
            });
            break;

          case 'delete':
            leftLines.push({
              lineNumber: leftLineNumber++,
              content: change.content,
              type: 'deleted',
              highlight: true
            });
            rightLines.push({
              content: '',
              type: 'empty'
            });
            break;

          case 'add':
            leftLines.push({
              content: '',
              type: 'empty'
            });
            rightLines.push({
              lineNumber: rightLineNumber++,
              content: change.content,
              type: 'added',
              highlight: true
            });
            break;

          case 'modify':
            leftLines.push({
              lineNumber: leftLineNumber++,
              content: change.content,
              type: 'modified',
              highlight: true
            });
            rightLines.push({
              lineNumber: rightLineNumber++,
              content: change.content,
              type: 'modified',
              highlight: true
            });
            break;
        }
      }
    }

    return {
      left: {
        lines: leftLines,
        title: 'Original',
        language: diff.language
      },
      right: {
        lines: rightLines,
        title: 'Modified',
        language: diff.language
      },
      synchronizedScrolling: true
    };
  }

  /**
   * Format as inline view
   */
  formatInline(diff: FileDiff): InlineView {
    const lines: InlineLine[] = [];
    let currentLine = 1;

    for (const hunk of diff.hunks) {
      for (const change of hunk.changes) {
        switch (change.type) {
          case 'context':
            lines.push({
              lineNumber: currentLine++,
              content: change.content,
              type: 'context'
            });
            break;

          case 'delete':
            lines.push({
              lineNumber: currentLine,
              content: change.content,
              type: 'deletion'
            });
            break;

          case 'add':
            lines.push({
              lineNumber: currentLine++,
              content: change.content,
              type: 'addition'
            });
            break;

          case 'modify':
            lines.push({
              lineNumber: currentLine++,
              content: change.content,
              type: 'modification',
              oldContent: change.content // This would need the actual old content
            });
            break;
        }
      }
    }

    return {
      lines,
      title: diff.path,
      language: diff.language
    };
  }

  /**
   * Format summary of all changes
   */
  formatSummary(preview: DiffPreview): string {
    const summary = preview.summary;
    let output = '';

    // Header
    output += '═══════════════════════════════════════════════════\n';
    output += '                CHANGE SUMMARY                      \n';
    output += '═══════════════════════════════════════════════════\n\n';

    // Overview
    output += `📊 Overview:\n`;
    output += `   Total files affected: ${summary.totalFiles}\n`;
    output += `   Files created: ${summary.filesCreated}\n`;
    output += `   Files modified: ${summary.filesModified}\n`;
    output += `   Files deleted: ${summary.filesDeleted}\n\n`;

    // Statistics
    output += `📈 Statistics:\n`;
    output += `   Lines added: ${this.formatNumber(summary.totalAdditions)} +++\n`;
    output += `   Lines deleted: ${this.formatNumber(summary.totalDeletions)} ---\n`;
    output += `   Net change: ${this.formatNetChange(summary.totalAdditions - summary.totalDeletions)}\n\n`;

    // Risk assessment
    output += `⚠️  Risk Assessment:\n`;
    output += `   Risk level: ${this.formatRiskLevel(summary.riskLevel)}\n`;
    output += `   Estimated review time: ${summary.estimatedReviewTime} minutes\n\n`;

    // File details
    output += `📁 File Changes:\n`;
    output += '───────────────────────────────────────────────────\n';
    
    for (const fileDiff of preview.fileOperations) {
      const icon = this.getOperationIcon(fileDiff.operation.type);
      const stats = fileDiff.stats;
      
      output += `${icon} ${fileDiff.path}\n`;
      output += `   ${stats.additions}+ ${stats.deletions}- (${stats.percentageChanged}% changed)\n`;
      
      if (fileDiff.operation.metadata?.description) {
        output += `   📝 ${fileDiff.operation.metadata.description}\n`;
      }
      output += '\n';
    }

    // Warnings and suggestions
    if (preview.metadata.warnings.length > 0) {
      output += `⚠️  Warnings:\n`;
      for (const warning of preview.metadata.warnings) {
        output += `   • ${warning}\n`;
      }
      output += '\n';
    }

    if (preview.metadata.suggestions.length > 0) {
      output += `💡 Suggestions:\n`;
      for (const suggestion of preview.metadata.suggestions) {
        output += `   • ${suggestion}\n`;
      }
      output += '\n';
    }

    // Footer
    output += '═══════════════════════════════════════════════════\n';
    output += `Generated: ${preview.metadata.generatedAt.toLocaleString()}\n`;
    output += `By: ${preview.metadata.generatedBy}\n`;

    return output;
  }

  /**
   * Format diff as HTML for web view
   */
  formatHTML(diff: FileDiff): string {
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: monospace; margin: 0; padding: 20px; }
          .diff { border: 1px solid #ddd; border-radius: 4px; }
          .hunk-header { background: #f6f8fa; padding: 10px; color: #586069; }
          .line { padding: 0 10px; white-space: pre; }
          .line-number { 
            display: inline-block; 
            width: 50px; 
            color: #999; 
            text-align: right; 
            margin-right: 10px;
          }
          .addition { background: #e6ffed; }
          .deletion { background: #ffeef0; }
          .context { color: #586069; }
        </style>
      </head>
      <body>
        <div class="diff">
          <h3>${this.escapeHtml(diff.path)}</h3>
    `;

    for (const hunk of diff.hunks) {
      html += `<div class="hunk">`;
      html += `<div class="hunk-header">@@ -${hunk.startLine},${hunk.deletions} +${hunk.startLine},${hunk.additions} @@</div>`;
      
      for (const change of hunk.changes) {
        const lineClass = this.getHTMLClass(change.type);
        const lineNumber = change.lineNumber || '';
        const prefix = this.getUnifiedPrefix(change.type);
        
        html += `<div class="line ${lineClass}">`;
        html += `<span class="line-number">${lineNumber}</span>`;
        html += `${prefix}${this.escapeHtml(change.content)}`;
        html += `</div>`;
      }
      
      html += `</div>`;
    }

    html += `
        </div>
      </body>
      </html>
    `;

    return html;
  }

  /**
   * Format diff as Markdown
   */
  formatMarkdown(diff: FileDiff): string {
    let markdown = `## ${diff.path}\n\n`;
    
    // Add statistics
    markdown += `**Changes:** ${diff.stats.additions} additions, ${diff.stats.deletions} deletions\n\n`;

    // Add diff content
    markdown += '```diff\n';
    
    for (const hunk of diff.hunks) {
      markdown += `@@ -${hunk.startLine},${hunk.deletions} +${hunk.startLine},${hunk.additions} @@\n`;
      
      for (const change of hunk.changes) {
        const prefix = this.getUnifiedPrefix(change.type);
        markdown += `${prefix}${change.content}\n`;
      }
    }
    
    markdown += '```\n\n';

    return markdown;
  }

  /**
   * Get unified diff prefix for change type
   */
  private getUnifiedPrefix(type: DiffChange['type']): string {
    switch (type) {
      case 'add': return '+';
      case 'delete': return '-';
      case 'modify': return '!';
      default: return ' ';
    }
  }

  /**
   * Get HTML class for change type
   */
  private getHTMLClass(type: DiffChange['type']): string {
    switch (type) {
      case 'add': return 'addition';
      case 'delete': return 'deletion';
      case 'modify': return 'modification';
      default: return 'context';
    }
  }

  /**
   * Get operation icon
   */
  private getOperationIcon(type: string): string {
    switch (type) {
      case 'create': return '✨';
      case 'update': return '📝';
      case 'delete': return '🗑️';
      case 'move': return '📦';
      case 'append': return '➕';
      default: return '📄';
    }
  }

  /**
   * Format risk level with color
   */
  private formatRiskLevel(level: string): string {
    switch (level) {
      case 'low': return '🟢 Low';
      case 'medium': return '🟡 Medium';
      case 'high': return '🔴 High';
      default: return level;
    }
  }

  /**
   * Format number with commas
   */
  private formatNumber(num: number): string {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Format net change with sign
   */
  private formatNetChange(change: number): string {
    if (change > 0) {
      return `+${this.formatNumber(change)}`;
    } else if (change < 0) {
      return this.formatNumber(change);
    }
    return '0';
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Generate terminal-friendly colored output
   */
  formatTerminal(diff: FileDiff): string {
    let output = '';
    
    // Use ANSI color codes
    const colors = {
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
      reset: '\x1b[0m'
    };

    // File header
    output += `${colors.cyan}--- a/${diff.path}${colors.reset}\n`;
    output += `${colors.cyan}+++ b/${diff.path}${colors.reset}\n`;

    for (const hunk of diff.hunks) {
      // Hunk header
      output += `${colors.blue}@@ -${hunk.startLine},${hunk.deletions} +${hunk.startLine},${hunk.additions} @@${colors.reset}\n`;
      
      for (const change of hunk.changes) {
        switch (change.type) {
          case 'add':
            output += `${colors.green}+${change.content}${colors.reset}\n`;
            break;
          case 'delete':
            output += `${colors.red}-${change.content}${colors.reset}\n`;
            break;
          case 'modify':
            output += `${colors.yellow}!${change.content}${colors.reset}\n`;
            break;
          default:
            output += `${colors.gray} ${change.content}${colors.reset}\n`;
        }
      }
    }

    return output;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}