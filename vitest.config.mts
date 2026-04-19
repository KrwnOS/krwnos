import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Focus on the persistence-agnostic kernel — everything that a
      // green `npm test` must keep honest. Prisma adapters / wiring
      // live behind real drivers and are exercised by integration
      // tests, so they're excluded here to keep the unit gate fast
      // and deterministic.
      include: ["src/core/**/*.ts"],
      exclude: [
        "src/core/**/*.test.ts",
        "src/core/__tests__/**",
        "src/core/index.ts",
        "src/core/setup-state.ts",
        "src/core/*-prisma.ts",
        "src/core/backup.ts",
        "src/core/tunneling.ts",
      ],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
});
