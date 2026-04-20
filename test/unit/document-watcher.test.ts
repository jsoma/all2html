import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentInfo } from "../../plugins/illustrator/panel/src/shared/types.js";

vi.mock("../../plugins/illustrator/panel/src/js/bridge.js", () => ({
  getDocumentInfo: vi.fn(),
}));

import { getDocumentInfo } from "../../plugins/illustrator/panel/src/js/bridge.js";
import {
  startWatching,
  stopWatching,
} from "../../plugins/illustrator/panel/src/js/document-watcher.js";

const getDocumentInfoMock = vi.mocked(getDocumentInfo);

async function flushWatcher(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("document watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getDocumentInfoMock.mockReset();
  });

  afterEach(() => {
    stopWatching();
    vi.useRealTimers();
  });

  it("reports an unsaved Illustrator document on the first poll", async () => {
    const doc: DocumentInfo = {
      name: "Untitled-1",
      path: "",
      saved: false,
      artboardCount: 1,
    };
    const callback = vi.fn();

    getDocumentInfoMock.mockResolvedValue(doc);

    startWatching(callback, 1000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(doc);
  });

  it("does not fire again while the same saved document stays active", async () => {
    const doc: DocumentInfo = {
      name: "story.ai",
      path: "/tmp/story.ai",
      saved: true,
      artboardCount: 3,
    };
    const callback = vi.fn();

    getDocumentInfoMock.mockResolvedValue(doc);

    startWatching(callback, 1000);
    await flushWatcher();
    await vi.advanceTimersByTimeAsync(3000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(doc);
  });

  it("treats a dirty saved document as the same document when its path is unchanged", async () => {
    const doc: DocumentInfo = {
      name: "story.ai",
      path: "/tmp/story.ai",
      saved: false,
      artboardCount: 3,
    };
    const callback = vi.fn();

    getDocumentInfoMock.mockResolvedValue(doc);

    startWatching(callback, 1000);
    await flushWatcher();
    await vi.advanceTimersByTimeAsync(3000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(doc);
  });

  it("treats different unsaved documents as separate active documents", async () => {
    const first: DocumentInfo = {
      name: "Untitled-1",
      path: "",
      saved: false,
      artboardCount: 1,
    };
    const second: DocumentInfo = {
      name: "Untitled-2",
      path: "",
      saved: false,
      artboardCount: 1,
    };
    const callback = vi.fn();

    getDocumentInfoMock.mockResolvedValueOnce(first).mockResolvedValue(second);

    startWatching(callback, 1000);
    await flushWatcher();
    await vi.advanceTimersByTimeAsync(1000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, first);
    expect(callback).toHaveBeenNthCalledWith(2, second);
  });

  it("ignores an in-flight poll that resolves after stopWatching()", async () => {
    const doc: DocumentInfo = {
      name: "story.ai",
      path: "/tmp/story.ai",
      saved: true,
      artboardCount: 3,
    };
    const callback = vi.fn();

    let resolvePoll: ((value: DocumentInfo | null) => void) | undefined;
    getDocumentInfoMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    );

    startWatching(callback, 1000);
    stopWatching();
    resolvePoll?.(doc);
    await flushWatcher();

    expect(callback).not.toHaveBeenCalled();
  });
});
