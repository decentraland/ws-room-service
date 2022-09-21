module.exports = {
  moduleFileExtensions: ["ts", "js"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", {
      tsconfig: "test/tsconfig.json",
    }],
  },
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "src/**/*.js"],
  coveragePathIgnorePatterns: ["/node_modules/", "/src/proto/"],
  testMatch: ["**/*.spec.(ts)"],
  testEnvironment: "node",
}
