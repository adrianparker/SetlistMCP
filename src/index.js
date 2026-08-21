#!/usr/bin/env node
import path from 'node:path'
import dotenv from 'dotenv'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createDependencies, createServer } from './server.js'

// quiet:true is not optional. dotenv writes an "injected env" banner to stdout, and
// under the stdio transport stdout is the JSON-RPC channel - that banner alone
// corrupts the stream before the server sends its first message.
//
// The path is resolved against this module because an MCP client spawns the server
// from its own working directory, not this repo, so a bare config() finds no .env.
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env'), quiet: true })
process.env.NODE_ENV ??= 'app'

/**
 * Starts the server on stdio.
 *
 * @returns {Promise<Object>} The stdio handle, for shutdown.
 */
async function main () {
  // Built once, outside the factory: serveStdio calls its factory per connection, so
  // constructing the rate limiters in there would reset them on every reconnect.
  const deps = await createDependencies()

  const handle = serveStdio(
    () => createServer(deps),
    { onerror: error => deps.logger.error(`Transport error: ${error.message}`) }
  )

  deps.logger.info('setlist-mcp running on stdio')

  const shutdown = () => {
    handle.close().catch(error => console.error('Error during shutdown:', error))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return handle
}

/* c8 ignore start - the bootstrap path is exercised by running the binary, not by unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    // console.error writes to stderr, which is safe under the stdio transport.
    console.error('Fatal error starting setlist-mcp:', error)
    process.exit(1)
  })
}
/* c8 ignore stop */

export { main }
