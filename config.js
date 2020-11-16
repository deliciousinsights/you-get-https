const { access, readFile } = require('fs/promises')
const { certificateFor } = require('devcert')
const { F_OK, R_OK } = require('fs').constants
const { join: joinPaths } = require('path')
const JSON5 = require('json5')
const pkgUp = require('pkg-up')
const xdgBaseDirs = require('xdg-basedir')

async function canFileBeRead(path) {
  try {
    await access(path, F_OK | R_OK)
    return true
  } catch (e) {
    return false
  }
}

async function getConfigFileName() {
  const packageJsonPath = await pkgUp()
  const json = await readFile(packageJsonPath, { encoding: 'utf-8' })
  const packageName = JSON.parse(json).name
  return `${packageName}.json`
}

const REGEX_DOMAIN_NAME = /^(?=.{0,253}$)(([a-z0-9_][a-z0-9_-]{0,61}[a-z0-9_]|[a-z0-9_])\.)+((?=.*[^0-9])([a-z0-9][a-z0-9-]{0,61}[a-z0-9]|[a-z0-9]))$/i

function isValidDomain(text) {
  return REGEX_DOMAIN_NAME.test(text)
}

function isValidPort(text) {
  const port = Number(text)
  return Number.isSafeInteger(port) && port > 0
}

async function readConfig() {
  const result = {
    listeningPort: 443,
    mappings: new Map()
  }

  const path = joinPaths(xdgBaseDirs.config, await getConfigFileName())
  const configFileReadable = await canFileBeRead(path)

  if (!configFileReadable) {
    return result
  }

  try {
    const toml = await readFile(path)
    const settings = JSON5.parse(toml)

    if (settings.frontline?.listen > 0) {
      result.listeningPort = Math.trunc(Number(settings.frontline.listen))
    }


    for (const [domain, port] of Object.entries(settings.mappings)) {
      if (isValidDomain(domain) && isValidPort(port)) {
        result.mappings.set(domain, { port: Math.trunc(Number(port)) })
      }
    }

    const domains = Array.from(result.mappings.keys())
    const sslConfigs = await Promise.all(domains.map(certificateFor))
    for (const sslConfig of sslConfigs) {
      result.mappings.get(domains.shift()).ssl = sslConfig
    }
  } catch (e) {
    console.error('Error reading JSON5 configuration file:', e)
  }
  return result
}

exports.readConfig = readConfig
