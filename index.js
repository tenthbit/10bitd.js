var fs = require('fs');

var socketServer = require('./socket_server');

var accts = JSON.parse(fs.readFileSync('accounts.json'));
var rooms = JSON.parse(fs.readFileSync('rooms.json'));
var clients = [];

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
      
      //this.write({op: 'meta', sr: this.acct.user, ex={...} # includes own metadata, like favorite rooms and fullname
      this.send({op: 'meta', sr: '@danopia.net', rm: '48557f95', ex: {name: 'programming', description: 'Programming talk | RCMP post-commit-hook: http://rcmp.tenthbit.net/ | Get permission before sharing logs, or any paraphrasing thereof, from here.', users: clients.filter(function(c){return c.acct}).map(function(c){return c.acct.user})}});
    } else {
      this.send({op: 'error'});
    };
  },
  
  actOp: function (pkt, ex) {
    if (!this.acct) return;
    var newPkt = {op: 'act', rm: pkt.rm, sr: this.acct.user, ex: ex};
    
    clients.forEach(function (client) {
      if (!client.acct) return;
      
      client.send(newPkt);
    });
  }
};

socketServer.handler = function (stream, write) {
  console.log('client connected', stream.npnProtocol, stream.authorized, stream.remoteAddress);

  var client = new Client(stream, write);
  clients.push(client);
  return client.readHandler;
};

socketServer.listen();

