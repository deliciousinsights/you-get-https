/**
 * You-Get-HTTPS! -- A configurable HTTPS frontline for local development servers
 * listening as HTTP, using a thin wrapper on top of the devcert tool.
 *
 * © 2020 Christophe Porteneuve & Delicious Insights
 *
 * @see https://github.com/deliciousinsights/you-get-https#readme
 */

const { readConfig } = require('./config')
const { setupFrontline } = require('./frontline')

run()

async function run() {
  const config = await readConfig()
  setupFrontline(config).start()
}
