import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Footer } from "../Footer.js";
import { elapsed } from "../../format/elapsed.js";
import type { ProvisionEvent } from "../../lib/provision/run.js";
import type { ProgressTitle } from "../../commands/context.js";

export type Subscribe = (listen: (event: ProvisionEvent) => void) => () => void;

export type ProvisioningProps = {
  title: ProgressTitle;
  subscribe: Subscribe;
  now?: () => number;
};

type StepState = { run: string; outcome?: string };

const TAIL_THROTTLE_MS = 100;
const TICK_MS = 1_000;

export const Provisioning = ({
  title,
  subscribe,
  now = Date.now,
}: ProvisioningProps): React.JSX.Element => {
  const [steps, setSteps] = useState<readonly StepState[]>(() =>
    title.steps.map((run) => ({ run })),
  );
  const [copied, setCopied] = useState(0);
  const [tail, setTail] = useState("");
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [sinceStep, setSinceStep] = useState(0);

  useEffect(() => {
    let lastTail = 0;
    return subscribe((event) => {
      switch (event.kind) {
        case "copy":
          if (event.outcome === "copied") setCopied((count) => count + 1);
          return;
        case "step-start":
          setStartedAt(now());
          setSinceStep(0);
          setTail("");
          return;
        case "step-done":
          setSteps((current) =>
            current.map((step) =>
              step.run === event.run && step.outcome === undefined
                ? { ...step, outcome: event.outcome }
                : step,
            ),
          );
          setStartedAt(undefined);
          return;
        case "output": {
          // Throttled: a progress bar emits dozens of repaints a second, and
          // Ink would spend the run redrawing rather than the command working.
          const at = now();
          if (at - lastTail < TAIL_THROTTLE_MS) return;
          lastTail = at;
          setTail(event.line);
          return;
        }
      }
    });
  }, [subscribe, now]);

  useEffect(() => {
    // Its own clock, not the event stream: a silent step must still show a
    // number that moves, or a slow run is indistinguishable from a hang.
    const timer = setInterval(() => {
      setSinceStep(startedAt === undefined ? 0 : now() - startedAt);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt, now]);

  const running = steps.findIndex((step) => step.outcome === undefined);

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{title.repoName}</Text>
        <Text dimColor> / {title.branch}</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {copied > 0 ? (
          <Text>
            <Text color="green">{"  ✓ "}</Text>
            {`copied ${String(copied)} file(s)`}
          </Text>
        ) : null}
        {steps.map((step, at) => (
          <Text key={step.run}>
            {step.outcome === "ran" ? (
              <Text color="green">{"  ✓ "}</Text>
            ) : step.outcome === undefined && at === running ? (
              <Text color="cyan">{"  ▸ "}</Text>
            ) : step.outcome === undefined ? (
              <Text dimColor>{"    "}</Text>
            ) : (
              <Text color="yellow">{"  ! "}</Text>
            )}
            <Text dimColor={step.outcome === undefined && at !== running}>
              {step.run}
            </Text>
            {at === running && startedAt !== undefined ? (
              <Text dimColor>{`   ${elapsed(sinceStep)}`}</Text>
            ) : null}
          </Text>
        ))}
      </Box>

      {tail === "" ? null : (
        <Box marginTop={1}>
          <Text dimColor>{`  › ${tail}`}</Text>
        </Box>
      )}

      {title.logPath === undefined ? null : (
        <Box marginTop={1}>
          <Text dimColor>{`  log  ${title.logPath}`}</Text>
        </Box>
      )}

      <Footer hints={[]} />
    </Box>
  );
};
