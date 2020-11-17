const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const {
  configuredDomains,
  hasCertificateFor,
  removeDomain,
  uninstall,
} = require('devcert')

const { APP_NAME, readConfig } = require('.')
const { setupFrontline } = require('../frontline')

function getCLIOptions() {
  return yargs(hideBin(process.argv))
    .command(
      'list-domains',
      'List installed domains on the local machine',
      {},
      listDomains
    )
    .help()
    .alias('h', 'help')
    .alias('?', 'help')
    .command(
      'forget-domain <domain>',
      'Remove a generated domain cert from the local machine',
      {},
      forgetDomain
    )
    .command('uninstall', `Uninstall ${APP_NAME} and devcert`, {}, uninstallAll)
    .version()
    .alias('V', 'version')
    .option('verbose', { alias: 'v', describe: 'Logs proxied requests' })
    .completion().argv
}

function forgetDomain({ domain }) {
  if (!hasCertificateFor(domain)) {
    console.warn(`${APP_NAME}: domain ${domain} was already not configured.`)
  } else {
    removeDomain(domain)
    console.info(`${APP_NAME}: domain ${domain} is not configured anymore.`)
  }
  process.exit(0)
}

function listDomains() {
  const domains = configuredDomains()
  domains.sort()
  console.log(`${APP_NAME} configured domains:`)
  for (const domain of domains) {
    console.log(`- ${domain}`)
  }
  process.exit(0)
}

async function processCLI() {
  const cli = getCLIOptions()
  const config = await readConfig()
  setupFrontline(config).start()
}

function uninstallAll() {
  uninstall()
  process.exit(0)
}

exports.processCLI = processCLI
