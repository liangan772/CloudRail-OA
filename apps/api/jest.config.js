/** Jest 配置：单测直接跑 TS 源码；@oa/shared 映射到源码，避免依赖 dist 构建产物 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // e2e 测试（test/）在阶段 6 接入，使用独立的 test/jest-e2e.json；此处只覆盖 src 下的单测
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@oa/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  collectCoverageFrom: ['src/domain/**/*.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
};
