var tls   = require('tls'),
    fs    = require('fs'),
    https = require('https'),
    ws    = require('ws');

// ssl/tls
exports.options = {
  key: fs.readFileSync('server-key.pem'),
  cert: fs.readFileSync('server-cert.pem'),
  NPNProtocols: ['10bit', '10bit-gzip', 'http/1.1']
};

// tcp server
exports.tcp = tls.createServer(exports.options, function (stream) {
  if (!stream.npnProtocol)
    stream.npnProtocol = '10bit';
    
  var handler = exports.handler(stream, function (d) { stream.write(d + '\n'); });
  
  var buffer = '', idx;
  stream.on('data', function (data) {
    buffer += data;
    
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handler(buffer.substring(0, idx));
      buffer = buffer.substring(idx + 1);
    }
  }).setEncoding('utf8');
});

// web server
exports.web = https.createServer(exports.options, function (req, res) {
  console.log(req,req.method,req.url);
  res.writeHead(200);
  res.end("All glory to WebSockets!\n");
});

// websocket server
exports.wss = new (ws.Server)({server: exports.web});
exports.wss.on('connection', function (wsc) {
  if (!wsc._socket.npnProtocol)
    wsc._socket.npnProtocol = 'http/1.1';
  
  var handler = exports.handler(wsc._socket, function (d) { wsc.send(d); });
  wsc.on('message', handler);
});

exports.listen = function () {
  exports.tcp.listen(10817, function () {
    console.log('Listening on port 10817 (tcp)');
  });
  
  exports.web.listen(10818, function () {
    console.log('Listening on port 10818 (web)');
  });
};

