import neostandard from 'neostandard'
import globals from 'globals'

export default [
  ...neostandard(),
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: globals.mocha
    },
    rules: {
      // chai assertions like expect(x).to.be.true are bare expressions by design
      'no-unused-expressions': 'off'
    }
  }
]
