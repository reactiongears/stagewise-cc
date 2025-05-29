import * as os from 'node:os';
import type { InstallationGuidance } from './cli-types';

/**
 * Provides platform-specific installation guidance
 */
export class CLIInstallationGuide {
  /**
   * Get installation guidance for current platform
   */
  static getGuidance(
    platform: NodeJS.Platform = os.platform(),
  ): InstallationGuidance {
    const guides: Record<NodeJS.Platform, InstallationGuidance> = {
      darwin: {
        title: 'Install Claude Code CLI on macOS',
        steps: [
          'Open Terminal application',
          'Option 1 - Install via Homebrew:',
          '  brew tap anthropics/claude',
          '  brew install claude-code',
          '',
          'Option 2 - Install via npm:',
          '  npm install -g @anthropic/claude-code',
          '',
          'Option 3 - Download directly:',
          '  Visit https://claude.ai/download',
          '  Download the macOS installer',
          '  Double-click to install',
          '',
          'Verify installation:',
          '  claude --version',
        ],
        troubleshooting: [
          'If "command not found", check your PATH:',
          '  echo $PATH',
          '  export PATH="/usr/local/bin:$PATH"',
          '',
          'For M1/M2 Macs, Homebrew installs to /opt/homebrew:',
          '  export PATH="/opt/homebrew/bin:$PATH"',
          '',
          'If permission denied:',
          '  chmod +x /usr/local/bin/claude',
          '',
          'For npm issues, check global npm prefix:',
          '  npm config get prefix',
          '  export PATH="$(npm config get prefix)/bin:$PATH"',
        ],
        verificationCommand: 'claude --version',
        downloadUrl: 'https://claude.ai/download/mac',
      },

      win32: {
        title: 'Install Claude Code CLI on Windows',
        steps: [
          'Option 1 - Download installer (Recommended):',
          '  1. Visit https://claude.ai/download',
          '  2. Download the Windows installer (.msi or .exe)',
          '  3. Run the installer as Administrator',
          '  4. Follow the installation wizard',
          '  5. Restart your terminal or VSCode',
          '',
          'Option 2 - Install via npm:',
          '  1. Open Command Prompt or PowerShell as Administrator',
          '  2. Run: npm install -g @anthropic/claude-code',
          '',
          'Option 3 - Install via Chocolatey:',
          '  1. Open PowerShell as Administrator',
          '  2. Run: choco install claude-code',
          '',
          'Verify installation in a new terminal:',
          '  claude --version',
        ],
        troubleshooting: [
          'If "command not recognized":',
          '  1. Check if Claude is in your PATH',
          '  2. Open System Properties > Environment Variables',
          '  3. Add Claude installation directory to PATH',
          '  4. Default: C:\\Program Files\\Claude\\bin',
          '',
          'For npm installation issues:',
          '  1. Run as Administrator',
          '  2. Clear npm cache: npm cache clean --force',
          '  3. Try installing again',
          '',
          'If antivirus blocks installation:',
          '  1. Temporarily disable antivirus',
          '  2. Install Claude CLI',
          '  3. Add exception for Claude executable',
          '  4. Re-enable antivirus',
        ],
        verificationCommand: 'claude --version',
        downloadUrl: 'https://claude.ai/download/windows',
      },

      linux: {
        title: 'Install Claude Code CLI on Linux',
        steps: [
          'Option 1 - Install via npm (Universal):',
          '  sudo npm install -g @anthropic/claude-code',
          '',
          'Option 2 - Download and install manually:',
          '  1. Download the Linux binary:',
          '     wget https://claude.ai/download/claude-linux-x64.tar.gz',
          '  2. Extract the archive:',
          '     tar -xzf claude-linux-x64.tar.gz',
          '  3. Move to system PATH:',
          '     sudo mv claude /usr/local/bin/',
          '  4. Make executable:',
          '     sudo chmod +x /usr/local/bin/claude',
          '',
          'Option 3 - Install via package manager:',
          '  Ubuntu/Debian: sudo apt install claude-code',
          '  Fedora: sudo dnf install claude-code',
          '  Arch: yay -S claude-code',
          '',
          'Verify installation:',
          '  claude --version',
        ],
        troubleshooting: [
          'If "command not found":',
          '  1. Check PATH: echo $PATH',
          '  2. Add to PATH in ~/.bashrc or ~/.zshrc:',
          '     export PATH="/usr/local/bin:$PATH"',
          '  3. Reload shell: source ~/.bashrc',
          '',
          'If permission denied:',
          '  1. Check file permissions: ls -la /usr/local/bin/claude',
          '  2. Make executable: sudo chmod +x /usr/local/bin/claude',
          '',
          'For missing dependencies:',
          '  1. Check with ldd: ldd /usr/local/bin/claude',
          '  2. Install missing libraries',
          '',
          'For npm permission issues:',
          '  1. Configure npm to use a different directory',
          '  2. Or use a Node version manager like nvm',
        ],
        verificationCommand: 'claude --version',
        downloadUrl: 'https://claude.ai/download/linux',
      },

      // Default fallback for other platforms
      aix: CLIInstallationGuide.getGenericGuidance(),
      android: CLIInstallationGuide.getGenericGuidance(),
      freebsd: CLIInstallationGuide.getGenericGuidance(),
      haiku: CLIInstallationGuide.getGenericGuidance(),
      openbsd: CLIInstallationGuide.getGenericGuidance(),
      sunos: CLIInstallationGuide.getGenericGuidance(),
      cygwin: CLIInstallationGuide.getGenericGuidance(),
      netbsd: CLIInstallationGuide.getGenericGuidance(),
    };

    return guides[platform] || CLIInstallationGuide.getGenericGuidance();
  }

  /**
   * Get generic installation guidance
   */
  private static getGenericGuidance(): InstallationGuidance {
    return {
      title: 'Install Claude Code CLI',
      steps: [
        'Option 1 - Install via npm:',
        '  npm install -g @anthropic/claude-code',
        '',
        'Option 2 - Download from official website:',
        '  Visit https://claude.ai/download',
        '  Select your platform',
        '  Follow the installation instructions',
        '',
        'Option 3 - Build from source:',
        '  git clone https://github.com/anthropics/claude-cli',
        '  cd claude-cli',
        '  npm install',
        '  npm run build',
        '  npm link',
        '',
        'Verify installation:',
        '  claude --version',
      ],
      troubleshooting: [
        'Check if Claude is in your PATH',
        'Ensure you have proper permissions',
        'Try running with elevated privileges',
        'Check for conflicting installations',
        'Verify Node.js is installed (for npm method)',
      ],
      verificationCommand: 'claude --version',
      downloadUrl: 'https://claude.ai/download',
    };
  }

  /**
   * Get quick install command for platform
   */
  static getQuickInstallCommand(
    platform: NodeJS.Platform = os.platform(),
  ): string {
    switch (platform) {
      case 'darwin':
        return 'brew install claude-code';
      case 'win32':
        return 'choco install claude-code';
      case 'linux':
        return 'sudo npm install -g @anthropic/claude-code';
      default:
        return 'npm install -g @anthropic/claude-code';
    }
  }

  /**
   * Get formatted installation steps as markdown
   */
  static getMarkdownGuide(platform?: NodeJS.Platform): string {
    const guidance = CLIInstallationGuide.getGuidance(platform);
    const lines: string[] = [
      `# ${guidance.title}`,
      '',
      '## Installation Steps',
      '',
      ...guidance.steps,
      '',
      '## Troubleshooting',
      '',
      ...guidance.troubleshooting,
      '',
      '## Verification',
      '',
      `Run \`${guidance.verificationCommand}\` to verify the installation.`,
      '',
      '## Download',
      '',
      `[Download Claude CLI](${guidance.downloadUrl})`,
    ];

    return lines.join('\n');
  }

  /**
   * Get HTML formatted guide
   */
  static getHtmlGuide(platform?: NodeJS.Platform): string {
    const guidance = CLIInstallationGuide.getGuidance(platform);

    return `
      <div class="installation-guide">
        <h1>${guidance.title}</h1>
        
        <section class="steps">
          <h2>Installation Steps</h2>
          <pre>${guidance.steps.join('\n')}</pre>
        </section>
        
        <section class="troubleshooting">
          <h2>Troubleshooting</h2>
          <pre>${guidance.troubleshooting.join('\n')}</pre>
        </section>
        
        <section class="verification">
          <h2>Verification</h2>
          <p>Run <code>${guidance.verificationCommand}</code> to verify the installation.</p>
        </section>
        
        <section class="download">
          <h2>Download</h2>
          <a href="${guidance.downloadUrl}" class="download-button">Download Claude CLI</a>
        </section>
      </div>
    `;
  }
}
