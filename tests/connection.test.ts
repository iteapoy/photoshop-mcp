import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, platform: () => 'darwin' };
});

vi.mock('../src/platform/detector.js', () => ({
  PhotoshopDetector: class {
    async detect() {
      return {
        version: '27.9.1',
        path: '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app',
        isRunning: true,
        appName: 'Adobe Photoshop 2026',
      };
    }
  },
}));

import { MacOSExecutor } from '../src/platform/macos-executor.js';
import { PhotoshopConnection } from '../src/platform/connection.js';

const appNameOf = (executor: MacOSExecutor) =>
  (executor as unknown as { appName: string }).appName;

describe('PhotoshopConnection on macOS', () => {
  const seenAppNames: string[] = [];
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.PHOTOSHOP_MCP_HOME;
    home = mkdtempSync(join(tmpdir(), 'ph-mcp-conn-'));
    process.env.PHOTOSHOP_MCP_HOME = home;
    seenAppNames.length = 0;
    vi.spyOn(MacOSExecutor.prototype, 'isPhotoshopRunning').mockImplementation(async function (
      this: MacOSExecutor
    ) {
      seenAppNames.push(appNameOf(this));
      return true;
    });
    vi.spyOn(MacOSExecutor.prototype, 'execute').mockImplementation(async function (
      this: MacOSExecutor
    ) {
      seenAppNames.push(appNameOf(this));
      return 'ok';
    });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.PHOTOSHOP_MCP_HOME;
    else process.env.PHOTOSHOP_MCP_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('applies the detected app name before the very first script runs', async () => {
    // Regression: the executor is created lazily, and setAppName used to run
    // before getExecutor(), so the first call of every session targeted the
    // hard-coded "Adobe Photoshop 2025" and failed on any other version.
    const connection = new PhotoshopConnection();
    await connection.executeScript('app.version');
    expect(seenAppNames).toEqual(['Adobe Photoshop 2026', 'Adobe Photoshop 2026']);
  });

  it('does not launch Photoshop when launch is false and the app is not running', async () => {
    vi.spyOn(MacOSExecutor.prototype, 'isPhotoshopRunning').mockResolvedValue(false);
    const launch = vi
      .spyOn(MacOSExecutor.prototype, 'launchPhotoshop')
      .mockResolvedValue(undefined);
    const connection = new PhotoshopConnection();
    await expect(
      connection.executeScript('return 1;', undefined, { launch: false })
    ).rejects.toThrow(/not running/i);
    expect(launch).not.toHaveBeenCalled();
  });

  it('applies the detected bundle path before the very first script runs (#72)', async () => {
    const seenPaths: Array<string | undefined> = [];
    vi.spyOn(MacOSExecutor.prototype, 'execute').mockImplementation(async function (
      this: MacOSExecutor
    ) {
      seenPaths.push((this as unknown as { appPath?: string }).appPath);
      return 'ok';
    });
    await new PhotoshopConnection().executeScript('app.version');
    expect(seenPaths).toEqual(['/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app']);
  });

  it('applies the detected app name in ensurePhotoshopRunning', async () => {
    const connection = new PhotoshopConnection();
    await connection.ensurePhotoshopRunning();
    expect(seenAppNames).toEqual(['Adobe Photoshop 2026']);
  });

  it('reuses the running-state probe across consecutive script calls', async () => {
    let probes = 0;
    vi.spyOn(MacOSExecutor.prototype, 'isPhotoshopRunning').mockImplementation(async () => {
      probes++;
      return true;
    });
    const connection = new PhotoshopConnection();
    await connection.executeScript('return 1;');
    await connection.executeScript('return 2;');
    await connection.executeScript('return 3;');
    // One tasklist/pgrep on the first call, none after (within the TTL).
    expect(probes).toBe(1);
  });

  it('re-probes after a bridge error reports Photoshop is not running', async () => {
    let probes = 0;
    vi.spyOn(MacOSExecutor.prototype, 'isPhotoshopRunning').mockImplementation(async () => {
      probes++;
      return true;
    });
    let call = 0;
    vi.spyOn(MacOSExecutor.prototype, 'execute').mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error('Photoshop is not running');
      return 'ok';
    });
    const connection = new PhotoshopConnection();
    await expect(connection.executeScript('return 1;', undefined, { launch: false })).rejects.toThrow(
      /not running/i
    );
    await connection.executeScript('return 2;', undefined, { launch: false });
    // Error invalidated the cached "running"; second call probes again.
    expect(probes).toBe(2);
  });
});

describe('cold API initialization', () => {
  it('initializes on the first get_state without requiring a ping', async () => {
    const { PhotoshopAPIFactory } = await import('../src/api/photoshop-api.js');
    const home=mkdtempSync(join(tmpdir(),'ps-cold-api-'));const old=process.env.PHOTOSHOP_MCP_HOME;process.env.PHOTOSHOP_MCP_HOME=home;
    try {
      const connection=new PhotoshopConnection();
      expect(connection.getPhotoshopInfo()).toBeNull();
      const api=await new PhotoshopAPIFactory(connection).createAPI();
      expect(api.getAPIType()).toBe('ExtendScript');expect(connection.getPhotoshopInfo()?.version).toBe('27.9.1');
    }finally{if(old===undefined)delete process.env.PHOTOSHOP_MCP_HOME;else process.env.PHOTOSHOP_MCP_HOME=old;rmSync(home,{recursive:true,force:true});}
  });
  it('shares concurrent cold detection and reports missing Photoshop with a ping recovery hint', async () => {
    const { PhotoshopAPIFactory }=await import('../src/api/photoshop-api.js');
    const { classifyError }=await import('../src/errors/envelope.js');
    const { PhotoshopDetector }=await import('../src/platform/detector.js');
    const home=mkdtempSync(join(tmpdir(),'ps-cold-concurrent-'));const old=process.env.PHOTOSHOP_MCP_HOME;process.env.PHOTOSHOP_MCP_HOME=home;
    try {
      const detector=vi.spyOn(PhotoshopDetector.prototype,'detect');
      const connection=new PhotoshopConnection();
      await Promise.all([new PhotoshopAPIFactory(connection).createAPI(),new PhotoshopAPIFactory(connection).createAPI()]);
      expect(detector).toHaveBeenCalledOnce();detector.mockRestore();
      const missing=classifyError('Photoshop info not available. Please detect Photoshop first.');
      expect(missing.code).toBe('photoshop_unreachable');expect(missing.suggested_next_tool).toBe('photoshop_ping');
    }finally{if(old===undefined)delete process.env.PHOTOSHOP_MCP_HOME;else process.env.PHOTOSHOP_MCP_HOME=old;rmSync(home,{recursive:true,force:true});}
  });
});
