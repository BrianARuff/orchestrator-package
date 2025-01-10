/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxConcurrency: 4, // Allow up to 4 concurrent tests
  // We want to run tests found in dist/cjs, not in src
  // The pattern can be adjusted as you wish:
  testMatch: ["<rootDir>/dist/cjs/__tests__/**/*.test.js", "<rootDir>/dist/cjs/__tests__/**/*.spec.js"],
  // By default, Jest uses its own transform for .js files.
  // Because they're already compiled, we can disable transforms:
  transform: {},
  moduleNameMapper: {
    '^orchestrator$': '<rootDir>/dist/cjs/index.cjs',
    '^orchestrator/esm$': '<rootDir>/dist/esm/index.js'
  },
};
