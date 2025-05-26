import * as vscode from 'vscode';
import type { Session, SessionBranch, ConversationTurn } from './session-types';
import { Logger } from './logger';

/**
 * Branch navigation event
 */
export interface BranchNavigationEvent {
  sessionId: string;
  fromBranchId?: string;
  toBranchId: string;
  timestamp: Date;
}

/**
 * Branch creation options
 */
export interface CreateBranchOptions {
  name?: string;
  description?: string;
  branchFromTurnId: string;
  copySubsequentTurns?: boolean;
}

/**
 * Branch merge options
 */
export interface MergeBranchOptions {
  strategy: 'append' | 'insert' | 'replace';
  conflictResolution?: 'source' | 'target' | 'manual';
}

/**
 * Branch tree node for visualization
 */
export interface BranchTreeNode {
  branchId: string;
  name: string;
  turnCount: number;
  createdAt: Date;
  children: BranchTreeNode[];
  isActive: boolean;
}

/**
 * Manages conversation branching functionality
 */
export class ConversationBranching {
  private logger: Logger;
  private navigationEmitter: vscode.EventEmitter<BranchNavigationEvent>;

  constructor() {
    const outputChannel = vscode.window.createOutputChannel(
      'Claude Conversation Branching',
    );
    this.logger = new Logger(outputChannel);
    this.navigationEmitter = new vscode.EventEmitter<BranchNavigationEvent>();
  }

  /**
   * Create a new branch from a specific turn
   */
  async createBranch(
    session: Session,
    options: CreateBranchOptions,
  ): Promise<SessionBranch> {
    // Find the turn to branch from
    const branchPointTurn = this.findTurnInSession(
      session,
      options.branchFromTurnId,
    );

    if (!branchPointTurn) {
      throw new Error(`Turn not found: ${options.branchFromTurnId}`);
    }

    // Determine parent branch
    const parentBranchId = this.findBranchContainingTurn(
      session,
      options.branchFromTurnId,
    );

    // Create new branch
    const branch: SessionBranch = {
      id: this.generateBranchId(),
      parentBranchId,
      branchPointTurnId: options.branchFromTurnId,
      createdAt: new Date(),
      name: options.name,
      description: options.description,
      turns: [],
    };

    // Copy subsequent turns if requested
    if (options.copySubsequentTurns) {
      const subsequentTurns = this.getSubsequentTurns(
        session,
        options.branchFromTurnId,
        parentBranchId,
      );
      branch.turns = this.cloneTurns(subsequentTurns);
    }

    // Add branch to session
    if (!session.branches) {
      session.branches = [];
    }
    session.branches.push(branch);

    this.logger.info(
      `Created branch ${branch.id} from turn ${options.branchFromTurnId}`,
    );
    return branch;
  }

  /**
   * Switch to a different branch
   */
  async switchBranch(
    session: Session,
    toBranchId: string | undefined,
  ): Promise<void> {
    const fromBranchId = session.currentBranchId;

    // Validate target branch exists (undefined means main branch)
    if (toBranchId && !this.getBranch(session, toBranchId)) {
      throw new Error(`Branch not found: ${toBranchId}`);
    }

    // Update current branch
    session.currentBranchId = toBranchId;

    // Emit navigation event
    this.navigationEmitter.fire({
      sessionId: session.id,
      fromBranchId,
      toBranchId: toBranchId || 'main',
      timestamp: new Date(),
    });

    this.logger.info(
      `Switched from branch ${fromBranchId || 'main'} to ${toBranchId || 'main'}`,
    );
  }

  /**
   * Get turns for current branch
   */
  getCurrentBranchTurns(session: Session): ConversationTurn[] {
    if (!session.currentBranchId) {
      // Return main branch (all turns not in any branch)
      return this.getMainBranchTurns(session);
    }

    const branch = this.getBranch(session, session.currentBranchId);
    if (!branch) {
      throw new Error(`Current branch not found: ${session.currentBranchId}`);
    }

    // Get turns up to branch point from parent, then branch turns
    const parentTurns = this.getTurnsUpToBranchPoint(session, branch);
    return [...parentTurns, ...branch.turns];
  }

  /**
   * Add turn to current branch
   */
  addTurnToBranch(session: Session, turn: ConversationTurn): void {
    if (!session.currentBranchId) {
      // Add to main branch (session.turns)
      session.turns.push(turn);
    } else {
      const branch = this.getBranch(session, session.currentBranchId);
      if (!branch) {
        throw new Error(`Current branch not found: ${session.currentBranchId}`);
      }
      branch.turns.push(turn);
    }
  }

  /**
   * Merge branches
   */
  async mergeBranches(
    session: Session,
    sourceBranchId: string,
    targetBranchId: string | undefined,
    options: MergeBranchOptions,
  ): Promise<ConversationTurn[]> {
    const sourceBranch = this.getBranch(session, sourceBranchId);
    if (!sourceBranch) {
      throw new Error(`Source branch not found: ${sourceBranchId}`);
    }

    let targetTurns: ConversationTurn[];

    if (!targetBranchId) {
      // Merging into main branch
      targetTurns = this.getMainBranchTurns(session);
    } else {
      const targetBranch = this.getBranch(session, targetBranchId);
      if (!targetBranch) {
        throw new Error(`Target branch not found: ${targetBranchId}`);
      }
      targetTurns = targetBranch.turns;
    }

    // Perform merge based on strategy
    let mergedTurns: ConversationTurn[];

    switch (options.strategy) {
      case 'append':
        mergedTurns = [...targetTurns, ...sourceBranch.turns];
        break;

      case 'insert':
        // Insert at branch point
        const insertIndex = this.findInsertionPoint(session, sourceBranch);
        mergedTurns = [
          ...targetTurns.slice(0, insertIndex),
          ...sourceBranch.turns,
          ...targetTurns.slice(insertIndex),
        ];
        break;

      case 'replace':
        // Replace turns after branch point
        const replaceIndex = this.findInsertionPoint(session, sourceBranch);
        mergedTurns = [
          ...targetTurns.slice(0, replaceIndex),
          ...sourceBranch.turns,
        ];
        break;

      default:
        throw new Error(`Unknown merge strategy: ${options.strategy}`);
    }

    // Apply merged turns
    if (!targetBranchId) {
      session.turns = mergedTurns;
    } else {
      const targetBranch = this.getBranch(session, targetBranchId)!;
      targetBranch.turns = mergedTurns;
    }

    // Optionally delete source branch after merge
    this.deleteBranch(session, sourceBranchId);

    this.logger.info(
      `Merged branch ${sourceBranchId} into ${targetBranchId || 'main'}`,
    );
    return mergedTurns;
  }

  /**
   * Delete a branch
   */
  deleteBranch(session: Session, branchId: string): boolean {
    if (!session.branches) return false;

    const index = session.branches.findIndex((b) => b.id === branchId);
    if (index === -1) return false;

    // Check if any branches depend on this one
    const dependentBranches = session.branches.filter(
      (b) => b.parentBranchId === branchId,
    );
    if (dependentBranches.length > 0) {
      throw new Error(
        `Cannot delete branch with dependent branches: ${dependentBranches.map((b) => b.id).join(', ')}`,
      );
    }

    // Remove branch
    session.branches.splice(index, 1);

    // If current branch was deleted, switch to parent or main
    if (session.currentBranchId === branchId) {
      const deletedBranch = session.branches[index];
      session.currentBranchId = deletedBranch.parentBranchId;
    }

    this.logger.info(`Deleted branch ${branchId}`);
    return true;
  }

  /**
   * Get branch tree for visualization
   */
  getBranchTree(session: Session): BranchTreeNode {
    const mainNode: BranchTreeNode = {
      branchId: 'main',
      name: 'Main',
      turnCount: this.getMainBranchTurns(session).length,
      createdAt: session.createdAt,
      children: [],
      isActive: !session.currentBranchId,
    };

    if (session.branches) {
      // Build tree recursively
      const rootBranches = session.branches.filter((b) => !b.parentBranchId);
      mainNode.children = rootBranches.map((branch) =>
        this.buildBranchNode(session, branch),
      );
    }

    return mainNode;
  }

  /**
   * Find common ancestor of two branches
   */
  findCommonAncestor(
    session: Session,
    branchId1: string | undefined,
    branchId2: string | undefined,
  ): string | undefined {
    if (branchId1 === branchId2) return branchId1;
    if (!branchId1 || !branchId2) return undefined;

    // Get ancestor chains
    const ancestors1 = this.getAncestorChain(session, branchId1);
    const ancestors2 = this.getAncestorChain(session, branchId2);

    // Find first common ancestor
    for (const ancestor of ancestors1) {
      if (ancestors2.includes(ancestor)) {
        return ancestor;
      }
    }

    return undefined;
  }

  /**
   * Get branch by ID
   */
  getBranch(session: Session, branchId: string): SessionBranch | undefined {
    return session.branches?.find((b) => b.id === branchId);
  }

  /**
   * Subscribe to navigation events
   */
  onBranchNavigation(
    handler: (event: BranchNavigationEvent) => void,
  ): vscode.Disposable {
    return this.navigationEmitter.event(handler);
  }

  // Private helper methods

  private generateBranchId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `branch_${timestamp}_${random}`;
  }

  private findTurnInSession(
    session: Session,
    turnId: string,
  ): ConversationTurn | undefined {
    // Check main branch
    const mainTurn = session.turns.find((t) => t.id === turnId);
    if (mainTurn) return mainTurn;

    // Check all branches
    if (session.branches) {
      for (const branch of session.branches) {
        const branchTurn = branch.turns.find((t) => t.id === turnId);
        if (branchTurn) return branchTurn;
      }
    }

    return undefined;
  }

  private findBranchContainingTurn(
    session: Session,
    turnId: string,
  ): string | undefined {
    if (session.branches) {
      for (const branch of session.branches) {
        if (branch.turns.some((t) => t.id === turnId)) {
          return branch.id;
        }
      }
    }

    // Turn is in main branch
    return undefined;
  }

  private getSubsequentTurns(
    session: Session,
    afterTurnId: string,
    branchId?: string,
  ): ConversationTurn[] {
    const turns = branchId
      ? this.getBranch(session, branchId)?.turns || []
      : session.turns;

    const index = turns.findIndex((t) => t.id === afterTurnId);
    if (index === -1) return [];

    return turns.slice(index + 1);
  }

  private cloneTurns(turns: ConversationTurn[]): ConversationTurn[] {
    return turns.map((turn) => ({
      ...turn,
      id: this.generateTurnId(),
      userMessage: { ...turn.userMessage },
      assistantMessage: turn.assistantMessage
        ? { ...turn.assistantMessage }
        : undefined,
    }));
  }

  private generateTurnId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `turn_${timestamp}_${random}`;
  }

  private getMainBranchTurns(session: Session): ConversationTurn[] {
    // Returns turns that are not part of any branch
    // For now, we'll return all session.turns
    // In a more complex implementation, we might track which turns belong to branches
    return session.turns;
  }

  private getTurnsUpToBranchPoint(
    session: Session,
    branch: SessionBranch,
  ): ConversationTurn[] {
    if (!branch.parentBranchId) {
      // Branch from main - get main turns up to branch point
      const mainTurns = this.getMainBranchTurns(session);
      const branchPointIndex = mainTurns.findIndex(
        (t) => t.id === branch.branchPointTurnId,
      );

      if (branchPointIndex === -1) return [];
      return mainTurns.slice(0, branchPointIndex + 1);
    } else {
      // Branch from another branch
      const parentBranch = this.getBranch(session, branch.parentBranchId);
      if (!parentBranch) return [];

      const parentTurns = this.getTurnsUpToBranchPoint(session, parentBranch);
      const branchTurns = parentBranch.turns;
      const branchPointIndex = branchTurns.findIndex(
        (t) => t.id === branch.branchPointTurnId,
      );

      if (branchPointIndex === -1) return parentTurns;
      return [...parentTurns, ...branchTurns.slice(0, branchPointIndex + 1)];
    }
  }

  private findInsertionPoint(session: Session, branch: SessionBranch): number {
    const targetTurns = branch.parentBranchId
      ? this.getBranch(session, branch.parentBranchId)?.turns || []
      : session.turns;

    const branchPointIndex = targetTurns.findIndex(
      (t) => t.id === branch.branchPointTurnId,
    );
    return branchPointIndex === -1 ? targetTurns.length : branchPointIndex + 1;
  }

  private buildBranchNode(
    session: Session,
    branch: SessionBranch,
  ): BranchTreeNode {
    const children =
      session.branches
        ?.filter((b) => b.parentBranchId === branch.id)
        .map((child) => this.buildBranchNode(session, child)) || [];

    return {
      branchId: branch.id,
      name: branch.name || `Branch ${branch.id.substring(0, 8)}`,
      turnCount: branch.turns.length,
      createdAt: branch.createdAt,
      children,
      isActive: session.currentBranchId === branch.id,
    };
  }

  private getAncestorChain(session: Session, branchId: string): string[] {
    const ancestors: string[] = [branchId];
    let currentBranch = this.getBranch(session, branchId);

    while (currentBranch?.parentBranchId) {
      ancestors.push(currentBranch.parentBranchId);
      currentBranch = this.getBranch(session, currentBranch.parentBranchId);
    }

    return ancestors;
  }

  /**
   * Export branch structure for debugging
   */
  exportBranchStructure(session: Session): string {
    let output = '# Branch Structure\n\n';

    const tree = this.getBranchTree(session);
    output += this.formatBranchNode(tree, 0);

    return output;
  }

  private formatBranchNode(node: BranchTreeNode, depth: number): string {
    const indent = '  '.repeat(depth);
    let output = `${indent}- ${node.name} (${node.turnCount} turns)`;

    if (node.isActive) {
      output += ' [ACTIVE]';
    }

    output += '\n';

    for (const child of node.children) {
      output += this.formatBranchNode(child, depth + 1);
    }

    return output;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.navigationEmitter.dispose();
  }
}
