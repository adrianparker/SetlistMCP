import dotenv from 'dotenv'
import { createLogger } from './logger.js'

function greet (name) {
  return `Hello, ${name}!`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config()
  const logger = await createLogger(process.env.NODE_ENV)
  logger.debug('Starting setlist-mcp')
  console.log(greet('world'))
}

export { greet }
