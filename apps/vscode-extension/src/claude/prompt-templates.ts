import type {
  WorkspaceInfo,
  FileInfo,
  DOMElementData,
  PluginContextData
} from './prompt-context';

// Base system prompt template
export const SYSTEM_PROMPT_TEMPLATE = `You are Claude, an AI assistant helping with web development. You have access to:
- Browser DOM elements selected by the user
- VSCode workspace context and files
- Project structure and configuration

Please provide helpful, actionable responses based on this context.
When suggesting code changes, be specific about files and locations.
Focus on practical solutions and best practices.`;

// Specialized prompt templates
export const REACT_COMPONENT_TEMPLATE = `You are helping with React component development. Pay attention to:
- Component structure and props
- State management patterns
- React hooks usage
- Performance considerations
- Accessibility requirements`;

export const BUG_FIX_TEMPLATE = `You are helping diagnose and fix a bug. Focus on:
- Understanding the expected vs actual behavior
- Identifying root causes
- Suggesting minimal, targeted fixes
- Considering edge cases
- Preventing similar issues`;

export const FEATURE_IMPLEMENTATION_TEMPLATE = `You are helping implement a new feature. Consider:
- Integration with existing code
- Following established patterns
- Edge cases and error handling
- Performance implications
- Testing requirements`;

export const CODE_REVIEW_TEMPLATE = `You are conducting a code review. Evaluate:
- Code quality and readability
- Best practices adherence
- Potential bugs or issues
- Performance considerations
- Security implications`;

// Template builder functions
export function buildWorkspaceSection(workspace: WorkspaceInfo): string {
  const lines: string[] = ['## Workspace Information'];
  
  lines.push(`Project: ${workspace.name}`);
  
  if (workspace.projectStructure?.projectType) {
    lines.push(`Type: ${workspace.projectStructure.projectType}`);
  }
  
  if (workspace.projectStructure?.frameworks?.length) {
    lines.push(`Frameworks: ${workspace.projectStructure.frameworks.join(', ')}`);
  }
  
  if (workspace.projectStructure?.gitInfo?.branch) {
    lines.push(`Git branch: ${workspace.projectStructure.gitInfo.branch}`);
  }
  
  return lines.join('\n');
}

export function buildDOMSection(elements: DOMElementData[]): string {
  if (!elements.length) return '## Selected Elements\nNo elements selected.';
  
  const lines: string[] = ['## Selected Elements'];
  
  elements.forEach((element, index) => {
    lines.push(`\n### Element ${index + 1}`);
    lines.push(`Tag: <${element.tagName}>`);
    
    if (element.attributes?.id) {
      lines.push(`ID: ${element.attributes.id}`);
    }
    
    if (element.attributes?.class) {
      lines.push(`Classes: ${element.attributes.class}`);
    }
    
    if (element.metadata?.structuralRole) {
      lines.push(`Role: ${element.metadata.structuralRole}`);
    }
    
    if (element.textContent) {
      const preview = element.textContent.trim().substring(0, 50);
      lines.push(`Text: "${preview}${element.textContent.length > 50 ? '...' : ''}"`);
    }
    
    if (element.selector) {
      lines.push(`Selector: ${element.selector}`);
    }
  });
  
  return lines.join('\n');
}

export function buildFileSection(files: FileInfo[]): string {
  if (!files.length) return '## Files\nNo files to display.';
  
  const lines: string[] = ['## Files'];
  
  files.forEach(file => {
    lines.push(`\n### ${file.path}`);
    
    if (file.language) {
      lines.push(`Language: ${file.language}`);
    }
    
    if (file.content) {
      const preview = file.content.substring(0, 500);
      lines.push('```' + (file.language || ''));
      lines.push(preview);
      if (file.content.length > 500) {
        lines.push('... (truncated)');
      }
      lines.push('```');
    }
  });
  
  return lines.join('\n');
}

export function buildPluginSection(plugins: PluginContextData[]): string {
  if (!plugins.length) return '## Plugin Context\nNo plugin data available.';
  
  const lines: string[] = ['## Plugin Context'];
  
  // Group by contextType
  const byType = plugins.reduce((acc, plugin) => {
    const type = plugin.contextType || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(plugin);
    return acc;
  }, {} as Record<string, PluginContextData[]>);
  
  Object.entries(byType).forEach(([type, pluginList]) => {
    lines.push(`\n### ${formatPluginType(type)}`);
    
    pluginList.forEach(plugin => {
      lines.push(`- **${plugin.name}** (v${plugin.version})`);
      if (plugin.metadata?.description) {
        lines.push(`  ${plugin.metadata.description}`);
      }
    });
  });
  
  return lines.join('\n');
}

// Template customization functions
export function createCustomTemplate(base: string, variables: Record<string, string>): string {
  let template = base;
  
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    template = template.replace(new RegExp(placeholder, 'g'), value);
  });
  
  return template;
}

export function selectPromptTemplate(taskType?: string): string {
  switch (taskType) {
    case 'react':
    case 'component':
      return REACT_COMPONENT_TEMPLATE;
    
    case 'bug':
    case 'fix':
    case 'debug':
      return BUG_FIX_TEMPLATE;
    
    case 'feature':
    case 'implement':
      return FEATURE_IMPLEMENTATION_TEMPLATE;
    
    case 'review':
    case 'code-review':
      return CODE_REVIEW_TEMPLATE;
    
    default:
      return SYSTEM_PROMPT_TEMPLATE;
  }
}

// Helper functions
function formatPluginType(type: string): string {
  const typeMap: Record<string, string> = {
    'ui': 'UI Components',
    'state': 'State Management',
    'api': 'API Integration',
    'analytics': 'Analytics',
    'auth': 'Authentication',
    'other': 'Other'
  };
  return typeMap[type] || type;
}

// Validation functions
export function validateTemplate(template: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!template || template.trim().length === 0) {
    errors.push('Template cannot be empty');
  }
  
  if (template.length > 10000) {
    errors.push('Template is too long (max 10000 characters)');
  }
  
  // Check for unclosed variables
  const openBrackets = (template.match(/{{/g) || []).length;
  const closeBrackets = (template.match(/}}/g) || []).length;
  if (openBrackets !== closeBrackets) {
    errors.push('Template has unclosed variable placeholders');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}