var tls = require('tls');
var fs  = require('fs');
var https = require('https');

var accts = JSON.parse(fs.readFileSync('accounts.json'));
var clients = [];
var topics = [];

topics.push({
  id: 'DEADBEEF',
  name: 'Programming',
  format: 'markdown',
  acl: [['dan', ['owner']], ['Squidward', ['ban']]],
  description: '## Programming talk\n* RCMP post-commit-hook: http://rcmp.tenthbit.net/\n* Get permission before sharing logs, or any paraphrasing thereof, from here.'});

var Client = function (stream, write) {
  this.stream = stream;
  this.write = write;
  
  this.sendWelcome();
  
  var self = this;
  this.readHandler = function (data) {
    console.log((self.acct ? self.acct : 'anon'), '>>>', data);
    
    var pkt = JSON.parse(data);
    if (self[pkt.op+'Op'])
      self[pkt.op+'Op'](pkt, pkt.ex);
    else
      console.log('unhandled op', pkt.op, 'in', pkt);
  };
  
  stream.on('end', function () {
    console.log('bye');
    clients.splice(clients.indexOf(self, 1));
  });
};

Client.prototype = {
  send: function (pkt) {
    console.log((this.acct ? this.acct.user : 'anon'), '<<<', JSON.stringify(pkt));
    this.write(JSON.stringify(pkt));
  },
  
  sendWelcome: function () {
    this.send({op: 'welcome', ex: {server: 'danopia.net', software: '10bitd.js/0.0.1', now: +(new Date()), auth: ['password']}});
  },
  
  authOp: function (pkt, ex) {
    var acct;
    accts.forEach(function (that) {
      if (that.user == ex.username && that.pass == ex.password)
        acct = that;
    });
    
    if (acct) {
      this.acct = acct;
      this.send({op: 'ack', ex: {for: 'auth'}});
      
      var me = JSON.parse(JSON.stringify(this.acct));
      delete me.pass;
      this.send({op: 'meta', sr: '@danopia.net', ex: me});
      
      //this.write({op: 'meta', sr: this.acct.user, ex={...} # includes own metadata, like favorite topics and fullname
      this.send({op: 'meta', sr: '@danopia.net', tp: 'DEADBEEF', ex: {name: 'programming', description: 'Programming talk | RCMP post-commit-hook: http://rcmp.tenthbit.net/ | Get permission before sharing logs, or any paraphrasing thereof, from here.', users: clients.filter(function(c){return c.acct}).map(function(c){return c.acct.user})}});
    } else {
      this.send({op: 'error'});
    };
  },
  
  actOp: function (pkt, ex) {
    if (!this.acct) return;
    var newPkt = {op: 'act', tp: pkt.tp, sr: this.acct.user, ex: ex};
    
    clients.forEach(function (client) {
      if (!client.acct) return;
      
      client.send(newPkt);
    });
  }
};

function mainHandler (stream, write) {
  console.log('client connected', stream.npnProtocol, stream.authorized, stream.remoteAddress);

  var client = new Client(stream, write);
  clients.push(client);
  return client.readHandler;
}

// ssl/tls
var options = {
  key: fs.readFileSync('server-key.pem'),
  cert: fs.readFileSync('server-cert.pem'),
  NPNProtocols: ['10bit/0.1', '10bit-gzip/0.1', 'http/1.1']
};

// tcp server
var server = tls.createServer(options, function (stream) {
  if (!wsc._socket.npnProtocol)
    wsc._socket.npnProtocol = '10bit/0.1';
    
  var handler = mainHandler(stream, function (d) { stream.write(d + '\n'); });
  
  var buffer = '', idx;
  stream.on('data', function (data) {
    buffer += data;
    
    while ((idx = buffer.indexOf('\n')) >= 0) {
      handler(buffer.substring(0, idx));
      buffer = buffer.substring(idx + 1);
    }
  }).setEncoding('utf8');
}).listen(10817, function () {
  console.log('Listening on port 10817 (tcp)');
});

// web server
var app = https.createServer(options, function (req, res) {
  console.log(req,req.method,req.url);
  res.writeHead(200);
  res.end("All glory to WebSockets!\n");
}).listen(10818, function () {
  console.log('Listening on port 10818 (web)');
});

// websocket server
var wss = new (require('ws').Server)({server: app});
wss.on('connection', function (wsc) {
  if (!wsc._socket.npnProtocol)
    wsc._socket.npnProtocol = 'http/1.1';
  
  var handler = mainHandler(wsc._socket, function (d) { wsc.send(d); });
  wsc.on('message', handler);
});

