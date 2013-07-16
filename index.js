var fs = require('fs');

var socketServer = require('./socket_server');

var accts = JSON.parse(fs.readFileSync('accounts.json'));
var rooms = JSON.parse(fs.readFileSync('rooms.json'));
var subs = {};
var clients = [];

function findRoom (id) {
  for (var idx in rooms) {
    var room = rooms[idx];
    if (room.id == id) {
      if (!room.users) room.users = [];
      if (!subs[room.id]) subs[room.id] = [];
      
      return room;
    };
  };
  
  return null;
}

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
    console.log((self.acct ? self.acct.user : 'anon'), '>>>', data);
    
    var pkt = JSON.parse(data);
    if (self[pkt.op+'Op'])
      self[pkt.op+'Op'](pkt, pkt.ex);
    else
      console.log('unhandled op', pkt.op, 'in', pkt);
  };
  
  stream.on('end', function () {
    self.disconnect();
  });
};

function relayPkt (pkt, ackTo, rooms, noRoom) {
  delete pkt.ex.isack;
  if (!pkt.ts) pkt.ts = +(new Date());
  if (!pkt.id) pkt.id = nextId();
  
  var sent = [];
  (rooms || []).forEach(function (id) {
    var room = findRoom(id);
    if (!room) return;
    
    subs[id].forEach(function (client) {
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
  send: function (pkt) {
    if (!pkt.ts) pkt.ts = +(new Date());
    if (!pkt.id) pkt.id = nextId();
    
    console.log((this.acct ? this.acct.user : 'anon'), '<<<', JSON.stringify(pkt));
    this.write(JSON.stringify(pkt));
  },
  
  sendWelcome: function () {
    this.send({op: 'welcome', ex: {server: 'danopia.net', software: '10bitd.js/0.0.1', auth: ['password']}});
  },
  
  authOp: function (pkt, ex) {
    var acct;
    accts.forEach(function (that) {
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
      (acct.rooms || []).forEach(function (fav) {
        if (fav.auto)
          self.joinRoom(fav.id);
      });
    } else {
      this.send({op: 'error'});
    };
  },
  
  actOp: function (pkt, ex) {
    if (!this.acct || !pkt.rm || !findRoom(pkt.rm) || findRoom(pkt.rm).clients.indexOf(this) == -1) return;
    
    var newPkt = {op: 'act', rm: pkt.rm, sr: this.acct.user, ex: ex ? ex : {}};
    relayPkt(newPkt, this, [pkt.rm]);
  },
  
  leaveOp: function (pkt, ex) {
    if (!this.acct) { return this.stream.end(); }
    
    if (pkt.rm) {
      this.leaveRoom(pkt.rm, ex);
    } else {
      this.disconnect();
      this.stream.end();
    }
  },
  
  disconnect: function (ex) {
    var idx = clients.indexOf(this);
    if (idx == -1) return false;
    
    console.log('disconnecting ' + (this.acct ? this.acct.user : 'anon'));
    clients.splice(idx, 1);
  },
  
  joinRoom: function (id, ex) {
    if (!this.acct || !id || !findRoom(id)) return false;
    var room = findRoom(id);
    if (subs[id].indexOf(this) >= 0) return false;
    room.users.push(this.acct.name);
    subs[id].push(this);
    
    var pkt = {op: 'join', sr: this.acct.name, ex: (ex || {})};
    relayPkt(pkt, this, [id]);
    
    this.send({op: 'meta', sr: '@danopia.net', rm: id, ex: room});
  },
  
  leaveRoom: function (id, ex) {
    if (!this.acct || !id || !findRoom(id)) return false;
    var room = findRoom(id);
    if (subs[id].indexOf(this) == -1) return false;
    room.users.splice(room.users.indexOf(this.acct.name), 1);
    subs[id].splice(subs[id].indexOf(this), 1);
    
    var pkt = {op: 'leave', sr: this.acct.name, ex: (ex || {})};
    relayPkt(pkt, this, [id]);
  },
  
  joinOp: function (pkt, ex) {
    this.joinRoom(pkt.rm, ex);
  }
};

socketServer.handler = function (stream, write) {
  console.log('client connected', stream.npnProtocol, stream.authorized, stream.remoteAddress);

  var client = new Client(stream, write);
  clients.push(client);
  return client.readHandler;
};

socketServer.listen();

