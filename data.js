var fs = require('fs');

exports.reload = function () {
  exports.accts = JSON.parse(fs.readFileSync('accounts.json'));
  console.log('Loaded account data');
};
exports.reload();

exports.rooms = JSON.parse(fs.readFileSync('rooms.json'));

exports.subs = {};

exports.findRoom = function (id) {
  for (var idx in exports.rooms) {
    var room = exports.rooms[idx];
    if (room.id == id) {
      if (!room.users) room.users = [];
      if (!exports.subs[room.id]) exports.subs[room.id] = [];
      
      return room;
    };
  };
  
  return null;
};

