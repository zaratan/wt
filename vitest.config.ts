import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    env: {
      // Ink colours its output when FORCE_COLOR is set in the ambient
      // environment, which turns every screen snapshot into a diff of escape
      // codes. Pinning it here keeps the suite green on machines that export it.
      FORCE_COLOR: "0",
    },
    coverage: {
      include: ["src/lib/**", "src/cli/**", "src/format/**"],
      exclude: ["src/lib/boundaries.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
