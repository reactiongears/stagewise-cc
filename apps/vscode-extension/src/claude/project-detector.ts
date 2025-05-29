import * as vscode from 'vscode';
import type { PackageInfo } from './workspace-types';

/**
 * Detects project type, frameworks, and dependencies
 */
export class ProjectDetector {
  private packageJsonCache: { data: any; timestamp: number } | null = null;
  private readonly CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

  /**
   * Detects the project type based on files and configuration
   */
  async detectProjectType(): Promise<string[]> {
    const types: string[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!workspaceRoot) {
      return ['unknown'];
    }

    // Check for various project indicators
    const checks = [
      { file: 'package.json', type: 'node' },
      { file: 'requirements.txt', type: 'python' },
      { file: 'Pipfile', type: 'python' },
      { file: 'pyproject.toml', type: 'python' },
      { file: 'pom.xml', type: 'java-maven' },
      { file: 'build.gradle', type: 'java-gradle' },
      { file: 'build.gradle.kts', type: 'kotlin-gradle' },
      { file: 'Cargo.toml', type: 'rust' },
      { file: 'go.mod', type: 'go' },
      { file: 'composer.json', type: 'php' },
      { file: 'Gemfile', type: 'ruby' },
      { file: '.csproj', type: 'dotnet', pattern: true },
      { file: 'pubspec.yaml', type: 'dart' },
      { file: 'Package.swift', type: 'swift' },
    ];

    for (const check of checks) {
      if (check.pattern) {
        // Look for files matching pattern
        const files = await vscode.workspace.findFiles(
          `**/${check.file}`,
          '**/node_modules/**',
          1,
        );
        if (files.length > 0) {
          types.push(check.type);
        }
      } else {
        // Check for specific file
        const fileUri = vscode.Uri.joinPath(workspaceRoot, check.file);
        if (await this.fileExists(fileUri)) {
          types.push(check.type);
        }
      }
    }

    return types.length > 0 ? types : ['unknown'];
  }

  /**
   * Gets package.json information if available
   */
  async getPackageInfo(): Promise<PackageInfo | undefined> {
    const packageJson = await this.readPackageJson();
    if (!packageJson) {
      return undefined;
    }

    return {
      name: packageJson.name || 'unnamed',
      version: packageJson.version || '0.0.0',
      description: packageJson.description,
      main: packageJson.main,
      scripts: packageJson.scripts,
      dependencies: packageJson.dependencies
        ? Object.keys(packageJson.dependencies)
        : [],
      devDependencies: packageJson.devDependencies
        ? Object.keys(packageJson.devDependencies)
        : [],
    };
  }

  /**
   * Detects frameworks used in the project
   */
  async detectFrameworks(): Promise<string[]> {
    const frameworks: string[] = [];
    const packageJson = await this.readPackageJson();

    if (packageJson) {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // React ecosystem
      if (allDeps.react) {
        frameworks.push('react');
        if (allDeps.next) frameworks.push('nextjs');
        if (allDeps.gatsby) frameworks.push('gatsby');
        if (allDeps['react-native']) frameworks.push('react-native');
      }

      // Vue ecosystem
      if (allDeps.vue) {
        frameworks.push('vue');
        if (allDeps.nuxt) frameworks.push('nuxt');
        if (allDeps['@vue/cli-service']) frameworks.push('vue-cli');
      }

      // Angular
      if (allDeps['@angular/core']) {
        frameworks.push('angular');
      }

      // Svelte
      if (allDeps.svelte) {
        frameworks.push('svelte');
        if (allDeps['@sveltejs/kit']) frameworks.push('sveltekit');
      }

      // Backend frameworks
      if (allDeps.express) frameworks.push('express');
      if (allDeps.fastify) frameworks.push('fastify');
      if (allDeps.koa) frameworks.push('koa');
      if (allDeps.nestjs || allDeps['@nestjs/core']) frameworks.push('nestjs');

      // Testing frameworks
      if (allDeps.jest) frameworks.push('jest');
      if (allDeps.mocha) frameworks.push('mocha');
      if (allDeps.vitest) frameworks.push('vitest');
      if (allDeps['@testing-library/react']) frameworks.push('testing-library');

      // Build tools
      if (allDeps.webpack) frameworks.push('webpack');
      if (allDeps.vite) frameworks.push('vite');
      if (allDeps.parcel) frameworks.push('parcel');
      if (allDeps.rollup) frameworks.push('rollup');
      if (allDeps.esbuild) frameworks.push('esbuild');

      // Other tools
      if (allDeps.typescript) frameworks.push('typescript');
      if (allDeps.eslint) frameworks.push('eslint');
      if (allDeps.prettier) frameworks.push('prettier');
    }

    // Check for framework-specific files
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceRoot) {
      // Angular
      if (
        await this.fileExists(
          vscode.Uri.joinPath(workspaceRoot, 'angular.json'),
        )
      ) {
        if (!frameworks.includes('angular')) frameworks.push('angular');
      }

      // Vue
      const vueFiles = await vscode.workspace.findFiles(
        '**/*.vue',
        '**/node_modules/**',
        1,
      );
      if (vueFiles.length > 0 && !frameworks.includes('vue')) {
        frameworks.push('vue');
      }

      // Next.js
      if (
        (await this.fileExists(
          vscode.Uri.joinPath(workspaceRoot, 'next.config.js'),
        )) ||
        (await this.fileExists(
          vscode.Uri.joinPath(workspaceRoot, 'next.config.ts'),
        ))
      ) {
        if (!frameworks.includes('nextjs')) frameworks.push('nextjs');
      }
    }

    return frameworks;
  }

  /**
   * Gets key dependencies from the project
   */
  async getDependencies(): Promise<string[]> {
    const packageJson = await this.readPackageJson();
    if (!packageJson) {
      return [];
    }

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // Filter out common/unimportant dependencies
    const ignoreDeps = [
      '@types/',
      'eslint-',
      'babel-',
      'webpack-',
      '@babel/',
      'postcss-',
      'autoprefixer',
      'prettier',
      'husky',
      'lint-staged',
    ];

    return Object.keys(allDeps)
      .filter((dep) => !ignoreDeps.some((ignore) => dep.startsWith(ignore)))
      .sort();
  }

  /**
   * Reads and caches package.json
   */
  private async readPackageJson(): Promise<any | undefined> {
    // Check cache
    if (
      this.packageJsonCache &&
      Date.now() - this.packageJsonCache.timestamp < this.CACHE_DURATION
    ) {
      return this.packageJsonCache.data;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      return undefined;
    }

    const packageJsonUri = vscode.Uri.joinPath(workspaceRoot, 'package.json');

    try {
      const content = await vscode.workspace.fs.readFile(packageJsonUri);
      const packageJson = JSON.parse(content.toString());

      // Cache the result
      this.packageJsonCache = {
        data: packageJson,
        timestamp: Date.now(),
      };

      return packageJson;
    } catch {
      return undefined;
    }
  }

  /**
   * Checks if a file exists
   */
  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}
