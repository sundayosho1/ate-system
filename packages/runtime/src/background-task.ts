import { lifecycleError, timeout, toErrorMessage } from "./primitives.js";
import type { LifecycleError, RuntimeClock } from "./types.js";

export type BackgroundTaskState = "CREATED" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

export type BackgroundTask = Readonly<{
  name: string;
  state: () => BackgroundTaskState;
  start: () => Promise<void>;
  stop: () => Promise<readonly LifecycleError[]>;
}>;

export const createBackgroundTask = (input: {
  name: string;
  clock: RuntimeClock;
  stopTimeoutMs: number;
  run: (signal: AbortSignal) => Promise<void>;
}): BackgroundTask => {
  let state: BackgroundTaskState = "CREATED";
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;

  return {
    name: input.name,
    state: () => state,
    start: () => {
      if (state === "RUNNING") {
        return Promise.resolve();
      }
      controller = new AbortController();
      state = "RUNNING";
      running = input.run(controller.signal).catch((error: unknown) => {
        state = "FAILED";
        throw error;
      });
      return Promise.resolve();
    },
    stop: async () => {
      if (state === "STOPPED") {
        return [];
      }
      state = "STOPPING";
      controller?.abort();
      const errors: LifecycleError[] = [];
      if (running !== undefined) {
        try {
          await timeout(
            running.catch(() => undefined),
            input.stopTimeoutMs,
            () =>
              lifecycleError(
                "SHUTDOWN_TIMEOUT",
                `background task ${input.name} did not stop before timeout`,
                input.clock.now(),
              ),
          );
        } catch (error) {
          errors.push(
            lifecycleError("SHUTDOWN_FAILED", toErrorMessage(error), input.clock.now(), undefined, {
              task: input.name,
            }),
          );
        }
      }
      state = "STOPPED";
      return errors;
    },
  };
};
