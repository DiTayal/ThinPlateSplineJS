var ThinPlateSpline = (function(){

function ThinPlateSpline(options) {
  if (!options) { options = {}; }

  this.__ord = {
    pointer : new Module._TPS(2),
    solved  : false
  };
  this.__rev = {
    pointer : new Module._TPS(2),
    solved  : false
  };
  this.isWorker = false;
  var me     = this;

  if (options.use_worker) {
    var root = '';
    var scripts = document.getElementsByTagName("script");
    var i = scripts.length;
    var min = '';
    while (i--) {
      var match = scripts[i].src.match(/(^|.*\/)thinplatespline(\.min)?\.js/);
      if (match) {
        root = match[1];
        min  = match[2];
        if (min === undefined) min = "";
        break;
      }
    }

    var worker = this.worker = new Worker(root + 'thinplatespline' + min + '.js');

    worker.onmessage = function(e) {
      var data      = e.data;
      var e_type    = data.event;

      switch (e_type){
        case 'solved':
          worker.postMessage({'method':'serialize'});
          break;
        case 'serialized':
          var serial = data.serial;
          delete(me.worker);
          worker.terminate();
          me.deserialize(serial);
          break;
        case 'echo':
          console.log(data.data);
      }
    };
  }

  if (options.transform_callback) {
    this.transform_callback = options.transform_callback;
  }

  if (options.error_callback) {
    this.error_callback = options.error_callback;
  }

  if (options.web_falback && options.transform_callback) {
    this.web_fallback = options.web_falback;
  }
}

ThinPlateSpline.prototype.destructor = function() {
  this.__ord.pointer.delete();
  this.__ord.pointer = null;
  this.__rev.pointer.delete();
  this.__rev.pointer = null;
};

ThinPlateSpline.prototype.push_points = function(points) {
  if (this.worker) {
    this.worker.postMessage({'method':'push_points','data':points});
  } else {
    for (var i=0,len=points.length;i<len;i++) {
      var point = points[i];
      this.add_point(point[0],point[1]);
    }
    this.solve();
  }
};

ThinPlateSpline.prototype.load_points = function(url) {
  var me = this;
  if (this.worker) {
    this.worker.postMessage({'method':'load_points','data':url});
  } else {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);

    xhr.onload = function(e) {
      if (this.status == 200) {
        var points = JSON.parse(this.response);
        me.push_points(points);
      } else {
        //self.postMessage({'event':'cannotLoad'});
      }
    };
    xhr.send();
  }
};

ThinPlateSpline.prototype.load_serial = function(url) {
  var me = this;
  if (this.worker) {
    this.worker.postMessage({'method':'load_serial','data':url});
  } else {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onload = function(e) {
      if (this.status == 200) {
        var serial = new Uint8Array(this.response);
        me.deserialize(serial);
      } else {
        //self.postMessage({'event':'cannotLoad'});
      }
    };
    xhr.send();
  }
};

ThinPlateSpline.prototype.add_point = function(P, D) {
  this.__add_point(this.__ord, P, D);
  this.__add_point(this.__rev, D, P);
};

ThinPlateSpline.prototype.__add_point = function(self, P, D) {
  var DPtr = _malloc(16);
  Module.setValue(DPtr,     D[0], 'double');
  Module.setValue(DPtr + 8, D[1], 'double');

  var ret = self.pointer.add_point(P[0], P[1], DPtr);

  _free(DPtr);

  self.solved = false;

  return ret;
};

ThinPlateSpline.prototype.solve = function() {
  this.__solve(this.__ord);
  this.__solve(this.__rev);
};

ThinPlateSpline.prototype.__solve = function(self) {
  self.solved = true;
  return self.pointer.solve();
};

ThinPlateSpline.prototype.transform = function(P, isRev) {
  var self = isRev ? this.__rev : this.__ord;
  var ret  = this.__get_point(self, P);
  var me   = this;

  if (me.transform_callback) {
    if (ret === 0) {
      if (me.web_fallback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', this.web_fallback + '?x=' + P[0] + '&y=' + P[1] + '&inv=' + isRev, true);

        xhr.onload = function(e) {
          if (this.status == 200) {
            var data = JSON.parse(this.response);
            me.transform_callback([data.data.x,data.data.y], isRev);
          } else if (me.error_callback) {
            me.error_callback(P, isRev);
          }
        };
        xhr.send();
      } else if (me.error_callback) {
        me.error_callback(P, isRev);
      }
    } else {
      me.transform_callback(ret, isRev);
    }
  } else {
    return ret;
  }
};

ThinPlateSpline.prototype.__get_point = function(self, P) {
  if (!self.solved) { return 0; } //this.__solve(self); }

  var DPtr = Module._malloc(16);
  var x    = P[0];
  var y    = P[1];
  var res  = self.pointer.get_point(x, y, DPtr);
  var ret  = [];
  ret[0]   = Module.getValue(DPtr,    'double');
  ret[1]   = Module.getValue(DPtr + 8,'double');

  Module._free(DPtr);

  return ret;
};

ThinPlateSpline.prototype.serialize = function() {
  var alloc_size = this.serialize_size();
  var all_size   = alloc_size[0] + alloc_size[1] + 2;
  var serial_ptr = _malloc(all_size);
  var work_ptr   = serial_ptr;

  work_ptr = this.__ord.pointer.serialize(work_ptr);
  Module.setValue(work_ptr, this.__ord.solved ? 1 : 0, 'i8');
  work_ptr++;

  work_ptr = this.__rev.pointer.serialize(work_ptr);
  Module.setValue(work_ptr, this.__rev.solved ? 1 : 0, 'i8');
  work_ptr++;

  var ret = new Uint8Array(new Uint8Array(HEAPU8.buffer, serial_ptr, all_size));

  _free(serial_ptr);

  return ret;
};

ThinPlateSpline.prototype.deserialize = function(serial) {
  var me = this;
  if (this.worker) {
    this.worker.postMessage({'method':'deserialize','data':serial});
  } else {
    var all_size   = serial.length;
    var serial_ptr = _malloc(all_size);
    var work_ptr   = serial_ptr;

    HEAPU8.set(serial, serial_ptr);

    work_ptr = this.__ord.pointer.deserialize(work_ptr);
    this.__ord.solved = Module.getValue(work_ptr, 'i8') ? true : false;
    work_ptr++;

    work_ptr = this.__rev.pointer.deserialize(work_ptr);
    this.__rev.solved = Module.getValue(work_ptr, 'i8') ? true : false;
    work_ptr++;

    _free(serial_ptr);
  }
};

ThinPlateSpline.prototype.serialize_size = function() {
  return [this.__serialize_size(this.__ord),this.__serialize_size(this.__rev)];
};

ThinPlateSpline.prototype.__serialize_size = function(self) {
  return self.pointer.serialize_size();
};
