import type { ProcessSignal, ProcessSignalSource } from "./types.js";

export type RegisteredSignalHandlers = Readonly<{
  dispose: () => void;
}>;

export const registerProcessSignalHandlers = (
  source: ProcessSignalSource,
  onSignal: (signal: ProcessSignal) => void,
  signals: readonly ProcessSignal[] = ["SIGINT", "SIGTERM"],
): RegisteredSignalHandlers => {
  const handlers = signals.map((signal) => {
    const handler = () => onSignal(signal);
    source.onSignal(signal, handler);
    return { signal, handler };
  });

  return {
    dispose: () => {
      for (const { signal, handler } of handlers) {
        source.offSignal(signal, handler);
      }
    },
  };
};
