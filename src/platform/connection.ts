import { platform } from 'os';
import { Logger } from '../utils/logger.js';
import { PhotoshopDetector } from './detector.js';
import { readPhotoshopDetectCache, writePhotoshopDetectCache } from './detect-cache.js';
import { ScriptExecutor } from './script-executor.js';
import { WindowsExecutor } from './windows-executor.js';
import { MacOSExecutor } from './macos-executor.js';

export interface PhotoshopInfo {
  version: string;
  path: string;
  isRunning: boolean;
  appName?: string;
}

export class PhotoshopConnection {
  private logger: Logger;
  private detector: PhotoshopDetector;
  private executor: ScriptExecutor | null = null;
  private photoshopInfo: PhotoshopInfo | null = null;
  private macosExecutor?: MacOSExecutor;
  private onFreshDetect?: (ok: boolean) => void;
  /**
   * Cached "is Photoshop running" probe. On Windows this shells out to
   * `tasklist` (~250ms) on every call; on macOS it runs pgrep. A script
   * execution via the COM/AppleScript bridge already fails fast when the app
   * is gone, so re-checking on every short-lived tool call is pure overhead.
   * Cache the positive result briefly and let the executor refresh it.
   */
  private runningCache: { at: number; value: boolean } | null = null;

  constructor() {
    this.logger = new Logger('PhotoshopConnection');
    this.detector = new PhotoshopDetector();
    // Executor is initialized lazily on first use so that constructing a
    // PhotoshopConnection on an unsupported platform (e.g. the Linux CI runner
    // used for the verify-photoshop-prompts script) does not throw immediately.
  }

  /** Returns the platform executor, initializing it on first call. */
  private getExecutor(): ScriptExecutor {
    if (this.executor) return this.executor;

    const platformType = platform();
    if (platformType === 'win32') {
      this.executor = new WindowsExecutor();
    } else if (platformType === 'darwin') {
      this.macosExecutor = new MacOSExecutor();
      this.executor = this.macosExecutor;
    } else {
      throw new Error(`Unsupported platform: ${platformType}`);
    }
    return this.executor;
  }

  /** Register a listener for a real detect() — not a cache hydrate. */
  setOnFreshDetect(callback: (ok: boolean) => void): void {
    this.onFreshDetect = callback;
  }

  /** Load a valid on-disk detect without Spotlight/registry. */
  hydrateFromCache(): boolean {
    if (this.photoshopInfo) return true;
    const cached = readPhotoshopDetectCache();
    if (!cached) return false;
    this.photoshopInfo = {
      version: cached.version,
      path: cached.path,
      isRunning: false,
      ...(cached.appName ? { appName: cached.appName } : {}),
    };
    this.logger.debug(`Using cached Photoshop detect at ${cached.path}`);
    return true;
  }

  private notifyFreshDetect(ok: boolean): void {
    this.onFreshDetect?.(ok);
  }

  /**
   * Running-state check with a short TTL. `force` bypasses the cache after we
   * launch or after a bridge error suggests the app may have exited.
   */
  private async isRunningCached(executor: ScriptExecutor, force = false): Promise<boolean> {
    const ttl = this.runningCacheTtlMs();
    const now = Date.now();
    if (!force && ttl > 0 && this.runningCache && now - this.runningCache.at < ttl) {
      return this.runningCache.value;
    }
    const value = await executor.isPhotoshopRunning();
    this.runningCache = { at: Date.now(), value };
    return value;
  }

  private runningCacheTtlMs(): number {
    const raw = process.env.PHOTOSHOP_RUNNING_CACHE_MS?.trim();
    if (raw !== undefined) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
    return 10_000;
  }

  /** Errors that mean Photoshop exited, so a cached "running" is now stale. */
  private static readonly NOT_RUNNING_PATTERN =
    /not running|isn't running|is not running|photoshop not found|-600|prohibit|programmatic access/i;

  /** Invalidate the cached running state (e.g. after launching Photoshop). */
  invalidateRunningCache(): void {
    this.runningCache = null;
  }

  private applyCachedInfo(cached: { version: string; path: string; appName?: string }): void {
    this.photoshopInfo = {
      version: cached.version,
      path: cached.path,
      isRunning: false,
      ...(cached.appName ? { appName: cached.appName } : {}),
    };
  }

  private async resolvePhotoshopInfo(): Promise<PhotoshopInfo | null> {
    if (this.photoshopInfo) return this.photoshopInfo;

    const cached = readPhotoshopDetectCache();
    if (cached) {
      this.applyCachedInfo(cached);
      return this.photoshopInfo;
    }

    try {
      this.photoshopInfo = await this.detector.detect();
      if (this.photoshopInfo) {
        writePhotoshopDetectCache({
          version: this.photoshopInfo.version,
          path: this.photoshopInfo.path,
          appName: this.photoshopInfo.appName,
        });
        this.notifyFreshDetect(true);
        return this.photoshopInfo;
      }
      this.notifyFreshDetect(false);
      return null;
    } catch (error) {
      this.notifyFreshDetect(false);
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    try {
      this.logger.debug('Pinging Photoshop...');
      const info = await this.resolvePhotoshopInfo();
      return info !== null;
    } catch (error) {
      this.logger.error('Ping failed:', error);
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const info = await this.resolvePhotoshopInfo();
      return info?.version || 'Unknown';
    } catch (error) {
      this.logger.error('Failed to get version:', error);
      throw error;
    }
  }

  async executeScript(
    script: string,
    timeout?: number,
    options?: { launch?: boolean }
  ): Promise<unknown> {
    try {
      await this.resolvePhotoshopInfo();
      if (!this.photoshopInfo) {
        throw new Error('Photoshop not found on this system');
      }

      const executor = this.getExecutor();
      this.applyMacOSTarget();

      const isRunning = await this.isRunningCached(executor);
      if (!isRunning) {
        if (options?.launch === false) {
          throw new Error('Photoshop is not running');
        }
        this.logger.info('Photoshop not running, launching...');
        await executor.launchPhotoshop(this.photoshopInfo.path);
        // The launch needs time to come up; drop the stale "not running" so the
        // next probe reflects reality instead of reusing a cached false.
        this.invalidateRunningCache();
      }

      try {
        return await executor.execute(script, timeout);
      } catch (error) {
        // If the bridge says Photoshop is gone, the cached "running" is stale.
        // Drop it so the next call re-probes and can auto-launch if allowed.
        const message = error instanceof Error ? error.message : String(error);
        if (PhotoshopConnection.NOT_RUNNING_PATTERN.test(message)) {
          this.invalidateRunningCache();
        }
        throw error;
      }
    } catch (error) {
      this.logger.error('Script execution failed:', error);
      throw error;
    }
  }

  getPhotoshopInfo(): PhotoshopInfo | null {
    return this.photoshopInfo;
  }

  async ensurePhotoshopRunning(): Promise<void> {
    await this.resolvePhotoshopInfo();
    if (!this.photoshopInfo) {
      throw new Error('Photoshop not found on this system');
    }

    const executor = this.getExecutor();
    this.applyMacOSTarget();
    const isRunning = await this.isRunningCached(executor);
    if (!isRunning) {
      this.logger.info('Launching Photoshop...');
      await executor.launchPhotoshop(this.photoshopInfo.path);
      this.invalidateRunningCache();
    }
  }

  /**
   * Point the macOS executor at the detected install. Must run after
   * getExecutor(): the executor is created lazily, and before this ordering fix
   * the first script of every session ran against the hard-coded default
   * ("Adobe Photoshop 2025"). The bundle path is the AppleScript target; the
   * name stays for logs and as a fallback when the path is not a bundle (#72).
   */
  private applyMacOSTarget(): void {
    if (!this.macosExecutor || !this.photoshopInfo) return;
    if (this.photoshopInfo.appName) this.macosExecutor.setAppName(this.photoshopInfo.appName);
    this.macosExecutor.setAppPath(this.photoshopInfo.path);
  }
}
