import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/illustrator/panel/src/js/lib/utils/bolt.js", () => ({
  getUserDataPath: vi.fn(() => "/mock-user-data/"),
}));

import {
  readStoredDefaults,
  writeStoredDefaults,
} from "../../plugins/illustrator/panel/src/js/default-storage.js";

/** A caller decoder in the spirit of the real ones: keep known keys, drop the rest. */
function decodeSettings(raw: Record<string, unknown>): { outputRoot?: string } {
  return typeof raw.outputRoot === "string" ? { outputRoot: raw.outputRoot } : {};
}

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
    fsMock.existsSync.mockReturnValue(true);
    (globalThis as { require?: unknown }).require = vi.fn(() => fsMock);
  });

  afterEach(() => {
    if (originalRequire === undefined) {
      delete (globalThis as { require?: unknown }).require;
    } else {
      (globalThis as { require?: unknown }).require = originalRequire;
    }
  });

  it("reads stored defaults through the caller's decoder", () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        version: "1.0.0",
        settings: { outputRoot: "from-disk", unknownKey: "dropped" },
        fonts: [{ sourceFont: "ArialMT", family: "Arial" }],
      }),
    );

    expect(readStoredDefaults("ae-defaults.json", "1.0.0", decodeSettings)).toEqual({
      kind: "ok",
      value: {
        version: "1.0.0",
        // Recognized fields kept, unknown ones dropped by the decoder.
        settings: { outputRoot: "from-disk" },
        fonts: [{ sourceFont: "ArialMT", aifont: "ArialMT", family: "Arial" }],
      },
    });
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/mock-user-data/ae-defaults.json", "utf-8");
  });

  it("reports a missing file as missing, silently", () => {
    fsMock.existsSync.mockReturnValue(false);

    expect(readStoredDefaults("defaults.json", "1.0.0", decodeSettings)).toEqual({
      kind: "missing",
    });
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it("reports unparseable JSON as corrupt, not missing", () => {
    fsMock.readFileSync.mockReturnValue("{not json");

    const result = readStoredDefaults("defaults.json", "1.0.0", decodeSettings);
    expect(result.kind).toBe("corrupt");
    expect(result.kind === "corrupt" && result.error.length > 0).toBe(true);
  });

  it("reports an unknown version as corrupt", () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ version: "9.9.9", settings: {}, fonts: [] }),
    );

    const result = readStoredDefaults("defaults.json", "1.0.0", decodeSettings);
    expect(result.kind).toBe("corrupt");
    expect(result.kind === "corrupt" && result.error).toContain("9.9.9");
  });

  it("reports a non-object settings payload as corrupt", () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ version: "1.0.0", settings: 5, fonts: [] }),
    );

    expect(readStoredDefaults("defaults.json", "1.0.0", decodeSettings).kind).toBe("corrupt");
  });

  it("creates the directory and normalizes font aliases before writing", () => {
    fsMock.existsSync.mockReturnValue(false);

    writeStoredDefaults("defaults.json", "1.0.0", { output: "multiple-files" }, [
      { aifont: "ArialMT", family: "Arial" },
    ]);

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

  it("propagates a write failure instead of swallowing it", () => {
    fsMock.writeFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(() => writeStoredDefaults("defaults.json", "1.0.0", {}, [])).toThrow(/EACCES/);
  });
});
