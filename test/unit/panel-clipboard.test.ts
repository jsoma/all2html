import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../../plugins/illustrator/panel/src/js/clipboard.js";

interface FakeTextarea {
  value: string;
  style: Record<string, string>;
  focus: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  setSelectionRange: ReturnType<typeof vi.fn>;
}

function makeFakeDocument(execCommand: ReturnType<typeof vi.fn>) {
  const textarea: FakeTextarea = {
    value: "",
    style: {},
    focus: vi.fn(),
    select: vi.fn(),
    setAttribute: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  };
  return {
    body,
    textarea,
    document: {
      body,
      activeElement: { focus: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand,
    },
  };
}

describe("panel clipboard helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies with a textarea fallback before using navigator.clipboard", async () => {
    const execCommand = vi.fn(() => true);
    const { document, textarea, body } = makeFakeDocument(execCommand);
    const writeText = vi.fn();
    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("diagnostic text")).resolves.toBe(true);

    expect(textarea.value).toBe("diagnostic text");
    expect(body.appendChild).toHaveBeenCalledWith(textarea);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to navigator.clipboard when execCommand fails", async () => {
    const { document } = makeFakeDocument(vi.fn(() => false));
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("warning text")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("warning text");
  });

  it("returns false when no copy path is available", async () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", {});

    await expect(copyText("nothing")).resolves.toBe(false);
  });
});
