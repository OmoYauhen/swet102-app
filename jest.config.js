/**
 * ts-jest on the plain Node environment (not jest-expo).
 *
 * The unit tests cover pure logic with no React Native imports, so they need no
 * RN runtime. Component/hook tests that import RN would use a separate jest-expo
 * project; the two can coexist.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  // Tests compile against tsconfig.jest.json, which adds Jest's global types
  // (`expect`, `it`, …) without touching the app's build tsconfig.
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
};
