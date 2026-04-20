import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AeProjectInfo } from "../../plugins/illustrator/panel/src/shared/types.js";

vi.mock("../../plugins/illustrator/panel/src/js/ae-bridge.js", () => ({
  getAeProjectInfo: vi.fn(),
}));

import { getAeProjectInfo } from "../../plugins/illustrator/panel/src/js/ae-bridge.js";
import {
  startAeWatching,
  stopAeWatching,
} from "../../plugins/illustrator/panel/src/js/ae-document-watcher.js";

const getAeProjectInfoMock = vi.mocked(getAeProjectInfo);

async function flushWatcher(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AE document watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAeProjectInfoMock.mockReset();
  });

  afterEach(() => {
    stopAeWatching();
    vi.useRealTimers();
  });

  it("reports the active project on the first poll", async () => {
    const project: AeProjectInfo = {
      name: "show.aep",
      path: "/tmp/show.aep",
      saved: true,
      compCount: 2,
      activeCompId: "42",
      activeCompName: "Main",
    };
    const callback = vi.fn();

    getAeProjectInfoMock.mockResolvedValue(project);

    startAeWatching(callback, 1000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(project);
  });

  it("does not fire again while the same project and comp stay active", async () => {
    const project: AeProjectInfo = {
      name: "show.aep",
      path: "/tmp/show.aep",
      saved: true,
      compCount: 2,
      activeCompId: "42",
      activeCompName: "Main",
    };
    const callback = vi.fn();

    getAeProjectInfoMock.mockResolvedValue(project);

    startAeWatching(callback, 1000);
    await flushWatcher();
    await vi.advanceTimersByTimeAsync(3000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("fires when the active comp changes within the same project", async () => {
    const first: AeProjectInfo = {
      name: "show.aep",
      path: "/tmp/show.aep",
      saved: true,
      compCount: 2,
      activeCompId: "42",
      activeCompName: "Main",
    };
    const second: AeProjectInfo = {
      ...first,
      activeCompId: "77",
      activeCompName: "Alt",
    };
    const callback = vi.fn();

    getAeProjectInfoMock.mockResolvedValueOnce(first).mockResolvedValue(second);

    startAeWatching(callback, 1000);
    await flushWatcher();
    await vi.advanceTimersByTimeAsync(1000);
    await flushWatcher();

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, first);
    expect(callback).toHaveBeenNthCalledWith(2, second);
  });

  it("ignores an in-flight poll that resolves after stopAeWatching()", async () => {
    const project: AeProjectInfo = {
      name: "show.aep",
      path: "/tmp/show.aep",
      saved: true,
      compCount: 2,
      activeCompId: "42",
      activeCompName: "Main",
    };
    const callback = vi.fn();

    let resolvePoll: ((value: AeProjectInfo | null) => void) | undefined;
    getAeProjectInfoMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    );

    startAeWatching(callback, 1000);
    stopAeWatching();
    resolvePoll?.(project);
    await flushWatcher();

    expect(callback).not.toHaveBeenCalled();
  });
});
