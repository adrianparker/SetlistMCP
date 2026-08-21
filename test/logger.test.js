import { describe, it } from 'mocha'
import { expect } from 'chai'
import path from 'path'
import winston from 'winston'
import { buildConsoleTransport, redirectConsoleLoggingToStderr, resolveLogFilePath } from '../src/logger.js'

const NON_ERROR_LEVELS = ['warn', 'info', 'http', 'verbose', 'debug', 'silly']

describe('buildConsoleTransport', () => {
  it('should route every level to stderr when consoleToStderr is set', () => {
    const transport = buildConsoleTransport({ consoleToStderr: true, consoleLogLevel: 'info' })

    // winston normalises the stderrLevels array into an object internally
    NON_ERROR_LEVELS.forEach(level => {
      expect(transport.stderrLevels).to.have.property(level)
    })
    expect(transport.stderrLevels).to.have.property('error')
  })

  it('should leave non-error levels on stdout when consoleToStderr is not set', () => {
    const transport = buildConsoleTransport({ consoleLogLevel: 'info' })

    expect(transport.stderrLevels).to.have.property('error')
    NON_ERROR_LEVELS.forEach(level => {
      expect(transport.stderrLevels).to.not.have.property(level)
    })
  })

  it('should honour the configured console level', () => {
    expect(buildConsoleTransport({ consoleLogLevel: 'warn' }).level).to.equal('warn')
  })

  it('should default to debug when no config is supplied', () => {
    expect(buildConsoleTransport(undefined).level).to.equal('debug')
  })
})

describe('redirectConsoleLoggingToStderr', () => {
  it('should replace a stdout console transport with a stderr one', () => {
    const logger = winston.createLogger({
      transports: [buildConsoleTransport({ consoleLogLevel: 'info' })]
    })

    redirectConsoleLoggingToStderr(logger)

    const consoleTransports = logger.transports.filter(t => t instanceof winston.transports.Console)
    expect(consoleTransports).to.have.lengthOf(1)
    NON_ERROR_LEVELS.forEach(level => {
      expect(consoleTransports[0].stderrLevels).to.have.property(level)
    })
  })

  it('should preserve the existing console level', () => {
    const logger = winston.createLogger({
      transports: [buildConsoleTransport({ consoleLogLevel: 'warn' })]
    })

    redirectConsoleLoggingToStderr(logger)

    const consoleTransport = logger.transports.find(t => t instanceof winston.transports.Console)
    expect(consoleTransport.level).to.equal('warn')
  })

  it('should leave non-console transports alone', () => {
    const logger = winston.createLogger({
      transports: [
        buildConsoleTransport({ consoleLogLevel: 'info' }),
        new winston.transports.File({ filename: '/dev/null' })
      ]
    })

    redirectConsoleLoggingToStderr(logger)

    expect(logger.transports.filter(t => t instanceof winston.transports.File)).to.have.lengthOf(1)
  })
})

describe('resolveLogFilePath', () => {
  it('should return an absolute path inside the repo, not the working directory', () => {
    const resolved = resolveLogFilePath('logs/app.log')
    const repoRoot = path.resolve(import.meta.dirname, '..')

    expect(path.isAbsolute(resolved)).to.be.true
    expect(resolved.startsWith(path.join(repoRoot, 'logs'))).to.be.true
  })

  it('should apply the current year and month to the filename', () => {
    const now = new Date()
    const expected = `app-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.log`

    expect(path.basename(resolveLogFilePath('logs/app.log'))).to.equal(expected)
  })
})
