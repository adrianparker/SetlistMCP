import fs from 'fs'
import path from 'path'
import winston from 'winston'
import { readFile } from 'fs/promises'

let loggerInstance

/**
 * Every winston level. Used to route the whole console transport to stderr, since
 * winston's default only sends 'error' there.
 */
const ALL_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']

/**
 * Loads the logging configuration for the specified environment.
 *
 * @param {string} [env] - The environment name (e.g., 'development', 'production').
 * @returns {Object|undefined} The logging configuration object if found, otherwise undefined.
 * @throws {Error} If the configuration file for the specified environment does not exist.
 */
async function loadConfig (env) {
  if (env) {
    const configPath = path.resolve(import.meta.dirname, `./config/${env}.json`)
    if (!fs.existsSync(configPath)) {
      throw new Error(`Logging config file not found: ${configPath}`)
    }
    const data = JSON.parse(await readFile(new URL(configPath, import.meta.url)))
    return data
  } else {
    console.warn('No environment specified, using default logging configuration.')
  }
}

/**
 * Returns a log file path with the current year and month, e.g. logs/app-2025-09.log
 * @param {string} basePath - The base log file path (e.g. logs/app.log)
 * @returns {string} The log file path with year and month
 */
function getMonthlyLogFilePath (basePath) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const ext = path.extname(basePath)
  const base = path.basename(basePath, ext)
  const dir = path.dirname(basePath)
  return path.join(dir, `${base}-${year}-${month}${ext}`)
}

/**
 * Builds the console transport.
 *
 * Under the MCP stdio transport, stdout is the JSON-RPC channel and a single log line
 * on it corrupts the protocol stream. When the config sets consoleToStderr, every
 * level is routed to stderr, including the ones winston would normally send to stdout.
 * Decided here at construction rather than patched afterwards, so there is no window
 * in which a startup warning can reach stdout.
 *
 * @param {Object} [config] - The logging configuration, if one was found.
 * @returns {winston.transports.Console} The configured console transport.
 */
function buildConsoleTransport (config) {
  return new winston.transports.Console({
    level: (config && config.consoleLogLevel ? config.consoleLogLevel : 'debug'),
    stderrLevels: (config && config.consoleToStderr) ? ALL_LEVELS : ['error'],
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message }) => `[${level}]: ${message}`)
    )
  })
}

/**
 * Resolves a configured log file path against this module rather than the working
 * directory. An MCP client spawns the server from an arbitrary cwd, so a relative
 * path would scatter log files into whichever repo the client happened to start in.
 *
 * @param {string} basePath - The configured log file path (e.g. logs/app.log)
 * @returns {string} An absolute path, with the current year and month applied.
 */
function resolveLogFilePath (basePath) {
  return path.resolve(import.meta.dirname, '..', getMonthlyLogFilePath(basePath))
}

/**
 * Routes an already-built logger's console output to stderr.
 *
 * Belt and braces alongside the consoleToStderr config: if a logger was somehow
 * created without it, this still protects the JSON-RPC channel before the server
 * starts serving.
 *
 * @param {winston.Logger} logger - The logger to fix up.
 * @returns {winston.Logger} The same logger, for chaining.
 */
function redirectConsoleLoggingToStderr (logger) {
  const consoleTransports = logger.transports.filter(t => t instanceof winston.transports.Console)
  consoleTransports.forEach(t => logger.remove(t))
  logger.add(new winston.transports.Console({
    level: consoleTransports[0] ? consoleTransports[0].level : 'debug',
    stderrLevels: ALL_LEVELS,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message }) => `[${level}]: ${message}`)
    )
  }))
  return logger
}

/**
 * Creates and returns a singleton Winston logger instance configured for the specified environment.
 *
 * @param {string} [env] - The environment name (e.g., 'development', 'production').
 * @returns {winston.Logger} The configured Winston logger instance.
 */
async function createLogger (env) {
  if (loggerInstance) {
    return loggerInstance
  }
  const config = await loadConfig(env)

  const transports = [buildConsoleTransport(config)]
  if (config) {
    if (config.logToFile && config.logFilePath) {
      const monthlyLogFilePath = resolveLogFilePath(config.logFilePath)
      transports.push(
        new winston.transports.File({
          filename: monthlyLogFilePath,
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message }) => {
              return `${timestamp} [${level}]: ${message}`
            })
          )
        })
      )
    }

    loggerInstance = winston.createLogger({
      level: config.level,
      transports
    })
    if (config.logToFile && config.logFilePath) {
      loggerInstance.debug(`Logging to file: ${resolveLogFilePath(config.logFilePath)}`)
    }
  } else {
    loggerInstance = winston.createLogger({
      level: 'debug',
      transports
    })
    loggerInstance.warn('No logging configuration found, using default settings.')
  }

  return loggerInstance
}

export { buildConsoleTransport, createLogger, redirectConsoleLoggingToStderr, resolveLogFilePath }
