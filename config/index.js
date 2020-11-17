const { access, readFile, writeFile } = require('fs/promises')
const { certificateFor } = require('devcert')
const {
  getWindowsEncryptionPassword: originalGetWindowsEncryptionPassword,
} = require('devcert/dist/user-interface').default
const { F_OK, R_OK, W_OK } = require('fs').constants
const { join: joinPaths } = require('path')
const JSON5 = require('json5')
const pkgUp = require('pkg-up')
const xdgBaseDirs = require('xdg-basedir')

const { cipher, decipher } = require('./secrets')

const APP_NAME = 'You-Get-HTTPS!'

// Helper: whether our process can read/write the file at `path`.

async function canFileBe(path, mode = 'read') {
  try {
    await access(path, F_OK | (mode === 'written' ? W_OK : R_OK))
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

  const domainsLongestFirst = Array.from(mappings.keys()).sort(
    (a, b) => b.length - a.length
  )
  const firstMatch = domainsLongestFirst.find((suffix) =>
    host.endsWith(`.${suffix}`)
  )
  return firstMatch && mappings.get(firstMatch).port
}

// Helper: compute the configuration path, dynamically based on the
// package's name.
async function getConfigFilePath() {
  const packageJsonPath = await pkgUp()
  const json = await readFile(packageJsonPath, { encoding: 'utf-8' })
  const packageName = JSON.parse(json).name
  return joinPaths(xdgBaseDirs.config, `${packageName}.json5`)
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

// Helper: persist the in-memory configuration, erasing the existing file if
// need be.  A header comment mentions the overwriting, to account for any loss
// of the original comments, if any.
async function persistConfig(settings) {
  const path = await getConfigFilePath()
  if (!canFileBe(path, 'written')) {
    return
  }

  let text = JSON5.stringify(settings, null, 2)
  const stamp = new Date().toISOString()
  text = `// Overwritten by ${APP_NAME} on ${stamp}\n${text}`
  await writeFile(path, text, { encoding: 'utf-8' })
}

// Helper: gen/retrieve certs for every mapping in parallel, and store the
// resulting configs (cert/key pairs) for later use by the HTTPS frontline
// server.
async function provisionCertificates(mappings, settings) {
  const domains = Array.from(mappings.keys())
  const sslConfigs = await Promise.all(
    domains.map((domain) =>
      certificateFor(domain, { ui: { getWindowsEncryptionPassword } })
    )
  )

  for (const sslConfig of sslConfigs) {
    mappings.get(domains.shift()).ssl = sslConfig
  }
  return mappings

  // This custom wrapper around the default password-prompting UI lets us
  // persist the password in the tool's configuration so we don't keep asking
  // for it.
  async function getWindowsEncryptionPassword() {
    if (settings.devCertPassword) {
      return decipher(settings.devCertPassword)
    }

    const devCertPassword = await originalGetWindowsEncryptionPassword()
    settings.devCertPassword = cipher(devCertPassword)
    persistConfig(settings)
    return devCertPassword
  }
}

// Exported API: reads the configuration (if any), and generates/retrieves
// certificates on-the-fly in a time-efficient manner (parallel async calls).
// On the first call ever, this will trigger root CA gen and installation.
async function readConfig() {
  const result = {
    listeningPort: 443,
    mappings: new Map(),
  }

  // Compute the config path and check whether one such file can be read.
  const path = await getConfigFilePath()
  const configFileReadable = await canFileBe(path, 'read')

  // Nope? We're useless then, let's get out.
  if (!configFileReadable) {
    console.error(
      'No configuration: no mappings.  The server is kinda useless then.'
    )
    process.exit(78) // EX_CONFIG
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
        result.mappings.set(domain, { port: convertPort(port) })
      }
    }

    await provisionCertificates(result.mappings, settings)
  } catch (e) {
    console.error('Error processing JSON5 configuration file:', e)
  }
  return result
}

exports.APP_NAME = APP_NAME
exports.findPortForMappedHost = findPortForMappedHost
exports.readConfig = readConfig
