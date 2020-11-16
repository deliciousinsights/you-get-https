const { access, readFile } = require('fs/promises')
const { default: DefaultUI } = require('devcert/dist/user-interface')
const { certificateFor } = require('devcert')
const { F_OK, R_OK } = require('fs').constants
const { join: joinPaths } = require('path')
const JSON5 = require('json5')
const pkgUp = require('pkg-up')
const xdgBaseDirs = require('xdg-basedir')
const { settings } = require('cluster')

// Helper: whether our process can read the file at `path`.
async function canFileBeRead(path) {
  try {
    await access(path, F_OK | R_OK)
    return true
  } catch (e) {
    return false
  }
}

// Helper: converts a (presumed correct) text to a port integer.
function convertPort(text) {
  return Math.trunc(Number(text))
}

// Exported API: finds the best match in the mappings for the actual host being
// passed, and returns the mapped port. If no match can be found, returns
// `undefined`.
function findPortForMappedHost(mappings, host) {
  host = normalizeDomain(host)

  const perfectMatch = mappings.get(host)
  if (perfectMatch) {
    return perfectMatch.port
  }

  const domainsLongestFirst = Array.from(mappings.keys()).sort((a, b) => b.length - a.length)
  const firstMatch = domainsLongestFirst.find((suffix) => host.endsWith(`.${suffix}`))
  return firstMatch && mappings.get(firstMatch).port
}

// Helper: compute the configuration filename, dynamically based on the
// package's name.
async function getConfigFileName() {
  const packageJsonPath = await pkgUp()
  const json = await readFile(packageJsonPath, { encoding: 'utf-8' })
  const packageName = JSON.parse(json).name
  return `${packageName}.json`
}

// Basic domain name syntax validation.  Copied over from one of devcert's
// internal constants.
const REGEX_DOMAIN_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i

// Helper: whether a text is a valid domain name.
function isValidDomain(text) {
  return REGEX_DOMAIN_NAME.test(text)
}

// Helper: whether a text is a valid port number (JS-safe positive integer).
function isValidPort(text) {
  const port = Number(text)
  return Number.isSafeInteger(port) && port > 0
}

// Helper: normalize a domain text to allow for more flexible config input yet
// ensure normalized mapping keys.
function normalizeDomain(domain) {
  return domain.replace(/\s+/, '').toLowerCase()
}

// Exported API: reads the configuration (if any), and generates/retrieves
// certificates on-the-fly in a time-efficient manner (parallel async calls).
// On the first call ever, this will trigger root CA gen and installation.
async function readConfig() {
  const result = {
    listeningPort: 443,
    mappings: new Map()
  }

  // Compute the config path and check whether one such file can be read.
  const path = joinPaths(xdgBaseDirs.config, await getConfigFileName())
  const configFileReadable = await canFileBeRead(path)

  // Nope? Let's stay with defaults (no mappings, btw).
  if (!configFileReadable) {
    console.warn('No configuration: no mappings.  The server is kinda useless now.')
    return result
  }

  try {
    const json = await readFile(path)
    const settings = JSON5.parse(json)

    // Look for a customized frontline listening port
    if (isValidPort(settings.frontline?.listen)) {
      result.listeningPort = convertPort(settings.frontline.listen)
    }

    // Store domain-port mappings for valid pairs
    for (let [domain, port] of Object.entries(settings.mappings)) {
      domain = normalizeDomain(domain)
      if (isValidDomain(domain) && isValidPort(port)) {
        result.mappings.set(domain.toLowerCase(), { port: convertPort(port) })
      }
    }

    // Gen/retrieve certs for every mapping in parallel, and store the resulting
    // configs (cert/key pairs) for later use by the HTTPS frontline server.
    const domains = Array.from(result.mappings.keys())
    const sslConfigs = await Promise.all(domains.map(certificateFor))
    for (const sslConfig of sslConfigs) {
      result.mappings.get(domains.shift()).ssl = sslConfig
    }
  } catch (e) {
    console.error('Error processing JSON5 configuration file:', e)
  }
  return result
}

exports.findPortForMappedHost = findPortForMappedHost
exports.readConfig = readConfig
