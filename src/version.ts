// Single source of truth = package.json.
// Bun inlines the JSON in the compiled bundle (`bun build --compile`)
// and reads it directly in dev mode (`bun src/index.tsx`).
import packageJson from "../package.json" with { type: "json" };

export const APP_VERSION: string = packageJson.version;
