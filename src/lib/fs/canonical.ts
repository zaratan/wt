import { realpath } from "node:fs/promises";

/** The path as the filesystem spells it, or as given when it does not exist. */
export const canonical = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
};
