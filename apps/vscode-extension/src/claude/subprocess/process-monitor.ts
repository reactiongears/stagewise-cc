import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import { Logger } from '../logger';
import type {
  ManagedProcess,
  ProcessMetrics,
  HealthCheck,
} from './process-types';

/**
 * Monitors subprocess health and performance
 */
export class ProcessMonitor extends EventEmitter {
  private monitors = new Map<string, NodeJS.Timer>();
  private metrics = new Map<string, ProcessMetrics>();
  private healthChecks = new Map<string, HealthCheck>();
  private readonly logger = new Logger('ProcessMonitor');
  private readonly defaultHealthCheck: HealthCheck = {
    interval: 30000, // 30 seconds
    timeout: 5000, // 5 seconds
    retries: 3,
    check: async () => true, // Default always healthy
  };

  /**
   * Start monitoring a process
   */
  startMonitoring(process: ManagedProcess): void {
    if (this.monitors.has(process.id)) {
      this.logger.warn(`Process ${process.id} is already being monitored`);
      return;
    }

    this.logger.info(`Starting monitoring for process ${process.id}`);

    // Initialize metrics
    this.metrics.set(process.id, {
      cpuUsage: 0,
      memoryUsage: 0,
      uptime: 0,
      restartCount: process.restartCount,
      lastHealthCheck: new Date(),
    });

    // Start monitoring interval
    const interval = setInterval(() => {
      this.collectMetrics(process);
      this.performHealthCheck(process);
    }, 5000); // Collect metrics every 5 seconds

    this.monitors.set(process.id, interval);
    this.emit('monitoringStarted', process.id);
  }

  /**
   * Stop monitoring a process
   */
  stopMonitoring(processId: string): void {
    const interval = this.monitors.get(processId);
    if (interval) {
      clearInterval(interval);
      this.monitors.delete(processId);
      this.metrics.delete(processId);
      this.logger.info(`Stopped monitoring for process ${processId}`);
      this.emit('monitoringStopped', processId);
    }
  }

  /**
   * Get metrics for a process
   */
  getMetrics(processId: string): ProcessMetrics | undefined {
    return this.metrics.get(processId);
  }

  /**
   * Set a custom health check for a process
   */
  setHealthCheck(processId: string, check: HealthCheck): void {
    this.healthChecks.set(processId, check);
    this.logger.info(`Custom health check set for process ${processId}`);
  }

  /**
   * Get all monitored processes with high resource usage
   */
  getHighResourceProcesses(cpuThreshold = 80, memoryThreshold = 80): string[] {
    const highResourceProcesses: string[] = [];

    this.metrics.forEach((metrics, processId) => {
      if (
        metrics.cpuUsage > cpuThreshold ||
        metrics.memoryUsage > memoryThreshold
      ) {
        highResourceProcesses.push(processId);
      }
    });

    return highResourceProcesses;
  }

  /**
   * Stop all monitoring
   */
  stopAll(): void {
    this.monitors.forEach((interval, processId) => {
      clearInterval(interval);
      this.logger.info(`Stopped monitoring for process ${processId}`);
    });
    this.monitors.clear();
    this.metrics.clear();
    this.healthChecks.clear();
  }

  /**
   * Collect metrics for a process
   */
  private async collectMetrics(process: ManagedProcess): Promise<void> {
    if (!process.pid) return;

    try {
      const metrics = await this.getProcessMetrics(process.pid);
      const currentMetrics = this.metrics.get(process.id);

      if (currentMetrics) {
        // Update metrics
        currentMetrics.cpuUsage = metrics.cpu;
        currentMetrics.memoryUsage = metrics.memory;
        currentMetrics.uptime = Date.now() - process.startTime.getTime();
        currentMetrics.restartCount = process.restartCount;

        // Check for alerts
        this.checkAlerts(process.id, currentMetrics);

        // Emit metrics update
        this.emit('metricsUpdated', process.id, currentMetrics);
      }
    } catch (error) {
      this.logger.error(
        `Failed to collect metrics for process ${process.id}:`,
        error,
      );
    }
  }

  /**
   * Get system metrics for a specific PID
   */
  private async getProcessMetrics(
    pid: number,
  ): Promise<{ cpu: number; memory: number }> {
    // This is a simplified implementation
    // In production, you'd use proper process monitoring tools
    try {
      const cpus = os.cpus();
      const totalMemory = os.totalmem();

      // Simulated metrics - in reality, you'd read from /proc/[pid]/stat on Linux
      // or use platform-specific APIs
      const cpu = Math.random() * 100; // Placeholder
      const memory = Math.random() * 100; // Placeholder

      return { cpu, memory };
    } catch (error) {
      this.logger.error(`Failed to get process metrics for PID ${pid}:`, error);
      return { cpu: 0, memory: 0 };
    }
  }

  /**
   * Perform health check for a process
   */
  private async performHealthCheck(process: ManagedProcess): Promise<void> {
    const healthCheck =
      this.healthChecks.get(process.id) || this.defaultHealthCheck;
    const metrics = this.metrics.get(process.id);

    if (!metrics) return;

    try {
      const startTime = Date.now();
      const isHealthy = await Promise.race([
        healthCheck.check(process),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), healthCheck.timeout),
        ),
      ]);

      const responseTime = Date.now() - startTime;
      metrics.responseTime = responseTime;
      metrics.lastHealthCheck = new Date();

      if (!isHealthy) {
        this.logger.warn(`Process ${process.id} failed health check`);
        this.emit('healthCheckFailed', process.id, metrics);

        // Trigger auto-recovery if configured
        this.handleUnhealthyProcess(process, healthCheck);
      } else {
        this.emit('healthCheckPassed', process.id, metrics);
      }
    } catch (error) {
      this.logger.error(`Health check error for process ${process.id}:`, error);
      this.emit('healthCheckError', process.id, error);
    }
  }

  /**
   * Check for alert conditions
   */
  private checkAlerts(processId: string, metrics: ProcessMetrics): void {
    // High CPU usage alert
    if (metrics.cpuUsage > 90) {
      this.logger.warn(
        `High CPU usage detected for process ${processId}: ${metrics.cpuUsage}%`,
      );
      this.emit('highCpuAlert', processId, metrics.cpuUsage);
    }

    // High memory usage alert
    if (metrics.memoryUsage > 90) {
      this.logger.warn(
        `High memory usage detected for process ${processId}: ${metrics.memoryUsage}%`,
      );
      this.emit('highMemoryAlert', processId, metrics.memoryUsage);
    }

    // Slow response time alert
    if (metrics.responseTime && metrics.responseTime > 10000) {
      this.logger.warn(
        `Slow response time detected for process ${processId}: ${metrics.responseTime}ms`,
      );
      this.emit('slowResponseAlert', processId, metrics.responseTime);
    }

    // Multiple restarts alert
    if (metrics.restartCount > 5) {
      this.logger.warn(
        `Process ${processId} has restarted ${metrics.restartCount} times`,
      );
      this.emit('frequentRestartsAlert', processId, metrics.restartCount);
    }
  }

  /**
   * Handle unhealthy process
   */
  private handleUnhealthyProcess(
    process: ManagedProcess,
    healthCheck: HealthCheck,
  ): void {
    // Emit event for external handling
    this.emit('processUnhealthy', process.id, healthCheck);

    // Log details
    this.logger.error(`Process ${process.id} is unhealthy, action required`);
  }
}
