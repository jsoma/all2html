import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/illustrator/panel/src/js/lib/utils/bolt.js", () => ({
  getUserDataPath: vi.fn(() => "/mock-user-data/"),
}));

import {
  readStoredDefaults,
  writeStoredDefaults,
} from "../../plugins/illustrator/panel/src/js/default-storage.js";

describe("shared defaults storage", () => {
  const originalRequire = (globalThis as { require?: unknown }).require;
  const fsMock = {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };

  beforeEach(() => {
    fsMock.readFileSync.mockReset();
    fsMock.writeFileSync.mockReset();
    fsMock.existsSync.mockReset();
    fsMock.mkdirSync.mockReset();
    (globalThis as { require?: unknown }).require = vi.fn(() => fsMock);
  });

  afterEach(() => {
    if (originalRequire === undefined) {
      delete (globalThis as { require?: unknown }).require;
    } else {
      (globalThis as { require?: unknown }).require = originalRequire;
    }
  });

  it("reads stored defaults from the CEP user-data directory", () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        version: "1.0.0",
        settings: { outputRoot: "from-disk" },
        fonts: [{ sourceFont: "ArialMT", family: "Arial" }],
      }),
    );

    expect(readStoredDefaults<{ outputRoot: string }>("ae-defaults.json")).toEqual({
      version: "1.0.0",
      settings: { outputRoot: "from-disk" },
      fonts: [{ sourceFont: "ArialMT", family: "Arial" }],
    });
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/mock-user-data/ae-defaults.json", "utf-8");
  });

  it("creates the directory and normalizes font aliases before writing", () => {
    fsMock.existsSync.mockReturnValue(false);

    writeStoredDefaults(
      "defaults.json",
      "1.0.0",
      { output: "multiple-files" },
      [{ aifont: "ArialMT", family: "Arial" }],
      "write failed",
    );

    expect(fsMock.mkdirSync).toHaveBeenCalledWith("/mock-user-data/", { recursive: true });
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);

    const [path, raw, encoding] = fsMock.writeFileSync.mock.calls[0];
    expect(path).toBe("/mock-user-data/defaults.json");
    expect(encoding).toBe("utf-8");
    expect(JSON.parse(String(raw))).toEqual({
      version: "1.0.0",
      settings: { output: "multiple-files" },
      fonts: [
        {
          sourceFont: "ArialMT",
          aifont: "ArialMT",
          family: "Arial",
        },
      ],
    });
  });
});
