var socketServer = require('./socket_server');
var data = require('./data');

var clients = [];

var seq = 1;
function nextId () {
  return '1-'+(seq++);
}

var Client = function (stream, write) {
  this.stream = stream;
  this.write = write;
  
  this.sendWelcome();
  
  var self = this;
  this.readHandler = function (data) {
    console.log(self.getLabel(), '>>>', data);
    
    var d = require('domain').create(), pkt;
    d.on('error', function (er) {
      self.send({op: 'error', ex: {message: "Error while parsing packet", details: er.message}});
    }).run(function () {
      pkt = JSON.parse(data);
    });
    
    if (!pkt) return;
    
    if (self[pkt.op + 'Op'])
      self[pkt.op + 'Op'](pkt, pkt.ex);
    else
      console.log('unhandled op', pkt.op, 'in', pkt);
  };
  
  stream.on('end', function () {
    self.dead = true;
    self.disconnect({reason: 'connection closed'});
  }).on('error', function (ex) {
    console.log('Socket error:', ex.message);
    self.dead = true;
    self.disconnect({reason: 'socket error'});
  });
};

function relayPkt (pkt, ackTo, rooms, noRoom) {
  if (!pkt.ts) pkt.ts = +(new Date());
  if (!pkt.id) pkt.id = nextId();
  if (!pkt.ex) pkt.ex = {};
  delete pkt.ex.isack;
  
  var sent = [];
  (rooms || []).forEach(function (id) {
    var room = data.findRoom(id);
    if (!room) return;
    
    data.subs[id].forEach(function (client) {
      if (client == ackTo || sent.indexOf(client) >= 0) return;
      
      if (!noRoom) pkt.rm = id;
      client.send(pkt);
      sent.push(client);
    });
  });
  
  if (ackTo) {
    pkt.ex.isack = true;
    ackTo.send(pkt);
  };
};

Client.prototype = {

  // Socket helpers  
  
  send: function (pkt) {
    if (!pkt.ts) pkt.ts = +(new Date());
    if (!pkt.id) pkt.id = nextId();
    
    console.log(this.getLabel(), '<<<', JSON.stringify(pkt));
    
    if (this.stream.wsc && this.stream.wsc.readyState != 1) {// open
      console.log('Disconnecting due to websocket state:', this.stream.wsc.readyState);
      this.dead = true;
      this.disconnect({reason: 'websocket state was ' + this.stream.wsc.readyState});
    } else {
      this.write(JSON.stringify(pkt));
    };
  },
  
  sendWelcome: function () {
    this.send({op: 'welcome', ex: {server: 'danopia.net', software: '10bitd.js/0.0.1', auth: ['password']}});
  },
  
  disconnect: function (ex) {
    var idx = clients.indexOf(this);
    if (idx == -1) return false;
    
    console.log('disconnecting ' + this.getLabel());
    clients.splice(idx, 1);
    
    if (this.acct) {
      var mySubs = this.findSubs();
      
      var self = this;
      mySubs.forEach(function (id) {
        data.findRoom(id).users.splice(data.findRoom(id).users.indexOf(self.acct.user), 1);
        data.subs[id].splice(data.subs[id].indexOf(self), 1);
      });
      
      var pkt = {op: 'disconnect', sr: this.acct.user};
      relayPkt(pkt, this.dead ? null : this, mySubs, true);
    };
    
    this.dead = true;
  },
  
  getLabel: function () {
    return this.acct ? this.acct.user : this.stream.remoteAddress;
  },
  
  // Room helpers
  
  findSubs: function () {
    var ids = [];
    for (id in data.subs) {
      if (data.subs[id].indexOf(this) >= 0)
        ids.push(id);
    };
    
    return ids;
  },
  
  joinRoom: function (id, ex, auto) {
    var room = data.findRoom(id);
    if (!this.acct || !id || !room) return false;
    if (data.subs[id].indexOf(this) >= 0) return false;
    
    this.send({op: 'meta', sr: '@danopia.net', rm: id, ex: room});
    
    room.users.push(this.acct.user);
    data.subs[id].push(this);
    
    var pkt = {op: 'join', sr: this.acct.user, ex: ex, rm: id};
    relayPkt(pkt, this, [id]);
  },
  
  leaveRoom: function (id, ex) {
    if (!this.acct || !id || !data.findRoom(id)) return false;
    var room = data.findRoom(id);
    if (data.subs[id].indexOf(this) == -1) return false;
    room.users.splice(room.users.indexOf(this.acct.user), 1);
    data.subs[id].splice(data.subs[id].indexOf(this), 1);
    
    var pkt = {op: 'leave', sr: this.acct.user, ex: ex, rm: id};
    relayPkt(pkt, this, [id]);
  },
  
  // Operation handlers
  
  authOp: function (pkt, ex) {
    data.reload();
    
    var acct;
    data.accts.forEach(function (that) {
      if (that.user == ex.username && that.pass == ex.password)
        acct = that;
    });
    
    if (acct) {
      this.acct = acct;
      relayPkt(pkt, this);
      
      var me = JSON.parse(JSON.stringify(this.acct));
      delete me.pass;
      this.send({op: 'meta', sr: '@danopia.net', ex: me});
      
      var self = this;
      (acct.favs || []).forEach(function (fav) {
        if (fav.auto)
          self.joinRoom(fav.id, null, true);
      });
    } else {
      this.send({op: 'error', ex: {message: 'Authentication failed for ' + ex.username}});
    };
  },
  
  actOp: function (pkt, ex) {
    if (!this.acct || !pkt.rm || !data.findRoom(pkt.rm) || data.subs[pkt.rm].indexOf(this) == -1) return;
    
    var newPkt = {op: 'act', rm: pkt.rm, sr: this.acct.user, ex: ex};
    relayPkt(newPkt, this, [pkt.rm]);
  },
  
  joinOp: function (pkt, ex) {
    this.joinRoom(pkt.rm, ex);
  },
  
  leaveOp: function (pkt, ex) {
    if (!this.acct || !pkt.rm) return false;
    this.leaveRoom(pkt.rm, ex);
  },
  
  disconnectOp: function (pkt, ex) {
    this.disconnect();
    this.stream.end();
  }
};

socketServer.handler = function (stream, write) {
  console.log('client connected', stream.npnProtocol, stream.authorized, stream.remoteAddress);

  var client = new Client(stream, write);
  clients.push(client);
  return client.readHandler;
};

socketServer.listen();

