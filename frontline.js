const chalk = require('chalk')
const { createProxyServer } = require('http-proxy')
const { createServer } = require('https')
const { APP_NAME, findPortForMappedHost } = require('./config')

const LOG_STAMP_FORMATTER = new Intl.DateTimeFormat([], { timeStyle: 'medium' })

function logRequest({ req, listeningPort, port }) {
  const { hostname, pathname } = new URL(req.url, `https://${req.headers.host}`)
  const frontlinePort = listeningPort === 443 ? '' : `:${listeningPort}`
  const stamp = LOG_STAMP_FORMATTER.format(new Date())

  console.debug(
    chalk`{dim [${stamp}] ${req.method} https://}${hostname}{dim ${pathname}${frontlinePort} => port} {bold ${port}}`
  )
}

// Exported API: sets up an HTTPS server on the listening port and registers SSL
// configs and proxying for all known mappings.  This does not start listening,
// but the resulting object has a `start()` method to do just that.  Errors and
// successful launch both are automatically reported on the console.
function setupFrontline({ listeningPort, mappings, verbose }) {
  const frontline = createServer(proxyRequest)

  // Here we register SSL configs (cert + key) for every mapped domain, so we
  // can provide multi-host frontlining through this single server, on a unified
  // listening port.
  for (const [domain, { ssl }] of mappings) {
    frontline.addContext(domain, ssl)
    // Our certs allow subdomains but this needs explicit declaration using SNI
    // wildcards in HTTPS servers.
    frontline.addContext(`*.${domain}`, ssl)
  }

  // Public API: result objects feature a `start` method to trigger listening
  // and report on both error and success.
  frontline.start = () => {
    frontline.listen(listeningPort, (err) => {
      if (err) {
        handleListenError(err)
      } else {
        reportSuccessfulStart()
      }
    })
  }

  const proxy = createProxyServer({ xfwd: true, ws: true })

  // Launch error handler.  Special-cases "port in use" situations for more
  // actionable reporting.
  function handleListenError(err) {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `It looks like listening port ${listeningPort} is in use already.  Check your existing services?`
      )
    } else {
      console.error(err)
    }
  }

  // Request handler.  This is where the actual proxying happens!
  function proxyRequest(req, res) {
    const port = findPortForMappedHost(mappings, req.headers.host)
    if (!port) {
      res.writeHead(501, 'No port mapping configured for this host')
      res.end(`No port mapping configured for host ${req.headers.host}`)
      return
    }

    if (verbose) {
      logRequest({ req, listeningPort, port })
    }
    proxy.web(req, res, { target: `http://localhost:${port}` }, (err) => {
      if (err.code === 'ECONNREFUSED') {
        const msg = `Could not connect to proxied port ${port}`
        res.writeHead(503, msg).end(msg)
      } else {
        res.writeHead(500, err.message).end(err.message)
      }
    })
  }

  // Launch success handler.  Reports on the listening port and active mappings.
  function reportSuccessfulStart() {
    console.log(
      `${APP_NAME} frontline listening on port ${frontline.address().port}`
    )
    console.log('Active port mappings:')
    console.table(
      Array.from(mappings).map(([domain, { port }]) => ({ domain, port }))
    )
    console.log('Hit Ctrl+C to stop')
  }

  return frontline
}

exports.setupFrontline = setupFrontline
