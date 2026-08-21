import fs from 'fs'
import path from 'path'
import winston from 'winston'
import { readFile } from 'fs/promises'

let loggerInstance

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

  const transports = [
    new winston.transports.Console({
      level: (config && config.consoleLogLevel ? config.consoleLogLevel : 'debug'),
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message }) => `[${level}]: ${message}`)
      )
    })
  ]
  if (config) {
    if (config.logToFile && config.logFilePath) {
      const monthlyLogFilePath = getMonthlyLogFilePath(config.logFilePath)
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
      loggerInstance.debug(`Logging to file: ${getMonthlyLogFilePath(config.logFilePath)}`)
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

export { createLogger }
