import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/illustrator/panel/src/js/lib/utils/bolt.js", () => ({
  evalTS: vi.fn(),
}));

import { openFolder as openAeFolder } from "../../plugins/illustrator/panel/src/js/ae-bridge.js";
import { openFolder as openIllustratorFolder } from "../../plugins/illustrator/panel/src/js/bridge.js";
import { evalTS } from "../../plugins/illustrator/panel/src/js/lib/utils/bolt.js";

const evalTSMock = vi.mocked(evalTS);
const originalDocument = (globalThis as any).document;
const originalRequire = (globalThis as any).require;

describe("open folder bridges", () => {
  beforeEach(() => {
    evalTSMock.mockReset();
    delete (globalThis as any).document;
    delete (globalThis as any).require;
  });

  afterEach(() => {
    if (originalDocument === undefined) {
      delete (globalThis as any).document;
    } else {
      (globalThis as any).document = originalDocument;
    }

    if (originalRequire === undefined) {
      delete (globalThis as any).require;
    } else {
      (globalThis as any).require = originalRequire;
    }
  });

  it("passes successful Illustrator host responses through", async () => {
    evalTSMock.mockResolvedValue({ success: true, path: "/tmp/output" });

    await expect(openIllustratorFolder("/tmp/output")).resolves.toBeUndefined();
    expect(evalTSMock).toHaveBeenCalledWith("openFolder", "/tmp/output");
  });

  it("throws when the Illustrator host reports a folder-open failure", async () => {
    evalTSMock.mockResolvedValue({ success: false, error: "Folder could not be opened" });

    await expect(openIllustratorFolder("~/broken")).rejects.toThrow("Folder could not be opened");
  });

  it("throws when the After Effects host reports a folder-open failure", async () => {
    evalTSMock.mockResolvedValue({ success: false, error: "Folder not found" });

    await expect(openAeFolder("~/broken")).rejects.toThrow("Folder not found");
  });

  it("uses the CEP node runtime before falling back to the host bridge", async () => {
    const execFile = vi.fn(
      (_command: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );
    (globalThis as any).document = {};
    (globalThis as any).require = vi.fn((moduleName: string) => {
      if (moduleName === "fs") {
        return { existsSync: vi.fn(() => true) };
      }
      if (moduleName === "child_process") {
        return { execFile };
      }
      if (moduleName === "os") {
        return { homedir: () => "/Users/tester", platform: () => "darwin" };
      }
      if (moduleName === "path") {
        return path;
      }
      throw new Error(`Unexpected module: ${moduleName}`);
    });

    await expect(openIllustratorFolder("~/output")).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]?.[1]).toEqual(["/Users/tester/output"]);
    expect(evalTSMock).not.toHaveBeenCalled();
  });

  it("uses cmd.exe start on Windows instead of explorer.exe fallback behavior", async () => {
    const execFile = vi.fn(
      (_command: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );
    (globalThis as any).document = {};
    (globalThis as any).require = vi.fn((moduleName: string) => {
      if (moduleName === "fs") {
        return { existsSync: vi.fn(() => true) };
      }
      if (moduleName === "child_process") {
        return { execFile };
      }
      if (moduleName === "os") {
        return { homedir: () => "/Users/tester", platform: () => "win32" };
      }
      if (moduleName === "path") {
        return path;
      }
      throw new Error(`Unexpected module: ${moduleName}`);
    });

    await expect(openAeFolder("~/output dir")).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledWith(
      "cmd.exe",
      ["/d", "/s", "/c", 'start "" "\\Users\\tester\\output dir"'],
      expect.any(Function),
    );
    expect(evalTSMock).not.toHaveBeenCalled();
  });
});
