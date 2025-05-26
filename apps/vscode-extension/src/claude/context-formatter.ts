import type {
  WorkspaceInfo,
  FileInfo,
  DOMElementData,
  PluginContextData
} from './prompt-context';

export class ContextFormatter {
  formatWorkspaceContext(workspace: WorkspaceInfo): string {
    const sections: string[] = [];

    // Project overview
    sections.push(`**Project**: ${workspace.name}`);
    
    if (workspace.projectStructure?.projectType) {
      sections.push(`**Type**: ${workspace.projectStructure.projectType}`);
    }

    if (workspace.projectStructure?.frameworks && workspace.projectStructure.frameworks.length > 0) {
      sections.push(`**Frameworks**: ${workspace.projectStructure.frameworks.join(', ')}`);
    }

    // Git information
    if (workspace.projectStructure?.gitInfo) {
      const { branch, remoteUrl } = workspace.projectStructure.gitInfo;
      sections.push(`**Git Branch**: ${branch}`);
      if (remoteUrl) {
        sections.push(`**Repository**: ${remoteUrl}`);
      }
    }

    // Active file
    if (workspace.activeFile) {
      sections.push(`**Active File**: ${workspace.activeFile.path} (${workspace.activeFile.language})`);
    }

    // Open files count
    if (workspace.openFiles && workspace.openFiles.length > 0) {
      sections.push(`**Open Files**: ${workspace.openFiles.length} files`);
    }

    return sections.join('\n');
  }

  formatDOMElements(elements: DOMElementData[]): string {
    if (!elements || elements.length === 0) return 'No elements selected.';

    const formatted = elements.map((element, index) => {
      const parts: string[] = [];
      
      // Element header
      parts.push(`### Element ${index + 1}: <${element.tagName}>`);
      
      // Key attributes
      if (element.attributes) {
        const importantAttrs = ['id', 'class', 'data-testid', 'aria-label', 'type', 'name'];
        const attrs = Object.entries(element.attributes)
          .filter(([key]) => importantAttrs.includes(key))
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ');
        if (attrs) parts.push(`**Attributes**: ${attrs}`);
      }

      // Text content (truncated)
      if (element.textContent) {
        const text = element.textContent.trim();
        const truncated = text.length > 100 ? text.substring(0, 100) + '...' : text;
        parts.push(`**Text**: "${truncated}"`);
      }

      // CSS selector
      if (element.selector) {
        parts.push(`**Selector**: \`${element.selector}\``);
      }

      // Bounding rect
      if (element.boundingRect) {
        const { x, y, width, height } = element.boundingRect;
        parts.push(`**Position**: (${x}, ${y}) ${width}×${height}`);
      }

      // Metadata
      if (element.metadata) {
        if (element.metadata.isInteractive) {
          parts.push(`**Interactive**: Yes`);
        }
        if (element.metadata.hasEventListeners) {
          parts.push(`**Has Event Listeners**: Yes`);
        }
      }

      // Children summary
      if (element.children && element.children.length > 0) {
        const childTypes = [...new Set(element.children.map(c => c.tagName))];
        parts.push(`**Children**: ${element.children.length} elements (${childTypes.join(', ')})`);
      }

      return parts.join('\n');
    }).join('\n\n');

    return formatted;
  }

  formatPluginContext(plugins: PluginContextData[]): string {
    if (!plugins || plugins.length === 0) return 'No plugin context available.';

    const grouped = this.groupPluginsByType(plugins);
    const sections: string[] = [];

    for (const [type, pluginList] of Object.entries(grouped)) {
      sections.push(`### ${this.formatPluginType(type)}`);
      
      const pluginData = pluginList.map((plugin: PluginContextData) => {
        const parts: string[] = [`**${plugin.name}** (v${plugin.version})`];
        
        if (plugin.metadata?.description) {
          parts.push(plugin.metadata.description);
        }

        if (plugin.data) {
          const dataStr = this.formatPluginData(plugin.data);
          parts.push(`Data: ${dataStr}`);
        }

        return parts.join('\n');
      }).join('\n\n');

      sections.push(pluginData);
    }

    return sections.join('\n\n');
  }

  async formatFileContent(files: FileInfo[]): Promise<string> {
    if (!files || files.length === 0) return 'No file content available.';

    const sections = await Promise.all(files.map(async (file) => {
      const parts: string[] = [];
      
      // File header
      parts.push(`### ${file.path}`);
      parts.push(`**Language**: ${file.language || 'unknown'}`);
      parts.push(`**Size**: ${this.formatFileSize(file.size)}`);
      
      if (file.lastModified) {
        parts.push(`**Modified**: ${new Date(file.lastModified).toLocaleString()}`);
      }

      // Content (with language hint for syntax highlighting)
      if (file.content) {
        const lang = file.language || 'text';
        const truncatedContent = file.content.length > 2000 
          ? file.content.substring(0, 2000) + '\n... (truncated)'
          : file.content;
        parts.push(`\`\`\`${lang}\n${truncatedContent}\n\`\`\``);
      }

      return parts.join('\n');
    }));

    return sections.join('\n\n');
  }

  private groupPluginsByType(plugins: PluginContextData[]): Record<string, PluginContextData[]> {
    return plugins.reduce((acc, plugin) => {
      const type = plugin.contextType || 'other';
      if (!acc[type]) acc[type] = [];
      acc[type].push(plugin);
      return acc;
    }, {} as Record<string, PluginContextData[]>);
  }

  private formatPluginType(type: string): string {
    const typeMap: Record<string, string> = {
      'ui': 'UI Components',
      'state': 'State Management',
      'api': 'API Integration',
      'analytics': 'Analytics',
      'auth': 'Authentication',
      'other': 'Other Plugins'
    };
    return typeMap[type] || type;
  }

  private formatPluginData(data: any): string {
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      try {
        return JSON.stringify(data, null, 2);
      } catch {
        return String(data);
      }
    }
    return String(data);
  }

  private formatFileSize(bytes?: number): string {
    if (!bytes) return 'unknown';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}