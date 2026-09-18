import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text, useInput } from "ink";
import { prompt } from "./prompt.js";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

const Asking = ({ onDone }: { onDone: (value: string) => void }) => {
  useInput((_input, key) => {
    if (key.return) onDone("answered");
  });
  return <Text>question?</Text>;
};

describe("prompt", () => {
  it("returns the answer instead of hanging after the screen is done", async () => {
    const harness = render(<Text> </Text>);
    const held = { current: false };

    const answering = prompt<string>((done) => <Asking onDone={done} />, held, {
      stdin: harness.stdin as never,
      stdout: harness.stdout as never,
    });

    await settle();
    harness.stdin.write("\r");

    const raced = await Promise.race([
      answering,
      new Promise<string>((resolve) =>
        setTimeout(() => {
          resolve("HUNG");
        }, 3_000),
      ),
    ]);

    expect(raced).toBe("answered");
    expect(held.current).toBe(false);
  });

  it("releases the terminal even when the screen never answers", async () => {
    const harness = render(<Text> </Text>);
    const held = { current: false };
    let done: ((value: string) => void) | undefined;

    const answering = prompt<string>(
      (settleIt) => {
        done = settleIt;
        return <Text>waiting</Text>;
      },
      held,
      { stdin: harness.stdin as never, stdout: harness.stdout as never },
    );

    await settle();
    expect(held.current).toBe(true);
    done?.("late");
    await answering;
    expect(held.current).toBe(false);
  });
});
