import { createInterface } from "node:readline/promises";

export type ConfirmStreams = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

/**
 * Anything but an explicit yes is a no, so a stray newline never agrees to
 * something destructive.
 */
export const askConfirm = async (
  streams: ConfirmStreams,
  question: string,
): Promise<boolean> => {
  const rl = createInterface({
    input: streams.input,
    output: streams.output,
    terminal: false,
  });
  // question() never settles on EOF, and Ctrl-D is EOF even on a terminal.
  const eof = new Promise<string>((resolve) => {
    rl.once("close", () => {
      resolve("");
    });
  });
  try {
    const answer = await Promise.race([rl.question(`${question} `), eof]);
    return /^\s*(y|yes|o|oui)\s*$/i.test(answer);
  } finally {
    rl.close();
  }
};
