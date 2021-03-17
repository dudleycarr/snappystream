module.exports = {
  env: {
    node: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 10,
    sourceType: 'module',
  },
  plugins: [],
  rules: {},
  settings: {},
  globals: {
    after: false,
    afterEach: false,
    before: false,
    describe: false,
    beforeEach: false,
    it: false,
    expect: false,
  },
}
