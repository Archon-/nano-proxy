const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');
const fs = require('fs');

// Load environment variables from .env file
const dotenvPath = '.env';

if (fs.existsSync(dotenvPath)) {
  const envContent = fs.readFileSync(dotenvPath, 'utf-8');
  const envLines = envContent.split('\n');

  envLines.forEach((line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const localProxyPort = process.env.LOCAL_PROXY_PORT || 8080;
const proxyType = process.env.PROXY_TYPE || 'http'; // 'http' or 'socks5'

if (proxyType === 'http') {
  const realProxyHost = process.env.REAL_PROXY_HOST || 'realproxy.example.com';
  const realProxyPort = process.env.REAL_PROXY_PORT || 8888;
  const username = process.env.PROXY_USERNAME || 'your_username';
  const password = process.env.PROXY_PASSWORD || 'your_password';

  function createProxyServer(req, res) {
    const proxyOptions = {
      host: realProxyHost,
      port: realProxyPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    // Inject username and password into the headers
    proxyOptions.headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

    const proxyReq = http.request(proxyOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, {
        end: true
      });
    });

    req.pipe(proxyReq, {
      end: true
    });

    proxyReq.on('error', (err) => {
      console.error('Error with the real proxy request:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });
  }

  function createPACServer(req, res) {
    // TODO: Implement PAC logic if needed
    // For simplicity, we will return a basic PAC configuration
    const pacConfig = `
      function FindProxyForURL(url, host) {
        return "PROXY ${req.headers.host}; DIRECT";
      }
    `;
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' });
    res.end(pacConfig);
  }

  function onRequest(req, res) {
    const parsedUrl = url.parse(req.url);

    if (parsedUrl.pathname === '/proxy.pac') {
      createPACServer(req, res);
    } else {
      createProxyServer(req, res);
    }
  }


  const httpServer = http.createServer(onRequest);
  httpServer.listen(localProxyPort, () => {
    console.log(`Local HTTP proxy server listening on port ${localProxyPort}`);
  });

  // Handle CONNECT requests for HTTPS connections
  httpServer.on('connect', (req, clientSocket, head) => {
    const parsedUrl = url.parse(`https://${req.url}`);
    const remoteSocket = net.connect(parsedUrl.port, parsedUrl.hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      remoteSocket.write(head);
      clientSocket.pipe(remoteSocket).pipe(clientSocket);
    });

    remoteSocket.on('error', (err) => {
      console.error('Error with the CONNECT request:', err.message);
      clientSocket.end();
    });
  });

  // ToDo: parametrize it (move to .env)
  const httpsOptions = {
    key: fs.readFileSync('./private-key.pem'),
    cert: fs.readFileSync('./certificate.pem'),
  };

  const httpsServer = https.createServer(httpsOptions, onRequest);
  httpsServer.listen(localProxyPort + 1, () => {
    console.log(`Local HTTPS proxy server listening on port ${localProxyPort + 1}`);
  });

} else if (proxyType === 'socks5') {
  console.log('Socks5 not implemented, yet!');
} else {
  console.error('Invalid proxy type. Use "http" or "socks5" in the PROXY_TYPE environment variable.');
  process.exit(1);
}

module.exports = {
  createProxyServer,
  createPACServer,
  onRequest,
};