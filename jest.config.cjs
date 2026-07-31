module.exports = {
  displayName: 'observability',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  coverageDirectory: 'coverage',
  // fixture packages under test/fixtures must never be treated as test roots
  modulePathIgnorePatterns: ['<rootDir>/test/fixtures/'],
};
