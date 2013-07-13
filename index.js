var tls = require('tls');
var fs  = require('fs');
var https = require('https');

var accts = JSON.parse(fs.readFileSync('accounts.json'));
var clients = [];

var Client = function (stream, write) {
  this.stream = stream;
  this.write = write;
  
  this.sendWelcome();
  
  var self = this;
  this.readHandler = function (data) {
    console.log(data);
    var pkt = JSON.parse(data);
    if (self[pkt.op+'Op'])
      self[pkt.op+'Op'](pkt, pkt.ex);
    else
      console.log('unhandled op', pkt.op, 'in', pkt);
  };
};

Client.prototype = {
  sendWelcome: function () {
    this.write({op: 'welcome', ex: {server: 'danopia.net', software: '10bitd.js/0.0.1', now: +(new Date()), auth: ['password']}});
  },
  
  authOp: function (pkt, ex) {
    var acct;
    accts.forEach(function (that) {
      if (that.user == ex.username && that.pass == ex.password)
        acct = that;
    });
    
    if (acct) {
      this.acct = acct;
      this.write({op: 'ack', ex: {for: 'auth'}});
      
      //this.write({op: 'meta', sr: '@danopia.net', ex={...} # includes server metadata, like rules
      //this.write({op: 'meta', sr: this.acct.user, ex={...} # includes own metadata, like favorite topics and fullname
      this.write({op: 'meta', sr: '@danopia.net', tp: 'DEADBEEF', ex: {name: 'programming', description: 'Programming talk | RCMP post-commit-hook: http://rcmp.tenthbit.net/ | Get permission before sharing logs, or any paraphrasing thereof, from here.', users: clients.filter(function(c){return c.acct}).map(function(c){return c.acct.user})}});
    } else {
      this.write({op: 'error'});
    };
  },
  
  actOp: function (pkt, ex) {
    if (!this.acct) return;
    var newPkt = {op: 'act', tp: pkt.tp, sr: this.acct.user, ex: ex};
    
    clients.forEach(function (client) {
      if (!client.acct) return;
      
      client.write(newPkt);
    });
  }
};

function mainHandler (stream, write) {
  console.log('client connected', stream.authorized, stream.remoteAddress);

  var client = new Client(stream, write);
  clients.push(client);
  return client.readHandler;
}

// tcp server
function rawHandler (stream) {
  var handler = mainHandler(stream, function (d) { stream.write(JSON.stringify(d) + '\n'); });
  
  stream.setEncoding('utf8');
  stream.on('data', handler);
}

var options = {
  key: fs.readFileSync('server-key.pem'),
  cert: fs.readFileSync('server-cert.pem'),
  NPNProtocols: ['10bit/0.1', '10bit-gzip/0.1']
};
var server = tls.createServer(options, rawHandler);
server.listen(10817, function () {
  console.log('Listening on port 10817');
});

// websocket server
var processRequest = function( req, res ) {
  console.log(req,req.method,req.url);
  res.writeHead(200);
  res.end("All glory to WebSockets!\n");
};

var app = https.createServer({
  key: fs.readFileSync('server-key.pem'),
  cert: fs.readFileSync('server-cert.pem'),
}, processRequest);
    
app.listen(10818, function () {
  console.log('Listening on port 10818');
});

var wss = new (require('ws').Server)({server: app});
wss.on('connection', function (wsc) {
  var handler = mainHandler(wsc._socket, function (d) {console.log(d); wsc.send(JSON.stringify(d)); });
  wsc.on('message', handler);
});

