/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  globalSetup: '<rootDir>/tests/globalSetup.ts',
  // The whole suite shares one real PostgreSQL database and truncates tables
  // between tests, so test files must not run in parallel.
  maxWorkers: 1,
  testTimeout: 30000,
  collectCoverageFrom: [
    'src/**/*.ts',
    // Process entry point and the seed CLI: not exercised by the suite.
    '!src/server.ts',
    '!src/scripts/**',
    // Static OpenAPI definition object, no branching logic.
    '!src/swagger.ts',
    // Executed on every run via globalSetup (it creates the schema the whole
    // suite depends on), but Jest does not instrument globalSetup modules, so
    // including it here would report a misleading 0%.
    '!src/data/migrate.ts',
  ],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageDirectory: 'coverage',
};
