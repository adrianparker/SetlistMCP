import neostandard from 'neostandard'
import globals from 'globals'

export default [
  ...neostandard(),
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: globals.mocha
    }
  }
]
