import { PickRepo } from "./screens/PickRepo.js";
import { prompt, type InkHeld } from "./prompt.js";
import type { ChooseRepo } from "../lib/git/resolve.js";

/**
 * The resolvers a terminal can answer. Absent ones leave every command on its
 * text path, which is what keeps `--json` and non-TTY runs byte-identical.
 */
export const interactiveResolvers = (
  held: InkHeld,
): { chooseRepo: ChooseRepo } => ({
  chooseRepo: (choice) =>
    prompt<string | undefined>(
      (done) => <PickRepo choice={choice} onPick={done} />,
      held,
    ),
});
