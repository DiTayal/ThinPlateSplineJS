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
// Note: For maximum-speed code, see "Optimizing Code" on the Emscripten wiki, https://github.com/kripken/emscripten/wiki/Optimizing-Code
// Note: Some Emscripten settings may limit the speed of the generated code.
// The Module object: Our interface to the outside world. We import
// and export values on it, and do the work to get that through
// closure compiler if necessary. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to do an eval in order to handle the closure compiler
// case, where this code here is minified but Module was defined
// elsewhere (e.g. case 4 above). We also need to check if Module
// already exists (e.g. case 3 above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module;
if (!Module) Module = eval('(function() { try { return Module || {} } catch(e) { return {} } })()');
// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
for (var key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}
// The environment setup code below is customized to use Module.
// *** Environment setup code ***
var ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function';
var ENVIRONMENT_IS_WEB = typeof window === 'object';
var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
if (ENVIRONMENT_IS_NODE) {
  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  Module['print'] = function print(x) {
    process['stdout'].write(x + '\n');
  };
  Module['printErr'] = function printErr(x) {
    process['stderr'].write(x + '\n');
  };
  var nodeFS = require('fs');
  var nodePath = require('path');
  Module['read'] = function read(filename, binary) {
    filename = nodePath['normalize'](filename);
    var ret = nodeFS['readFileSync'](filename);
    // The path is absolute if the normalized version is the same as the resolved.
    if (!ret && filename != nodePath['resolve'](filename)) {
      filename = path.join(__dirname, '..', 'src', filename);
      ret = nodeFS['readFileSync'](filename);
    }
    if (ret && !binary) ret = ret.toString();
    return ret;
  };
  Module['readBinary'] = function readBinary(filename) { return Module['read'](filename, true) };
  Module['load'] = function load(f) {
    globalEval(read(f));
  };
  Module['arguments'] = process['argv'].slice(2);
  module['exports'] = Module;
}
else if (ENVIRONMENT_IS_SHELL) {
  Module['print'] = print;
  if (typeof printErr != 'undefined') Module['printErr'] = printErr; // not present in v8 or older sm
  if (typeof read != 'undefined') {
    Module['read'] = read;
  } else {
    Module['read'] = function read() { throw 'no read() available (jsc?)' };
  }
  Module['readBinary'] = function readBinary(f) {
    return read(f, 'binary');
  };
  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }
  this['Module'] = Module;
  eval("if (typeof gc === 'function' && gc.toString().indexOf('[native code]') > 0) var gc = undefined"); // wipe out the SpiderMonkey shell 'gc' function, which can confuse closure (uses it as a minified name, and it is then initted to a non-falsey value unexpectedly)
}
else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  Module['read'] = function read(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    return xhr.responseText;
  };
  if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }
  if (typeof console !== 'undefined') {
    Module['print'] = function print(x) {
      console.log(x);
    };
    Module['printErr'] = function printErr(x) {
      console.log(x);
    };
  } else {
    // Probably a worker, and without console.log. We can do very little here...
    var TRY_USE_DUMP = false;
    Module['print'] = (TRY_USE_DUMP && (typeof(dump) !== "undefined") ? (function(x) {
      dump(x);
    }) : (function(x) {
      // self.postMessage(x); // enable this if you want stdout to be sent as messages
    }));
  }
  if (ENVIRONMENT_IS_WEB) {
    this['Module'] = Module;
  } else {
    Module['load'] = importScripts;
  }
}
else {
  // Unreachable because SHELL is dependant on the others
  throw 'Unknown runtime environment. Where are we?';
}
function globalEval(x) {
  eval.call(null, x);
}
if (!Module['load'] == 'undefined' && Module['read']) {
  Module['load'] = function load(f) {
    globalEval(Module['read'](f));
  };
}
if (!Module['print']) {
  Module['print'] = function(){};
}
if (!Module['printErr']) {
  Module['printErr'] = Module['print'];
}
if (!Module['arguments']) {
  Module['arguments'] = [];
}
// *** Environment setup code ***
// Closure helpers
Module.print = Module['print'];
Module.printErr = Module['printErr'];
// Callbacks
Module['preRun'] = [];
Module['postRun'] = [];
// Merge back in the overrides
for (var key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// === Auto-generated preamble library stuff ===
//========================================
// Runtime code shared with compiler
//========================================
var Runtime = {
  stackSave: function () {
    return STACKTOP;
  },
  stackRestore: function (stackTop) {
    STACKTOP = stackTop;
  },
  forceAlign: function (target, quantum) {
    quantum = quantum || 4;
    if (quantum == 1) return target;
    if (isNumber(target) && isNumber(quantum)) {
      return Math.ceil(target/quantum)*quantum;
    } else if (isNumber(quantum) && isPowerOfTwo(quantum)) {
      return '(((' +target + ')+' + (quantum-1) + ')&' + -quantum + ')';
    }
    return 'Math.ceil((' + target + ')/' + quantum + ')*' + quantum;
  },
  isNumberType: function (type) {
    return type in Runtime.INT_TYPES || type in Runtime.FLOAT_TYPES;
  },
  isPointerType: function isPointerType(type) {
  return type[type.length-1] == '*';
},
  isStructType: function isStructType(type) {
  if (isPointerType(type)) return false;
  if (isArrayType(type)) return true;
  if (/<?{ ?[^}]* ?}>?/.test(type)) return true; // { i32, i8 } etc. - anonymous struct types
  // See comment in isStructPointerType()
  return type[0] == '%';
},
  INT_TYPES: {"i1":0,"i8":0,"i16":0,"i32":0,"i64":0},
  FLOAT_TYPES: {"float":0,"double":0},
  or64: function (x, y) {
    var l = (x | 0) | (y | 0);
    var h = (Math.round(x / 4294967296) | Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  },
  and64: function (x, y) {
    var l = (x | 0) & (y | 0);
    var h = (Math.round(x / 4294967296) & Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  },
  xor64: function (x, y) {
    var l = (x | 0) ^ (y | 0);
    var h = (Math.round(x / 4294967296) ^ Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  },
  getNativeTypeSize: function (type) {
    switch (type) {
      case 'i1': case 'i8': return 1;
      case 'i16': return 2;
      case 'i32': return 4;
      case 'i64': return 8;
      case 'float': return 4;
      case 'double': return 8;
      default: {
        if (type[type.length-1] === '*') {
          return Runtime.QUANTUM_SIZE; // A pointer
        } else if (type[0] === 'i') {
          var bits = parseInt(type.substr(1));
          assert(bits % 8 === 0);
          return bits/8;
        } else {
          return 0;
        }
      }
    }
  },
  getNativeFieldSize: function (type) {
    return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
  },
  dedup: function dedup(items, ident) {
  var seen = {};
  if (ident) {
    return items.filter(function(item) {
      if (seen[item[ident]]) return false;
      seen[item[ident]] = true;
      return true;
    });
  } else {
    return items.filter(function(item) {
      if (seen[item]) return false;
      seen[item] = true;
      return true;
    });
  }
},
  set: function set() {
  var args = typeof arguments[0] === 'object' ? arguments[0] : arguments;
  var ret = {};
  for (var i = 0; i < args.length; i++) {
    ret[args[i]] = 0;
  }
  return ret;
},
  STACK_ALIGN: 8,
  getAlignSize: function (type, size, vararg) {
    // we align i64s and doubles on 64-bit boundaries, unlike x86
    if (vararg) return 8;
    if (!vararg && (type == 'i64' || type == 'double')) return 8;
    if (!type) return Math.min(size, 8); // align structures internally to 64 bits
    return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
  },
  calculateStructAlignment: function calculateStructAlignment(type) {
    type.flatSize = 0;
    type.alignSize = 0;
    var diffs = [];
    var prev = -1;
    var index = 0;
    type.flatIndexes = type.fields.map(function(field) {
      index++;
      var size, alignSize;
      if (Runtime.isNumberType(field) || Runtime.isPointerType(field)) {
        size = Runtime.getNativeTypeSize(field); // pack char; char; in structs, also char[X]s.
        alignSize = Runtime.getAlignSize(field, size);
      } else if (Runtime.isStructType(field)) {
        if (field[1] === '0') {
          // this is [0 x something]. When inside another structure like here, it must be at the end,
          // and it adds no size
          // XXX this happens in java-nbody for example... assert(index === type.fields.length, 'zero-length in the middle!');
          size = 0;
          if (Types.types[field]) {
            alignSize = Runtime.getAlignSize(null, Types.types[field].alignSize);
          } else {
            alignSize = type.alignSize || QUANTUM_SIZE;
          }
        } else {
          size = Types.types[field].flatSize;
          alignSize = Runtime.getAlignSize(null, Types.types[field].alignSize);
        }
      } else if (field[0] == 'b') {
        // bN, large number field, like a [N x i8]
        size = field.substr(1)|0;
        alignSize = 1;
      } else if (field[0] === '<') {
        // vector type
        size = alignSize = Types.types[field].flatSize; // fully aligned
      } else if (field[0] === 'i') {
        // illegal integer field, that could not be legalized because it is an internal structure field
        // it is ok to have such fields, if we just use them as markers of field size and nothing more complex
        size = alignSize = parseInt(field.substr(1))/8;
        assert(size % 1 === 0, 'cannot handle non-byte-size field ' + field);
      } else {
        assert(false, 'invalid type for calculateStructAlignment');
      }
      if (type.packed) alignSize = 1;
      type.alignSize = Math.max(type.alignSize, alignSize);
      var curr = Runtime.alignMemory(type.flatSize, alignSize); // if necessary, place this on aligned memory
      type.flatSize = curr + size;
      if (prev >= 0) {
        diffs.push(curr-prev);
      }
      prev = curr;
      return curr;
    });
    if (type.name_ && type.name_[0] === '[') {
      // arrays have 2 elements, so we get the proper difference. then we scale here. that way we avoid
      // allocating a potentially huge array for [999999 x i8] etc.
      type.flatSize = parseInt(type.name_.substr(1))*type.flatSize/2;
    }
    type.flatSize = Runtime.alignMemory(type.flatSize, type.alignSize);
    if (diffs.length == 0) {
      type.flatFactor = type.flatSize;
    } else if (Runtime.dedup(diffs).length == 1) {
      type.flatFactor = diffs[0];
    }
    type.needsFlattening = (type.flatFactor != 1);
    return type.flatIndexes;
  },
  generateStructInfo: function (struct, typeName, offset) {
    var type, alignment;
    if (typeName) {
      offset = offset || 0;
      type = (typeof Types === 'undefined' ? Runtime.typeInfo : Types.types)[typeName];
      if (!type) return null;
      if (type.fields.length != struct.length) {
        printErr('Number of named fields must match the type for ' + typeName + ': possibly duplicate struct names. Cannot return structInfo');
        return null;
      }
      alignment = type.flatIndexes;
    } else {
      var type = { fields: struct.map(function(item) { return item[0] }) };
      alignment = Runtime.calculateStructAlignment(type);
    }
    var ret = {
      __size__: type.flatSize
    };
    if (typeName) {
      struct.forEach(function(item, i) {
        if (typeof item === 'string') {
          ret[item] = alignment[i] + offset;
        } else {
          // embedded struct
          var key;
          for (var k in item) key = k;
          ret[key] = Runtime.generateStructInfo(item[key], type.fields[i], alignment[i]);
        }
      });
    } else {
      struct.forEach(function(item, i) {
        ret[item[1]] = alignment[i];
      });
    }
    return ret;
  },
  dynCall: function (sig, ptr, args) {
    if (args && args.length) {
      return FUNCTION_TABLE[ptr].apply(null, args);
    } else {
      return FUNCTION_TABLE[ptr]();
    }
  },
  addFunction: function (func) {
    var table = FUNCTION_TABLE;
    var ret = table.length;
    assert(ret % 2 === 0);
    table.push(func);
    for (var i = 0; i < 2-1; i++) table.push(0);
    return ret;
  },
  removeFunction: function (index) {
    var table = FUNCTION_TABLE;
    table[index] = null;
  },
  getAsmConst: function (code, numArgs) {
    // code is a constant string on the heap, so we can cache these
    if (!Runtime.asmConstCache) Runtime.asmConstCache = {};
    var func = Runtime.asmConstCache[code];
    if (func) return func;
    var args = [];
    for (var i = 0; i < numArgs; i++) {
      args.push(String.fromCharCode(36) + i); // $0, $1 etc
    }
    return Runtime.asmConstCache[code] = eval('(function(' + args.join(',') + '){ ' + Pointer_stringify(code) + ' })'); // new Function does not allow upvars in node
  },
  warnOnce: function (text) {
    if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
    if (!Runtime.warnOnce.shown[text]) {
      Runtime.warnOnce.shown[text] = 1;
      Module.printErr(text);
    }
  },
  funcWrappers: {},
  getFuncWrapper: function (func, sig) {
    assert(sig);
    if (!Runtime.funcWrappers[func]) {
      Runtime.funcWrappers[func] = function dynCall_wrapper() {
        return Runtime.dynCall(sig, func, arguments);
      };
    }
    return Runtime.funcWrappers[func];
  },
  UTF8Processor: function () {
    var buffer = [];
    var needed = 0;
    this.processCChar = function (code) {
      code = code & 0xFF;
      if (buffer.length == 0) {
        if ((code & 0x80) == 0x00) {        // 0xxxxxxx
          return String.fromCharCode(code);
        }
        buffer.push(code);
        if ((code & 0xE0) == 0xC0) {        // 110xxxxx
          needed = 1;
        } else if ((code & 0xF0) == 0xE0) { // 1110xxxx
          needed = 2;
        } else {                            // 11110xxx
          needed = 3;
        }
        return '';
      }
      if (needed) {
        buffer.push(code);
        needed--;
        if (needed > 0) return '';
      }
      var c1 = buffer[0];
      var c2 = buffer[1];
      var c3 = buffer[2];
      var c4 = buffer[3];
      var ret;
      if (buffer.length == 2) {
        ret = String.fromCharCode(((c1 & 0x1F) << 6)  | (c2 & 0x3F));
      } else if (buffer.length == 3) {
        ret = String.fromCharCode(((c1 & 0x0F) << 12) | ((c2 & 0x3F) << 6)  | (c3 & 0x3F));
      } else {
        // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
        var codePoint = ((c1 & 0x07) << 18) | ((c2 & 0x3F) << 12) |
                        ((c3 & 0x3F) << 6)  | (c4 & 0x3F);
        ret = String.fromCharCode(
          Math.floor((codePoint - 0x10000) / 0x400) + 0xD800,
          (codePoint - 0x10000) % 0x400 + 0xDC00);
      }
      buffer.length = 0;
      return ret;
    }
    this.processJSString = function processJSString(string) {
      string = unescape(encodeURIComponent(string));
      var ret = [];
      for (var i = 0; i < string.length; i++) {
        ret.push(string.charCodeAt(i));
      }
      return ret;
    }
  },
  stackAlloc: function (size) { var ret = STACKTOP;STACKTOP = (STACKTOP + size)|0;STACKTOP = (((STACKTOP)+7)&-8); return ret; },
  staticAlloc: function (size) { var ret = STATICTOP;STATICTOP = (STATICTOP + size)|0;STATICTOP = (((STATICTOP)+7)&-8); return ret; },
  dynamicAlloc: function (size) { var ret = DYNAMICTOP;DYNAMICTOP = (DYNAMICTOP + size)|0;DYNAMICTOP = (((DYNAMICTOP)+7)&-8); if (DYNAMICTOP >= TOTAL_MEMORY) enlargeMemory();; return ret; },
  alignMemory: function (size,quantum) { var ret = size = Math.ceil((size)/(quantum ? quantum : 8))*(quantum ? quantum : 8); return ret; },
  makeBigInt: function (low,high,unsigned) { var ret = (unsigned ? ((low>>>0)+((high>>>0)*4294967296)) : ((low>>>0)+((high|0)*4294967296))); return ret; },
  GLOBAL_BASE: 8,
  QUANTUM_SIZE: 4,
  __dummy__: 0
}
//========================================
// Runtime essentials
//========================================
var __THREW__ = 0; // Used in checking for thrown exceptions.
var setjmpId = 1; // Used in setjmp/longjmp
var setjmpLabels = {};
var ABORT = false; // whether we are quitting the application. no code should run after this. set in exit() and abort()
var EXITSTATUS = 0;
var undef = 0;
// tempInt is used for 32-bit signed values or smaller. tempBigInt is used
// for 32-bit unsigned values or more than 32 bits. TODO: audit all uses of tempInt
var tempValue, tempInt, tempBigInt, tempInt2, tempBigInt2, tempPair, tempBigIntI, tempBigIntR, tempBigIntS, tempBigIntP, tempBigIntD, tempDouble, tempFloat;
var tempI64, tempI64b;
var tempRet0, tempRet1, tempRet2, tempRet3, tempRet4, tempRet5, tempRet6, tempRet7, tempRet8, tempRet9;
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}
var globalScope = this;
// C calling interface. A convenient way to call C functions (in C files, or
// defined with extern "C").
//
// Note: LLVM optimizations can inline and remove functions, after which you will not be
//       able to call them. Closure can also do so. To avoid that, add your function to
//       the exports using something like
//
//         -s EXPORTED_FUNCTIONS='["_main", "_myfunc"]'
//
// @param ident      The name of the C function (note that C++ functions will be name-mangled - use extern "C")
// @param returnType The return type of the function, one of the JS types 'number', 'string' or 'array' (use 'number' for any C pointer, and
//                   'array' for JavaScript arrays and typed arrays; note that arrays are 8-bit).
// @param argTypes   An array of the types of arguments for the function (if there are no arguments, this can be ommitted). Types are as in returnType,
//                   except that 'array' is not possible (there is no way for us to know the length of the array)
// @param args       An array of the arguments to the function, as native JS values (as in returnType)
//                   Note that string arguments will be stored on the stack (the JS string will become a C string on the stack).
// @return           The return value, as a native JS value (as in returnType)
function ccall(ident, returnType, argTypes, args) {
  return ccallFunc(getCFunc(ident), returnType, argTypes, args);
}
Module["ccall"] = ccall;
// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  try {
    var func = Module['_' + ident]; // closure exported function
    if (!func) func = eval('_' + ident); // explicit lookup
  } catch(e) {
  }
  assert(func, 'Cannot call unknown function ' + ident + ' (perhaps LLVM optimizations or closure removed it?)');
  return func;
}
// Internal function that does a C call using a function, not an identifier
function ccallFunc(func, returnType, argTypes, args) {
  var stack = 0;
  function toC(value, type) {
    if (type == 'string') {
      if (value === null || value === undefined || value === 0) return 0; // null string
      value = intArrayFromString(value);
      type = 'array';
    }
    if (type == 'array') {
      if (!stack) stack = Runtime.stackSave();
      var ret = Runtime.stackAlloc(value.length);
      writeArrayToMemory(value, ret);
      return ret;
    }
    return value;
  }
  function fromC(value, type) {
    if (type == 'string') {
      return Pointer_stringify(value);
    }
    assert(type != 'array');
    return value;
  }
  var i = 0;
  var cArgs = args ? args.map(function(arg) {
    return toC(arg, argTypes[i++]);
  }) : [];
  var ret = fromC(func.apply(null, cArgs), returnType);
  if (stack) Runtime.stackRestore(stack);
  return ret;
}
// Returns a native JS wrapper for a C function. This is similar to ccall, but
// returns a function you can call repeatedly in a normal way. For example:
//
//   var my_function = cwrap('my_c_function', 'number', ['number', 'number']);
//   alert(my_function(5, 22));
//   alert(my_function(99, 12));
//
function cwrap(ident, returnType, argTypes) {
  var func = getCFunc(ident);
  return function() {
    return ccallFunc(func, returnType, argTypes, Array.prototype.slice.call(arguments));
  }
}
Module["cwrap"] = cwrap;
// Sets a value in memory in a dynamic way at run-time. Uses the
// type data. This is the same as makeSetValue, except that
// makeSetValue is done at compile-time and generates the needed
// code then, whereas this function picks the right code at
// run-time.
// Note that setValue and getValue only do *aligned* writes and reads!
// Note that ccall uses JS types as for defining types, while setValue and
// getValue need LLVM types ('i8', 'i32') - this is a lower-level operation
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[(ptr)]=value; break;
      case 'i8': HEAP8[(ptr)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,Math_abs(tempDouble) >= 1 ? (tempDouble > 0 ? Math_min(Math_floor((tempDouble)/4294967296), 4294967295)>>>0 : (~~(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296)))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}
Module['setValue'] = setValue;
// Parallel to setValue.
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[(ptr)];
      case 'i8': return HEAP8[(ptr)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for setValue: ' + type);
    }
  return null;
}
Module['getValue'] = getValue;
var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_STATIC = 2; // Cannot be freed
var ALLOC_DYNAMIC = 3; // Cannot be freed except through sbrk
var ALLOC_NONE = 4; // Do not allocate
Module['ALLOC_NORMAL'] = ALLOC_NORMAL;
Module['ALLOC_STACK'] = ALLOC_STACK;
Module['ALLOC_STATIC'] = ALLOC_STATIC;
Module['ALLOC_DYNAMIC'] = ALLOC_DYNAMIC;
Module['ALLOC_NONE'] = ALLOC_NONE;
// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }
  var singleType = typeof types === 'string' ? types : null;
  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
  }
  if (zeroinit) {
    var ptr = ret, stop;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)|0)]=0;
    }
    return ret;
  }
  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(slab, ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }
  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];
    if (typeof curr === 'function') {
      curr = Runtime.getFunctionIndex(curr);
    }
    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later
    setValue(ret+i, curr, type);
    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = Runtime.getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }
  return ret;
}
Module['allocate'] = allocate;
function Pointer_stringify(ptr, /* optional */ length) {
  // TODO: use TextDecoder
  // Find the length, and check for UTF while doing so
  var hasUtf = false;
  var t;
  var i = 0;
  while (1) {
    t = HEAPU8[(((ptr)+(i))|0)];
    if (t >= 128) hasUtf = true;
    else if (t == 0 && !length) break;
    i++;
    if (length && i == length) break;
  }
  if (!length) length = i;
  var ret = '';
  if (!hasUtf) {
    var MAX_CHUNK = 1024; // split up into chunks, because .apply on a huge string can overflow the stack
    var curr;
    while (length > 0) {
      curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
      ret = ret ? ret + curr : curr;
      ptr += MAX_CHUNK;
      length -= MAX_CHUNK;
    }
    return ret;
  }
  var utf8 = new Runtime.UTF8Processor();
  for (i = 0; i < length; i++) {
    t = HEAPU8[(((ptr)+(i))|0)];
    ret += utf8.processCChar(t);
  }
  return ret;
}
Module['Pointer_stringify'] = Pointer_stringify;
// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.
function UTF16ToString(ptr) {
  var i = 0;
  var str = '';
  while (1) {
    var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
    if (codeUnit == 0)
      return str;
    ++i;
    // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
    str += String.fromCharCode(codeUnit);
  }
}
Module['UTF16ToString'] = UTF16ToString;
// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16LE form. The copy will require at most (str.length*2+1)*2 bytes of space in the HEAP.
function stringToUTF16(str, outPtr) {
  for(var i = 0; i < str.length; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[(((outPtr)+(i*2))>>1)]=codeUnit;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[(((outPtr)+(str.length*2))>>1)]=0;
}
Module['stringToUTF16'] = stringToUTF16;
// Given a pointer 'ptr' to a null-terminated UTF32LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.
function UTF32ToString(ptr) {
  var i = 0;
  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}
Module['UTF32ToString'] = UTF32ToString;
// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32LE form. The copy will require at most (str.length+1)*4 bytes of space in the HEAP,
// but can use less, since str.length does not return the number of characters in the string, but the number of UTF-16 code units in the string.
function stringToUTF32(str, outPtr) {
  var iChar = 0;
  for(var iCodeUnit = 0; iCodeUnit < str.length; ++iCodeUnit) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    var codeUnit = str.charCodeAt(iCodeUnit); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++iCodeUnit);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[(((outPtr)+(iChar*4))>>2)]=codeUnit;
    ++iChar;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[(((outPtr)+(iChar*4))>>2)]=0;
}
Module['stringToUTF32'] = stringToUTF32;
function demangle(func) {
  try {
    // Special-case the entry point, since its name differs from other name mangling.
    if (func == 'Object._main' || func == '_main') {
      return 'main()';
    }
    if (typeof func === 'number') func = Pointer_stringify(func);
    if (func[0] !== '_') return func;
    if (func[1] !== '_') return func; // C function
    if (func[2] !== 'Z') return func;
    switch (func[3]) {
      case 'n': return 'operator new()';
      case 'd': return 'operator delete()';
    }
    var i = 3;
    // params, etc.
    var basicTypes = {
      'v': 'void',
      'b': 'bool',
      'c': 'char',
      's': 'short',
      'i': 'int',
      'l': 'long',
      'f': 'float',
      'd': 'double',
      'w': 'wchar_t',
      'a': 'signed char',
      'h': 'unsigned char',
      't': 'unsigned short',
      'j': 'unsigned int',
      'm': 'unsigned long',
      'x': 'long long',
      'y': 'unsigned long long',
      'z': '...'
    };
    function dump(x) {
      //return;
      if (x) Module.print(x);
      Module.print(func);
      var pre = '';
      for (var a = 0; a < i; a++) pre += ' ';
      Module.print (pre + '^');
    }
    var subs = [];
    function parseNested() {
      i++;
      if (func[i] === 'K') i++; // ignore const
      var parts = [];
      while (func[i] !== 'E') {
        if (func[i] === 'S') { // substitution
          i++;
          var next = func.indexOf('_', i);
          var num = func.substring(i, next) || 0;
          parts.push(subs[num] || '?');
          i = next+1;
          continue;
        }
        if (func[i] === 'C') { // constructor
          parts.push(parts[parts.length-1]);
          i += 2;
          continue;
        }
        var size = parseInt(func.substr(i));
        var pre = size.toString().length;
        if (!size || !pre) { i--; break; } // counter i++ below us
        var curr = func.substr(i + pre, size);
        parts.push(curr);
        subs.push(curr);
        i += pre + size;
      }
      i++; // skip E
      return parts;
    }
    var first = true;
    function parse(rawList, limit, allowVoid) { // main parser
      limit = limit || Infinity;
      var ret = '', list = [];
      function flushList() {
        return '(' + list.join(', ') + ')';
      }
      var name;
      if (func[i] === 'N') {
        // namespaced N-E
        name = parseNested().join('::');
        limit--;
        if (limit === 0) return rawList ? [name] : name;
      } else {
        // not namespaced
        if (func[i] === 'K' || (first && func[i] === 'L')) i++; // ignore const and first 'L'
        var size = parseInt(func.substr(i));
        if (size) {
          var pre = size.toString().length;
          name = func.substr(i + pre, size);
          i += pre + size;
        }
      }
      first = false;
      if (func[i] === 'I') {
        i++;
        var iList = parse(true);
        var iRet = parse(true, 1, true);
        ret += iRet[0] + ' ' + name + '<' + iList.join(', ') + '>';
      } else {
        ret = name;
      }
      paramLoop: while (i < func.length && limit-- > 0) {
        //dump('paramLoop');
        var c = func[i++];
        if (c in basicTypes) {
          list.push(basicTypes[c]);
        } else {
          switch (c) {
            case 'P': list.push(parse(true, 1, true)[0] + '*'); break; // pointer
            case 'R': list.push(parse(true, 1, true)[0] + '&'); break; // reference
            case 'L': { // literal
              i++; // skip basic type
              var end = func.indexOf('E', i);
              var size = end - i;
              list.push(func.substr(i, size));
              i += size + 2; // size + 'EE'
              break;
            }
            case 'A': { // array
              var size = parseInt(func.substr(i));
              i += size.toString().length;
              if (func[i] !== '_') throw '?';
              i++; // skip _
              list.push(parse(true, 1, true)[0] + ' [' + size + ']');
              break;
            }
            case 'E': break paramLoop;
            default: ret += '?' + c; break paramLoop;
          }
        }
      }
      if (!allowVoid && list.length === 1 && list[0] === 'void') list = []; // avoid (void)
      return rawList ? list : ret + flushList();
    }
    return parse();
  } catch(e) {
    return func;
  }
}
function demangleAll(text) {
  return text.replace(/__Z[\w\d_]+/g, function(x) { var y = demangle(x); return x === y ? x : (x + ' [' + y + ']') });
}
function stackTrace() {
  var stack = new Error().stack;
  return stack ? demangleAll(stack) : '(no stack trace available)'; // Stack trace is not available at least on IE10 and Safari 6.
}
// Memory management
var PAGE_SIZE = 4096;
function alignMemoryPage(x) {
  return (x+4095)&-4096;
}
var HEAP;
var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
var STATIC_BASE = 0, STATICTOP = 0, staticSealed = false; // static area
var STACK_BASE = 0, STACKTOP = 0, STACK_MAX = 0; // stack area
var DYNAMIC_BASE = 0, DYNAMICTOP = 0; // dynamic area handled by sbrk
function enlargeMemory() {
  abort('Cannot enlarge memory arrays. Either (1) compile with -s TOTAL_MEMORY=X with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with ALLOW_MEMORY_GROWTH which adjusts the size at runtime but prevents some optimizations, or (3) set Module.TOTAL_MEMORY before the program runs.');
}
var TOTAL_STACK = Module['TOTAL_STACK'] || 5242880;
var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
var FAST_MEMORY = Module['FAST_MEMORY'] || 2097152;
// Initialize the runtime's memory
// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && !!(new Int32Array(1)['subarray']) && !!(new Int32Array(1)['set']),
       'Cannot fallback to non-typed array case: Code is too specialized');
var buffer = new ArrayBuffer(TOTAL_MEMORY);
HEAP8 = new Int8Array(buffer);
HEAP16 = new Int16Array(buffer);
HEAP32 = new Int32Array(buffer);
HEAPU8 = new Uint8Array(buffer);
HEAPU16 = new Uint16Array(buffer);
HEAPU32 = new Uint32Array(buffer);
HEAPF32 = new Float32Array(buffer);
HEAPF64 = new Float64Array(buffer);
// Endianness check (note: assumes compiler arch was little-endian)
HEAP32[0] = 255;
assert(HEAPU8[0] === 255 && HEAPU8[3] === 0, 'Typed arrays 2 must be run on a little-endian system');
Module['HEAP'] = HEAP;
Module['HEAP8'] = HEAP8;
Module['HEAP16'] = HEAP16;
Module['HEAP32'] = HEAP32;
Module['HEAPU8'] = HEAPU8;
Module['HEAPU16'] = HEAPU16;
Module['HEAPU32'] = HEAPU32;
Module['HEAPF32'] = HEAPF32;
Module['HEAPF64'] = HEAPF64;
function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Runtime.dynCall('v', func);
      } else {
        Runtime.dynCall('vi', func, [callback.arg]);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}
var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the runtime has exited
var runtimeInitialized = false;
function preRun() {
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}
function ensureInitRuntime() {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  callRuntimeCallbacks(__ATINIT__);
}
function preMain() {
  callRuntimeCallbacks(__ATMAIN__);
}
function exitRuntime() {
  callRuntimeCallbacks(__ATEXIT__);
}
function postRun() {
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}
function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}
Module['addOnPreRun'] = Module.addOnPreRun = addOnPreRun;
function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}
Module['addOnInit'] = Module.addOnInit = addOnInit;
function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}
Module['addOnPreMain'] = Module.addOnPreMain = addOnPreMain;
function addOnExit(cb) {
  __ATEXIT__.unshift(cb);
}
Module['addOnExit'] = Module.addOnExit = addOnExit;
function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}
Module['addOnPostRun'] = Module.addOnPostRun = addOnPostRun;
// Tools
// This processes a JS string into a C-line array of numbers, 0-terminated.
// For LLVM-originating strings, see parser.js:parseLLVMString function
function intArrayFromString(stringy, dontAddNull, length /* optional */) {
  var ret = (new Runtime.UTF8Processor()).processJSString(stringy);
  if (length) {
    ret.length = length;
  }
  if (!dontAddNull) {
    ret.push(0);
  }
  return ret;
}
Module['intArrayFromString'] = intArrayFromString;
function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}
Module['intArrayToString'] = intArrayToString;
// Write a Javascript array to somewhere in the heap
function writeStringToMemory(string, buffer, dontAddNull) {
  var array = intArrayFromString(string, dontAddNull);
  var i = 0;
  while (i < array.length) {
    var chr = array[i];
    HEAP8[(((buffer)+(i))|0)]=chr;
    i = i + 1;
  }
}
Module['writeStringToMemory'] = writeStringToMemory;
function writeArrayToMemory(array, buffer) {
  for (var i = 0; i < array.length; i++) {
    HEAP8[(((buffer)+(i))|0)]=array[i];
  }
}
Module['writeArrayToMemory'] = writeArrayToMemory;
function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; i++) {
    HEAP8[(((buffer)+(i))|0)]=str.charCodeAt(i);
  }
  if (!dontAddNull) HEAP8[(((buffer)+(str.length))|0)]=0;
}
Module['writeAsciiToMemory'] = writeAsciiToMemory;
function unSign(value, bits, ignore, sig) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore, sig) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}
// check for imul support, and also for correctness ( https://bugs.webkit.org/show_bug.cgi?id=126345 )
if (!Math['imul'] || Math['imul'](0xffffffff, 5) !== -5) Math['imul'] = function imul(a, b) {
  var ah  = a >>> 16;
  var al = a & 0xffff;
  var bh  = b >>> 16;
  var bl = b & 0xffff;
  return (al*bl + ((ah*bl + al*bh) << 16))|0;
};
Math.imul = Math['imul'];
var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_min = Math.min;
// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// PRE_RUN_ADDITIONS (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
function addRunDependency(id) {
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
}
Module['addRunDependency'] = addRunDependency;
function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}
Module['removeRunDependency'] = removeRunDependency;
Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data
var memoryInitializer = null;
// === Body ===
STATIC_BASE = 8;
STATICTOP = STATIC_BASE + 2280;
var _stderr;
var _stderr=_stderr=allocate([0,0,0,0,0,0,0,0], "i8", ALLOC_STATIC);
/* global initializers */ __ATINIT__.push({ func: function() { runPostSets() } },{ func: function() { __GLOBAL__I_a() } },{ func: function() { __GLOBAL__I_a23() } });
var __ZTVN10__cxxabiv120__si_class_type_infoE;
__ZTVN10__cxxabiv120__si_class_type_infoE=allocate([0,0,0,0,144,6,0,0,34,0,0,0,68,0,0,0,48,0,0,0,70,0,0,0,60,0,0,0,8,0,0,0,26,0,0,0,74,0,0,0,0,0,0,0,0,0,0,0], "i8", ALLOC_STATIC);
var __ZTVN10__cxxabiv119__pointer_type_infoE;
__ZTVN10__cxxabiv119__pointer_type_infoE=allocate([0,0,0,0,160,6,0,0,34,0,0,0,50,0,0,0,48,0,0,0,70,0,0,0,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], "i8", ALLOC_STATIC);
var __ZTVN10__cxxabiv117__class_type_infoE;
__ZTVN10__cxxabiv117__class_type_infoE=allocate([0,0,0,0,192,6,0,0,34,0,0,0,20,0,0,0,48,0,0,0,70,0,0,0,60,0,0,0,40,0,0,0,42,0,0,0,64,0,0,0,0,0,0,0,0,0,0,0], "i8", ALLOC_STATIC);
var __ZTIt;
__ZTIt=allocate([96,2,0,0,184,2,0,0], "i8", ALLOC_STATIC);
var __ZTIs;
__ZTIs=allocate([96,2,0,0,192,2,0,0], "i8", ALLOC_STATIC);
var __ZTIm;
__ZTIm=allocate([96,2,0,0,200,2,0,0], "i8", ALLOC_STATIC);
var __ZTIl;
__ZTIl=allocate([96,2,0,0,208,2,0,0], "i8", ALLOC_STATIC);
var __ZTIj;
__ZTIj=allocate([96,2,0,0,216,2,0,0], "i8", ALLOC_STATIC);
var __ZTIi;
__ZTIi=allocate([96,2,0,0,224,2,0,0], "i8", ALLOC_STATIC);
var __ZTIh;
__ZTIh=allocate([96,2,0,0,232,2,0,0], "i8", ALLOC_STATIC);
var __ZTIf;
__ZTIf=allocate([96,2,0,0,240,2,0,0], "i8", ALLOC_STATIC);
var __ZTId;
__ZTId=allocate([96,2,0,0,248,2,0,0], "i8", ALLOC_STATIC);
var __ZTIc;
__ZTIc=allocate([96,2,0,0,0,3,0,0], "i8", ALLOC_STATIC);
var __ZTIa;
__ZTIa=allocate([96,2,0,0,16,3,0,0], "i8", ALLOC_STATIC);
/* memory initializer */ allocate([108,111,110,103,0,0,0,0,115,111,108,118,101,0,0,0,117,110,115,105,103,110,101,100,32,105,110,116,0,0,0,0,97,100,100,95,112,111,105,110,116,0,0,0,0,0,0,0,105,110,116,0,0,0,0,0,95,84,80,83,0,0,0,0,117,110,115,105,103,110,101,100,32,115,104,111,114,116,0,0,115,104,111,114,116,0,0,0,32,65,32,112,111,105,110,116,32,119,97,115,32,100,101,108,101,116,101,100,32,97,102,116,101,114,32,116,104,101,32,108,97,115,116,32,115,111,108,118,101,10,0,0,0,0,0,0,117,110,115,105,103,110,101,100,32,99,104,97,114,0,0,0,32,78,79,32,105,110,116,101,114,112,111,108,97,116,105,111,110,32,45,32,114,101,116,117,114,110,32,118,97,108,117,101,115,32,97,114,101,32,122,101,114,111,10,0,0,0,0,0,115,105,103,110,101,100,32,99,104,97,114,0,0,0,0,0,115,116,100,58,58,98,97,100,95,97,108,108,111,99,0,0,32,65,32,112,111,105,110,116,32,119,97,115,32,97,100,100,101,100,32,97,102,116,101,114,32,116,104,101,32,108,97,115,116,32,115,111,108,118,101,10,0,0,0,0,0,0,0,0,99,104,97,114,0,0,0,0,118,111,105,100,0,0,0,0,101,109,115,99,114,105,112,116,101,110,58,58,109,101,109,111,114,121,95,118,105,101,119,0,98,111,111,108,0,0,0,0,101,109,115,99,114,105,112,116,101,110,58,58,118,97,108,0,47,85,115,101,114,115,47,107,111,107,111,103,105,107,111,47,101,109,115,99,114,105,112,116,101,110,47,115,121,115,116,101,109,47,105,110,99,108,117,100,101,47,101,109,115,99,114,105,112,116,101,110,47,98,105,110,100,46,104,0,0,0,0,0,115,116,100,58,58,119,115,116,114,105,110,103,0,0,0,0,112,116,114,0,0,0,0,0,115,116,100,58,58,115,116,114,105,110,103,0,0,0,0,0,100,101,115,101,114,105,97,108,105,122,101,0,0,0,0,0,100,111,117,98,108,101,0,0,115,101,114,105,97,108,105,122,101,0,0,0,0,0,0,0,102,108,111,97,116,0,0,0,115,101,114,105,97,108,105,122,101,95,115,105,122,101,0,0,117,110,115,105,103,110,101,100,32,108,111,110,103,0,0,0,103,101,116,95,112,111,105,110,116,0,0,0,0,0,0,0,103,101,116,65,99,116,117,97,108,84,121,112,101,0,0,0,0,0,0,0,200,5,0,0,38,0,0,0,14,0,0,0,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,112,6,0,0,34,0,0,0,72,0,0,0,48,0,0,0,70,0,0,0,28,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,128,6,0,0,34,0,0,0,56,0,0,0,48,0,0,0,70,0,0,0,60,0,0,0,36,0,0,0,46,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,118,0,0,0,0,0,0,0,116,0,0,0,0,0,0,0,115,0,0,0,0,0,0,0,109,0,0,0,0,0,0,0,108,0,0,0,0,0,0,0,106,0,0,0,0,0,0,0,105,0,0,0,0,0,0,0,104,0,0,0,0,0,0,0,102,0,0,0,0,0,0,0,100,0,0,0,0,0,0,0,99,0,0,0,0,0,0,0,98,0,0,0,0,0,0,0,97,0,0,0,0,0,0,0,83,116,57,116,121,112,101,95,105,110,102,111,0,0,0,0,83,116,57,101,120,99,101,112,116,105,111,110,0,0,0,0,83,116,57,98,97,100,95,97,108,108,111,99,0,0,0,0,80,100,0,0,0,0,0,0,80,99,0,0,0,0,0,0,80,75,100,0,0,0,0,0,80,75,49,55,86,105,122,71,101,111,114,101,102,83,112,108,105,110,101,50,68,0,0,0,80,49,55,86,105,122,71,101,111,114,101,102,83,112,108,105,110,101,50,68,0,0,0,0,78,83,116,51,95,95,49,50,49,95,95,98,97,115,105,99,95,115,116,114,105,110,103,95,99,111,109,109,111,110,73,76,98,49,69,69,69,0,0,0,78,83,116,51,95,95,49,49,50,98,97,115,105,99,95,115,116,114,105,110,103,73,119,78,83,95,49,49,99,104,97,114,95,116,114,97,105,116,115,73,119,69,69,78,83,95,57,97,108,108,111,99,97,116,111,114,73,119,69,69,69,69,0,0,78,83,116,51,95,95,49,49,50,98,97,115,105,99,95,115,116,114,105,110,103,73,99,78,83,95,49,49,99,104,97,114,95,116,114,97,105,116,115,73,99,69,69,78,83,95,57,97,108,108,111,99,97,116,111,114,73,99,69,69,69,69,0,0,78,49,48,101,109,115,99,114,105,112,116,101,110,51,118,97,108,69,0,0,0,0,0,0,78,49,48,101,109,115,99,114,105,112,116,101,110,49,49,109,101,109,111,114,121,95,118,105,101,119,69,0,0,0,0,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,51,95,95,102,117,110,100,97,109,101,110,116,97,108,95,116,121,112,101,95,105,110,102,111,69,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,49,95,95,118,109,105,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,0,0,78,49,48,95,95,99,120,120,97,98,105,118,49,50,48,95,95,115,105,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,0,0,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,57,95,95,112,111,105,110,116,101,114,95,116,121,112,101,95,105,110,102,111,69,0,0,0,0,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,55,95,95,112,98,97,115,101,95,116,121,112,101,95,105,110,102,111,69,0,0,0,0,0,0,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,55,95,95,99,108,97,115,115,95,116,121,112,101,95,105,110,102,111,69,0,0,0,0,0,0,0,78,49,48,95,95,99,120,120,97,98,105,118,49,49,54,95,95,115,104,105,109,95,116,121,112,101,95,105,110,102,111,69,0,0,0,0,0,0,0,0,68,110,0,0,0,0,0,0,49,55,86,105,122,71,101,111,114,101,102,83,112,108,105,110,101,50,68,0,0,0,0,0,96,2,0,0,176,2,0,0,96,2,0,0,8,3,0,0,0,0,0,0,24,3,0,0,0,0,0,0,40,3,0,0,0,0,0,0,56,3,0,0,192,5,0,0,0,0,0,0,0,0,0,0,72,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,88,3,0,0,1,0,0,0,0,0,0,0,0,0,0,0,96,3,0,0,1,0,0,0,232,6,0,0,0,0,0,0,120,3,0,0,0,0,0,0,232,6,0,0,0,0,0,0,144,3,0,0,136,2,0,0,184,3,0,0,0,0,0,0,1,0,0,0,40,6,0,0,0,0,0,0,136,2,0,0,248,3,0,0,0,0,0,0,1,0,0,0,40,6,0,0,0,0,0,0,0,0,0,0,56,4,0,0,0,0,0,0,80,4,0,0,0,0,0,0,112,4,0,0,208,6,0,0,0,0,0,0,0,0,0,0,152,4,0,0,192,6,0,0,0,0,0,0,0,0,0,0,192,4,0,0,192,6,0,0,0,0,0,0,0,0,0,0,232,4,0,0,176,6,0,0,0,0,0,0,0,0,0,0,16,5,0,0,208,6,0,0,0,0,0,0,0,0,0,0,56,5,0,0,208,6,0,0,0,0,0,0,0,0,0,0,96,5,0,0,184,5,0,0,0,0,0,0,96,2,0,0,136,5,0,0,0,0,0,0,144,5,0,0], "i8", ALLOC_NONE, Runtime.GLOBAL_BASE)
function runPostSets() {
HEAP32[((1464 )>>2)]=(((__ZTVN10__cxxabiv117__class_type_infoE+8)|0));
HEAP32[((1472 )>>2)]=(((__ZTVN10__cxxabiv117__class_type_infoE+8)|0));
HEAP32[((1480 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1496 )>>2)]=(((__ZTVN10__cxxabiv119__pointer_type_infoE+8)|0));
HEAP32[((1508 )>>2)]=__ZTId;
HEAP32[((1512 )>>2)]=(((__ZTVN10__cxxabiv119__pointer_type_infoE+8)|0));
HEAP32[((1524 )>>2)]=__ZTIc;
HEAP32[((1528 )>>2)]=(((__ZTVN10__cxxabiv119__pointer_type_infoE+8)|0));
HEAP32[((1540 )>>2)]=__ZTId;
HEAP32[((1544 )>>2)]=(((__ZTVN10__cxxabiv119__pointer_type_infoE+8)|0));
HEAP32[((1560 )>>2)]=(((__ZTVN10__cxxabiv119__pointer_type_infoE+8)|0));
HEAP32[((1576 )>>2)]=(((__ZTVN10__cxxabiv117__class_type_infoE+8)|0));
HEAP32[((1632 )>>2)]=(((__ZTVN10__cxxabiv117__class_type_infoE+8)|0));
HEAP32[((1640 )>>2)]=(((__ZTVN10__cxxabiv117__class_type_infoE+8)|0));
HEAP32[((1648 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1664 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1680 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1696 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1712 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1728 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1744 )>>2)]=(((__ZTVN10__cxxabiv120__si_class_type_infoE+8)|0));
HEAP32[((1768 )>>2)]=(((__ZTVN10__cxxabiv117__class_type_infoE+8)|0));
}
var tempDoublePtr = Runtime.alignMemory(allocate(12, "i8", ALLOC_STATIC), 8);
assert(tempDoublePtr % 8 == 0);
function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}
function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}
  var _fabs=Math_abs;
  var _sqrt=Math_sqrt;
  var _log=Math_log;
  function _memcpy(dest, src, num) {
      dest = dest|0; src = src|0; num = num|0;
      var ret = 0;
      ret = dest|0;
      if ((dest&3) == (src&3)) {
        while (dest & 3) {
          if ((num|0) == 0) return ret|0;
          HEAP8[(dest)]=HEAP8[(src)];
          dest = (dest+1)|0;
          src = (src+1)|0;
          num = (num-1)|0;
        }
        while ((num|0) >= 4) {
          HEAP32[((dest)>>2)]=HEAP32[((src)>>2)];
          dest = (dest+4)|0;
          src = (src+4)|0;
          num = (num-4)|0;
        }
      }
      while ((num|0) > 0) {
        HEAP8[(dest)]=HEAP8[(src)];
        dest = (dest+1)|0;
        src = (src+1)|0;
        num = (num-1)|0;
      }
      return ret|0;
    }var _llvm_memcpy_p0i8_p0i8_i32=_memcpy;
  function _llvm_umul_with_overflow_i32(x, y) {
      x = x>>>0;
      y = y>>>0;
      return tempRet0 = x*y > 4294967295,(x*y)>>>0;
    }
;
;
;
  function ___assert_fail(condition, filename, line, func) {
      ABORT = true;
      throw 'Assertion failed: ' + Pointer_stringify(condition) + ', at: ' + [filename ? Pointer_stringify(filename) : 'unknown filename', line, func ? Pointer_stringify(func) : 'unknown function'] + ' at ' + stackTrace();
    }
  function _memset(ptr, value, num) {
      ptr = ptr|0; value = value|0; num = num|0;
      var stop = 0, value4 = 0, stop4 = 0, unaligned = 0;
      stop = (ptr + num)|0;
      if ((num|0) >= 20) {
        // This is unaligned, but quite large, so work hard to get to aligned settings
        value = value & 0xff;
        unaligned = ptr & 3;
        value4 = value | (value << 8) | (value << 16) | (value << 24);
        stop4 = stop & ~3;
        if (unaligned) {
          unaligned = (ptr + 4 - unaligned)|0;
          while ((ptr|0) < (unaligned|0)) { // no need to check for stop, since we have large num
            HEAP8[(ptr)]=value;
            ptr = (ptr+1)|0;
          }
        }
        while ((ptr|0) < (stop4|0)) {
          HEAP32[((ptr)>>2)]=value4;
          ptr = (ptr+4)|0;
        }
      }
      while ((ptr|0) < (stop|0)) {
        HEAP8[(ptr)]=value;
        ptr = (ptr+1)|0;
      }
      return (ptr-num)|0;
    }var _llvm_memset_p0i8_i64=_memset;
  var ERRNO_CODES={EPERM:1,ENOENT:2,ESRCH:3,EINTR:4,EIO:5,ENXIO:6,E2BIG:7,ENOEXEC:8,EBADF:9,ECHILD:10,EAGAIN:11,EWOULDBLOCK:11,ENOMEM:12,EACCES:13,EFAULT:14,ENOTBLK:15,EBUSY:16,EEXIST:17,EXDEV:18,ENODEV:19,ENOTDIR:20,EISDIR:21,EINVAL:22,ENFILE:23,EMFILE:24,ENOTTY:25,ETXTBSY:26,EFBIG:27,ENOSPC:28,ESPIPE:29,EROFS:30,EMLINK:31,EPIPE:32,EDOM:33,ERANGE:34,ENOMSG:42,EIDRM:43,ECHRNG:44,EL2NSYNC:45,EL3HLT:46,EL3RST:47,ELNRNG:48,EUNATCH:49,ENOCSI:50,EL2HLT:51,EDEADLK:35,ENOLCK:37,EBADE:52,EBADR:53,EXFULL:54,ENOANO:55,EBADRQC:56,EBADSLT:57,EDEADLOCK:35,EBFONT:59,ENOSTR:60,ENODATA:61,ETIME:62,ENOSR:63,ENONET:64,ENOPKG:65,EREMOTE:66,ENOLINK:67,EADV:68,ESRMNT:69,ECOMM:70,EPROTO:71,EMULTIHOP:72,EDOTDOT:73,EBADMSG:74,ENOTUNIQ:76,EBADFD:77,EREMCHG:78,ELIBACC:79,ELIBBAD:80,ELIBSCN:81,ELIBMAX:82,ELIBEXEC:83,ENOSYS:38,ENOTEMPTY:39,ENAMETOOLONG:36,ELOOP:40,EOPNOTSUPP:95,EPFNOSUPPORT:96,ECONNRESET:104,ENOBUFS:105,EAFNOSUPPORT:97,EPROTOTYPE:91,ENOTSOCK:88,ENOPROTOOPT:92,ESHUTDOWN:108,ECONNREFUSED:111,EADDRINUSE:98,ECONNABORTED:103,ENETUNREACH:101,ENETDOWN:100,ETIMEDOUT:110,EHOSTDOWN:112,EHOSTUNREACH:113,EINPROGRESS:115,EALREADY:114,EDESTADDRREQ:89,EMSGSIZE:90,EPROTONOSUPPORT:93,ESOCKTNOSUPPORT:94,EADDRNOTAVAIL:99,ENETRESET:102,EISCONN:106,ENOTCONN:107,ETOOMANYREFS:109,EUSERS:87,EDQUOT:122,ESTALE:116,ENOTSUP:95,ENOMEDIUM:123,EILSEQ:84,EOVERFLOW:75,ECANCELED:125,ENOTRECOVERABLE:131,EOWNERDEAD:130,ESTRPIPE:86};
  var ERRNO_MESSAGES={0:"Success",1:"Not super-user",2:"No such file or directory",3:"No such process",4:"Interrupted system call",5:"I/O error",6:"No such device or address",7:"Arg list too long",8:"Exec format error",9:"Bad file number",10:"No children",11:"No more processes",12:"Not enough core",13:"Permission denied",14:"Bad address",15:"Block device required",16:"Mount device busy",17:"File exists",18:"Cross-device link",19:"No such device",20:"Not a directory",21:"Is a directory",22:"Invalid argument",23:"Too many open files in system",24:"Too many open files",25:"Not a typewriter",26:"Text file busy",27:"File too large",28:"No space left on device",29:"Illegal seek",30:"Read only file system",31:"Too many links",32:"Broken pipe",33:"Math arg out of domain of func",34:"Math result not representable",35:"File locking deadlock error",36:"File or path name too long",37:"No record locks available",38:"Function not implemented",39:"Directory not empty",40:"Too many symbolic links",42:"No message of desired type",43:"Identifier removed",44:"Channel number out of range",45:"Level 2 not synchronized",46:"Level 3 halted",47:"Level 3 reset",48:"Link number out of range",49:"Protocol driver not attached",50:"No CSI structure available",51:"Level 2 halted",52:"Invalid exchange",53:"Invalid request descriptor",54:"Exchange full",55:"No anode",56:"Invalid request code",57:"Invalid slot",59:"Bad font file fmt",60:"Device not a stream",61:"No data (for no delay io)",62:"Timer expired",63:"Out of streams resources",64:"Machine is not on the network",65:"Package not installed",66:"The object is remote",67:"The link has been severed",68:"Advertise error",69:"Srmount error",70:"Communication error on send",71:"Protocol error",72:"Multihop attempted",73:"Cross mount point (not really error)",74:"Trying to read unreadable message",75:"Value too large for defined data type",76:"Given log. name not unique",77:"f.d. invalid for this operation",78:"Remote address changed",79:"Can   access a needed shared lib",80:"Accessing a corrupted shared lib",81:".lib section in a.out corrupted",82:"Attempting to link in too many libs",83:"Attempting to exec a shared library",84:"Illegal byte sequence",86:"Streams pipe error",87:"Too many users",88:"Socket operation on non-socket",89:"Destination address required",90:"Message too long",91:"Protocol wrong type for socket",92:"Protocol not available",93:"Unknown protocol",94:"Socket type not supported",95:"Not supported",96:"Protocol family not supported",97:"Address family not supported by protocol family",98:"Address already in use",99:"Address not available",100:"Network interface is not configured",101:"Network is unreachable",102:"Connection reset by network",103:"Connection aborted",104:"Connection reset by peer",105:"No buffer space available",106:"Socket is already connected",107:"Socket is not connected",108:"Can't send after socket shutdown",109:"Too many references",110:"Connection timed out",111:"Connection refused",112:"Host is down",113:"Host is unreachable",114:"Socket already connected",115:"Connection already in progress",116:"Stale file handle",122:"Quota exceeded",123:"No medium (in tape drive)",125:"Operation canceled",130:"Previous owner died",131:"State not recoverable"};
  var ___errno_state=0;function ___setErrNo(value) {
      // For convenient setting and returning of errno.
      HEAP32[((___errno_state)>>2)]=value
      return value;
    }
  var PATH={splitPath:function (filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function (parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up--; up) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function (path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function (path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function (path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function (path) {
        return PATH.splitPath(path)[3];
      },join:function () {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function (l, r) {
        return PATH.normalize(l + '/' + r);
      },resolve:function () {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? arguments[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path !== 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            continue;
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = path.charAt(0) === '/';
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(function(p) {
          return !!p;
        }), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },relative:function (from, to) {
        from = PATH.resolve(from).substr(1);
        to = PATH.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      }};
  var TTY={ttys:[],init:function () {
        // https://github.com/kripken/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process['stdin']['setEncoding']('utf8');
        // }
      },shutdown:function () {
        // https://github.com/kripken/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function (dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function (stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function (stream) {
          // flush any pending line data
          if (stream.tty.output.length) {
            stream.tty.ops.put_char(stream.tty, 10);
          }
        },read:function (stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }
          return bytesRead;
        },write:function (stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
          }
          for (var i = 0; i < length; i++) {
            try {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
          }
          if (length) {
            stream.node.timestamp = Date.now();
          }
          return i;
        }},default_tty_ops:{get_char:function (tty) {
          if (!tty.input.length) {
            var result = null;
            if (ENVIRONMENT_IS_NODE) {
              result = process['stdin']['read']();
              if (!result) {
                if (process['stdin']['_readableState'] && process['stdin']['_readableState']['ended']) {
                  return null;  // EOF
                }
                return undefined;  // no data available
              }
            } else if (typeof window != 'undefined' &&
              typeof window.prompt == 'function') {
              // Browser.
              result = window.prompt('Input: ');  // returns null on cancel
              if (result !== null) {
                result += '\n';
              }
            } else if (typeof readline == 'function') {
              // Command line.
              result = readline();
              if (result !== null) {
                result += '\n';
              }
            }
            if (!result) {
              return null;
            }
            tty.input = intArrayFromString(result, true);
          }
          return tty.input.shift();
        },put_char:function (tty, val) {
          if (val === null || val === 10) {
            Module['print'](tty.output.join(''));
            tty.output = [];
          } else {
            tty.output.push(TTY.utf8.processCChar(val));
          }
        }},default_tty1_ops:{put_char:function (tty, val) {
          if (val === null || val === 10) {
            Module['printErr'](tty.output.join(''));
            tty.output = [];
          } else {
            tty.output.push(TTY.utf8.processCChar(val));
          }
        }}};
  var MEMFS={ops_table:null,CONTENT_OWNING:1,CONTENT_FLEXIBLE:2,CONTENT_FIXED:3,mount:function (mount) {
        return MEMFS.createNode(null, '/', 16384 | 0777, 0);
      },createNode:function (parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (!MEMFS.ops_table) {
          MEMFS.ops_table = {
            dir: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                lookup: MEMFS.node_ops.lookup,
                mknod: MEMFS.node_ops.mknod,
                mknod: MEMFS.node_ops.mknod,
                rename: MEMFS.node_ops.rename,
                unlink: MEMFS.node_ops.unlink,
                rmdir: MEMFS.node_ops.rmdir,
                readdir: MEMFS.node_ops.readdir,
                symlink: MEMFS.node_ops.symlink
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek
              }
            },
            file: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek,
                read: MEMFS.stream_ops.read,
                write: MEMFS.stream_ops.write,
                allocate: MEMFS.stream_ops.allocate,
                mmap: MEMFS.stream_ops.mmap
              }
            },
            link: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                readlink: MEMFS.node_ops.readlink
              },
              stream: {}
            },
            chrdev: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: FS.chrdev_stream_ops
            },
          };
        }
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.contents = [];
          node.contentMode = MEMFS.CONTENT_FLEXIBLE;
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.timestamp = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },ensureFlexible:function (node) {
        if (node.contentMode !== MEMFS.CONTENT_FLEXIBLE) {
          var contents = node.contents;
          node.contents = Array.prototype.slice.call(contents);
          node.contentMode = MEMFS.CONTENT_FLEXIBLE;
        }
      },node_ops:{getattr:function (node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.contents.length;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.timestamp);
          attr.mtime = new Date(node.timestamp);
          attr.ctime = new Date(node.timestamp);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },setattr:function (node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.ensureFlexible(node);
            var contents = node.contents;
            if (attr.size < contents.length) contents.length = attr.size;
            else while (attr.size > contents.length) contents.push(0);
          }
        },lookup:function (parent, name) {
          throw FS.genericErrors[ERRNO_CODES.ENOENT];
        },mknod:function (parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function (old_node, new_dir, new_name) {
          // if we're overwriting a directory at new_name, make sure it's empty.
          if (FS.isDir(old_node.mode)) {
            var new_node;
            try {
              new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) {
            }
            if (new_node) {
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
              }
            }
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          old_node.name = new_name;
          new_dir.contents[new_name] = old_node;
          old_node.parent = new_dir;
        },unlink:function (parent, name) {
          delete parent.contents[name];
        },rmdir:function (parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
          }
          delete parent.contents[name];
        },readdir:function (node) {
          var entries = ['.', '..']
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function (parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 0777 | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function (node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          return node.link;
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else
          {
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          }
          return size;
        },write:function (stream, buffer, offset, length, position, canOwn) {
          var node = stream.node;
          node.timestamp = Date.now();
          var contents = node.contents;
          if (length && contents.length === 0 && position === 0 && buffer.subarray) {
            // just replace it with the new data
            if (canOwn && offset === 0) {
              node.contents = buffer; // this could be a subarray of Emscripten HEAP, or allocated from some other source.
              node.contentMode = (buffer.buffer === HEAP8.buffer) ? MEMFS.CONTENT_OWNING : MEMFS.CONTENT_FIXED;
            } else {
              node.contents = new Uint8Array(buffer.subarray(offset, offset+length));
              node.contentMode = MEMFS.CONTENT_FIXED;
            }
            return length;
          }
          MEMFS.ensureFlexible(node);
          var contents = node.contents;
          while (contents.length < position) contents.push(0);
          for (var i = 0; i < length; i++) {
            contents[position + i] = buffer[offset + i];
          }
          return length;
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.contents.length;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          stream.ungotten = [];
          stream.position = position;
          return position;
        },allocate:function (stream, offset, length) {
          MEMFS.ensureFlexible(stream.node);
          var contents = stream.node.contents;
          var limit = offset + length;
          while (limit > contents.length) contents.push(0);
        },mmap:function (stream, buffer, offset, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if ( !(flags & 2) &&
                (contents.buffer === buffer || contents.buffer === buffer.buffer) ) {
            // We can't emulate MAP_SHARED when the file is not backed by the buffer
            // we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            // Try to avoid unnecessary slices.
            if (position > 0 || position + length < contents.length) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length);
              } else {
                contents = Array.prototype.slice.call(contents, position, position + length);
              }
            }
            allocated = true;
            ptr = _malloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
            }
            buffer.set(contents, ptr);
          }
          return { ptr: ptr, allocated: allocated };
        }}};
  var IDBFS={dbs:{},indexedDB:function () {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",mount:function (mount) {
        return MEMFS.mount.apply(null, arguments);
      },syncfs:function (mount, populate, callback) {
        IDBFS.getLocalSet(mount, function(err, local) {
          if (err) return callback(err);
          IDBFS.getRemoteSet(mount, function(err, remote) {
            if (err) return callback(err);
            var src = populate ? remote : local;
            var dst = populate ? local : remote;
            IDBFS.reconcile(src, dst, callback);
          });
        });
      },reconcile:function (src, dst, callback) {
        var total = 0;
        var create = {};
        for (var key in src.files) {
          if (!src.files.hasOwnProperty(key)) continue;
          var e = src.files[key];
          var e2 = dst.files[key];
          if (!e2 || e.timestamp > e2.timestamp) {
            create[key] = e;
            total++;
          }
        }
        var remove = {};
        for (var key in dst.files) {
          if (!dst.files.hasOwnProperty(key)) continue;
          var e = dst.files[key];
          var e2 = src.files[key];
          if (!e2) {
            remove[key] = e;
            total++;
          }
        }
        if (!total) {
          // early out
          return callback(null);
        }
        var completed = 0;
        function done(err) {
          if (err) return callback(err);
          if (++completed >= total) {
            return callback(null);
          }
        };
        // create a single transaction to handle and IDB reads / writes we'll need to do
        var db = src.type === 'remote' ? src.db : dst.db;
        var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
        transaction.onerror = function transaction_onerror() { callback(this.error); };
        var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
        for (var path in create) {
          if (!create.hasOwnProperty(path)) continue;
          var entry = create[path];
          if (dst.type === 'local') {
            // save file to local
            try {
              if (FS.isDir(entry.mode)) {
                FS.mkdir(path, entry.mode);
              } else if (FS.isFile(entry.mode)) {
                var stream = FS.open(path, 'w+', 0666);
                FS.write(stream, entry.contents, 0, entry.contents.length, 0, true /* canOwn */);
                FS.close(stream);
              }
              done(null);
            } catch (e) {
              return done(e);
            }
          } else {
            // save file to IDB
            var req = store.put(entry, path);
            req.onsuccess = function req_onsuccess() { done(null); };
            req.onerror = function req_onerror() { done(this.error); };
          }
        }
        for (var path in remove) {
          if (!remove.hasOwnProperty(path)) continue;
          var entry = remove[path];
          if (dst.type === 'local') {
            // delete file from local
            try {
              if (FS.isDir(entry.mode)) {
                // TODO recursive delete?
                FS.rmdir(path);
              } else if (FS.isFile(entry.mode)) {
                FS.unlink(path);
              }
              done(null);
            } catch (e) {
              return done(e);
            }
          } else {
            // delete file from IDB
            var req = store.delete(path);
            req.onsuccess = function req_onsuccess() { done(null); };
            req.onerror = function req_onerror() { done(this.error); };
          }
        }
      },getLocalSet:function (mount, callback) {
        var files = {};
        function isRealDir(p) {
          return p !== '.' && p !== '..';
        };
        function toAbsolute(root) {
          return function(p) {
            return PATH.join2(root, p);
          }
        };
        var check = FS.readdir(mount.mountpoint)
          .filter(isRealDir)
          .map(toAbsolute(mount.mountpoint));
        while (check.length) {
          var path = check.pop();
          var stat, node;
          try {
            var lookup = FS.lookupPath(path);
            node = lookup.node;
            stat = FS.stat(path);
          } catch (e) {
            return callback(e);
          }
          if (FS.isDir(stat.mode)) {
            check.push.apply(check, FS.readdir(path)
              .filter(isRealDir)
              .map(toAbsolute(path)));
            files[path] = { mode: stat.mode, timestamp: stat.mtime };
          } else if (FS.isFile(stat.mode)) {
            files[path] = { contents: node.contents, mode: stat.mode, timestamp: stat.mtime };
          } else {
            return callback(new Error('node type not supported'));
          }
        }
        return callback(null, { type: 'local', files: files });
      },getDB:function (name, callback) {
        // look it up in the cache
        var db = IDBFS.dbs[name];
        if (db) {
          return callback(null, db);
        }
        var req;
        try {
          req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        req.onupgradeneeded = function req_onupgradeneeded() {
          db = req.result;
          db.createObjectStore(IDBFS.DB_STORE_NAME);
        };
        req.onsuccess = function req_onsuccess() {
          db = req.result;
          // add to the cache
          IDBFS.dbs[name] = db;
          callback(null, db);
        };
        req.onerror = function req_onerror() {
          callback(this.error);
        };
      },getRemoteSet:function (mount, callback) {
        var files = {};
        IDBFS.getDB(mount.mountpoint, function(err, db) {
          if (err) return callback(err);
          var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
          transaction.onerror = function transaction_onerror() { callback(this.error); };
          var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
          store.openCursor().onsuccess = function store_openCursor_onsuccess(event) {
            var cursor = event.target.result;
            if (!cursor) {
              return callback(null, { type: 'remote', db: db, files: files });
            }
            files[cursor.key] = cursor.value;
            cursor.continue();
          };
        });
      }};
  var NODEFS={isWindows:false,staticInit:function () {
        NODEFS.isWindows = !!process.platform.match(/^win/);
      },mount:function (mount) {
        assert(ENVIRONMENT_IS_NODE);
        return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
      },createNode:function (parent, name, mode, dev) {
        if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node = FS.createNode(parent, name, mode);
        node.node_ops = NODEFS.node_ops;
        node.stream_ops = NODEFS.stream_ops;
        return node;
      },getMode:function (path) {
        var stat;
        try {
          stat = fs.lstatSync(path);
          if (NODEFS.isWindows) {
            // On Windows, directories return permission bits 'rw-rw-rw-', even though they have 'rwxrwxrwx', so 
            // propagate write bits to execute bits.
            stat.mode = stat.mode | ((stat.mode & 146) >> 1);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return stat.mode;
      },realPath:function (node) {
        var parts = [];
        while (node.parent !== node) {
          parts.push(node.name);
          node = node.parent;
        }
        parts.push(node.mount.opts.root);
        parts.reverse();
        return PATH.join.apply(null, parts);
      },flagsToPermissionStringMap:{0:"r",1:"r+",2:"r+",64:"r",65:"r+",66:"r+",129:"rx+",193:"rx+",514:"w+",577:"w",578:"w+",705:"wx",706:"wx+",1024:"a",1025:"a",1026:"a+",1089:"a",1090:"a+",1153:"ax",1154:"ax+",1217:"ax",1218:"ax+",4096:"rs",4098:"rs+"},flagsToPermissionString:function (flags) {
        if (flags in NODEFS.flagsToPermissionStringMap) {
          return NODEFS.flagsToPermissionStringMap[flags];
        } else {
          return flags;
        }
      },node_ops:{getattr:function (node) {
          var path = NODEFS.realPath(node);
          var stat;
          try {
            stat = fs.lstatSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          // node.js v0.10.20 doesn't report blksize and blocks on Windows. Fake them with default blksize of 4096.
          // See http://support.microsoft.com/kb/140365
          if (NODEFS.isWindows && !stat.blksize) {
            stat.blksize = 4096;
          }
          if (NODEFS.isWindows && !stat.blocks) {
            stat.blocks = (stat.size+stat.blksize-1)/stat.blksize|0;
          }
          return {
            dev: stat.dev,
            ino: stat.ino,
            mode: stat.mode,
            nlink: stat.nlink,
            uid: stat.uid,
            gid: stat.gid,
            rdev: stat.rdev,
            size: stat.size,
            atime: stat.atime,
            mtime: stat.mtime,
            ctime: stat.ctime,
            blksize: stat.blksize,
            blocks: stat.blocks
          };
        },setattr:function (node, attr) {
          var path = NODEFS.realPath(node);
          try {
            if (attr.mode !== undefined) {
              fs.chmodSync(path, attr.mode);
              // update the common node structure mode as well
              node.mode = attr.mode;
            }
            if (attr.timestamp !== undefined) {
              var date = new Date(attr.timestamp);
              fs.utimesSync(path, date, date);
            }
            if (attr.size !== undefined) {
              fs.truncateSync(path, attr.size);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },lookup:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          var mode = NODEFS.getMode(path);
          return NODEFS.createNode(parent, name, mode);
        },mknod:function (parent, name, mode, dev) {
          var node = NODEFS.createNode(parent, name, mode, dev);
          // create the backing node for this in the fs root as well
          var path = NODEFS.realPath(node);
          try {
            if (FS.isDir(node.mode)) {
              fs.mkdirSync(path, node.mode);
            } else {
              fs.writeFileSync(path, '', { mode: node.mode });
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return node;
        },rename:function (oldNode, newDir, newName) {
          var oldPath = NODEFS.realPath(oldNode);
          var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
          try {
            fs.renameSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },unlink:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.unlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },rmdir:function (parent, name) {
          var path = PATH.join2(NODEFS.realPath(parent), name);
          try {
            fs.rmdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readdir:function (node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readdirSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },symlink:function (parent, newName, oldPath) {
          var newPath = PATH.join2(NODEFS.realPath(parent), newName);
          try {
            fs.symlinkSync(oldPath, newPath);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },readlink:function (node) {
          var path = NODEFS.realPath(node);
          try {
            return fs.readlinkSync(path);
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        }},stream_ops:{open:function (stream) {
          var path = NODEFS.realPath(stream.node);
          try {
            if (FS.isFile(stream.node.mode)) {
              stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },close:function (stream) {
          try {
            if (FS.isFile(stream.node.mode) && stream.nfd) {
              fs.closeSync(stream.nfd);
            }
          } catch (e) {
            if (!e.code) throw e;
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
        },read:function (stream, buffer, offset, length, position) {
          // FIXME this is terrible.
          var nbuffer = new Buffer(length);
          var res;
          try {
            res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          if (res > 0) {
            for (var i = 0; i < res; i++) {
              buffer[offset + i] = nbuffer[i];
            }
          }
          return res;
        },write:function (stream, buffer, offset, length, position) {
          // FIXME this is terrible.
          var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
          var res;
          try {
            res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES[e.code]);
          }
          return res;
        },llseek:function (stream, offset, whence) {
          var position = offset;
          if (whence === 1) {  // SEEK_CUR.
            position += stream.position;
          } else if (whence === 2) {  // SEEK_END.
            if (FS.isFile(stream.node.mode)) {
              try {
                var stat = fs.fstatSync(stream.nfd);
                position += stat.size;
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES[e.code]);
              }
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          stream.position = position;
          return position;
        }}};
  var _stdin=allocate(1, "i32*", ALLOC_STATIC);
  var _stdout=allocate(1, "i32*", ALLOC_STATIC);
  var _stderr=allocate(1, "i32*", ALLOC_STATIC);
  function _fflush(stream) {
      // int fflush(FILE *stream);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/fflush.html
      // we don't currently perform any user-space buffering of data
    }var FS={root:null,mounts:[],devices:[null],streams:[null],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,ErrnoError:null,genericErrors:{},handleFSError:function (e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function (path, opts) {
        path = PATH.resolve(FS.cwd(), path);
        opts = opts || { recurse_count: 0 };
        if (opts.recurse_count > 8) {  // max recursive lookup of 8
          throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
        }
        // split the path
        var parts = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), false);
        // start at the root
        var current = FS.root;
        var current_path = '/';
        for (var i = 0; i < parts.length; i++) {
          var islast = (i === parts.length-1);
          if (islast && opts.parent) {
            // stop resolving
            break;
          }
          current = FS.lookupNode(current, parts[i]);
          current_path = PATH.join2(current_path, parts[i]);
          // jump to the mount's root node if this is a mountpoint
          if (FS.isMountpoint(current)) {
            current = current.mount.root;
          }
          // follow symlinks
          // by default, lookupPath will not follow a symlink if it is the final path component.
          // setting opts.follow = true will override this behavior.
          if (!islast || opts.follow) {
            var count = 0;
            while (FS.isLink(current.mode)) {
              var link = FS.readlink(current_path);
              current_path = PATH.resolve(PATH.dirname(current_path), link);
              var lookup = FS.lookupPath(current_path, { recurse_count: opts.recurse_count });
              current = lookup.node;
              if (count++ > 40) {  // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
                throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
              }
            }
          }
        }
        return { path: current_path, node: current };
      },getPath:function (node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? mount + '/' + path : mount + path;
          }
          path = path ? node.name + '/' + path : node.name;
          node = node.parent;
        }
      },hashName:function (parentid, name) {
        var hash = 0;
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },lookupNode:function (parent, name) {
        var err = FS.mayLookup(parent);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },createNode:function (parent, name, mode, rdev) {
        if (!FS.FSNode) {
          FS.FSNode = function(parent, name, mode, rdev) {
            this.id = FS.nextInode++;
            this.name = name;
            this.mode = mode;
            this.node_ops = {};
            this.stream_ops = {};
            this.rdev = rdev;
            this.parent = null;
            this.mount = null;
            if (!parent) {
              parent = this;  // root node sets parent to itself
            }
            this.parent = parent;
            this.mount = parent.mount;
            FS.hashAddNode(this);
          };
          // compatibility
          var readMode = 292 | 73;
          var writeMode = 146;
          FS.FSNode.prototype = {};
          // NOTE we must use Object.defineProperties instead of individual calls to
          // Object.defineProperty in order to make closure compiler happy
          Object.defineProperties(FS.FSNode.prototype, {
            read: {
              get: function() { return (this.mode & readMode) === readMode; },
              set: function(val) { val ? this.mode |= readMode : this.mode &= ~readMode; }
            },
            write: {
              get: function() { return (this.mode & writeMode) === writeMode; },
              set: function(val) { val ? this.mode |= writeMode : this.mode &= ~writeMode; }
            },
            isFolder: {
              get: function() { return FS.isDir(this.mode); },
            },
            isDevice: {
              get: function() { return FS.isChrdev(this.mode); },
            },
          });
        }
        return new FS.FSNode(parent, name, mode, rdev);
      },destroyNode:function (node) {
        FS.hashRemoveNode(node);
      },isRoot:function (node) {
        return node === node.parent;
      },isMountpoint:function (node) {
        return node.mounted;
      },isFile:function (mode) {
        return (mode & 61440) === 32768;
      },isDir:function (mode) {
        return (mode & 61440) === 16384;
      },isLink:function (mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function (mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function (mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function (mode) {
        return (mode & 61440) === 4096;
      },isSocket:function (mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function (str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function (flag) {
        var accmode = flag & 2097155;
        var perms = ['r', 'w', 'rw'][accmode];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function (node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
          return ERRNO_CODES.EACCES;
        } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
          return ERRNO_CODES.EACCES;
        } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
          return ERRNO_CODES.EACCES;
        }
        return 0;
      },mayLookup:function (dir) {
        return FS.nodePermissions(dir, 'x');
      },mayCreate:function (dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return ERRNO_CODES.EEXIST;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function (dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var err = FS.nodePermissions(dir, 'wx');
        if (err) {
          return err;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return ERRNO_CODES.ENOTDIR;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return ERRNO_CODES.EBUSY;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return ERRNO_CODES.EISDIR;
          }
        }
        return 0;
      },mayOpen:function (node, flags) {
        if (!node) {
          return ERRNO_CODES.ENOENT;
        }
        if (FS.isLink(node.mode)) {
          return ERRNO_CODES.ELOOP;
        } else if (FS.isDir(node.mode)) {
          if ((flags & 2097155) !== 0 ||  // opening for write
              (flags & 512)) {
            return ERRNO_CODES.EISDIR;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },MAX_OPEN_FDS:4096,nextfd:function (fd_start, fd_end) {
        fd_start = fd_start || 1;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
      },getStream:function (fd) {
        return FS.streams[fd];
      },createStream:function (stream, fd_start, fd_end) {
        if (!FS.FSStream) {
          FS.FSStream = function(){};
          FS.FSStream.prototype = {};
          // compatibility
          Object.defineProperties(FS.FSStream.prototype, {
            object: {
              get: function() { return this.node; },
              set: function(val) { this.node = val; }
            },
            isRead: {
              get: function() { return (this.flags & 2097155) !== 1; }
            },
            isWrite: {
              get: function() { return (this.flags & 2097155) !== 0; }
            },
            isAppend: {
              get: function() { return (this.flags & 1024); }
            }
          });
        }
        if (stream.__proto__) {
          // reuse the object
          stream.__proto__ = FS.FSStream.prototype;
        } else {
          var newStream = new FS.FSStream();
          for (var p in stream) {
            newStream[p] = stream[p];
          }
          stream = newStream;
        }
        var fd = FS.nextfd(fd_start, fd_end);
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },closeStream:function (fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function (stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function () {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }},major:function (dev) {
        return ((dev) >> 8);
      },minor:function (dev) {
        return ((dev) & 0xff);
      },makedev:function (ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function (dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function (dev) {
        return FS.devices[dev];
      },syncfs:function (populate, callback) {
        if (typeof(populate) === 'function') {
          callback = populate;
          populate = false;
        }
        var completed = 0;
        var total = FS.mounts.length;
        function done(err) {
          if (err) {
            return callback(err);
          }
          if (++completed >= total) {
            callback(null);
          }
        };
        // sync all mounts
        for (var i = 0; i < FS.mounts.length; i++) {
          var mount = FS.mounts[i];
          if (!mount.type.syncfs) {
            done(null);
            continue;
          }
          mount.type.syncfs(mount, populate, done);
        }
      },mount:function (type, opts, mountpoint) {
        var lookup;
        if (mountpoint) {
          lookup = FS.lookupPath(mountpoint, { follow: false });
          mountpoint = lookup.path;  // use the absolute path
        }
        var mount = {
          type: type,
          opts: opts,
          mountpoint: mountpoint,
          root: null
        };
        // create a root node for the fs
        var root = type.mount(mount);
        root.mount = mount;
        mount.root = root;
        // assign the mount info to the mountpoint's node
        if (lookup) {
          lookup.node.mount = mount;
          lookup.node.mounted = true;
          // compatibility update FS.root if we mount to /
          if (mountpoint === '/') {
            FS.root = mount.root;
          }
        }
        // add to our cached list of mounts
        FS.mounts.push(mount);
        return root;
      },lookup:function (parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function (path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var err = FS.mayCreate(parent, name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },create:function (path, mode) {
        mode = mode !== undefined ? mode : 0666;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function (path, mode) {
        mode = mode !== undefined ? mode : 0777;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdev:function (path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 0666;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function (oldpath, newpath) {
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        var newname = PATH.basename(newpath);
        var err = FS.mayCreate(parent, newname);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },rename:function (old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
        try {
          lookup = FS.lookupPath(old_path, { parent: true });
          old_dir = lookup.node;
          lookup = FS.lookupPath(new_path, { parent: true });
          new_dir = lookup.node;
        } catch (e) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        // new path should not be an ancestor of the old path
        relative = PATH.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var err = FS.mayDelete(old_dir, old_name, isdir);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        err = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          err = FS.nodePermissions(old_dir, 'w');
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
      },rmdir:function (path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, true);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
      },readdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        return node.node_ops.readdir(node);
      },unlink:function (path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, false);
        if (err) {
          // POSIX says unlink should set EPERM, not EISDIR
          if (err === ERRNO_CODES.EISDIR) err = ERRNO_CODES.EPERM;
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
      },readlink:function (path) {
        var lookup = FS.lookupPath(path, { follow: false });
        var link = lookup.node;
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        return link.node_ops.readlink(link);
      },stat:function (path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        return node.node_ops.getattr(node);
      },lstat:function (path) {
        return FS.stat(path, true);
      },chmod:function (path, mode, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          timestamp: Date.now()
        });
      },lchmod:function (path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function (fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        FS.chmod(stream.node, mode);
      },chown:function (path, uid, gid, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },lchown:function (path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function (fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function (path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(ERRNO_CODES.EPERM);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var err = FS.nodePermissions(node, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },ftruncate:function (fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        FS.truncate(stream.node, len);
      },utime:function (path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function (path, flags, mode, fd_start, fd_end) {
        flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
        mode = typeof mode === 'undefined' ? 0666 : mode;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path === 'object') {
          node = path;
        } else {
          path = PATH.normalize(path);
          try {
            var lookup = FS.lookupPath(path, {
              follow: !(flags & 131072)
            });
            node = lookup.node;
          } catch (e) {
            // ignore
          }
        }
        // perhaps we need to create the node
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
          }
        }
        if (!node) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // check permissions
        var err = FS.mayOpen(node, flags);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // do truncation if necessary
        if ((flags & 512)) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512);
        // register the stream with the filesystem
        var stream = FS.createStream({
          node: node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags: flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        }, fd_start, fd_end);
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!FS.readFiles) FS.readFiles = {};
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
            Module['printErr']('read file: ' + path);
          }
        }
        return stream;
      },close:function (stream) {
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
      },llseek:function (stream, offset, whence) {
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        return stream.stream_ops.llseek(stream, offset, whence);
      },read:function (stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var seeking = true;
        if (typeof position === 'undefined') {
          position = stream.position;
          seeking = false;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },write:function (stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        var seeking = true;
        if (typeof position === 'undefined') {
          position = stream.position;
          seeking = false;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
        }
        if (stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        return bytesWritten;
      },allocate:function (stream, offset, length) {
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EBADF);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },mmap:function (stream, buffer, offset, length, position, prot, flags) {
        // TODO if PROT is PROT_WRITE, make sure we have write access
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(ERRNO_CODES.EACCES);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }
        return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
      },ioctl:function (stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function (path, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'r';
        opts.encoding = opts.encoding || 'binary';
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = '';
          var utf8 = new Runtime.UTF8Processor();
          for (var i = 0; i < length; i++) {
            ret += utf8.processCChar(buf[i]);
          }
        } else if (opts.encoding === 'binary') {
          ret = buf;
        } else {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        FS.close(stream);
        return ret;
      },writeFile:function (path, data, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'w';
        opts.encoding = opts.encoding || 'utf8';
        var stream = FS.open(path, opts.flags, opts.mode);
        if (opts.encoding === 'utf8') {
          var utf8 = new Runtime.UTF8Processor();
          var buf = new Uint8Array(utf8.processJSString(data));
          FS.write(stream, buf, 0, buf.length, 0);
        } else if (opts.encoding === 'binary') {
          FS.write(stream, data, 0, data.length, 0);
        } else {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        FS.close(stream);
      },cwd:function () {
        return FS.currentPath;
      },chdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
        var err = FS.nodePermissions(lookup.node, 'x');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        FS.currentPath = lookup.path;
      },createDefaultDirectories:function () {
        FS.mkdir('/tmp');
      },createDefaultDevices:function () {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: function() { return 0; },
          write: function() { return 0; }
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using Module['printErr']
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },createStandardStreams:function () {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (Module['stdin']) {
          FS.createDevice('/dev', 'stdin', Module['stdin']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (Module['stdout']) {
          FS.createDevice('/dev', 'stdout', null, Module['stdout']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (Module['stderr']) {
          FS.createDevice('/dev', 'stderr', null, Module['stderr']);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 'r');
        HEAP32[((_stdin)>>2)]=stdin.fd;
        assert(stdin.fd === 1, 'invalid handle for stdin (' + stdin.fd + ')');
        var stdout = FS.open('/dev/stdout', 'w');
        HEAP32[((_stdout)>>2)]=stdout.fd;
        assert(stdout.fd === 2, 'invalid handle for stdout (' + stdout.fd + ')');
        var stderr = FS.open('/dev/stderr', 'w');
        HEAP32[((_stderr)>>2)]=stderr.fd;
        assert(stderr.fd === 3, 'invalid handle for stderr (' + stderr.fd + ')');
      },ensureErrnoError:function () {
        if (FS.ErrnoError) return;
        FS.ErrnoError = function ErrnoError(errno) {
          this.errno = errno;
          for (var key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === errno) {
              this.code = key;
              break;
            }
          }
          this.message = ERRNO_MESSAGES[errno];
        };
        FS.ErrnoError.prototype = new Error();
        FS.ErrnoError.prototype.constructor = FS.ErrnoError;
        // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
        [ERRNO_CODES.ENOENT].forEach(function(code) {
          FS.genericErrors[code] = new FS.ErrnoError(code);
          FS.genericErrors[code].stack = '<generic error, no stack>';
        });
      },staticInit:function () {
        FS.ensureErrnoError();
        FS.nameTable = new Array(4096);
        FS.root = FS.createNode(null, '/', 16384 | 0777, 0);
        FS.mount(MEMFS, {}, '/');
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
      },init:function (input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
        FS.ensureErrnoError();
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
        FS.createStandardStreams();
      },quit:function () {
        FS.init.initialized = false;
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },getMode:function (canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function (parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function (relative, base) {
        return PATH.resolve(base, relative);
      },standardizePath:function (path) {
        return PATH.normalize(path);
      },findObject:function (path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function (path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },createFolder:function (parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function (parent, path, canRead, canWrite) {
        parent = typeof parent === 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },createFile:function (parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function (parent, name, data, canRead, canWrite, canOwn) {
        var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
        var mode = FS.getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data === 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 'w');
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
        return node;
      },createDevice:function (parent, name, input, output) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(!!input, !!output);
        if (!FS.createDevice.major) FS.createDevice.major = 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open: function(stream) {
            stream.seekable = false;
          },
          close: function(stream) {
            // flush any pending line data
            if (output && output.buffer && output.buffer.length) {
              output(10);
            }
          },
          read: function(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES.EIO);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.timestamp = Date.now();
            }
            return bytesRead;
          },
          write: function(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(ERRNO_CODES.EIO);
              }
            }
            if (length) {
              stream.node.timestamp = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },createLink:function (parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function (obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        var success = true;
        if (typeof XMLHttpRequest !== 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else if (Module['read']) {
          // Command-line.
          try {
            // WARNING: Can't read binary files in V8's d8 or tracemonkey's js, as
            //          read() will try to parse UTF8.
            obj.contents = intArrayFromString(Module['read'](obj.url), true);
          } catch (e) {
            success = false;
          }
        } else {
          throw new Error('Cannot load without read() or XMLHttpRequest.');
        }
        if (!success) ___setErrNo(ERRNO_CODES.EIO);
        return success;
      },createLazyFile:function (parent, name, url, canRead, canWrite) {
        if (typeof XMLHttpRequest !== 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
          function LazyUint8Array() {
            this.lengthKnown = false;
            this.chunks = []; // Loaded chunks. Index is the chunk number
          }
          LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
            if (idx > this.length-1 || idx < 0) {
              return undefined;
            }
            var chunkOffset = idx % this.chunkSize;
            var chunkNum = Math.floor(idx / this.chunkSize);
            return this.getter(chunkNum)[chunkOffset];
          }
          LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
            this.getter = getter;
          }
          LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
              // Find length
              var xhr = new XMLHttpRequest();
              xhr.open('HEAD', url, false);
              xhr.send(null);
              if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
              var datalength = Number(xhr.getResponseHeader("Content-length"));
              var header;
              var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
              var chunkSize = 1024*1024; // Chunk size in bytes
              if (!hasByteServing) chunkSize = datalength;
              // Function to get a range from the remote URL.
              var doXHR = (function(from, to) {
                if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
                if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
                // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, false);
                if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
                // Some hints to the browser that we want binary data.
                if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
                if (xhr.overrideMimeType) {
                  xhr.overrideMimeType('text/plain; charset=x-user-defined');
                }
                xhr.send(null);
                if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
                if (xhr.response !== undefined) {
                  return new Uint8Array(xhr.response || []);
                } else {
                  return intArrayFromString(xhr.responseText || '', true);
                }
              });
              var lazyArray = this;
              lazyArray.setDataGetter(function(chunkNum) {
                var start = chunkNum * chunkSize;
                var end = (chunkNum+1) * chunkSize - 1; // including this byte
                end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
                if (typeof(lazyArray.chunks[chunkNum]) === "undefined") {
                  lazyArray.chunks[chunkNum] = doXHR(start, end);
                }
                if (typeof(lazyArray.chunks[chunkNum]) === "undefined") throw new Error("doXHR failed!");
                return lazyArray.chunks[chunkNum];
              });
              this._length = datalength;
              this._chunkSize = chunkSize;
              this.lengthKnown = true;
          }
          var lazyArray = new LazyUint8Array();
          Object.defineProperty(lazyArray, "length", {
              get: function() {
                  if(!this.lengthKnown) {
                      this.cacheLength();
                  }
                  return this._length;
              }
          });
          Object.defineProperty(lazyArray, "chunkSize", {
              get: function() {
                  if(!this.lengthKnown) {
                      this.cacheLength();
                  }
                  return this._chunkSize;
              }
          });
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach(function(key) {
          var fn = node.stream_ops[key];
          stream_ops[key] = function forceLoadLazyFile() {
            if (!FS.forceLoadFile(node)) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            return fn.apply(null, arguments);
          };
        });
        // use a custom read function
        stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        };
        node.stream_ops = stream_ops;
        return node;
      },createPreloadedFile:function (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn) {
        Browser.init();
        // TODO we should allow people to just pass in a complete filename instead
        // of parent and name being that we just join them anyways
        var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
        function processData(byteArray) {
          function finish(byteArray) {
            if (!dontCreateFile) {
              FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
            }
            if (onload) onload();
            removeRunDependency('cp ' + fullname);
          }
          var handled = false;
          Module['preloadPlugins'].forEach(function(plugin) {
            if (handled) return;
            if (plugin['canHandle'](fullname)) {
              plugin['handle'](byteArray, fullname, finish, function() {
                if (onerror) onerror();
                removeRunDependency('cp ' + fullname);
              });
              handled = true;
            }
          });
          if (!handled) finish(byteArray);
        }
        addRunDependency('cp ' + fullname);
        if (typeof url == 'string') {
          Browser.asyncLoad(url, function(byteArray) {
            processData(byteArray);
          }, onerror);
        } else {
          processData(url);
        }
      },indexedDB:function () {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function () {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function (paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
          console.log('creating db');
          var db = openRequest.result;
          db.createObjectStore(FS.DB_STORE_NAME);
        };
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var putRequest = files.put(FS.analyzePath(path).object.contents, path);
            putRequest.onsuccess = function putRequest_onsuccess() { ok++; if (ok + fail == total) finish() };
            putRequest.onerror = function putRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      },loadFilesFromDB:function (paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = onerror; // no database to load from
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          try {
            var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
          } catch(e) {
            onerror(e);
            return;
          }
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var getRequest = files.get(path);
            getRequest.onsuccess = function getRequest_onsuccess() {
              if (FS.analyzePath(path).exists) {
                FS.unlink(path);
              }
              FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
              ok++;
              if (ok + fail == total) finish();
            };
            getRequest.onerror = function getRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      }};
  var _mkport=undefined;var SOCKFS={mount:function (mount) {
        return FS.createNode(null, '/', 16384 | 0777, 0);
      },createSocket:function (family, type, protocol) {
        var streaming = type == 1;
        if (protocol) {
          assert(streaming == (protocol == 6)); // if SOCK_STREAM, must be tcp
        }
        // create our internal socket structure
        var sock = {
          family: family,
          type: type,
          protocol: protocol,
          server: null,
          peers: {},
          pending: [],
          recv_queue: [],
          sock_ops: SOCKFS.websocket_sock_ops
        };
        // create the filesystem node to store the socket structure
        var name = SOCKFS.nextname();
        var node = FS.createNode(SOCKFS.root, name, 49152, 0);
        node.sock = sock;
        // and the wrapping stream that enables library functions such
        // as read and write to indirectly interact with the socket
        var stream = FS.createStream({
          path: name,
          node: node,
          flags: FS.modeStringToFlags('r+'),
          seekable: false,
          stream_ops: SOCKFS.stream_ops
        });
        // map the new stream to the socket structure (sockets have a 1:1
        // relationship with a stream)
        sock.stream = stream;
        return sock;
      },getSocket:function (fd) {
        var stream = FS.getStream(fd);
        if (!stream || !FS.isSocket(stream.node.mode)) {
          return null;
        }
        return stream.node.sock;
      },stream_ops:{poll:function (stream) {
          var sock = stream.node.sock;
          return sock.sock_ops.poll(sock);
        },ioctl:function (stream, request, varargs) {
          var sock = stream.node.sock;
          return sock.sock_ops.ioctl(sock, request, varargs);
        },read:function (stream, buffer, offset, length, position /* ignored */) {
          var sock = stream.node.sock;
          var msg = sock.sock_ops.recvmsg(sock, length);
          if (!msg) {
            // socket is closed
            return 0;
          }
          buffer.set(msg.buffer, offset);
          return msg.buffer.length;
        },write:function (stream, buffer, offset, length, position /* ignored */) {
          var sock = stream.node.sock;
          return sock.sock_ops.sendmsg(sock, buffer, offset, length);
        },close:function (stream) {
          var sock = stream.node.sock;
          sock.sock_ops.close(sock);
        }},nextname:function () {
        if (!SOCKFS.nextname.current) {
          SOCKFS.nextname.current = 0;
        }
        return 'socket[' + (SOCKFS.nextname.current++) + ']';
      },websocket_sock_ops:{createPeer:function (sock, addr, port) {
          var ws;
          if (typeof addr === 'object') {
            ws = addr;
            addr = null;
            port = null;
          }
          if (ws) {
            // for sockets that've already connected (e.g. we're the server)
            // we can inspect the _socket property for the address
            if (ws._socket) {
              addr = ws._socket.remoteAddress;
              port = ws._socket.remotePort;
            }
            // if we're just now initializing a connection to the remote,
            // inspect the url property
            else {
              var result = /ws[s]?:\/\/([^:]+):(\d+)/.exec(ws.url);
              if (!result) {
                throw new Error('WebSocket URL must be in the format ws(s)://address:port');
              }
              addr = result[1];
              port = parseInt(result[2], 10);
            }
          } else {
            // create the actual websocket object and connect
            try {
              var url = 'ws://' + addr + ':' + port;
              // the node ws library API is slightly different than the browser's
              var opts = ENVIRONMENT_IS_NODE ? {headers: {'websocket-protocol': ['binary']}} : ['binary'];
              // If node we use the ws library.
              var WebSocket = ENVIRONMENT_IS_NODE ? require('ws') : window['WebSocket'];
              ws = new WebSocket(url, opts);
              ws.binaryType = 'arraybuffer';
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EHOSTUNREACH);
            }
          }
          var peer = {
            addr: addr,
            port: port,
            socket: ws,
            dgram_send_queue: []
          };
          SOCKFS.websocket_sock_ops.addPeer(sock, peer);
          SOCKFS.websocket_sock_ops.handlePeerEvents(sock, peer);
          // if this is a bound dgram socket, send the port number first to allow
          // us to override the ephemeral port reported to us by remotePort on the
          // remote end.
          if (sock.type === 2 && typeof sock.sport !== 'undefined') {
            peer.dgram_send_queue.push(new Uint8Array([
                255, 255, 255, 255,
                'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0), 't'.charCodeAt(0),
                ((sock.sport & 0xff00) >> 8) , (sock.sport & 0xff)
            ]));
          }
          return peer;
        },getPeer:function (sock, addr, port) {
          return sock.peers[addr + ':' + port];
        },addPeer:function (sock, peer) {
          sock.peers[peer.addr + ':' + peer.port] = peer;
        },removePeer:function (sock, peer) {
          delete sock.peers[peer.addr + ':' + peer.port];
        },handlePeerEvents:function (sock, peer) {
          var first = true;
          var handleOpen = function () {
            try {
              var queued = peer.dgram_send_queue.shift();
              while (queued) {
                peer.socket.send(queued);
                queued = peer.dgram_send_queue.shift();
              }
            } catch (e) {
              // not much we can do here in the way of proper error handling as we've already
              // lied and said this data was sent. shut it down.
              peer.socket.close();
            }
          };
          function handleMessage(data) {
            assert(typeof data !== 'string' && data.byteLength !== undefined);  // must receive an ArrayBuffer
            data = new Uint8Array(data);  // make a typed array view on the array buffer
            // if this is the port message, override the peer's port with it
            var wasfirst = first;
            first = false;
            if (wasfirst &&
                data.length === 10 &&
                data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255 &&
                data[4] === 'p'.charCodeAt(0) && data[5] === 'o'.charCodeAt(0) && data[6] === 'r'.charCodeAt(0) && data[7] === 't'.charCodeAt(0)) {
              // update the peer's port and it's key in the peer map
              var newport = ((data[8] << 8) | data[9]);
              SOCKFS.websocket_sock_ops.removePeer(sock, peer);
              peer.port = newport;
              SOCKFS.websocket_sock_ops.addPeer(sock, peer);
              return;
            }
            sock.recv_queue.push({ addr: peer.addr, port: peer.port, data: data });
          };
          if (ENVIRONMENT_IS_NODE) {
            peer.socket.on('open', handleOpen);
            peer.socket.on('message', function(data, flags) {
              if (!flags.binary) {
                return;
              }
              handleMessage((new Uint8Array(data)).buffer);  // copy from node Buffer -> ArrayBuffer
            });
            peer.socket.on('error', function() {
              // don't throw
            });
          } else {
            peer.socket.onopen = handleOpen;
            peer.socket.onmessage = function peer_socket_onmessage(event) {
              handleMessage(event.data);
            };
          }
        },poll:function (sock) {
          if (sock.type === 1 && sock.server) {
            // listen sockets should only say they're available for reading
            // if there are pending clients.
            return sock.pending.length ? (64 | 1) : 0;
          }
          var mask = 0;
          var dest = sock.type === 1 ?  // we only care about the socket state for connection-based sockets
            SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport) :
            null;
          if (sock.recv_queue.length ||
              !dest ||  // connection-less sockets are always ready to read
              (dest && dest.socket.readyState === dest.socket.CLOSING) ||
              (dest && dest.socket.readyState === dest.socket.CLOSED)) {  // let recv return 0 once closed
            mask |= (64 | 1);
          }
          if (!dest ||  // connection-less sockets are always ready to write
              (dest && dest.socket.readyState === dest.socket.OPEN)) {
            mask |= 4;
          }
          if ((dest && dest.socket.readyState === dest.socket.CLOSING) ||
              (dest && dest.socket.readyState === dest.socket.CLOSED)) {
            mask |= 16;
          }
          return mask;
        },ioctl:function (sock, request, arg) {
          switch (request) {
            case 21531:
              var bytes = 0;
              if (sock.recv_queue.length) {
                bytes = sock.recv_queue[0].data.length;
              }
              HEAP32[((arg)>>2)]=bytes;
              return 0;
            default:
              return ERRNO_CODES.EINVAL;
          }
        },close:function (sock) {
          // if we've spawned a listen server, close it
          if (sock.server) {
            try {
              sock.server.close();
            } catch (e) {
            }
            sock.server = null;
          }
          // close any peer connections
          var peers = Object.keys(sock.peers);
          for (var i = 0; i < peers.length; i++) {
            var peer = sock.peers[peers[i]];
            try {
              peer.socket.close();
            } catch (e) {
            }
            SOCKFS.websocket_sock_ops.removePeer(sock, peer);
          }
          return 0;
        },bind:function (sock, addr, port) {
          if (typeof sock.saddr !== 'undefined' || typeof sock.sport !== 'undefined') {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);  // already bound
          }
          sock.saddr = addr;
          sock.sport = port || _mkport();
          // in order to emulate dgram sockets, we need to launch a listen server when
          // binding on a connection-less socket
          // note: this is only required on the server side
          if (sock.type === 2) {
            // close the existing server if it exists
            if (sock.server) {
              sock.server.close();
              sock.server = null;
            }
            // swallow error operation not supported error that occurs when binding in the
            // browser where this isn't supported
            try {
              sock.sock_ops.listen(sock, 0);
            } catch (e) {
              if (!(e instanceof FS.ErrnoError)) throw e;
              if (e.errno !== ERRNO_CODES.EOPNOTSUPP) throw e;
            }
          }
        },connect:function (sock, addr, port) {
          if (sock.server) {
            throw new FS.ErrnoError(ERRNO_CODS.EOPNOTSUPP);
          }
          // TODO autobind
          // if (!sock.addr && sock.type == 2) {
          // }
          // early out if we're already connected / in the middle of connecting
          if (typeof sock.daddr !== 'undefined' && typeof sock.dport !== 'undefined') {
            var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
            if (dest) {
              if (dest.socket.readyState === dest.socket.CONNECTING) {
                throw new FS.ErrnoError(ERRNO_CODES.EALREADY);
              } else {
                throw new FS.ErrnoError(ERRNO_CODES.EISCONN);
              }
            }
          }
          // add the socket to our peer list and set our
          // destination address / port to match
          var peer = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
          sock.daddr = peer.addr;
          sock.dport = peer.port;
          // always "fail" in non-blocking mode
          throw new FS.ErrnoError(ERRNO_CODES.EINPROGRESS);
        },listen:function (sock, backlog) {
          if (!ENVIRONMENT_IS_NODE) {
            throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
          }
          if (sock.server) {
             throw new FS.ErrnoError(ERRNO_CODES.EINVAL);  // already listening
          }
          var WebSocketServer = require('ws').Server;
          var host = sock.saddr;
          sock.server = new WebSocketServer({
            host: host,
            port: sock.sport
            // TODO support backlog
          });
          sock.server.on('connection', function(ws) {
            if (sock.type === 1) {
              var newsock = SOCKFS.createSocket(sock.family, sock.type, sock.protocol);
              // create a peer on the new socket
              var peer = SOCKFS.websocket_sock_ops.createPeer(newsock, ws);
              newsock.daddr = peer.addr;
              newsock.dport = peer.port;
              // push to queue for accept to pick up
              sock.pending.push(newsock);
            } else {
              // create a peer on the listen socket so calling sendto
              // with the listen socket and an address will resolve
              // to the correct client
              SOCKFS.websocket_sock_ops.createPeer(sock, ws);
            }
          });
          sock.server.on('closed', function() {
            sock.server = null;
          });
          sock.server.on('error', function() {
            // don't throw
          });
        },accept:function (listensock) {
          if (!listensock.server) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
          var newsock = listensock.pending.shift();
          newsock.stream.flags = listensock.stream.flags;
          return newsock;
        },getname:function (sock, peer) {
          var addr, port;
          if (peer) {
            if (sock.daddr === undefined || sock.dport === undefined) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
            }
            addr = sock.daddr;
            port = sock.dport;
          } else {
            // TODO saddr and sport will be set for bind()'d UDP sockets, but what
            // should we be returning for TCP sockets that've been connect()'d?
            addr = sock.saddr || 0;
            port = sock.sport || 0;
          }
          return { addr: addr, port: port };
        },sendmsg:function (sock, buffer, offset, length, addr, port) {
          if (sock.type === 2) {
            // connection-less sockets will honor the message address,
            // and otherwise fall back to the bound destination address
            if (addr === undefined || port === undefined) {
              addr = sock.daddr;
              port = sock.dport;
            }
            // if there was no address to fall back to, error out
            if (addr === undefined || port === undefined) {
              throw new FS.ErrnoError(ERRNO_CODES.EDESTADDRREQ);
            }
          } else {
            // connection-based sockets will only use the bound
            addr = sock.daddr;
            port = sock.dport;
          }
          // find the peer for the destination address
          var dest = SOCKFS.websocket_sock_ops.getPeer(sock, addr, port);
          // early out if not connected with a connection-based socket
          if (sock.type === 1) {
            if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
            } else if (dest.socket.readyState === dest.socket.CONNECTING) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
          }
          // create a copy of the incoming data to send, as the WebSocket API
          // doesn't work entirely with an ArrayBufferView, it'll just send
          // the entire underlying buffer
          var data;
          if (buffer instanceof Array || buffer instanceof ArrayBuffer) {
            data = buffer.slice(offset, offset + length);
          } else {  // ArrayBufferView
            data = buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length);
          }
          // if we're emulating a connection-less dgram socket and don't have
          // a cached connection, queue the buffer to send upon connect and
          // lie, saying the data was sent now.
          if (sock.type === 2) {
            if (!dest || dest.socket.readyState !== dest.socket.OPEN) {
              // if we're not connected, open a new connection
              if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
                dest = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
              }
              dest.dgram_send_queue.push(data);
              return length;
            }
          }
          try {
            // send the actual data
            dest.socket.send(data);
            return length;
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          }
        },recvmsg:function (sock, length) {
          // http://pubs.opengroup.org/onlinepubs/7908799/xns/recvmsg.html
          if (sock.type === 1 && sock.server) {
            // tcp servers should not be recv()'ing on the listen socket
            throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
          }
          var queued = sock.recv_queue.shift();
          if (!queued) {
            if (sock.type === 1) {
              var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
              if (!dest) {
                // if we have a destination address but are not connected, error out
                throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
              }
              else if (dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
                // return null if the socket has closed
                return null;
              }
              else {
                // else, our socket is in a valid state but truly has nothing available
                throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
              }
            } else {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
          }
          // queued.data will be an ArrayBuffer if it's unadulterated, but if it's
          // requeued TCP data it'll be an ArrayBufferView
          var queuedLength = queued.data.byteLength || queued.data.length;
          var queuedOffset = queued.data.byteOffset || 0;
          var queuedBuffer = queued.data.buffer || queued.data;
          var bytesRead = Math.min(length, queuedLength);
          var res = {
            buffer: new Uint8Array(queuedBuffer, queuedOffset, bytesRead),
            addr: queued.addr,
            port: queued.port
          };
          // push back any unread data for TCP connections
          if (sock.type === 1 && bytesRead < queuedLength) {
            var bytesRemaining = queuedLength - bytesRead;
            queued.data = new Uint8Array(queuedBuffer, queuedOffset + bytesRead, bytesRemaining);
            sock.recv_queue.unshift(queued);
          }
          return res;
        }}};function _send(fd, buf, len, flags) {
      var sock = SOCKFS.getSocket(fd);
      if (!sock) {
        ___setErrNo(ERRNO_CODES.EBADF);
        return -1;
      }
      // TODO honor flags
      return _write(fd, buf, len);
    }
  function _pwrite(fildes, buf, nbyte, offset) {
      // ssize_t pwrite(int fildes, const void *buf, size_t nbyte, off_t offset);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/write.html
      var stream = FS.getStream(fildes);
      if (!stream) {
        ___setErrNo(ERRNO_CODES.EBADF);
        return -1;
      }
      try {
        var slab = HEAP8;
        return FS.write(stream, slab, buf, nbyte, offset);
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }function _write(fildes, buf, nbyte) {
      // ssize_t write(int fildes, const void *buf, size_t nbyte);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/write.html
      var stream = FS.getStream(fildes);
      if (!stream) {
        ___setErrNo(ERRNO_CODES.EBADF);
        return -1;
      }
      try {
        var slab = HEAP8;
        return FS.write(stream, slab, buf, nbyte);
      } catch (e) {
        FS.handleFSError(e);
        return -1;
      }
    }function _fwrite(ptr, size, nitems, stream) {
      // size_t fwrite(const void *restrict ptr, size_t size, size_t nitems, FILE *restrict stream);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/fwrite.html
      var bytesToWrite = nitems * size;
      if (bytesToWrite == 0) return 0;
      var bytesWritten = _write(stream, ptr, bytesToWrite);
      if (bytesWritten == -1) {
        var streamObj = FS.getStream(stream);
        if (streamObj) streamObj.error = true;
        return 0;
      } else {
        return Math.floor(bytesWritten / size);
      }
    }
  function _llvm_lifetime_start() {}
  function _llvm_lifetime_end() {}
  function _strlen(ptr) {
      ptr = ptr|0;
      var curr = 0;
      curr = ptr;
      while (HEAP8[(curr)]) {
        curr = (curr + 1)|0;
      }
      return (curr - ptr)|0;
    }function _strdup(ptr) {
      var len = _strlen(ptr);
      var newStr = _malloc(len + 1);
      (_memcpy(newStr, ptr, len)|0);
      HEAP8[(((newStr)+(len))|0)]=0;
      return newStr;
    }
;
;
;
;
;
;
;
;
  function _abort() {
      Module['abort']();
    }
  var _llvm_memset_p0i8_i32=_memset;
  function ___errno_location() {
      return ___errno_state;
    }
  function _sbrk(bytes) {
      // Implement a Linux-like 'memory area' for our 'process'.
      // Changes the size of the memory area by |bytes|; returns the
      // address of the previous top ('break') of the memory area
      // We control the "dynamic" memory - DYNAMIC_BASE to DYNAMICTOP
      var self = _sbrk;
      if (!self.called) {
        DYNAMICTOP = alignMemoryPage(DYNAMICTOP); // make sure we start out aligned
        self.called = true;
        assert(Runtime.dynamicAlloc);
        self.alloc = Runtime.dynamicAlloc;
        Runtime.dynamicAlloc = function() { abort('cannot dynamically allocate, sbrk now has control') };
      }
      var ret = DYNAMICTOP;
      if (bytes != 0) self.alloc(bytes);
      return ret;  // Previous break location.
    }
  function _sysconf(name) {
      // long sysconf(int name);
      // http://pubs.opengroup.org/onlinepubs/009695399/functions/sysconf.html
      switch(name) {
        case 30: return PAGE_SIZE;
        case 132:
        case 133:
        case 12:
        case 137:
        case 138:
        case 15:
        case 235:
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        case 149:
        case 13:
        case 10:
        case 236:
        case 153:
        case 9:
        case 21:
        case 22:
        case 159:
        case 154:
        case 14:
        case 77:
        case 78:
        case 139:
        case 80:
        case 81:
        case 79:
        case 82:
        case 68:
        case 67:
        case 164:
        case 11:
        case 29:
        case 47:
        case 48:
        case 95:
        case 52:
        case 51:
        case 46:
          return 200809;
        case 27:
        case 246:
        case 127:
        case 128:
        case 23:
        case 24:
        case 160:
        case 161:
        case 181:
        case 182:
        case 242:
        case 183:
        case 184:
        case 243:
        case 244:
        case 245:
        case 165:
        case 178:
        case 179:
        case 49:
        case 50:
        case 168:
        case 169:
        case 175:
        case 170:
        case 171:
        case 172:
        case 97:
        case 76:
        case 32:
        case 173:
        case 35:
          return -1;
        case 176:
        case 177:
        case 7:
        case 155:
        case 8:
        case 157:
        case 125:
        case 126:
        case 92:
        case 93:
        case 129:
        case 130:
        case 131:
        case 94:
        case 91:
          return 1;
        case 74:
        case 60:
        case 69:
        case 70:
        case 4:
          return 1024;
        case 31:
        case 42:
        case 72:
          return 32;
        case 87:
        case 26:
        case 33:
          return 2147483647;
        case 34:
        case 1:
          return 47839;
        case 38:
        case 36:
          return 99;
        case 43:
        case 37:
          return 2048;
        case 0: return 2097152;
        case 3: return 65536;
        case 28: return 32768;
        case 44: return 32767;
        case 75: return 16384;
        case 39: return 1000;
        case 89: return 700;
        case 71: return 256;
        case 40: return 255;
        case 2: return 100;
        case 180: return 64;
        case 25: return 20;
        case 5: return 16;
        case 6: return 6;
        case 73: return 4;
        case 84: return 1;
      }
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }
  function _time(ptr) {
      var ret = Math.floor(Date.now()/1000);
      if (ptr) {
        HEAP32[((ptr)>>2)]=ret
      }
      return ret;
    }
  function _llvm_eh_exception() {
      return HEAP32[((_llvm_eh_exception.buf)>>2)];
    }
  function __ZSt18uncaught_exceptionv() { // std::uncaught_exception()
      return !!__ZSt18uncaught_exceptionv.uncaught_exception;
    }
  function ___cxa_is_number_type(type) {
      var isNumber = false;
      try { if (type == __ZTIi) isNumber = true } catch(e){}
      try { if (type == __ZTIj) isNumber = true } catch(e){}
      try { if (type == __ZTIl) isNumber = true } catch(e){}
      try { if (type == __ZTIm) isNumber = true } catch(e){}
      try { if (type == __ZTIx) isNumber = true } catch(e){}
      try { if (type == __ZTIy) isNumber = true } catch(e){}
      try { if (type == __ZTIf) isNumber = true } catch(e){}
      try { if (type == __ZTId) isNumber = true } catch(e){}
      try { if (type == __ZTIe) isNumber = true } catch(e){}
      try { if (type == __ZTIc) isNumber = true } catch(e){}
      try { if (type == __ZTIa) isNumber = true } catch(e){}
      try { if (type == __ZTIh) isNumber = true } catch(e){}
      try { if (type == __ZTIs) isNumber = true } catch(e){}
      try { if (type == __ZTIt) isNumber = true } catch(e){}
      return isNumber;
    }function ___cxa_does_inherit(definiteType, possibilityType, possibility) {
      if (possibility == 0) return false;
      if (possibilityType == 0 || possibilityType == definiteType)
        return true;
      var possibility_type_info;
      if (___cxa_is_number_type(possibilityType)) {
        possibility_type_info = possibilityType;
      } else {
        var possibility_type_infoAddr = HEAP32[((possibilityType)>>2)] - 8;
        possibility_type_info = HEAP32[((possibility_type_infoAddr)>>2)];
      }
      switch (possibility_type_info) {
      case 0: // possibility is a pointer
        // See if definite type is a pointer
        var definite_type_infoAddr = HEAP32[((definiteType)>>2)] - 8;
        var definite_type_info = HEAP32[((definite_type_infoAddr)>>2)];
        if (definite_type_info == 0) {
          // Also a pointer; compare base types of pointers
          var defPointerBaseAddr = definiteType+8;
          var defPointerBaseType = HEAP32[((defPointerBaseAddr)>>2)];
          var possPointerBaseAddr = possibilityType+8;
          var possPointerBaseType = HEAP32[((possPointerBaseAddr)>>2)];
          return ___cxa_does_inherit(defPointerBaseType, possPointerBaseType, possibility);
        } else
          return false; // one pointer and one non-pointer
      case 1: // class with no base class
        return false;
      case 2: // class with base class
        var parentTypeAddr = possibilityType + 8;
        var parentType = HEAP32[((parentTypeAddr)>>2)];
        return ___cxa_does_inherit(definiteType, parentType, possibility);
      default:
        return false; // some unencountered type
      }
    }
  function ___resumeException(ptr) {
      if (HEAP32[((_llvm_eh_exception.buf)>>2)] == 0) HEAP32[((_llvm_eh_exception.buf)>>2)]=ptr;
      throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";;
    }function ___cxa_find_matching_catch(thrown, throwntype) {
      if (thrown == -1) thrown = HEAP32[((_llvm_eh_exception.buf)>>2)];
      if (throwntype == -1) throwntype = HEAP32[(((_llvm_eh_exception.buf)+(4))>>2)];
      var typeArray = Array.prototype.slice.call(arguments, 2);
      // If throwntype is a pointer, this means a pointer has been
      // thrown. When a pointer is thrown, actually what's thrown
      // is a pointer to the pointer. We'll dereference it.
      if (throwntype != 0 && !___cxa_is_number_type(throwntype)) {
        var throwntypeInfoAddr= HEAP32[((throwntype)>>2)] - 8;
        var throwntypeInfo= HEAP32[((throwntypeInfoAddr)>>2)];
        if (throwntypeInfo == 0)
          thrown = HEAP32[((thrown)>>2)];
      }
      // The different catch blocks are denoted by different types.
      // Due to inheritance, those types may not precisely match the
      // type of the thrown object. Find one which matches, and
      // return the type of the catch block which should be called.
      for (var i = 0; i < typeArray.length; i++) {
        if (___cxa_does_inherit(typeArray[i], throwntype, thrown))
          return tempRet0 = typeArray[i],thrown;
      }
      // Shouldn't happen unless we have bogus data in typeArray
      // or encounter a type for which emscripten doesn't have suitable
      // typeinfo defined. Best-efforts match just in case.
      return tempRet0 = throwntype,thrown;
    }function ___gxx_personality_v0() {
    }
  function ___cxa_allocate_exception(size) {
      return _malloc(size);
    }
  function ___cxa_throw(ptr, type, destructor) {
      if (!___cxa_throw.initialized) {
        try {
          HEAP32[((__ZTVN10__cxxabiv119__pointer_type_infoE)>>2)]=0; // Workaround for libcxxabi integration bug
        } catch(e){}
        try {
          HEAP32[((__ZTVN10__cxxabiv117__class_type_infoE)>>2)]=1; // Workaround for libcxxabi integration bug
        } catch(e){}
        try {
          HEAP32[((__ZTVN10__cxxabiv120__si_class_type_infoE)>>2)]=2; // Workaround for libcxxabi integration bug
        } catch(e){}
        ___cxa_throw.initialized = true;
      }
      HEAP32[((_llvm_eh_exception.buf)>>2)]=ptr
      HEAP32[(((_llvm_eh_exception.buf)+(4))>>2)]=type
      HEAP32[(((_llvm_eh_exception.buf)+(8))>>2)]=destructor
      if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
        __ZSt18uncaught_exceptionv.uncaught_exception = 1;
      } else {
        __ZSt18uncaught_exceptionv.uncaught_exception++;
      }
      throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";;
    }
  function ___cxa_call_unexpected(exception) {
      Module.printErr('Unexpected exception thrown, this is not properly supported - aborting');
      ABORT = true;
      throw exception;
    }
  var Browser={mainLoop:{scheduler:null,shouldPause:false,paused:false,queue:[],pause:function () {
          Browser.mainLoop.shouldPause = true;
        },resume:function () {
          if (Browser.mainLoop.paused) {
            Browser.mainLoop.paused = false;
            Browser.mainLoop.scheduler();
          }
          Browser.mainLoop.shouldPause = false;
        },updateStatus:function () {
          if (Module['setStatus']) {
            var message = Module['statusMessage'] || 'Please wait...';
            var remaining = Browser.mainLoop.remainingBlockers;
            var expected = Browser.mainLoop.expectedBlockers;
            if (remaining) {
              if (remaining < expected) {
                Module['setStatus'](message + ' (' + (expected - remaining) + '/' + expected + ')');
              } else {
                Module['setStatus'](message);
              }
            } else {
              Module['setStatus']('');
            }
          }
        }},isFullScreen:false,pointerLock:false,moduleContextCreatedCallbacks:[],workers:[],init:function () {
        if (!Module["preloadPlugins"]) Module["preloadPlugins"] = []; // needs to exist even in workers
        if (Browser.initted || ENVIRONMENT_IS_WORKER) return;
        Browser.initted = true;
        try {
          new Blob();
          Browser.hasBlobConstructor = true;
        } catch(e) {
          Browser.hasBlobConstructor = false;
          console.log("warning: no blob constructor, cannot create blobs with mimetypes");
        }
        Browser.BlobBuilder = typeof MozBlobBuilder != "undefined" ? MozBlobBuilder : (typeof WebKitBlobBuilder != "undefined" ? WebKitBlobBuilder : (!Browser.hasBlobConstructor ? console.log("warning: no BlobBuilder") : null));
        Browser.URLObject = typeof window != "undefined" ? (window.URL ? window.URL : window.webkitURL) : undefined;
        if (!Module.noImageDecoding && typeof Browser.URLObject === 'undefined') {
          console.log("warning: Browser does not support creating object URLs. Built-in browser image decoding will not be available.");
          Module.noImageDecoding = true;
        }
        // Support for plugins that can process preloaded files. You can add more of these to
        // your app by creating and appending to Module.preloadPlugins.
        //
        // Each plugin is asked if it can handle a file based on the file's name. If it can,
        // it is given the file's raw data. When it is done, it calls a callback with the file's
        // (possibly modified) data. For example, a plugin might decompress a file, or it
        // might create some side data structure for use later (like an Image element, etc.).
        var imagePlugin = {};
        imagePlugin['canHandle'] = function imagePlugin_canHandle(name) {
          return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
        };
        imagePlugin['handle'] = function imagePlugin_handle(byteArray, name, onload, onerror) {
          var b = null;
          if (Browser.hasBlobConstructor) {
            try {
              b = new Blob([byteArray], { type: Browser.getMimetype(name) });
              if (b.size !== byteArray.length) { // Safari bug #118630
                // Safari's Blob can only take an ArrayBuffer
                b = new Blob([(new Uint8Array(byteArray)).buffer], { type: Browser.getMimetype(name) });
              }
            } catch(e) {
              Runtime.warnOnce('Blob constructor present but fails: ' + e + '; falling back to blob builder');
            }
          }
          if (!b) {
            var bb = new Browser.BlobBuilder();
            bb.append((new Uint8Array(byteArray)).buffer); // we need to pass a buffer, and must copy the array to get the right data range
            b = bb.getBlob();
          }
          var url = Browser.URLObject.createObjectURL(b);
          var img = new Image();
          img.onload = function img_onload() {
            assert(img.complete, 'Image ' + name + ' could not be decoded');
            var canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            Module["preloadedImages"][name] = canvas;
            Browser.URLObject.revokeObjectURL(url);
            if (onload) onload(byteArray);
          };
          img.onerror = function img_onerror(event) {
            console.log('Image ' + url + ' could not be decoded');
            if (onerror) onerror();
          };
          img.src = url;
        };
        Module['preloadPlugins'].push(imagePlugin);
        var audioPlugin = {};
        audioPlugin['canHandle'] = function audioPlugin_canHandle(name) {
          return !Module.noAudioDecoding && name.substr(-4) in { '.ogg': 1, '.wav': 1, '.mp3': 1 };
        };
        audioPlugin['handle'] = function audioPlugin_handle(byteArray, name, onload, onerror) {
          var done = false;
          function finish(audio) {
            if (done) return;
            done = true;
            Module["preloadedAudios"][name] = audio;
            if (onload) onload(byteArray);
          }
          function fail() {
            if (done) return;
            done = true;
            Module["preloadedAudios"][name] = new Audio(); // empty shim
            if (onerror) onerror();
          }
          if (Browser.hasBlobConstructor) {
            try {
              var b = new Blob([byteArray], { type: Browser.getMimetype(name) });
            } catch(e) {
              return fail();
            }
            var url = Browser.URLObject.createObjectURL(b); // XXX we never revoke this!
            var audio = new Audio();
            audio.addEventListener('canplaythrough', function() { finish(audio) }, false); // use addEventListener due to chromium bug 124926
            audio.onerror = function audio_onerror(event) {
              if (done) return;
              console.log('warning: browser could not fully decode audio ' + name + ', trying slower base64 approach');
              function encode64(data) {
                var BASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                var PAD = '=';
                var ret = '';
                var leftchar = 0;
                var leftbits = 0;
                for (var i = 0; i < data.length; i++) {
                  leftchar = (leftchar << 8) | data[i];
                  leftbits += 8;
                  while (leftbits >= 6) {
                    var curr = (leftchar >> (leftbits-6)) & 0x3f;
                    leftbits -= 6;
                    ret += BASE[curr];
                  }
                }
                if (leftbits == 2) {
                  ret += BASE[(leftchar&3) << 4];
                  ret += PAD + PAD;
                } else if (leftbits == 4) {
                  ret += BASE[(leftchar&0xf) << 2];
                  ret += PAD;
                }
                return ret;
              }
              audio.src = 'data:audio/x-' + name.substr(-3) + ';base64,' + encode64(byteArray);
              finish(audio); // we don't wait for confirmation this worked - but it's worth trying
            };
            audio.src = url;
            // workaround for chrome bug 124926 - we do not always get oncanplaythrough or onerror
            Browser.safeSetTimeout(function() {
              finish(audio); // try to use it even though it is not necessarily ready to play
            }, 10000);
          } else {
            return fail();
          }
        };
        Module['preloadPlugins'].push(audioPlugin);
        // Canvas event setup
        var canvas = Module['canvas'];
        canvas.requestPointerLock = canvas['requestPointerLock'] ||
                                    canvas['mozRequestPointerLock'] ||
                                    canvas['webkitRequestPointerLock'];
        canvas.exitPointerLock = document['exitPointerLock'] ||
                                 document['mozExitPointerLock'] ||
                                 document['webkitExitPointerLock'] ||
                                 function(){}; // no-op if function does not exist
        canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
        function pointerLockChange() {
          Browser.pointerLock = document['pointerLockElement'] === canvas ||
                                document['mozPointerLockElement'] === canvas ||
                                document['webkitPointerLockElement'] === canvas;
        }
        document.addEventListener('pointerlockchange', pointerLockChange, false);
        document.addEventListener('mozpointerlockchange', pointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', pointerLockChange, false);
        if (Module['elementPointerLock']) {
          canvas.addEventListener("click", function(ev) {
            if (!Browser.pointerLock && canvas.requestPointerLock) {
              canvas.requestPointerLock();
              ev.preventDefault();
            }
          }, false);
        }
      },createContext:function (canvas, useWebGL, setInModule, webGLContextAttributes) {
        var ctx;
        try {
          if (useWebGL) {
            var contextAttributes = {
              antialias: false,
              alpha: false
            };
            if (webGLContextAttributes) {
              for (var attribute in webGLContextAttributes) {
                contextAttributes[attribute] = webGLContextAttributes[attribute];
              }
            }
            var errorInfo = '?';
            function onContextCreationError(event) {
              errorInfo = event.statusMessage || errorInfo;
            }
            canvas.addEventListener('webglcontextcreationerror', onContextCreationError, false);
            try {
              ['experimental-webgl', 'webgl'].some(function(webglId) {
                return ctx = canvas.getContext(webglId, contextAttributes);
              });
            } finally {
              canvas.removeEventListener('webglcontextcreationerror', onContextCreationError, false);
            }
          } else {
            ctx = canvas.getContext('2d');
          }
          if (!ctx) throw ':(';
        } catch (e) {
          Module.print('Could not create canvas: ' + [errorInfo, e]);
          return null;
        }
        if (useWebGL) {
          // Set the background of the WebGL canvas to black
          canvas.style.backgroundColor = "black";
          // Warn on context loss
          canvas.addEventListener('webglcontextlost', function(event) {
            alert('WebGL context lost. You will need to reload the page.');
          }, false);
        }
        if (setInModule) {
          GLctx = Module.ctx = ctx;
          Module.useWebGL = useWebGL;
          Browser.moduleContextCreatedCallbacks.forEach(function(callback) { callback() });
          Browser.init();
        }
        return ctx;
      },destroyContext:function (canvas, useWebGL, setInModule) {},fullScreenHandlersInstalled:false,lockPointer:undefined,resizeCanvas:undefined,requestFullScreen:function (lockPointer, resizeCanvas) {
        Browser.lockPointer = lockPointer;
        Browser.resizeCanvas = resizeCanvas;
        if (typeof Browser.lockPointer === 'undefined') Browser.lockPointer = true;
        if (typeof Browser.resizeCanvas === 'undefined') Browser.resizeCanvas = false;
        var canvas = Module['canvas'];
        function fullScreenChange() {
          Browser.isFullScreen = false;
          if ((document['webkitFullScreenElement'] || document['webkitFullscreenElement'] ||
               document['mozFullScreenElement'] || document['mozFullscreenElement'] ||
               document['fullScreenElement'] || document['fullscreenElement']) === canvas) {
            canvas.cancelFullScreen = document['cancelFullScreen'] ||
                                      document['mozCancelFullScreen'] ||
                                      document['webkitCancelFullScreen'];
            canvas.cancelFullScreen = canvas.cancelFullScreen.bind(document);
            if (Browser.lockPointer) canvas.requestPointerLock();
            Browser.isFullScreen = true;
            if (Browser.resizeCanvas) Browser.setFullScreenCanvasSize();
          } else if (Browser.resizeCanvas){
            Browser.setWindowedCanvasSize();
          }
          if (Module['onFullScreen']) Module['onFullScreen'](Browser.isFullScreen);
        }
        if (!Browser.fullScreenHandlersInstalled) {
          Browser.fullScreenHandlersInstalled = true;
          document.addEventListener('fullscreenchange', fullScreenChange, false);
          document.addEventListener('mozfullscreenchange', fullScreenChange, false);
          document.addEventListener('webkitfullscreenchange', fullScreenChange, false);
        }
        canvas.requestFullScreen = canvas['requestFullScreen'] ||
                                   canvas['mozRequestFullScreen'] ||
                                   (canvas['webkitRequestFullScreen'] ? function() { canvas['webkitRequestFullScreen'](Element['ALLOW_KEYBOARD_INPUT']) } : null);
        canvas.requestFullScreen();
      },requestAnimationFrame:function requestAnimationFrame(func) {
        if (typeof window === 'undefined') { // Provide fallback to setTimeout if window is undefined (e.g. in Node.js)
          setTimeout(func, 1000/60);
        } else {
          if (!window.requestAnimationFrame) {
            window.requestAnimationFrame = window['requestAnimationFrame'] ||
                                           window['mozRequestAnimationFrame'] ||
                                           window['webkitRequestAnimationFrame'] ||
                                           window['msRequestAnimationFrame'] ||
                                           window['oRequestAnimationFrame'] ||
                                           window['setTimeout'];
          }
          window.requestAnimationFrame(func);
        }
      },safeCallback:function (func) {
        return function() {
          if (!ABORT) return func.apply(null, arguments);
        };
      },safeRequestAnimationFrame:function (func) {
        return Browser.requestAnimationFrame(function() {
          if (!ABORT) func();
        });
      },safeSetTimeout:function (func, timeout) {
        return setTimeout(function() {
          if (!ABORT) func();
        }, timeout);
      },safeSetInterval:function (func, timeout) {
        return setInterval(function() {
          if (!ABORT) func();
        }, timeout);
      },getMimetype:function (name) {
        return {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'bmp': 'image/bmp',
          'ogg': 'audio/ogg',
          'wav': 'audio/wav',
          'mp3': 'audio/mpeg'
        }[name.substr(name.lastIndexOf('.')+1)];
      },getUserMedia:function (func) {
        if(!window.getUserMedia) {
          window.getUserMedia = navigator['getUserMedia'] ||
                                navigator['mozGetUserMedia'];
        }
        window.getUserMedia(func);
      },getMovementX:function (event) {
        return event['movementX'] ||
               event['mozMovementX'] ||
               event['webkitMovementX'] ||
               0;
      },getMovementY:function (event) {
        return event['movementY'] ||
               event['mozMovementY'] ||
               event['webkitMovementY'] ||
               0;
      },mouseX:0,mouseY:0,mouseMovementX:0,mouseMovementY:0,calculateMouseEvent:function (event) { // event should be mousemove, mousedown or mouseup
        if (Browser.pointerLock) {
          // When the pointer is locked, calculate the coordinates
          // based on the movement of the mouse.
          // Workaround for Firefox bug 764498
          if (event.type != 'mousemove' &&
              ('mozMovementX' in event)) {
            Browser.mouseMovementX = Browser.mouseMovementY = 0;
          } else {
            Browser.mouseMovementX = Browser.getMovementX(event);
            Browser.mouseMovementY = Browser.getMovementY(event);
          }
          // check if SDL is available
          if (typeof SDL != "undefined") {
          	Browser.mouseX = SDL.mouseX + Browser.mouseMovementX;
          	Browser.mouseY = SDL.mouseY + Browser.mouseMovementY;
          } else {
          	// just add the mouse delta to the current absolut mouse position
          	// FIXME: ideally this should be clamped against the canvas size and zero
          	Browser.mouseX += Browser.mouseMovementX;
          	Browser.mouseY += Browser.mouseMovementY;
          }        
        } else {
          // Otherwise, calculate the movement based on the changes
          // in the coordinates.
          var rect = Module["canvas"].getBoundingClientRect();
          var x, y;
          // Neither .scrollX or .pageXOffset are defined in a spec, but
          // we prefer .scrollX because it is currently in a spec draft.
          // (see: http://www.w3.org/TR/2013/WD-cssom-view-20131217/)
          var scrollX = ((typeof window.scrollX !== 'undefined') ? window.scrollX : window.pageXOffset);
          var scrollY = ((typeof window.scrollY !== 'undefined') ? window.scrollY : window.pageYOffset);
          if (event.type == 'touchstart' ||
              event.type == 'touchend' ||
              event.type == 'touchmove') {
            var t = event.touches.item(0);
            if (t) {
              x = t.pageX - (scrollX + rect.left);
              y = t.pageY - (scrollY + rect.top);
            } else {
              return;
            }
          } else {
            x = event.pageX - (scrollX + rect.left);
            y = event.pageY - (scrollY + rect.top);
          }
          // the canvas might be CSS-scaled compared to its backbuffer;
          // SDL-using content will want mouse coordinates in terms
          // of backbuffer units.
          var cw = Module["canvas"].width;
          var ch = Module["canvas"].height;
          x = x * (cw / rect.width);
          y = y * (ch / rect.height);
          Browser.mouseMovementX = x - Browser.mouseX;
          Browser.mouseMovementY = y - Browser.mouseY;
          Browser.mouseX = x;
          Browser.mouseY = y;
        }
      },xhrLoad:function (url, onload, onerror) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function xhr_onload() {
          if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
            onload(xhr.response);
          } else {
            onerror();
          }
        };
        xhr.onerror = onerror;
        xhr.send(null);
      },asyncLoad:function (url, onload, onerror, noRunDep) {
        Browser.xhrLoad(url, function(arrayBuffer) {
          assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
          onload(new Uint8Array(arrayBuffer));
          if (!noRunDep) removeRunDependency('al ' + url);
        }, function(event) {
          if (onerror) {
            onerror();
          } else {
            throw 'Loading data file "' + url + '" failed.';
          }
        });
        if (!noRunDep) addRunDependency('al ' + url);
      },resizeListeners:[],updateResizeListeners:function () {
        var canvas = Module['canvas'];
        Browser.resizeListeners.forEach(function(listener) {
          listener(canvas.width, canvas.height);
        });
      },setCanvasSize:function (width, height, noUpdates) {
        var canvas = Module['canvas'];
        canvas.width = width;
        canvas.height = height;
        if (!noUpdates) Browser.updateResizeListeners();
      },windowedWidth:0,windowedHeight:0,setFullScreenCanvasSize:function () {
        var canvas = Module['canvas'];
        this.windowedWidth = canvas.width;
        this.windowedHeight = canvas.height;
        canvas.width = screen.width;
        canvas.height = screen.height;
        // check if SDL is available   
        if (typeof SDL != "undefined") {
        	var flags = HEAPU32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)];
        	flags = flags | 0x00800000; // set SDL_FULLSCREEN flag
        	HEAP32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)]=flags
        }
        Browser.updateResizeListeners();
      },setWindowedCanvasSize:function () {
        var canvas = Module['canvas'];
        canvas.width = this.windowedWidth;
        canvas.height = this.windowedHeight;
        // check if SDL is available       
        if (typeof SDL != "undefined") {
        	var flags = HEAPU32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)];
        	flags = flags & ~0x00800000; // clear SDL_FULLSCREEN flag
        	HEAP32[((SDL.screen+Runtime.QUANTUM_SIZE*0)>>2)]=flags
        }
        Browser.updateResizeListeners();
      }};
FS.staticInit();__ATINIT__.unshift({ func: function() { if (!Module["noFSInit"] && !FS.init.initialized) FS.init() } });__ATMAIN__.push({ func: function() { FS.ignorePermissions = false } });__ATEXIT__.push({ func: function() { FS.quit() } });Module["FS_createFolder"] = FS.createFolder;Module["FS_createPath"] = FS.createPath;Module["FS_createDataFile"] = FS.createDataFile;Module["FS_createPreloadedFile"] = FS.createPreloadedFile;Module["FS_createLazyFile"] = FS.createLazyFile;Module["FS_createLink"] = FS.createLink;Module["FS_createDevice"] = FS.createDevice;
___errno_state = Runtime.staticAlloc(4); HEAP32[((___errno_state)>>2)]=0;
__ATINIT__.unshift({ func: function() { TTY.init() } });__ATEXIT__.push({ func: function() { TTY.shutdown() } });TTY.utf8 = new Runtime.UTF8Processor();
if (ENVIRONMENT_IS_NODE) { var fs = require("fs"); NODEFS.staticInit(); }
__ATINIT__.push({ func: function() { SOCKFS.root = FS.mount(SOCKFS, {}, null); } });
_llvm_eh_exception.buf = allocate(12, "void*", ALLOC_STATIC);
Module["requestFullScreen"] = function Module_requestFullScreen(lockPointer, resizeCanvas) { Browser.requestFullScreen(lockPointer, resizeCanvas) };
  Module["requestAnimationFrame"] = function Module_requestAnimationFrame(func) { Browser.requestAnimationFrame(func) };
  Module["setCanvasSize"] = function Module_setCanvasSize(width, height, noUpdates) { Browser.setCanvasSize(width, height, noUpdates) };
  Module["pauseMainLoop"] = function Module_pauseMainLoop() { Browser.mainLoop.pause() };
  Module["resumeMainLoop"] = function Module_resumeMainLoop() { Browser.mainLoop.resume() };
  Module["getUserMedia"] = function Module_getUserMedia() { Browser.getUserMedia() }
STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);
staticSealed = true; // seal the static portion of memory
STACK_MAX = STACK_BASE + 5242880;
DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);
assert(DYNAMIC_BASE < TOTAL_MEMORY, "TOTAL_MEMORY not big enough for stack");
var FUNCTION_TABLE = [0,0,__ZN17VizGeorefSpline2D9get_pointEddPd,0,__ZN17VizGeorefSpline2D14serialize_sizeEv,0,__ZNK10__cxxabiv121__vmi_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,0,__ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,0,__ZN10emscripten8internal12operator_newI17VizGeorefSpline2DJiEEEPT_DpT0_,0,__ZNK10__cxxabiv119__pointer_type_info9can_catchEPKNS_16__shim_type_infoERPv,0,__ZNSt9bad_allocD0Ev,0,__ZN17VizGeorefSpline2D9serializeEPc,0,__ZN17VizGeorefSpline2D5solveEv,0,__ZN10__cxxabiv117__class_type_infoD0Ev,0,__ZN10emscripten8internal14raw_destructorI17VizGeorefSpline2DEEvPT_,0,__ZNKSt9bad_alloc4whatEv,0,__ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,0,__ZNK10__cxxabiv123__fundamental_type_info9can_catchEPKNS_16__shim_type_infoERPv,0,__ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFiddPdEiPS2_JddS3_EE6invokeERKS5_S6_ddS3_,0,__ZN10emscripten8internal13getActualTypeI17VizGeorefSpline2DEEPKNS0_7_TYPEIDEPT_,0,__ZN10__cxxabiv116__shim_type_infoD2Ev,0,__ZNK10__cxxabiv121__vmi_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,0,__ZNSt9bad_allocD2Ev,0,__ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib,0,__ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,0,__ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFPcS3_ES3_PS2_JS3_EE6invokeERKS5_S6_S3_,0,__ZNK10__cxxabiv121__vmi_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib,0,__ZNK10__cxxabiv116__shim_type_info5noop1Ev,0,__ZN10__cxxabiv119__pointer_type_infoD0Ev,0,__ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFiddPKdEiPS2_JddS4_EE6invokeERKS6_S7_ddS4_,0,__ZN10emscripten8internal7InvokerIP17VizGeorefSpline2DJiEE6invokeEPFS3_iEi,0,__ZN10__cxxabiv121__vmi_class_type_infoD0Ev,0,__ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFivEiPS2_JEE6invokeERKS4_S5_,0,__ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv,0,__ZN17VizGeorefSpline2D11deserializeEPc,0,__ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,0,__ZN17VizGeorefSpline2D9add_pointEddPKd,0,__ZN10__cxxabiv120__si_class_type_infoD0Ev,0,__ZNK10__cxxabiv116__shim_type_info5noop2Ev,0,__ZN10__cxxabiv123__fundamental_type_infoD0Ev,0,__ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi,0];
// EMSCRIPTEN_START_FUNCS
function __ZN17VizGeorefSpline2D11grow_pointsEv(r1){var r2,r3,r4,r5,r6,r7,r8,r9,r10,r11;r2=r1+12|0;r3=HEAP32[r2>>2];r4=r3<<1;r5=r4+2|0;r6=r4+5|0;if((r3|0)!=0){r3=r1+64|0;r4=r6<<3;HEAP32[r3>>2]=_realloc(HEAP32[r3>>2],r4);r3=r1+68|0;HEAP32[r3>>2]=_realloc(HEAP32[r3>>2],r4);r3=r1+88|0;HEAP32[r3>>2]=_realloc(HEAP32[r3>>2],r4);r3=r1+92|0;r7=r6<<2;HEAP32[r3>>2]=_realloc(HEAP32[r3>>2],r7);r3=r1+96|0;HEAP32[r3>>2]=_realloc(HEAP32[r3>>2],r7);r7=r1+72|0;HEAP32[r7>>2]=_realloc(HEAP32[r7>>2],r4);r7=r1+80|0;HEAP32[r7>>2]=_realloc(HEAP32[r7>>2],r4);r7=r1+76|0;HEAP32[r7>>2]=_realloc(HEAP32[r7>>2],r4);r7=r1+84|0;HEAP32[r7>>2]=_realloc(HEAP32[r7>>2],r4);HEAP32[r2>>2]=r5;return}r4=r6<<3;HEAP32[r1+64>>2]=_malloc(r4);HEAP32[r1+68>>2]=_malloc(r4);HEAP32[r1+88>>2]=_malloc(r4);r7=r6<<2;HEAP32[r1+92>>2]=_malloc(r7);HEAP32[r1+96>>2]=_malloc(r7);r7=r6>>>0>65535;if(r7){r8=(r6&536870911|0)==(r6|0)?r4:-1}else{r8=r4}r3=_malloc(r8);do{if((r3|0)!=0){if((HEAP32[r3-4>>2]&3|0)==0){break}_memset(r3,0,r8)|0}}while(0);HEAP32[r1+72>>2]=r3;if(r7){r9=(r6&536870911|0)==(r6|0)?r4:-1}else{r9=r4}r3=_malloc(r9);do{if((r3|0)!=0){if((HEAP32[r3-4>>2]&3|0)==0){break}_memset(r3,0,r9)|0}}while(0);HEAP32[r1+80>>2]=r3;if(r7){r10=(r6&536870911|0)==(r6|0)?r4:-1}else{r10=r4}r3=_malloc(r10);do{if((r3|0)!=0){if((HEAP32[r3-4>>2]&3|0)==0){break}_memset(r3,0,r10)|0}}while(0);HEAP32[r1+76>>2]=r3;if(r7){r11=(r6&536870911|0)==(r6|0)?r4:-1}else{r11=r4}r4=_malloc(r11);do{if((r4|0)!=0){if((HEAP32[r4-4>>2]&3|0)==0){break}_memset(r4,0,r11)|0}}while(0);HEAP32[r1+84>>2]=r4;HEAP32[r2>>2]=r5;return}function __ZN17VizGeorefSpline2D9add_pointEddPKd(r1,r2,r3,r4){var r5,r6,r7,r8,r9;HEAP32[r1>>2]=5;r5=r1+8|0;r6=HEAP32[r5>>2];if((r6|0)==(HEAP32[r1+12>>2]|0)){__ZN17VizGeorefSpline2D11grow_pointsEv(r1);r7=HEAP32[r5>>2]}else{r7=r6}HEAPF64[HEAP32[r1+64>>2]+(r7<<3)>>3]=r2;HEAPF64[HEAP32[r1+68>>2]+(r7<<3)>>3]=r3;r3=r1+4|0;if((HEAP32[r3>>2]|0)<=0){r8=HEAP32[r5>>2];r9=r8+1|0;HEAP32[r5>>2]=r9;return 1}r2=r7+3|0;r7=0;while(1){HEAPF64[HEAP32[r1+72+(r7<<2)>>2]+(r2<<3)>>3]=HEAPF64[r4+(r7<<3)>>3];r6=r7+1|0;if((r6|0)<(HEAP32[r3>>2]|0)){r7=r6}else{break}}r8=HEAP32[r5>>2];r9=r8+1|0;HEAP32[r5>>2]=r9;return 1}function __ZN17VizGeorefSpline2D5solveEv(r1){var r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32,r33,r34,r35,r36,r37,r38,r39,r40,r41,r42,r43,r44,r45,r46,r47,r48,r49,r50;r2=0;r3=r1+8|0;r4=HEAP32[r3>>2];if((r4|0)<1){HEAP32[r1>>2]=0;r5=0;return r5}if((r4|0)==1){HEAP32[r1>>2]=1;r5=1;return r5}r6=r1+64|0;r7=HEAP32[r6>>2];if((r4|0)==2){r8=HEAPF64[r7+8>>3]-HEAPF64[r7>>3];r9=r1+48|0;HEAPF64[r9>>3]=r8;r10=HEAP32[r1+68>>2];r11=HEAPF64[r10+8>>3]-HEAPF64[r10>>3];r10=1/(r8*r8+r11*r11);HEAPF64[r9>>3]=r8*r10;HEAPF64[r1+56>>3]=r10*r11;HEAP32[r1>>2]=2;r5=2;return r5}r11=HEAPF64[r7>>3];r10=r1+68|0;r8=HEAP32[r10>>2];r9=HEAPF64[r8>>3];r12=r9;r13=r9;r14=0;r15=0;r16=0;r17=0;r18=0;r19=r11;r20=r11;r21=1;r22=r11;r11=r9;while(1){r23=r20>r22?r20:r22;r24=r19<r22?r19:r22;r25=r13>r11?r13:r11;r26=r12<r11?r12:r11;r27=r14+r22;r28=r16+r22*r22;r29=r15+r11;r30=r17+r11*r11;r31=r18+r22*r11;if((r21|0)>=(r4|0)){break}r9=HEAPF64[r7+(r21<<3)>>3];r32=HEAPF64[r8+(r21<<3)>>3];r12=r26;r13=r25;r14=r27;r15=r29;r16=r28;r17=r30;r18=r31;r19=r24;r20=r23;r21=r21+1|0;r22=r9;r11=r32}r11=r23-r24;r24=r25-r26;r26=r27*r27;r25=r4|0;r4=r29*r29;r23=r31-r27*r29/r25;do{if(!(r11<r24*.001|r24<r11*.001)){if(Math_abs(r23*r23/((r30-r4/r25)*(r28-r26/r25)))>.99){break}HEAP32[r1>>2]=4;r29=r1+100|0;r27=HEAP32[r29>>2];if((r27|0)!=0){_free(r27)}r27=r1+104|0;r31=HEAP32[r27>>2];if((r31|0)!=0){_free(r31)}r31=HEAP32[r3>>2];r22=r31+3|0;r21=r1+16|0;HEAP32[r21>>2]=r22;r20=Math_imul(r22,r22)|0;r19=(r20|0)==0;do{if(r19){r33=0}else{r18=r20<<3;if(r20>>>0<=65535){r33=r18;break}r33=((r18>>>0)/(r20>>>0)&-1|0)==8?r18:-1}}while(0);r18=_malloc(r33);do{if((r18|0)!=0){if((HEAP32[r18-4>>2]&3|0)==0){break}_memset(r18,0,r33)|0}}while(0);r17=r18;HEAP32[r29>>2]=r17;do{if(r19){r34=0}else{r16=r20<<3;if(r20>>>0<=65535){r34=r16;break}r34=((r16>>>0)/(r20>>>0)&-1|0)==8?r16:-1}}while(0);r20=_malloc(r34);do{if((r20|0)!=0){if((HEAP32[r20-4>>2]&3|0)==0){break}_memset(r20,0,r34)|0}}while(0);HEAP32[r27>>2]=r20;HEAP32[r18>>2]=0;HEAP32[r18+4>>2]=0;HEAP32[r18+8>>2]=0;HEAP32[r18+12>>2]=0;HEAP32[r18+16>>2]=0;HEAP32[r18+20>>2]=0;HEAPF64[r17+(r22<<3)>>3]=0;HEAPF64[r17+(r31+4<<3)>>3]=0;HEAPF64[r17+(r31+5<<3)>>3]=0;r19=r22<<1;HEAPF64[r17+(r19<<3)>>3]=0;HEAPF64[r17+((r19|1)<<3)>>3]=0;HEAPF64[r17+(r19+2<<3)>>3]=0;do{if((r31|0)>0){r19=0;r16=r17;while(1){r15=r19+3|0;HEAPF64[r16+(r15<<3)>>3]=1;HEAPF64[HEAP32[r29>>2]+(HEAP32[r21>>2]+r15<<3)>>3]=HEAPF64[HEAP32[r6>>2]+(r19<<3)>>3];HEAPF64[HEAP32[r29>>2]+((HEAP32[r21>>2]<<1)+r15<<3)>>3]=HEAPF64[HEAP32[r10>>2]+(r19<<3)>>3];r14=Math_imul(HEAP32[r21>>2],r15)|0;HEAPF64[HEAP32[r29>>2]+(r14<<3)>>3]=1;r14=Math_imul(HEAP32[r21>>2],r15)+1|0;HEAPF64[HEAP32[r29>>2]+(r14<<3)>>3]=HEAPF64[HEAP32[r6>>2]+(r19<<3)>>3];r14=Math_imul(HEAP32[r21>>2],r15)+2|0;HEAPF64[HEAP32[r29>>2]+(r14<<3)>>3]=HEAPF64[HEAP32[r10>>2]+(r19<<3)>>3];r14=r19+1|0;r35=HEAP32[r3>>2];if((r14|0)>=(r35|0)){break}r19=r14;r16=HEAP32[r29>>2]}if((r35|0)>0){r36=0;r37=r35}else{break}while(1){if((r36|0)<(r37|0)){r16=r36+3|0;r19=r36;while(1){r14=HEAP32[r6>>2];r15=HEAPF64[r14+(r36<<3)>>3];r13=HEAP32[r10>>2];r12=HEAPF64[r13+(r36<<3)>>3];r32=HEAPF64[r14+(r19<<3)>>3];r14=HEAPF64[r13+(r19<<3)>>3];if(r15==r32&r12==r14){r38=0}else{r13=r32-r15;r15=r14-r12;r12=r13*r13+r15*r15;r38=r12*Math_log(r12)}r12=r19+3|0;r15=Math_imul(HEAP32[r21>>2],r16)+r12|0;HEAPF64[HEAP32[r29>>2]+(r15<<3)>>3]=r38;if((r36|0)!=(r19|0)){r15=HEAP32[r21>>2];r13=Math_imul(r15,r16)+r12|0;r14=HEAP32[r29>>2];HEAPF64[r14+(Math_imul(r15,r12)+r16<<3)>>3]=HEAPF64[r14+(r13<<3)>>3]}r13=r19+1|0;r14=HEAP32[r3>>2];if((r13|0)<(r14|0)){r19=r13}else{r39=r14;break}}}else{r39=r37}r19=r36+1|0;if((r19|0)<(r39|0)){r36=r19;r37=r39}else{break}}}}while(0);r17=HEAP32[r21>>2];r31=HEAP32[r29>>2];r22=HEAP32[r27>>2];r18=r17<<1;r20=_llvm_umul_with_overflow_i32(Math_imul(r18,r17)|0,8);r19=tempRet0?-1:r20;r20=(r19|0)==0?1:r19;while(1){r40=_malloc(r20);if((r40|0)!=0){break}r19=(tempValue=HEAP32[2280>>2],HEAP32[2280>>2]=tempValue+0,tempValue);if((r19|0)==0){r2=60;break}FUNCTION_TABLE[r19]()}if(r2==60){r20=___cxa_allocate_exception(4);HEAP32[r20>>2]=576;___cxa_throw(r20,1480,38)}r20=r40;if((r17|0)>0){r29=0;while(1){r19=Math_imul(r29,r17)|0;r16=Math_imul(r18,r29)|0;r14=0;while(1){r13=r14+r16|0;HEAPF64[r20+(r13<<3)>>3]=HEAPF64[r31+(r14+r19<<3)>>3];HEAPF64[r20+(r13+r17<<3)>>3]=0;r13=r14+1|0;if((r13|0)<(r17|0)){r14=r13}else{break}}HEAPF64[r20+(r29+r17+r16<<3)>>3]=1;r14=r29+1|0;if((r14|0)<(r17|0)){r29=r14}else{r41=0;break}}while(1){r29=r41+1|0;r31=(r29|0)<(r17|0);do{if(r31){r14=r29;r19=r41;while(1){r13=Math_abs(HEAPF64[r20+(Math_imul(r18,r14)+r41<<3)>>3]);r12=r13>Math_abs(HEAPF64[r20+(Math_imul(r18,r19)+r41<<3)>>3]);r42=r12?r14:r19;r12=r14+1|0;if((r12|0)<(r17|0)){r14=r12;r19=r42}else{break}}if(!((r42|0)!=(r41|0)&(r41|0)<(r18|0))){break}r19=Math_imul(r18,r41)|0;r14=Math_imul(r18,r42)|0;r12=r41;while(1){r13=r20+(r12+r19<<3)|0;r15=HEAPF64[r13>>3];r32=r20+(r12+r14<<3)|0;HEAPF64[r13>>3]=HEAPF64[r32>>3];HEAPF64[r32>>3]=r15;r15=r12+1|0;if((r15|0)<(r18|0)){r12=r15}else{break}}}}while(0);r16=Math_imul(r41<<1,r17)|0;r12=HEAPF64[r20+(r16+r41<<3)>>3];if(r12==0){r2=80;break}if((r41|0)<(r18|0)){r14=r41;while(1){r19=r20+(r14+r16<<3)|0;HEAPF64[r19>>3]=HEAPF64[r19>>3]/r12;r19=r14+1|0;if((r19|0)<(r18|0)){r14=r19}else{r43=0;break}}while(1){if((r43|0)!=(r41|0)){r14=Math_imul(r43<<1,r17)|0;r12=HEAPF64[r20+(r14+r41<<3)>>3];r19=r41;while(1){r15=r20+(r19+r14<<3)|0;HEAPF64[r15>>3]=HEAPF64[r15>>3]-r12*HEAPF64[r20+(r19+r16<<3)>>3];r15=r19+1|0;if((r15|0)<(r18|0)){r19=r15}else{break}}}r19=r43+1|0;if((r19|0)<(r17|0)){r43=r19}else{break}}}if(r31){r41=r29}else{r2=71;break}}if(r2==71){r18=r17<<3;r20=r17<<4;r16=0;while(1){_memcpy(r22+(Math_imul(r16,r17)<<3)|0,r40+(r18+Math_imul(r20,r16))|0,r18)|0;r19=r16+1|0;if((r19|0)<(r17|0)){r16=r19}else{break}}}else if(r2==80){_free(r40);r5=0;return r5}}_free(r40);r16=r1+4|0;r17=HEAP32[r16>>2];if((r17|0)<=0){r5=4;return r5}r18=0;r20=HEAP32[r21>>2];r22=r17;while(1){if((r20|0)>0){r17=r1+80+(r18<<2)|0;r19=r1+72+(r18<<2)|0;r12=0;while(1){HEAPF64[HEAP32[r17>>2]+(r12<<3)>>3]=0;r14=HEAP32[r21>>2];if((r14|0)>0){r15=0;r32=r14;while(1){r13=Math_imul(r32,r12)+r15|0;r9=HEAP32[r17>>2]+(r12<<3)|0;HEAPF64[r9>>3]=HEAPF64[HEAP32[r27>>2]+(r13<<3)>>3]*HEAPF64[HEAP32[r19>>2]+(r15<<3)>>3]+HEAPF64[r9>>3];r9=r15+1|0;r13=HEAP32[r21>>2];if((r9|0)<(r13|0)){r15=r9;r32=r13}else{r44=r13;break}}}else{r44=r14}r32=r12+1|0;if((r32|0)<(r44|0)){r12=r32}else{break}}r45=r44;r46=HEAP32[r16>>2]}else{r45=r20;r46=r22}r12=r18+1|0;if((r12|0)<(r46|0)){r18=r12;r20=r45;r22=r46}else{r5=4;break}}return r5}}while(0);HEAP32[r1>>2]=3;r46=r28*r25-r26;r26=r1+48|0;r28=r30*r25-r4;r4=r1+56|0;r25=1/Math_sqrt(r46*r46+r28*r28);r30=r46*r25;HEAPF64[r26>>3]=r30;r46=r25*r28;HEAPF64[r4>>3]=r46;r28=r1+88|0;r25=r1+92|0;r45=0;r44=r7;r7=r8;r8=r30;r30=r46;while(1){HEAPF64[HEAP32[r28>>2]+(r45<<3)>>3]=(HEAPF64[r44+(r45<<3)>>3]-HEAPF64[r44>>3])*r8+(HEAPF64[r7+(r45<<3)>>3]-HEAPF64[r7>>3])*r30;HEAP32[HEAP32[r25>>2]+(r45<<2)>>2]=1;r46=r45+1|0;r47=HEAP32[r3>>2];if((r46|0)>=(r47|0)){break}r45=r46;r44=HEAP32[r6>>2];r7=HEAP32[r10>>2];r8=HEAPF64[r26>>3];r30=HEAPF64[r4>>3]}if((r47|0)<=0){r5=3;return r5}r4=r1+96|0;r1=0;r30=r47;while(1){if((r30|0)>0){r47=HEAP32[r25>>2];r26=0;r8=-1;r10=0;while(1){if((HEAP32[r47+(r26<<2)>>2]|0)==0){r48=r10;r49=r8}else{r7=HEAPF64[HEAP32[r28>>2]+(r26<<3)>>3];r6=(r8|0)<0|r7<r10;r48=r6?r7:r10;r49=r6?r26:r8}r6=r26+1|0;if((r6|0)<(r30|0)){r26=r6;r8=r49;r10=r48}else{r50=r49;break}}}else{r50=-1}HEAP32[HEAP32[r4>>2]+(r1<<2)>>2]=r50;HEAP32[HEAP32[r25>>2]+(r50<<2)>>2]=0;r10=r1+1|0;r8=HEAP32[r3>>2];if((r10|0)<(r8|0)){r1=r10;r30=r8}else{r5=3;break}}return r5}function __ZN17VizGeorefSpline2D9get_pointEddPd(r1,r2,r3,r4){var r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32,r33,r34,r35,r36,r37,r38,r39,r40,r41,r42,r43,r44,r45,r46,r47,r48,r49,r50,r51,r52,r53,r54,r55,r56,r57,r58,r59,r60,r61,r62,r63,r64,r65,r66,r67,r68,r69,r70,r71,r72,r73,r74,r75,r76,r77,r78,r79,r80,r81,r82,r83,r84,r85,r86,r87,r88,r89,r90,r91,r92,r93,r94,r95,r96,r97,r98,r99,r100,r101,r102,r103,r104,r105,r106,r107,r108,r109,r110,r111,r112,r113,r114,r115,r116,r117,r118,r119,r120,r121,r122,r123,r124,r125,r126,r127,r128,r129,r130,r131,r132,r133,r134,r135,r136,r137,r138,r139,r140,r141,r142,r143,r144,r145,r146,r147,r148,r149,r150,r151,r152,r153,r154,r155,r156,r157,r158,r159,r160,r161,r162,r163,r164,r165,r166,r167,r168,r169,r170,r171,r172,r173,r174,r175,r176,r177,r178,r179,r180,r181,r182,r183,r184,r185,r186,r187,r188,r189,r190,r191,r192,r193,r194,r195,r196,r197,r198,r199,r200,r201,r202,r203,r204,r205,r206,r207,r208,r209,r210,r211,r212,r213,r214,r215,r216,r217,r218,r219,r220,r221,r222,r223,r224,r225,r226;r5=0;r6=r1|0;r7=HEAP32[r6>>2];switch(r7|0){case 1:{r8=r1+4|0;r9=HEAP32[r8>>2];r10=(r9|0)>0;if(r10){r11=0}else{r12=1;return r12}while(1){r13=r1+72+(r11<<2)|0;r14=HEAP32[r13>>2];r15=r14+24|0;r16=HEAPF64[r15>>3];r17=r4+(r11<<3)|0;HEAPF64[r17>>3]=r16;r18=r11+1|0;r19=HEAP32[r8>>2];r20=(r18|0)<(r19|0);if(r20){r11=r18}else{r12=1;break}}return r12;break};case 4:{r21=r1+4|0;r22=HEAP32[r21>>2];r23=(r22|0)>0;if(r23){r24=0;while(1){r25=r1+80+(r24<<2)|0;r26=HEAP32[r25>>2];r27=HEAPF64[r26>>3];r28=r26+8|0;r29=HEAPF64[r28>>3];r30=r29*r2;r31=r27+r30;r32=r26+16|0;r33=HEAPF64[r32>>3];r34=r33*r3;r35=r31+r34;r36=r4+(r24<<3)|0;HEAPF64[r36>>3]=r35;r37=r24+1|0;r38=HEAP32[r21>>2];r39=(r37|0)<(r38|0);if(r39){r24=r37}else{r40=r38;break}}}else{r40=r22}r41=r1+8|0;r42=HEAP32[r41>>2];r43=(r42|0)>0;if(!r43){r12=1;return r12}r44=r1+64|0;r45=r1+68|0;r46=0;r47=r40;r48=r42;while(1){r49=HEAP32[r44>>2];r50=r49+(r46<<3)|0;r51=HEAPF64[r50>>3];r52=HEAP32[r45>>2];r53=r52+(r46<<3)|0;r54=HEAPF64[r53>>3];r55=r51==r2;r56=r54==r3;r57=r55&r56;if(r57){r58=0}else{r59=r51-r2;r60=r59*r59;r61=r54-r3;r62=r61*r61;r63=r60+r62;r64=Math_log(r63);r65=r63*r64;r58=r65}r66=(r47|0)>0;if(r66){r67=r46+3|0;r68=0;while(1){r69=r1+80+(r68<<2)|0;r70=HEAP32[r69>>2];r71=r70+(r67<<3)|0;r72=HEAPF64[r71>>3];r73=r58*r72;r74=r4+(r68<<3)|0;r75=HEAPF64[r74>>3];r76=r75+r73;HEAPF64[r74>>3]=r76;r77=r68+1|0;r78=HEAP32[r21>>2];r79=(r77|0)<(r78|0);if(r79){r68=r77}else{break}}r80=HEAP32[r41>>2];r81=r78;r82=r80}else{r81=r47;r82=r48}r83=r46+1|0;r84=(r83|0)<(r82|0);if(r84){r46=r83;r47=r81;r48=r82}else{r12=1;break}}return r12;break};case 5:{r85=HEAP32[_stderr>>2];r86=_fwrite(240,40,1,r85);r87=_fwrite(160,43,1,r85);r88=r1+4|0;r89=HEAP32[r88>>2];r90=(r89|0)>0;if(r90){r91=0}else{r12=0;return r12}while(1){r92=r4+(r91<<3)|0;HEAPF64[r92>>3]=0;r93=r91+1|0;r94=HEAP32[r88>>2];r95=(r93|0)<(r94|0);if(r95){r91=r93}else{r12=0;break}}return r12;break};case 6:{r96=HEAP32[_stderr>>2];r97=_fwrite(96,42,1,r96);r98=_fwrite(160,43,1,r96);r99=r1+4|0;r100=HEAP32[r99>>2];r101=(r100|0)>0;if(r101){r102=0}else{r12=0;return r12}while(1){r103=r4+(r102<<3)|0;HEAPF64[r103>>3]=0;r104=r102+1|0;r105=HEAP32[r99>>2];r106=(r104|0)<(r105|0);if(r106){r102=r104}else{r12=0;break}}return r12;break};case 0:{r107=r1+4|0;r108=HEAP32[r107>>2];r109=(r108|0)>0;if(r109){r110=0}else{r12=1;return r12}while(1){r111=r4+(r110<<3)|0;HEAPF64[r111>>3]=0;r112=r110+1|0;r113=HEAP32[r107>>2];r114=(r112|0)<(r113|0);if(r114){r110=r112}else{r12=1;break}}return r12;break};case 2:{r115=r1+48|0;r116=HEAPF64[r115>>3];r117=r1+64|0;r118=HEAP32[r117>>2];r119=HEAPF64[r118>>3];r120=r2-r119;r121=r116*r120;r122=r1+56|0;r123=HEAPF64[r122>>3];r124=r1+68|0;r125=HEAP32[r124>>2];r126=HEAPF64[r125>>3];r127=r3-r126;r128=r123*r127;r129=r121+r128;r130=r1+4|0;r131=HEAP32[r130>>2];r132=(r131|0)>0;if(!r132){r12=1;return r12}r133=1-r129;r134=0;while(1){r135=r1+72+(r134<<2)|0;r136=HEAP32[r135>>2];r137=r136+24|0;r138=HEAPF64[r137>>3];r139=r133*r138;r140=r136+32|0;r141=HEAPF64[r140>>3];r142=r129*r141;r143=r139+r142;r144=r4+(r134<<3)|0;HEAPF64[r144>>3]=r143;r145=r134+1|0;r146=HEAP32[r130>>2];r147=(r145|0)<(r146|0);if(r147){r134=r145}else{r12=1;break}}return r12;break};case 3:{r148=r1+48|0;r149=HEAPF64[r148>>3];r150=r1+64|0;r151=HEAP32[r150>>2];r152=HEAPF64[r151>>3];r153=r2-r152;r154=r149*r153;r155=r1+56|0;r156=HEAPF64[r155>>3];r157=r1+68|0;r158=HEAP32[r157>>2];r159=HEAPF64[r158>>3];r160=r3-r159;r161=r156*r160;r162=r154+r161;r163=r1+96|0;r164=HEAP32[r163>>2];r165=HEAP32[r164>>2];r166=r1+88|0;r167=HEAP32[r166>>2];r168=r167+(r165<<3)|0;r169=HEAPF64[r168>>3];r170=r162>r169;L55:do{if(r170){r171=r1+8|0;r172=HEAP32[r171>>2];r173=r172-1|0;r174=r164+(r173<<2)|0;r175=HEAP32[r174>>2];r176=r167+(r175<<3)|0;r177=HEAPF64[r176>>3];r178=r162<r177;if(r178){r179=1;r180=0;r181=0;r182=r165}else{r183=r172-2|0;r184=r164+(r183<<2)|0;r185=HEAP32[r184>>2];r186=r175;r187=r185;break}while(1){r188=(r179|0)<(r172|0);if(!r188){r186=r181;r187=r180;break L55}r189=r164+(r179<<2)|0;r190=HEAP32[r189>>2];r191=r167+(r182<<3)|0;r192=HEAPF64[r191>>3];r193=r162<r192;if(!r193){r194=r167+(r190<<3)|0;r195=HEAPF64[r194>>3];r196=r162>r195;if(!r196){r186=r190;r187=r182;break L55}}r197=r179+1|0;r179=r197;r180=r182;r181=r190;r182=r190}}else{r198=r164+4|0;r199=HEAP32[r198>>2];r186=r199;r187=r165}}while(0);r200=r167+(r187<<3)|0;r201=HEAPF64[r200>>3];r202=r162-r201;r203=r167+(r186<<3)|0;r204=HEAPF64[r203>>3];r205=r204-r201;r206=r202/r205;r207=r1+4|0;r208=HEAP32[r207>>2];r209=(r208|0)>0;if(!r209){r12=1;return r12}r210=1-r206;r211=r187+3|0;r212=r186+3|0;r213=0;while(1){r214=r1+72+(r213<<2)|0;r215=HEAP32[r214>>2];r216=r215+(r211<<3)|0;r217=HEAPF64[r216>>3];r218=r210*r217;r219=r215+(r212<<3)|0;r220=HEAPF64[r219>>3];r221=r206*r220;r222=r218+r221;r223=r4+(r213<<3)|0;HEAPF64[r223>>3]=r222;r224=r213+1|0;r225=HEAP32[r207>>2];r226=(r224|0)<(r225|0);if(r226){r213=r224}else{r12=1;break}}return r12;break};default:{r12=0;return r12}}}function __ZN17VizGeorefSpline2D14serialize_sizeEv(r1){var r2,r3,r4;r2=(HEAP32[r1+12>>2]<<6)+256|0;r3=HEAP32[r1+16>>2];if((HEAP32[r1+100>>2]|0)==0){r4=r2;return r4}r4=Math_imul(r3<<4,r3)+r2|0;return r4}function __ZN17VizGeorefSpline2D9serializeEPc(r1,r2){var r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25;r3=r1+12|0;r4=HEAP32[r3>>2];r5=r4+3|0;r6=r1+16|0;r7=HEAP32[r6>>2];r8=Math_imul(r7,r7)|0;r7=r1+100|0;r9=(HEAP32[r7>>2]|0)!=0;r10=r1+4|0;r11=r2;tempBigInt=HEAPU8[r10]|HEAPU8[r10+1|0]<<8|HEAPU8[r10+2|0]<<16|HEAPU8[r10+3|0]<<24|0;HEAP8[r11]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+3|0]=tempBigInt;r11=r1+8|0;r10=r2+4|0;tempBigInt=HEAPU8[r11]|HEAPU8[r11+1|0]<<8|HEAPU8[r11+2|0]<<16|HEAPU8[r11+3|0]<<24|0;HEAP8[r10]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+3|0]=tempBigInt;r10=r2+8|0;tempBigInt=HEAPU8[r3]|HEAPU8[r3+1|0]<<8|HEAPU8[r3+2|0]<<16|HEAPU8[r3+3|0]<<24|0;HEAP8[r10]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+3|0]=tempBigInt;r10=r2+12|0;tempBigInt=HEAPU8[r6]|HEAPU8[r6+1|0]<<8|HEAPU8[r6+2|0]<<16|HEAPU8[r6+3|0]<<24|0;HEAP8[r10]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+3|0]=tempBigInt;r10=r2+16|0;tempBigInt=r9&1;HEAP8[r10]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+3|0]=tempBigInt;r10=r1|0;r6=r2+20|0;tempBigInt=HEAPU8[r10]|HEAPU8[r10+1|0]<<8|HEAPU8[r10+2|0]<<16|HEAPU8[r10+3|0]<<24|0;HEAP8[r6]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+3|0]=tempBigInt;r6=r1+24|0;r10=r2+24|0;r3=r6|0;r11=r6+4|0;r6=HEAPU8[r11]|HEAPU8[r11+1|0]<<8|HEAPU8[r11+2|0]<<16|HEAPU8[r11+3|0]<<24|0;r11=r10|0;tempBigInt=HEAPU8[r3]|HEAPU8[r3+1|0]<<8|HEAPU8[r3+2|0]<<16|HEAPU8[r3+3|0]<<24|0;HEAP8[r11]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+3|0]=tempBigInt;r11=r10+4|0;tempBigInt=r6;HEAP8[r11]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+3|0]=tempBigInt;r11=r1+32|0;r6=r2+32|0;r10=r11|0;r3=r11+4|0;r11=HEAPU8[r3]|HEAPU8[r3+1|0]<<8|HEAPU8[r3+2|0]<<16|HEAPU8[r3+3|0]<<24|0;r3=r6|0;tempBigInt=HEAPU8[r10]|HEAPU8[r10+1|0]<<8|HEAPU8[r10+2|0]<<16|HEAPU8[r10+3|0]<<24|0;HEAP8[r3]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r3+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r3+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r3+3|0]=tempBigInt;r3=r6+4|0;tempBigInt=r11;HEAP8[r3]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r3+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r3+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r3+3|0]=tempBigInt;r3=r1+40|0;r11=r2+40|0;r6=r3|0;r10=r3+4|0;r3=HEAPU8[r10]|HEAPU8[r10+1|0]<<8|HEAPU8[r10+2|0]<<16|HEAPU8[r10+3|0]<<24|0;r10=r11|0;tempBigInt=HEAPU8[r6]|HEAPU8[r6+1|0]<<8|HEAPU8[r6+2|0]<<16|HEAPU8[r6+3|0]<<24|0;HEAP8[r10]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+3|0]=tempBigInt;r10=r11+4|0;tempBigInt=r3;HEAP8[r10]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r10+3|0]=tempBigInt;r10=r1+48|0;r3=r2+48|0;r11=r10|0;r6=r10+4|0;r10=HEAPU8[r6]|HEAPU8[r6+1|0]<<8|HEAPU8[r6+2|0]<<16|HEAPU8[r6+3|0]<<24|0;r6=r3|0;tempBigInt=HEAPU8[r11]|HEAPU8[r11+1|0]<<8|HEAPU8[r11+2|0]<<16|HEAPU8[r11+3|0]<<24|0;HEAP8[r6]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+3|0]=tempBigInt;r6=r3+4|0;tempBigInt=r10;HEAP8[r6]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r6+3|0]=tempBigInt;r6=r1+56|0;r10=r2+56|0;r3=r6|0;r11=r6+4|0;r6=HEAPU8[r11]|HEAPU8[r11+1|0]<<8|HEAPU8[r11+2|0]<<16|HEAPU8[r11+3|0]<<24|0;r11=r10|0;tempBigInt=HEAPU8[r3]|HEAPU8[r3+1|0]<<8|HEAPU8[r3+2|0]<<16|HEAPU8[r3+3|0]<<24|0;HEAP8[r11]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+3|0]=tempBigInt;r11=r10+4|0;tempBigInt=r6;HEAP8[r11]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r11+3|0]=tempBigInt;r11=r2+64|0;if((r5|0)>0){r6=r1+92|0;r10=r1+96|0;r3=r1+64|0;r12=r1+68|0;r13=r1+88|0;r14=r1+72|0;r15=(r4<<6)+256|0;r4=r1+80|0;r16=r1+76|0;r17=r1+84|0;r18=r11;r19=0;while(1){r20=HEAP32[r6>>2]+(r19<<2)|0;r21=r18;tempBigInt=HEAPU8[r20]|HEAPU8[r20+1|0]<<8|HEAPU8[r20+2|0]<<16|HEAPU8[r20+3|0]<<24|0;HEAP8[r21]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+3|0]=tempBigInt;r21=HEAP32[r10>>2]+(r19<<2)|0;r20=r18+4|0;tempBigInt=HEAPU8[r21]|HEAPU8[r21+1|0]<<8|HEAPU8[r21+2|0]<<16|HEAPU8[r21+3|0]<<24|0;HEAP8[r20]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+3|0]=tempBigInt;r20=HEAP32[r3>>2]+(r19<<3)|0;r21=r18+8|0;r22=r20|0;r23=r20+4|0;r20=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24|0;r23=r21|0;tempBigInt=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24|0;HEAP8[r23]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+3|0]=tempBigInt;r23=r21+4|0;tempBigInt=r20;HEAP8[r23]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+3|0]=tempBigInt;r23=HEAP32[r12>>2]+(r19<<3)|0;r20=r18+16|0;r21=r23|0;r22=r23+4|0;r23=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24|0;r22=r20|0;tempBigInt=HEAPU8[r21]|HEAPU8[r21+1|0]<<8|HEAPU8[r21+2|0]<<16|HEAPU8[r21+3|0]<<24|0;HEAP8[r22]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+3|0]=tempBigInt;r22=r20+4|0;tempBigInt=r23;HEAP8[r22]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+3|0]=tempBigInt;r22=HEAP32[r13>>2]+(r19<<3)|0;r23=r18+24|0;r20=r22|0;r21=r22+4|0;r22=HEAPU8[r21]|HEAPU8[r21+1|0]<<8|HEAPU8[r21+2|0]<<16|HEAPU8[r21+3|0]<<24|0;r21=r23|0;tempBigInt=HEAPU8[r20]|HEAPU8[r20+1|0]<<8|HEAPU8[r20+2|0]<<16|HEAPU8[r20+3|0]<<24|0;HEAP8[r21]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+3|0]=tempBigInt;r21=r23+4|0;tempBigInt=r22;HEAP8[r21]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+3|0]=tempBigInt;r21=HEAP32[r14>>2]+(r19<<3)|0;r22=r18+32|0;r23=r21|0;r20=r21+4|0;r21=HEAPU8[r20]|HEAPU8[r20+1|0]<<8|HEAPU8[r20+2|0]<<16|HEAPU8[r20+3|0]<<24|0;r20=r22|0;tempBigInt=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24|0;HEAP8[r20]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+3|0]=tempBigInt;r20=r22+4|0;tempBigInt=r21;HEAP8[r20]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r20+3|0]=tempBigInt;r20=HEAP32[r4>>2]+(r19<<3)|0;r21=r18+40|0;r22=r20|0;r23=r20+4|0;r20=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24|0;r23=r21|0;tempBigInt=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24|0;HEAP8[r23]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+3|0]=tempBigInt;r23=r21+4|0;tempBigInt=r20;HEAP8[r23]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r23+3|0]=tempBigInt;r23=HEAP32[r16>>2]+(r19<<3)|0;r20=r18+48|0;r21=r23|0;r22=r23+4|0;r23=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24|0;r22=r20|0;tempBigInt=HEAPU8[r21]|HEAPU8[r21+1|0]<<8|HEAPU8[r21+2|0]<<16|HEAPU8[r21+3|0]<<24|0;HEAP8[r22]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+3|0]=tempBigInt;r22=r20+4|0;tempBigInt=r23;HEAP8[r22]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r22+3|0]=tempBigInt;r22=HEAP32[r17>>2]+(r19<<3)|0;r23=r18+56|0;r20=r22|0;r21=r22+4|0;r22=HEAPU8[r21]|HEAPU8[r21+1|0]<<8|HEAPU8[r21+2|0]<<16|HEAPU8[r21+3|0]<<24|0;r21=r23|0;tempBigInt=HEAPU8[r20]|HEAPU8[r20+1|0]<<8|HEAPU8[r20+2|0]<<16|HEAPU8[r20+3|0]<<24|0;HEAP8[r21]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+3|0]=tempBigInt;r21=r23+4|0;tempBigInt=r22;HEAP8[r21]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r21+3|0]=tempBigInt;r21=r19+1|0;if((r21|0)<(r5|0)){r18=r18+64|0;r19=r21}else{break}}r24=r2+r15|0}else{r24=r11}if((r8|0)==0|r9^1){r25=r24;return r25}r9=r1+104|0;r1=(r8|0)>1?r8<<4:16;r11=r24;r15=0;while(1){r2=HEAP32[r7>>2]+(r15<<3)|0;r19=r11;r18=r2|0;r5=r2+4|0;r2=HEAPU8[r5]|HEAPU8[r5+1|0]<<8|HEAPU8[r5+2|0]<<16|HEAPU8[r5+3|0]<<24|0;r5=r19|0;tempBigInt=HEAPU8[r18]|HEAPU8[r18+1|0]<<8|HEAPU8[r18+2|0]<<16|HEAPU8[r18+3|0]<<24|0;HEAP8[r5]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r5+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r5+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r5+3|0]=tempBigInt;r5=r19+4|0;tempBigInt=r2;HEAP8[r5]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r5+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r5+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r5+3|0]=tempBigInt;r5=HEAP32[r9>>2]+(r15<<3)|0;r2=r11+8|0;r19=r5|0;r18=r5+4|0;r5=HEAPU8[r18]|HEAPU8[r18+1|0]<<8|HEAPU8[r18+2|0]<<16|HEAPU8[r18+3|0]<<24|0;r18=r2|0;tempBigInt=HEAPU8[r19]|HEAPU8[r19+1|0]<<8|HEAPU8[r19+2|0]<<16|HEAPU8[r19+3|0]<<24|0;HEAP8[r18]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+3|0]=tempBigInt;r18=r2+4|0;tempBigInt=r5;HEAP8[r18]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+3|0]=tempBigInt;r18=r15+1|0;if((r18|0)<(r8|0)){r11=r11+16|0;r15=r18}else{break}}r25=r24+r1|0;return r25}function __ZN17VizGeorefSpline2D11deserializeEPc(r1,r2){var r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26;r3=r1+100|0;r4=HEAP32[r3>>2];if((r4|0)!=0){_free(r4);HEAP32[r3>>2]=0}r4=r1+104|0;r5=HEAP32[r4>>2];if((r5|0)!=0){_free(r5);HEAP32[r4>>2]=0}r5=r1+64|0;_free(HEAP32[r5>>2]);r6=r1+68|0;_free(HEAP32[r6>>2]);r7=r1+88|0;_free(HEAP32[r7>>2]);r8=r1+92|0;_free(HEAP32[r8>>2]);r9=r1+96|0;_free(HEAP32[r9>>2]);r10=r1+72|0;_free(HEAP32[r10>>2]);r11=r1+80|0;_free(HEAP32[r11>>2]);r12=r1+76|0;_free(HEAP32[r12>>2]);r13=r1+84|0;_free(HEAP32[r13>>2]);r14=r1+4|0;r15=r2;tempBigInt=HEAPU8[r15]|HEAPU8[r15+1|0]<<8|HEAPU8[r15+2|0]<<16|HEAPU8[r15+3|0]<<24|0;HEAP8[r14]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+3|0]=tempBigInt;r14=r1+8|0;r15=r2+4|0;tempBigInt=HEAPU8[r15]|HEAPU8[r15+1|0]<<8|HEAPU8[r15+2|0]<<16|HEAPU8[r15+3|0]<<24|0;HEAP8[r14]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+3|0]=tempBigInt;r14=r1+12|0;r15=r2+8|0;r16=HEAPU8[r15]|HEAPU8[r15+1|0]<<8|HEAPU8[r15+2|0]<<16|HEAPU8[r15+3|0]<<24|0;tempBigInt=r16;HEAP8[r14]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+3|0]=tempBigInt;r14=r1+16|0;r15=r2+12|0;r17=HEAPU8[r15]|HEAPU8[r15+1|0]<<8|HEAPU8[r15+2|0]<<16|HEAPU8[r15+3|0]<<24|0;tempBigInt=r17;HEAP8[r14]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r14+3|0]=tempBigInt;r14=r2+16|0;r15=HEAPU8[r14]|HEAPU8[r14+1|0]<<8|HEAPU8[r14+2|0]<<16|HEAPU8[r14+3|0]<<24|0;r14=r2+20|0;r18=r1|0;tempBigInt=HEAPU8[r14]|HEAPU8[r14+1|0]<<8|HEAPU8[r14+2|0]<<16|HEAPU8[r14+3|0]<<24|0;HEAP8[r18]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r18+3|0]=tempBigInt;r18=r1+24|0;r14=r2+24|0;r19=(HEAP32[tempDoublePtr>>2]=HEAPU8[r14]|HEAPU8[r14+1|0]<<8|HEAPU8[r14+2|0]<<16|HEAPU8[r14+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r14+4|0]|HEAPU8[r14+5|0]<<8|HEAPU8[r14+6|0]<<16|HEAPU8[r14+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r19,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r18]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r18+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+7|0]=tempBigInt;r18=r1+32|0;r19=r2+32|0;r14=(HEAP32[tempDoublePtr>>2]=HEAPU8[r19]|HEAPU8[r19+1|0]<<8|HEAPU8[r19+2|0]<<16|HEAPU8[r19+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r19+4|0]|HEAPU8[r19+5|0]<<8|HEAPU8[r19+6|0]<<16|HEAPU8[r19+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r14,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r18]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r18+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+7|0]=tempBigInt;r18=r1+40|0;r14=r2+40|0;r19=(HEAP32[tempDoublePtr>>2]=HEAPU8[r14]|HEAPU8[r14+1|0]<<8|HEAPU8[r14+2|0]<<16|HEAPU8[r14+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r14+4|0]|HEAPU8[r14+5|0]<<8|HEAPU8[r14+6|0]<<16|HEAPU8[r14+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r19,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r18]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r18+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+7|0]=tempBigInt;r18=r1+48|0;r19=r2+48|0;r14=(HEAP32[tempDoublePtr>>2]=HEAPU8[r19]|HEAPU8[r19+1|0]<<8|HEAPU8[r19+2|0]<<16|HEAPU8[r19+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r19+4|0]|HEAPU8[r19+5|0]<<8|HEAPU8[r19+6|0]<<16|HEAPU8[r19+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r14,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r18]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r18+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+7|0]=tempBigInt;r18=r1+56|0;r1=r2+56|0;r14=(HEAP32[tempDoublePtr>>2]=HEAPU8[r1]|HEAPU8[r1+1|0]<<8|HEAPU8[r1+2|0]<<16|HEAPU8[r1+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r1+4|0]|HEAPU8[r1+5|0]<<8|HEAPU8[r1+6|0]<<16|HEAPU8[r1+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r14,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r18]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r18+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r18+7|0]=tempBigInt;r18=r16+3|0;r14=r18<<3;HEAP32[r5>>2]=_malloc(r14);HEAP32[r6>>2]=_malloc(r14);HEAP32[r7>>2]=_malloc(r14);r1=r18<<2;r19=_malloc(r1);HEAP32[r8>>2]=r19;HEAP32[r9>>2]=_malloc(r1);r1=r18>>>0>65535;if(r1){r20=(r18&536870911|0)==(r18|0)?r14:-1}else{r20=r14}r21=_malloc(r20);do{if((r21|0)!=0){if((HEAP32[r21-4>>2]&3|0)==0){break}_memset(r21,0,r20)|0}}while(0);HEAP32[r10>>2]=r21;if(r1){r22=(r18&536870911|0)==(r18|0)?r14:-1}else{r22=r14}r21=_malloc(r22);do{if((r21|0)!=0){if((HEAP32[r21-4>>2]&3|0)==0){break}_memset(r21,0,r22)|0}}while(0);HEAP32[r11>>2]=r21;if(r1){r23=(r18&536870911|0)==(r18|0)?r14:-1}else{r23=r14}r21=_malloc(r23);do{if((r21|0)!=0){if((HEAP32[r21-4>>2]&3|0)==0){break}_memset(r21,0,r23)|0}}while(0);HEAP32[r12>>2]=r21;if(r1){r24=(r18&536870911|0)==(r18|0)?r14:-1}else{r24=r14}r14=_malloc(r24);do{if((r14|0)!=0){if((HEAP32[r14-4>>2]&3|0)==0){break}_memset(r14,0,r24)|0}}while(0);HEAP32[r13>>2]=r14;r14=r2+64|0;r24=Math_imul(r17,r17)|0;if((r18|0)>0){r17=(r16<<6)+256|0;r16=r14;r1=0;r21=r19;while(1){r19=r21+(r1<<2)|0;r23=r16;tempBigInt=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24|0;HEAP8[r19]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r19+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r19+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r19+3|0]=tempBigInt;r19=HEAP32[r9>>2]+(r1<<2)|0;r23=r16+4|0;tempBigInt=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24|0;HEAP8[r19]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r19+1|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r19+2|0]=tempBigInt;tempBigInt=tempBigInt>>8;HEAP8[r19+3|0]=tempBigInt;r19=HEAP32[r5>>2]+(r1<<3)|0;r23=r16+8|0;r22=(HEAP32[tempDoublePtr>>2]=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r23+4|0]|HEAPU8[r23+5|0]<<8|HEAPU8[r23+6|0]<<16|HEAPU8[r23+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r22,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=HEAP32[r6>>2]+(r1<<3)|0;r22=r16+16|0;r23=(HEAP32[tempDoublePtr>>2]=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r22+4|0]|HEAPU8[r22+5|0]<<8|HEAPU8[r22+6|0]<<16|HEAPU8[r22+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r23,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=HEAP32[r7>>2]+(r1<<3)|0;r23=r16+24|0;r22=(HEAP32[tempDoublePtr>>2]=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r23+4|0]|HEAPU8[r23+5|0]<<8|HEAPU8[r23+6|0]<<16|HEAPU8[r23+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r22,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=HEAP32[r10>>2]+(r1<<3)|0;r22=r16+32|0;r23=(HEAP32[tempDoublePtr>>2]=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r22+4|0]|HEAPU8[r22+5|0]<<8|HEAPU8[r22+6|0]<<16|HEAPU8[r22+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r23,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=HEAP32[r11>>2]+(r1<<3)|0;r23=r16+40|0;r22=(HEAP32[tempDoublePtr>>2]=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r23+4|0]|HEAPU8[r23+5|0]<<8|HEAPU8[r23+6|0]<<16|HEAPU8[r23+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r22,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=HEAP32[r12>>2]+(r1<<3)|0;r22=r16+48|0;r23=(HEAP32[tempDoublePtr>>2]=HEAPU8[r22]|HEAPU8[r22+1|0]<<8|HEAPU8[r22+2|0]<<16|HEAPU8[r22+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r22+4|0]|HEAPU8[r22+5|0]<<8|HEAPU8[r22+6|0]<<16|HEAPU8[r22+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r23,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=HEAP32[r13>>2]+(r1<<3)|0;r23=r16+56|0;r22=(HEAP32[tempDoublePtr>>2]=HEAPU8[r23]|HEAPU8[r23+1|0]<<8|HEAPU8[r23+2|0]<<16|HEAPU8[r23+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r23+4|0]|HEAPU8[r23+5|0]<<8|HEAPU8[r23+6|0]<<16|HEAPU8[r23+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r22,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r19]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r19+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r19+7|0]=tempBigInt;r19=r1+1|0;if((r19|0)>=(r18|0)){break}r16=r16+64|0;r1=r19;r21=HEAP32[r8>>2]}r25=r2+r17|0}else{r25=r14}if((r15|0)==0){r26=r25;return r26}r15=r24<<3;r14=_malloc(r15);HEAP32[r3>>2]=r14;HEAP32[r4>>2]=_malloc(r15);if((r24|0)==0){r26=r25;return r26}r15=(r24|0)>1?r24<<4:16;r17=r25;r2=0;r8=r14;while(1){r14=r8+(r2<<3)|0;r21=r17;r1=(HEAP32[tempDoublePtr>>2]=HEAPU8[r21]|HEAPU8[r21+1|0]<<8|HEAPU8[r21+2|0]<<16|HEAPU8[r21+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r21+4|0]|HEAPU8[r21+5|0]<<8|HEAPU8[r21+6|0]<<16|HEAPU8[r21+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r1,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r14]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r14+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+7|0]=tempBigInt;r14=HEAP32[r4>>2]+(r2<<3)|0;r1=r17+8|0;r21=(HEAP32[tempDoublePtr>>2]=HEAPU8[r1]|HEAPU8[r1+1|0]<<8|HEAPU8[r1+2|0]<<16|HEAPU8[r1+3|0]<<24,HEAP32[tempDoublePtr+4>>2]=HEAPU8[r1+4|0]|HEAPU8[r1+5|0]<<8|HEAPU8[r1+6|0]<<16|HEAPU8[r1+7|0]<<24,HEAPF64[tempDoublePtr>>3]);HEAPF64[tempDoublePtr>>3]=r21,tempBigInt=HEAP32[tempDoublePtr>>2],HEAP8[r14]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+1|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+2|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+3|0]=tempBigInt,tempBigInt=HEAP32[tempDoublePtr+4>>2],HEAP8[r14+4|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+5|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+6|0]=tempBigInt,tempBigInt=tempBigInt>>8,HEAP8[r14+7|0]=tempBigInt;r14=r2+1|0;if((r14|0)>=(r24|0)){break}r17=r17+16|0;r2=r14;r8=HEAP32[r3>>2]}r26=r25+r15|0;return r26}function __ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFPcS3_ES3_PS2_JS3_EE6invokeERKS5_S6_S3_(r1,r2,r3){var r4,r5,r6,r7;r4=r2+HEAP32[r1+4>>2]|0;r2=r4;r5=HEAP32[r1>>2];if((r5&1|0)==0){r6=r5;r7=FUNCTION_TABLE[r6](r2,r3);return r7}else{r6=HEAP32[HEAP32[r4>>2]+(r5-1)>>2];r7=FUNCTION_TABLE[r6](r2,r3);return r7}}function __ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFiddPdEiPS2_JddS3_EE6invokeERKS5_S6_ddS3_(r1,r2,r3,r4,r5){var r6,r7,r8,r9;r6=r2+HEAP32[r1+4>>2]|0;r2=r6;r7=HEAP32[r1>>2];if((r7&1|0)==0){r8=r7;r9=FUNCTION_TABLE[r8](r2,r3,r4,r5);return r9}else{r8=HEAP32[HEAP32[r6>>2]+(r7-1)>>2];r9=FUNCTION_TABLE[r8](r2,r3,r4,r5);return r9}}function __ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFivEiPS2_JEE6invokeERKS4_S5_(r1,r2){var r3,r4,r5,r6;r3=r2+HEAP32[r1+4>>2]|0;r2=r3;r4=HEAP32[r1>>2];if((r4&1|0)==0){r5=r4;r6=FUNCTION_TABLE[r5](r2);return r6}else{r5=HEAP32[HEAP32[r3>>2]+(r4-1)>>2];r6=FUNCTION_TABLE[r5](r2);return r6}}function __ZN10emscripten8internal13MethodInvokerIM17VizGeorefSpline2DFiddPKdEiPS2_JddS4_EE6invokeERKS6_S7_ddS4_(r1,r2,r3,r4,r5){var r6,r7,r8,r9;r6=r2+HEAP32[r1+4>>2]|0;r2=r6;r7=HEAP32[r1>>2];if((r7&1|0)==0){r8=r7;r9=FUNCTION_TABLE[r8](r2,r3,r4,r5);return r9}else{r8=HEAP32[HEAP32[r6>>2]+(r7-1)>>2];r9=FUNCTION_TABLE[r8](r2,r3,r4,r5);return r9}}function __ZN10emscripten8internal12operator_newI17VizGeorefSpline2DJiEEEPT_DpT0_(r1){var r2,r3,r4,r5;r2=0;while(1){r3=_malloc(112);if((r3|0)!=0){break}r4=(tempValue=HEAP32[2280>>2],HEAP32[2280>>2]=tempValue+0,tempValue);if((r4|0)==0){r2=9;break}FUNCTION_TABLE[r4]()}if(r2==9){r2=___cxa_allocate_exception(4);HEAP32[r2>>2]=576;___cxa_throw(r2,1480,38)}r2=r3;HEAP32[r3+88>>2]=0;HEAP32[r3+68>>2]=0;HEAP32[r3+64>>2]=0;HEAP32[r3+96>>2]=0;HEAP32[r3+92>>2]=0;if((r1|0)>0){r4=0;while(1){HEAP32[r2+72+(r4<<2)>>2]=0;HEAP32[r2+80+(r4<<2)>>2]=0;r5=r4+1|0;if((r5|0)<(r1|0)){r4=r5}else{break}}}r4=r3+24|0;HEAP32[r4>>2]=0;HEAP32[r4+4>>2]=0;HEAP32[r4+8>>2]=0;HEAP32[r4+12>>2]=0;HEAPF64[r3+40>>3]=10;HEAP32[r3+8>>2]=0;HEAP32[r3+4>>2]=r1;HEAP32[r3+12>>2]=0;HEAP32[r3+100>>2]=0;HEAP32[r3+104>>2]=0;__ZN17VizGeorefSpline2D11grow_pointsEv(r2);HEAP32[r3>>2]=0;return r2}function __ZN10emscripten8internal7InvokerIP17VizGeorefSpline2DJiEE6invokeEPFS3_iEi(r1,r2){return FUNCTION_TABLE[r1](r2)}function __ZN10emscripten8internal13getActualTypeI17VizGeorefSpline2DEEPKNS0_7_TYPEIDEPT_(r1){if((r1|0)==0){___assert_fail(432,352,797,552)}else{return 1768}}function __ZN10emscripten8internal14raw_destructorI17VizGeorefSpline2DEEvPT_(r1){var r2,r3,r4;if((r1|0)==0){return}r2=HEAP32[r1+100>>2];if((r2|0)!=0){_free(r2)}r2=HEAP32[r1+104>>2];if((r2|0)!=0){_free(r2)}_free(HEAP32[r1+64>>2]);_free(HEAP32[r1+68>>2]);_free(HEAP32[r1+88>>2]);_free(HEAP32[r1+92>>2]);_free(HEAP32[r1+96>>2]);r2=r1+4|0;if((HEAP32[r2>>2]|0)>0){r3=0;while(1){_free(HEAP32[r1+72+(r3<<2)>>2]);_free(HEAP32[r1+80+(r3<<2)>>2]);r4=r3+1|0;if((r4|0)<(HEAP32[r2>>2]|0)){r3=r4}else{break}}}_free(r1);return}function __GLOBAL__I_a(){var r1,r2,r3,r4,r5,r6,r7,r8,r9;r1=STACKTOP;STACKTOP=STACKTOP+128|0;r2=r1;r3=r1+16;r4=r1+32;r5=r1+48;r6=r1+72;r7=r1+88;r8=r1+112;__embind_register_class(1768,1560,1544,0,32,0,0,64,22);HEAP32[r8>>2]=2;r9=r8+4|0;HEAP32[r9>>2]=1560;HEAP32[r8+8>>2]=__ZTIi;__embind_register_class_constructor(1768,2,r9,54,10);HEAP32[r7>>2]=5;r9=r7+4|0;HEAP32[r9>>2]=__ZTIi;HEAP32[r7+8>>2]=1560;HEAP32[r7+12>>2]=__ZTId;HEAP32[r7+16>>2]=__ZTId;HEAP32[r7+20>>2]=1528;r7=_malloc(8);if((r7|0)!=0){r8=r7;HEAP32[r8>>2]=66;HEAP32[r8+4>>2]=0}__embind_register_class_function(1768,40,5,r9,52,r7);HEAP32[r6>>2]=2;r7=r6+4|0;HEAP32[r7>>2]=__ZTIi;HEAP32[r6+8>>2]=1560;r6=_malloc(8);if((r6|0)!=0){r9=r6;HEAP32[r9>>2]=18;HEAP32[r9+4>>2]=0}__embind_register_class_function(1768,16,2,r7,58,r6);HEAP32[r5>>2]=5;r6=r5+4|0;HEAP32[r6>>2]=__ZTIi;HEAP32[r5+8>>2]=1560;HEAP32[r5+12>>2]=__ZTId;HEAP32[r5+16>>2]=__ZTId;HEAP32[r5+20>>2]=1496;r5=_malloc(8);if((r5|0)!=0){r7=r5;HEAP32[r7>>2]=2;HEAP32[r7+4>>2]=0}__embind_register_class_function(1768,536,5,r6,30,r5);HEAP32[r4>>2]=2;r5=r4+4|0;HEAP32[r5>>2]=__ZTIi;HEAP32[r4+8>>2]=1560;r4=_malloc(8);if((r4|0)!=0){r6=r4;HEAP32[r6>>2]=4;HEAP32[r6+4>>2]=0}__embind_register_class_function(1768,504,2,r5,58,r4);HEAP32[r3>>2]=3;r4=r3+4|0;HEAP32[r4>>2]=1512;HEAP32[r3+8>>2]=1560;HEAP32[r3+12>>2]=1512;r3=_malloc(8);if((r3|0)!=0){r5=r3;HEAP32[r5>>2]=16;HEAP32[r5+4>>2]=0}__embind_register_class_function(1768,480,3,r4,44,r3);HEAP32[r2>>2]=3;r3=r2+4|0;HEAP32[r3>>2]=1512;HEAP32[r2+8>>2]=1560;HEAP32[r2+12>>2]=1512;r2=_malloc(8);if((r2|0)==0){__embind_register_class_function(1768,456,3,r3,44,r2);STACKTOP=r1;return}r4=r2;HEAP32[r4>>2]=62;HEAP32[r4+4>>2]=0;__embind_register_class_function(1768,456,3,r3,44,r2);STACKTOP=r1;return}function ___getTypeName(r1){return _strdup(HEAP32[r1+4>>2])}function __GLOBAL__I_a23(){__embind_register_void(1448,296);__embind_register_bool(1456,328,1,0);__embind_register_integer(__ZTIc,288,-128,127);__embind_register_integer(__ZTIa,208,-128,127);__embind_register_integer(__ZTIh,144,0,255);__embind_register_integer(__ZTIs,88,-32768,32767);__embind_register_integer(__ZTIt,72,0,65535);__embind_register_integer(__ZTIi,56,-2147483648,2147483647);__embind_register_integer(__ZTIj,24,0,-1);__embind_register_integer(__ZTIl,8,-2147483648,2147483647);__embind_register_integer(__ZTIm,520,0,-1);__embind_register_float(__ZTIf,496);__embind_register_float(__ZTId,472);__embind_register_std_string(1608,440);__embind_register_std_wstring(1584,4,416);__embind_register_emval(1632,336);__embind_register_memory_view(1640,304);return}function __ZN10__cxxabiv116__shim_type_infoD2Ev(r1){return}function __ZNK10__cxxabiv116__shim_type_info5noop1Ev(r1){return}function __ZNK10__cxxabiv116__shim_type_info5noop2Ev(r1){return}function __ZN10__cxxabiv123__fundamental_type_infoD0Ev(r1){if((r1|0)==0){return}_free(r1);return}function __ZN10__cxxabiv117__class_type_infoD0Ev(r1){if((r1|0)==0){return}_free(r1);return}function __ZN10__cxxabiv120__si_class_type_infoD0Ev(r1){if((r1|0)==0){return}_free(r1);return}function __ZN10__cxxabiv121__vmi_class_type_infoD0Ev(r1){if((r1|0)==0){return}_free(r1);return}function __ZN10__cxxabiv119__pointer_type_infoD0Ev(r1){if((r1|0)==0){return}_free(r1);return}function __ZNK10__cxxabiv123__fundamental_type_info9can_catchEPKNS_16__shim_type_infoERPv(r1,r2,r3){return(r1|0)==(r2|0)}function __ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv(r1,r2,r3){var r4,r5,r6,r7;r4=STACKTOP;STACKTOP=STACKTOP+56|0;r5=r4;if((r1|0)==(r2|0)){r6=1;STACKTOP=r4;return r6}if((r2|0)==0){r6=0;STACKTOP=r4;return r6}r7=___dynamic_cast(r2,1728);r2=r7;if((r7|0)==0){r6=0;STACKTOP=r4;return r6}_memset(r5,0,56)|0;HEAP32[r5>>2]=r2;HEAP32[r5+8>>2]=r1;HEAP32[r5+12>>2]=-1;HEAP32[r5+48>>2]=1;FUNCTION_TABLE[HEAP32[HEAP32[r7>>2]+28>>2]](r2,r5,HEAP32[r3>>2],1);if((HEAP32[r5+24>>2]|0)!=1){r6=0;STACKTOP=r4;return r6}HEAP32[r3>>2]=HEAP32[r5+16>>2];r6=1;STACKTOP=r4;return r6}function __ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi(r1,r2,r3,r4){var r5;if((HEAP32[r2+8>>2]|0)!=(r1|0)){return}r1=r2+16|0;r5=HEAP32[r1>>2];if((r5|0)==0){HEAP32[r1>>2]=r3;HEAP32[r2+24>>2]=r4;HEAP32[r2+36>>2]=1;return}if((r5|0)!=(r3|0)){r3=r2+36|0;HEAP32[r3>>2]=HEAP32[r3>>2]+1;HEAP32[r2+24>>2]=2;HEAP8[r2+54|0]=1;return}r3=r2+24|0;if((HEAP32[r3>>2]|0)!=2){return}HEAP32[r3>>2]=r4;return}function __ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi(r1,r2,r3,r4){var r5;if((r1|0)!=(HEAP32[r2+8>>2]|0)){r5=HEAP32[r1+8>>2];FUNCTION_TABLE[HEAP32[HEAP32[r5>>2]+28>>2]](r5,r2,r3,r4);return}r5=r2+16|0;r1=HEAP32[r5>>2];if((r1|0)==0){HEAP32[r5>>2]=r3;HEAP32[r2+24>>2]=r4;HEAP32[r2+36>>2]=1;return}if((r1|0)!=(r3|0)){r3=r2+36|0;HEAP32[r3>>2]=HEAP32[r3>>2]+1;HEAP32[r2+24>>2]=2;HEAP8[r2+54|0]=1;return}r3=r2+24|0;if((HEAP32[r3>>2]|0)!=2){return}HEAP32[r3>>2]=r4;return}function __ZNK10__cxxabiv121__vmi_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi(r1,r2,r3,r4){var r5,r6,r7,r8,r9,r10,r11;r5=0;if((r1|0)==(HEAP32[r2+8>>2]|0)){r6=r2+16|0;r7=HEAP32[r6>>2];if((r7|0)==0){HEAP32[r6>>2]=r3;HEAP32[r2+24>>2]=r4;HEAP32[r2+36>>2]=1;return}if((r7|0)!=(r3|0)){r7=r2+36|0;HEAP32[r7>>2]=HEAP32[r7>>2]+1;HEAP32[r2+24>>2]=2;HEAP8[r2+54|0]=1;return}r7=r2+24|0;if((HEAP32[r7>>2]|0)!=2){return}HEAP32[r7>>2]=r4;return}r7=HEAP32[r1+12>>2];r6=r1+16+(r7<<3)|0;r8=HEAP32[r1+20>>2];r9=r8>>8;if((r8&1|0)==0){r10=r9}else{r10=HEAP32[HEAP32[r3>>2]+r9>>2]}r9=HEAP32[r1+16>>2];FUNCTION_TABLE[HEAP32[HEAP32[r9>>2]+28>>2]](r9,r2,r3+r10|0,(r8&2|0)!=0?r4:2);if((r7|0)<=1){return}r7=r2+54|0;r8=r3;r10=r1+24|0;while(1){r1=HEAP32[r10+4>>2];r9=r1>>8;if((r1&1|0)==0){r11=r9}else{r11=HEAP32[HEAP32[r8>>2]+r9>>2]}r9=HEAP32[r10>>2];FUNCTION_TABLE[HEAP32[HEAP32[r9>>2]+28>>2]](r9,r2,r3+r11|0,(r1&2|0)!=0?r4:2);if((HEAP8[r7]&1)!=0){r5=18;break}r1=r10+8|0;if(r1>>>0<r6>>>0){r10=r1}else{r5=19;break}}if(r5==18){return}else if(r5==19){return}}function __ZNK10__cxxabiv119__pointer_type_info9can_catchEPKNS_16__shim_type_infoERPv(r1,r2,r3){var r4,r5,r6,r7,r8,r9,r10;r4=STACKTOP;STACKTOP=STACKTOP+56|0;r5=r4;HEAP32[r3>>2]=HEAP32[HEAP32[r3>>2]>>2];r6=r2|0;do{if((r1|0)==(r6|0)|(r6|0)==1760){r7=1}else{if((r2|0)==0){r7=0;break}r8=___dynamic_cast(r2,1696);if((r8|0)==0){r7=0;break}if((HEAP32[r8+8>>2]&~HEAP32[r1+8>>2]|0)!=0){r7=0;break}r9=HEAP32[r1+12>>2];r10=r8+12|0;if((r9|0)==(HEAP32[r10>>2]|0)|(r9|0)==1448){r7=1;break}if((r9|0)==0){r7=0;break}r8=___dynamic_cast(r9,1728);if((r8|0)==0){r7=0;break}r9=HEAP32[r10>>2];if((r9|0)==0){r7=0;break}r10=___dynamic_cast(r9,1728);r9=r10;if((r10|0)==0){r7=0;break}_memset(r5,0,56)|0;HEAP32[r5>>2]=r9;HEAP32[r5+8>>2]=r8;HEAP32[r5+12>>2]=-1;HEAP32[r5+48>>2]=1;FUNCTION_TABLE[HEAP32[HEAP32[r10>>2]+28>>2]](r9,r5,HEAP32[r3>>2],1);if((HEAP32[r5+24>>2]|0)!=1){r7=0;break}HEAP32[r3>>2]=HEAP32[r5+16>>2];r7=1}}while(0);STACKTOP=r4;return r7}function ___dynamic_cast(r1,r2){var r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13;r3=STACKTOP;STACKTOP=STACKTOP+56|0;r4=r3;r5=HEAP32[r1>>2];r6=r1+HEAP32[r5-8>>2]|0;r7=HEAP32[r5-4>>2];r5=r7;HEAP32[r4>>2]=r2;HEAP32[r4+4>>2]=r1;HEAP32[r4+8>>2]=1744;HEAP32[r4+12>>2]=-1;r1=r4+16|0;r8=r4+20|0;r9=r4+24|0;r10=r4+28|0;r11=r4+32|0;r12=r4+40|0;_memset(r1,0,39)|0;if((r7|0)==(r2|0)){HEAP32[r4+48>>2]=1;FUNCTION_TABLE[HEAP32[HEAP32[r7>>2]+20>>2]](r5,r4,r6,r6,1,0);STACKTOP=r3;return(HEAP32[r9>>2]|0)==1?r6:0}FUNCTION_TABLE[HEAP32[HEAP32[r7>>2]+24>>2]](r5,r4,r6,1,0);r6=HEAP32[r4+36>>2];do{if((r6|0)==1){if((HEAP32[r9>>2]|0)!=1){if((HEAP32[r12>>2]|0)!=0){r13=0;break}if((HEAP32[r10>>2]|0)!=1){r13=0;break}if((HEAP32[r11>>2]|0)!=1){r13=0;break}}r13=HEAP32[r1>>2]}else if((r6|0)==0){if((HEAP32[r12>>2]|0)!=1){r13=0;break}if((HEAP32[r10>>2]|0)!=1){r13=0;break}r13=(HEAP32[r11>>2]|0)==1?HEAP32[r8>>2]:0}else{r13=0}}while(0);STACKTOP=r3;return r13}function __ZNK10__cxxabiv121__vmi_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib(r1,r2,r3,r4,r5){var r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32;r6=0;r7=r1|0;if((r7|0)==(HEAP32[r2+8>>2]|0)){if((HEAP32[r2+4>>2]|0)!=(r3|0)){return}r8=r2+28|0;if((HEAP32[r8>>2]|0)==1){return}HEAP32[r8>>2]=r4;return}if((r7|0)==(HEAP32[r2>>2]|0)){do{if((HEAP32[r2+16>>2]|0)!=(r3|0)){r7=r2+20|0;if((HEAP32[r7>>2]|0)==(r3|0)){break}HEAP32[r2+32>>2]=r4;r8=r2+44|0;if((HEAP32[r8>>2]|0)==4){return}r9=HEAP32[r1+12>>2];r10=r1+16+(r9<<3)|0;L19:do{if((r9|0)>0){r11=r2+52|0;r12=r2+53|0;r13=r2+54|0;r14=r1+8|0;r15=r2+24|0;r16=r3;r17=0;r18=r1+16|0;r19=0;L21:while(1){HEAP8[r11]=0;HEAP8[r12]=0;r20=HEAP32[r18+4>>2];r21=r20>>8;if((r20&1|0)==0){r22=r21}else{r22=HEAP32[HEAP32[r16>>2]+r21>>2]}r21=HEAP32[r18>>2];FUNCTION_TABLE[HEAP32[HEAP32[r21>>2]+20>>2]](r21,r2,r3,r3+r22|0,2-(r20>>>1&1)|0,r5);if((HEAP8[r13]&1)!=0){r23=r19;r24=r17;break}do{if((HEAP8[r12]&1)==0){r25=r19;r26=r17}else{if((HEAP8[r11]&1)==0){if((HEAP32[r14>>2]&1|0)==0){r23=1;r24=r17;break L21}else{r25=1;r26=r17;break}}if((HEAP32[r15>>2]|0)==1){r6=27;break L19}if((HEAP32[r14>>2]&2|0)==0){r6=27;break L19}else{r25=1;r26=1}}}while(0);r20=r18+8|0;if(r20>>>0<r10>>>0){r17=r26;r18=r20;r19=r25}else{r23=r25;r24=r26;break}}if(r24){r27=r23;r6=26}else{r28=r23;r6=23}}else{r28=0;r6=23}}while(0);do{if(r6==23){HEAP32[r7>>2]=r3;r10=r2+40|0;HEAP32[r10>>2]=HEAP32[r10>>2]+1;if((HEAP32[r2+36>>2]|0)!=1){r27=r28;r6=26;break}if((HEAP32[r2+24>>2]|0)!=2){r27=r28;r6=26;break}HEAP8[r2+54|0]=1;if(r28){r6=27}else{r6=28}}}while(0);if(r6==26){if(r27){r6=27}else{r6=28}}if(r6==27){HEAP32[r8>>2]=3;return}else if(r6==28){HEAP32[r8>>2]=4;return}}}while(0);if((r4|0)!=1){return}HEAP32[r2+32>>2]=1;return}r27=HEAP32[r1+12>>2];r28=r1+16+(r27<<3)|0;r23=HEAP32[r1+20>>2];r24=r23>>8;if((r23&1|0)==0){r29=r24}else{r29=HEAP32[HEAP32[r3>>2]+r24>>2]}r24=HEAP32[r1+16>>2];FUNCTION_TABLE[HEAP32[HEAP32[r24>>2]+24>>2]](r24,r2,r3+r29|0,(r23&2|0)!=0?r4:2,r5);r23=r1+24|0;if((r27|0)<=1){return}r27=HEAP32[r1+8>>2];do{if((r27&2|0)==0){r1=r2+36|0;if((HEAP32[r1>>2]|0)==1){break}if((r27&1|0)==0){r29=r2+54|0;r24=r3;r26=r23;while(1){if((HEAP8[r29]&1)!=0){r6=65;break}if((HEAP32[r1>>2]|0)==1){r6=66;break}r25=HEAP32[r26+4>>2];r22=r25>>8;if((r25&1|0)==0){r30=r22}else{r30=HEAP32[HEAP32[r24>>2]+r22>>2]}r22=HEAP32[r26>>2];FUNCTION_TABLE[HEAP32[HEAP32[r22>>2]+24>>2]](r22,r2,r3+r30|0,(r25&2|0)!=0?r4:2,r5);r25=r26+8|0;if(r25>>>0<r28>>>0){r26=r25}else{r6=67;break}}if(r6==65){return}else if(r6==66){return}else if(r6==67){return}}r26=r2+24|0;r24=r2+54|0;r29=r3;r8=r23;while(1){if((HEAP8[r24]&1)!=0){r6=59;break}if((HEAP32[r1>>2]|0)==1){if((HEAP32[r26>>2]|0)==1){r6=60;break}}r25=HEAP32[r8+4>>2];r22=r25>>8;if((r25&1|0)==0){r31=r22}else{r31=HEAP32[HEAP32[r29>>2]+r22>>2]}r22=HEAP32[r8>>2];FUNCTION_TABLE[HEAP32[HEAP32[r22>>2]+24>>2]](r22,r2,r3+r31|0,(r25&2|0)!=0?r4:2,r5);r25=r8+8|0;if(r25>>>0<r28>>>0){r8=r25}else{r6=64;break}}if(r6==59){return}else if(r6==60){return}else if(r6==64){return}}}while(0);r31=r2+54|0;r30=r3;r27=r23;while(1){if((HEAP8[r31]&1)!=0){r6=61;break}r23=HEAP32[r27+4>>2];r8=r23>>8;if((r23&1|0)==0){r32=r8}else{r32=HEAP32[HEAP32[r30>>2]+r8>>2]}r8=HEAP32[r27>>2];FUNCTION_TABLE[HEAP32[HEAP32[r8>>2]+24>>2]](r8,r2,r3+r32|0,(r23&2|0)!=0?r4:2,r5);r23=r27+8|0;if(r23>>>0<r28>>>0){r27=r23}else{r6=58;break}}if(r6==58){return}else if(r6==61){return}}function __ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib(r1,r2,r3,r4,r5){var r6,r7,r8,r9,r10,r11,r12;r6=0;r7=r1|0;if((r7|0)==(HEAP32[r2+8>>2]|0)){if((HEAP32[r2+4>>2]|0)!=(r3|0)){return}r8=r2+28|0;if((HEAP32[r8>>2]|0)==1){return}HEAP32[r8>>2]=r4;return}if((r7|0)!=(HEAP32[r2>>2]|0)){r7=HEAP32[r1+8>>2];FUNCTION_TABLE[HEAP32[HEAP32[r7>>2]+24>>2]](r7,r2,r3,r4,r5);return}do{if((HEAP32[r2+16>>2]|0)!=(r3|0)){r7=r2+20|0;if((HEAP32[r7>>2]|0)==(r3|0)){break}HEAP32[r2+32>>2]=r4;r8=r2+44|0;if((HEAP32[r8>>2]|0)==4){return}r9=r2+52|0;HEAP8[r9]=0;r10=r2+53|0;HEAP8[r10]=0;r11=HEAP32[r1+8>>2];FUNCTION_TABLE[HEAP32[HEAP32[r11>>2]+20>>2]](r11,r2,r3,r3,1,r5);if((HEAP8[r10]&1)==0){r12=0;r6=13}else{if((HEAP8[r9]&1)==0){r12=1;r6=13}}L23:do{if(r6==13){HEAP32[r7>>2]=r3;r9=r2+40|0;HEAP32[r9>>2]=HEAP32[r9>>2]+1;do{if((HEAP32[r2+36>>2]|0)==1){if((HEAP32[r2+24>>2]|0)!=2){r6=16;break}HEAP8[r2+54|0]=1;if(r12){break L23}}else{r6=16}}while(0);if(r6==16){if(r12){break}}HEAP32[r8>>2]=4;return}}while(0);HEAP32[r8>>2]=3;return}}while(0);if((r4|0)!=1){return}HEAP32[r2+32>>2]=1;return}function __ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib(r1,r2,r3,r4,r5){if((HEAP32[r2+8>>2]|0)==(r1|0)){if((HEAP32[r2+4>>2]|0)!=(r3|0)){return}r5=r2+28|0;if((HEAP32[r5>>2]|0)==1){return}HEAP32[r5>>2]=r4;return}if((HEAP32[r2>>2]|0)!=(r1|0)){return}do{if((HEAP32[r2+16>>2]|0)!=(r3|0)){r1=r2+20|0;if((HEAP32[r1>>2]|0)==(r3|0)){break}HEAP32[r2+32>>2]=r4;HEAP32[r1>>2]=r3;r1=r2+40|0;HEAP32[r1>>2]=HEAP32[r1>>2]+1;do{if((HEAP32[r2+36>>2]|0)==1){if((HEAP32[r2+24>>2]|0)!=2){break}HEAP8[r2+54|0]=1}}while(0);HEAP32[r2+44>>2]=4;return}}while(0);if((r4|0)!=1){return}HEAP32[r2+32>>2]=1;return}function __ZNK10__cxxabiv121__vmi_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib(r1,r2,r3,r4,r5,r6){var r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21;if((r1|0)!=(HEAP32[r2+8>>2]|0)){r7=r2+52|0;r8=HEAP8[r7]&1;r9=r2+53|0;r10=HEAP8[r9]&1;r11=HEAP32[r1+12>>2];r12=r1+16+(r11<<3)|0;HEAP8[r7]=0;HEAP8[r9]=0;r13=HEAP32[r1+20>>2];r14=r13>>8;if((r13&1|0)==0){r15=r14}else{r15=HEAP32[HEAP32[r4>>2]+r14>>2]}r14=HEAP32[r1+16>>2];FUNCTION_TABLE[HEAP32[HEAP32[r14>>2]+20>>2]](r14,r2,r3,r4+r15|0,(r13&2|0)!=0?r5:2,r6);L6:do{if((r11|0)>1){r13=r2+24|0;r15=r1+8|0;r14=r2+54|0;r16=r4;r17=r1+24|0;while(1){if((HEAP8[r14]&1)!=0){break L6}do{if((HEAP8[r7]&1)==0){if((HEAP8[r9]&1)==0){break}if((HEAP32[r15>>2]&1|0)==0){break L6}}else{if((HEAP32[r13>>2]|0)==1){break L6}if((HEAP32[r15>>2]&2|0)==0){break L6}}}while(0);HEAP8[r7]=0;HEAP8[r9]=0;r18=HEAP32[r17+4>>2];r19=r18>>8;if((r18&1|0)==0){r20=r19}else{r20=HEAP32[HEAP32[r16>>2]+r19>>2]}r19=HEAP32[r17>>2];FUNCTION_TABLE[HEAP32[HEAP32[r19>>2]+20>>2]](r19,r2,r3,r4+r20|0,(r18&2|0)!=0?r5:2,r6);r18=r17+8|0;if(r18>>>0<r12>>>0){r17=r18}else{break}}}}while(0);HEAP8[r7]=r8;HEAP8[r9]=r10;return}HEAP8[r2+53|0]=1;if((HEAP32[r2+4>>2]|0)!=(r4|0)){return}HEAP8[r2+52|0]=1;r4=r2+16|0;r10=HEAP32[r4>>2];if((r10|0)==0){HEAP32[r4>>2]=r3;HEAP32[r2+24>>2]=r5;HEAP32[r2+36>>2]=1;if(!((HEAP32[r2+48>>2]|0)==1&(r5|0)==1)){return}HEAP8[r2+54|0]=1;return}if((r10|0)!=(r3|0)){r3=r2+36|0;HEAP32[r3>>2]=HEAP32[r3>>2]+1;HEAP8[r2+54|0]=1;return}r3=r2+24|0;r10=HEAP32[r3>>2];if((r10|0)==2){HEAP32[r3>>2]=r5;r21=r5}else{r21=r10}if(!((HEAP32[r2+48>>2]|0)==1&(r21|0)==1)){return}HEAP8[r2+54|0]=1;return}function __ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib(r1,r2,r3,r4,r5,r6){var r7,r8;if((r1|0)!=(HEAP32[r2+8>>2]|0)){r7=HEAP32[r1+8>>2];FUNCTION_TABLE[HEAP32[HEAP32[r7>>2]+20>>2]](r7,r2,r3,r4,r5,r6);return}HEAP8[r2+53|0]=1;if((HEAP32[r2+4>>2]|0)!=(r4|0)){return}HEAP8[r2+52|0]=1;r4=r2+16|0;r6=HEAP32[r4>>2];if((r6|0)==0){HEAP32[r4>>2]=r3;HEAP32[r2+24>>2]=r5;HEAP32[r2+36>>2]=1;if(!((HEAP32[r2+48>>2]|0)==1&(r5|0)==1)){return}HEAP8[r2+54|0]=1;return}if((r6|0)!=(r3|0)){r3=r2+36|0;HEAP32[r3>>2]=HEAP32[r3>>2]+1;HEAP8[r2+54|0]=1;return}r3=r2+24|0;r6=HEAP32[r3>>2];if((r6|0)==2){HEAP32[r3>>2]=r5;r8=r5}else{r8=r6}if(!((HEAP32[r2+48>>2]|0)==1&(r8|0)==1)){return}HEAP8[r2+54|0]=1;return}function __ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib(r1,r2,r3,r4,r5,r6){var r7;if((HEAP32[r2+8>>2]|0)!=(r1|0)){return}HEAP8[r2+53|0]=1;if((HEAP32[r2+4>>2]|0)!=(r4|0)){return}HEAP8[r2+52|0]=1;r4=r2+16|0;r1=HEAP32[r4>>2];if((r1|0)==0){HEAP32[r4>>2]=r3;HEAP32[r2+24>>2]=r5;HEAP32[r2+36>>2]=1;if(!((HEAP32[r2+48>>2]|0)==1&(r5|0)==1)){return}HEAP8[r2+54|0]=1;return}if((r1|0)!=(r3|0)){r3=r2+36|0;HEAP32[r3>>2]=HEAP32[r3>>2]+1;HEAP8[r2+54|0]=1;return}r3=r2+24|0;r1=HEAP32[r3>>2];if((r1|0)==2){HEAP32[r3>>2]=r5;r7=r5}else{r7=r1}if(!((HEAP32[r2+48>>2]|0)==1&(r7|0)==1)){return}HEAP8[r2+54|0]=1;return}function _malloc(r1){var r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32,r33,r34,r35,r36,r37,r38,r39,r40,r41,r42,r43,r44,r45,r46,r47,r48,r49,r50,r51,r52,r53,r54,r55,r56,r57,r58,r59,r60,r61,r62,r63,r64,r65,r66,r67,r68,r69,r70,r71,r72,r73,r74,r75,r76,r77,r78,r79,r80,r81,r82,r83,r84,r85,r86;r2=0;do{if(r1>>>0<245){if(r1>>>0<11){r3=16}else{r3=r1+11&-8}r4=r3>>>3;r5=HEAP32[1808>>2];r6=r5>>>(r4>>>0);if((r6&3|0)!=0){r7=(r6&1^1)+r4|0;r8=r7<<1;r9=1848+(r8<<2)|0;r10=1848+(r8+2<<2)|0;r8=HEAP32[r10>>2];r11=r8+8|0;r12=HEAP32[r11>>2];do{if((r9|0)==(r12|0)){HEAP32[1808>>2]=r5&~(1<<r7)}else{if(r12>>>0<HEAP32[1824>>2]>>>0){_abort()}r13=r12+12|0;if((HEAP32[r13>>2]|0)==(r8|0)){HEAP32[r13>>2]=r9;HEAP32[r10>>2]=r12;break}else{_abort()}}}while(0);r12=r7<<3;HEAP32[r8+4>>2]=r12|3;r10=r8+(r12|4)|0;HEAP32[r10>>2]=HEAP32[r10>>2]|1;r14=r11;return r14}if(r3>>>0<=HEAP32[1816>>2]>>>0){r15=r3;break}if((r6|0)!=0){r10=2<<r4;r12=r6<<r4&(r10|-r10);r10=(r12&-r12)-1|0;r12=r10>>>12&16;r9=r10>>>(r12>>>0);r10=r9>>>5&8;r13=r9>>>(r10>>>0);r9=r13>>>2&4;r16=r13>>>(r9>>>0);r13=r16>>>1&2;r17=r16>>>(r13>>>0);r16=r17>>>1&1;r18=(r10|r12|r9|r13|r16)+(r17>>>(r16>>>0))|0;r16=r18<<1;r17=1848+(r16<<2)|0;r13=1848+(r16+2<<2)|0;r16=HEAP32[r13>>2];r9=r16+8|0;r12=HEAP32[r9>>2];do{if((r17|0)==(r12|0)){HEAP32[1808>>2]=r5&~(1<<r18)}else{if(r12>>>0<HEAP32[1824>>2]>>>0){_abort()}r10=r12+12|0;if((HEAP32[r10>>2]|0)==(r16|0)){HEAP32[r10>>2]=r17;HEAP32[r13>>2]=r12;break}else{_abort()}}}while(0);r12=r18<<3;r13=r12-r3|0;HEAP32[r16+4>>2]=r3|3;r17=r16;r5=r17+r3|0;HEAP32[r17+(r3|4)>>2]=r13|1;HEAP32[r17+r12>>2]=r13;r12=HEAP32[1816>>2];if((r12|0)!=0){r17=HEAP32[1828>>2];r4=r12>>>3;r12=r4<<1;r6=1848+(r12<<2)|0;r11=HEAP32[1808>>2];r8=1<<r4;do{if((r11&r8|0)==0){HEAP32[1808>>2]=r11|r8;r19=r6;r20=1848+(r12+2<<2)|0}else{r4=1848+(r12+2<<2)|0;r7=HEAP32[r4>>2];if(r7>>>0>=HEAP32[1824>>2]>>>0){r19=r7;r20=r4;break}_abort()}}while(0);HEAP32[r20>>2]=r17;HEAP32[r19+12>>2]=r17;HEAP32[r17+8>>2]=r19;HEAP32[r17+12>>2]=r6}HEAP32[1816>>2]=r13;HEAP32[1828>>2]=r5;r14=r9;return r14}r12=HEAP32[1812>>2];if((r12|0)==0){r15=r3;break}r8=(r12&-r12)-1|0;r12=r8>>>12&16;r11=r8>>>(r12>>>0);r8=r11>>>5&8;r16=r11>>>(r8>>>0);r11=r16>>>2&4;r18=r16>>>(r11>>>0);r16=r18>>>1&2;r4=r18>>>(r16>>>0);r18=r4>>>1&1;r7=HEAP32[2112+((r8|r12|r11|r16|r18)+(r4>>>(r18>>>0))<<2)>>2];r18=r7;r4=r7;r16=(HEAP32[r7+4>>2]&-8)-r3|0;while(1){r7=HEAP32[r18+16>>2];if((r7|0)==0){r11=HEAP32[r18+20>>2];if((r11|0)==0){break}else{r21=r11}}else{r21=r7}r7=(HEAP32[r21+4>>2]&-8)-r3|0;r11=r7>>>0<r16>>>0;r18=r21;r4=r11?r21:r4;r16=r11?r7:r16}r18=r4;r9=HEAP32[1824>>2];if(r18>>>0<r9>>>0){_abort()}r5=r18+r3|0;r13=r5;if(r18>>>0>=r5>>>0){_abort()}r5=HEAP32[r4+24>>2];r6=HEAP32[r4+12>>2];do{if((r6|0)==(r4|0)){r17=r4+20|0;r7=HEAP32[r17>>2];if((r7|0)==0){r11=r4+16|0;r12=HEAP32[r11>>2];if((r12|0)==0){r22=0;break}else{r23=r12;r24=r11}}else{r23=r7;r24=r17}while(1){r17=r23+20|0;r7=HEAP32[r17>>2];if((r7|0)!=0){r23=r7;r24=r17;continue}r17=r23+16|0;r7=HEAP32[r17>>2];if((r7|0)==0){break}else{r23=r7;r24=r17}}if(r24>>>0<r9>>>0){_abort()}else{HEAP32[r24>>2]=0;r22=r23;break}}else{r17=HEAP32[r4+8>>2];if(r17>>>0<r9>>>0){_abort()}r7=r17+12|0;if((HEAP32[r7>>2]|0)!=(r4|0)){_abort()}r11=r6+8|0;if((HEAP32[r11>>2]|0)==(r4|0)){HEAP32[r7>>2]=r6;HEAP32[r11>>2]=r17;r22=r6;break}else{_abort()}}}while(0);L201:do{if((r5|0)!=0){r6=r4+28|0;r9=2112+(HEAP32[r6>>2]<<2)|0;do{if((r4|0)==(HEAP32[r9>>2]|0)){HEAP32[r9>>2]=r22;if((r22|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r6>>2]);break L201}else{if(r5>>>0<HEAP32[1824>>2]>>>0){_abort()}r17=r5+16|0;if((HEAP32[r17>>2]|0)==(r4|0)){HEAP32[r17>>2]=r22}else{HEAP32[r5+20>>2]=r22}if((r22|0)==0){break L201}}}while(0);if(r22>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r22+24>>2]=r5;r6=HEAP32[r4+16>>2];do{if((r6|0)!=0){if(r6>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r22+16>>2]=r6;HEAP32[r6+24>>2]=r22;break}}}while(0);r6=HEAP32[r4+20>>2];if((r6|0)==0){break}if(r6>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r22+20>>2]=r6;HEAP32[r6+24>>2]=r22;break}}}while(0);if(r16>>>0<16){r5=r16+r3|0;HEAP32[r4+4>>2]=r5|3;r6=r18+(r5+4)|0;HEAP32[r6>>2]=HEAP32[r6>>2]|1}else{HEAP32[r4+4>>2]=r3|3;HEAP32[r18+(r3|4)>>2]=r16|1;HEAP32[r18+(r16+r3)>>2]=r16;r6=HEAP32[1816>>2];if((r6|0)!=0){r5=HEAP32[1828>>2];r9=r6>>>3;r6=r9<<1;r17=1848+(r6<<2)|0;r11=HEAP32[1808>>2];r7=1<<r9;do{if((r11&r7|0)==0){HEAP32[1808>>2]=r11|r7;r25=r17;r26=1848+(r6+2<<2)|0}else{r9=1848+(r6+2<<2)|0;r12=HEAP32[r9>>2];if(r12>>>0>=HEAP32[1824>>2]>>>0){r25=r12;r26=r9;break}_abort()}}while(0);HEAP32[r26>>2]=r5;HEAP32[r25+12>>2]=r5;HEAP32[r5+8>>2]=r25;HEAP32[r5+12>>2]=r17}HEAP32[1816>>2]=r16;HEAP32[1828>>2]=r13}r6=r4+8|0;if((r6|0)==0){r15=r3;break}else{r14=r6}return r14}else{if(r1>>>0>4294967231){r15=-1;break}r6=r1+11|0;r7=r6&-8;r11=HEAP32[1812>>2];if((r11|0)==0){r15=r7;break}r18=-r7|0;r9=r6>>>8;do{if((r9|0)==0){r27=0}else{if(r7>>>0>16777215){r27=31;break}r6=(r9+1048320|0)>>>16&8;r12=r9<<r6;r8=(r12+520192|0)>>>16&4;r10=r12<<r8;r12=(r10+245760|0)>>>16&2;r28=14-(r8|r6|r12)+(r10<<r12>>>15)|0;r27=r7>>>((r28+7|0)>>>0)&1|r28<<1}}while(0);r9=HEAP32[2112+(r27<<2)>>2];L9:do{if((r9|0)==0){r29=0;r30=r18;r31=0}else{if((r27|0)==31){r32=0}else{r32=25-(r27>>>1)|0}r4=0;r13=r18;r16=r9;r17=r7<<r32;r5=0;while(1){r28=HEAP32[r16+4>>2]&-8;r12=r28-r7|0;if(r12>>>0<r13>>>0){if((r28|0)==(r7|0)){r29=r16;r30=r12;r31=r16;break L9}else{r33=r16;r34=r12}}else{r33=r4;r34=r13}r12=HEAP32[r16+20>>2];r28=HEAP32[r16+16+(r17>>>31<<2)>>2];r10=(r12|0)==0|(r12|0)==(r28|0)?r5:r12;if((r28|0)==0){r29=r33;r30=r34;r31=r10;break}else{r4=r33;r13=r34;r16=r28;r17=r17<<1;r5=r10}}}}while(0);if((r31|0)==0&(r29|0)==0){r9=2<<r27;r18=r11&(r9|-r9);if((r18|0)==0){r15=r7;break}r9=(r18&-r18)-1|0;r18=r9>>>12&16;r5=r9>>>(r18>>>0);r9=r5>>>5&8;r17=r5>>>(r9>>>0);r5=r17>>>2&4;r16=r17>>>(r5>>>0);r17=r16>>>1&2;r13=r16>>>(r17>>>0);r16=r13>>>1&1;r35=HEAP32[2112+((r9|r18|r5|r17|r16)+(r13>>>(r16>>>0))<<2)>>2]}else{r35=r31}if((r35|0)==0){r36=r30;r37=r29}else{r16=r35;r13=r30;r17=r29;while(1){r5=(HEAP32[r16+4>>2]&-8)-r7|0;r18=r5>>>0<r13>>>0;r9=r18?r5:r13;r5=r18?r16:r17;r18=HEAP32[r16+16>>2];if((r18|0)!=0){r16=r18;r13=r9;r17=r5;continue}r18=HEAP32[r16+20>>2];if((r18|0)==0){r36=r9;r37=r5;break}else{r16=r18;r13=r9;r17=r5}}}if((r37|0)==0){r15=r7;break}if(r36>>>0>=(HEAP32[1816>>2]-r7|0)>>>0){r15=r7;break}r17=r37;r13=HEAP32[1824>>2];if(r17>>>0<r13>>>0){_abort()}r16=r17+r7|0;r11=r16;if(r17>>>0>=r16>>>0){_abort()}r5=HEAP32[r37+24>>2];r9=HEAP32[r37+12>>2];do{if((r9|0)==(r37|0)){r18=r37+20|0;r4=HEAP32[r18>>2];if((r4|0)==0){r10=r37+16|0;r28=HEAP32[r10>>2];if((r28|0)==0){r38=0;break}else{r39=r28;r40=r10}}else{r39=r4;r40=r18}while(1){r18=r39+20|0;r4=HEAP32[r18>>2];if((r4|0)!=0){r39=r4;r40=r18;continue}r18=r39+16|0;r4=HEAP32[r18>>2];if((r4|0)==0){break}else{r39=r4;r40=r18}}if(r40>>>0<r13>>>0){_abort()}else{HEAP32[r40>>2]=0;r38=r39;break}}else{r18=HEAP32[r37+8>>2];if(r18>>>0<r13>>>0){_abort()}r4=r18+12|0;if((HEAP32[r4>>2]|0)!=(r37|0)){_abort()}r10=r9+8|0;if((HEAP32[r10>>2]|0)==(r37|0)){HEAP32[r4>>2]=r9;HEAP32[r10>>2]=r18;r38=r9;break}else{_abort()}}}while(0);L59:do{if((r5|0)!=0){r9=r37+28|0;r13=2112+(HEAP32[r9>>2]<<2)|0;do{if((r37|0)==(HEAP32[r13>>2]|0)){HEAP32[r13>>2]=r38;if((r38|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r9>>2]);break L59}else{if(r5>>>0<HEAP32[1824>>2]>>>0){_abort()}r18=r5+16|0;if((HEAP32[r18>>2]|0)==(r37|0)){HEAP32[r18>>2]=r38}else{HEAP32[r5+20>>2]=r38}if((r38|0)==0){break L59}}}while(0);if(r38>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r38+24>>2]=r5;r9=HEAP32[r37+16>>2];do{if((r9|0)!=0){if(r9>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r38+16>>2]=r9;HEAP32[r9+24>>2]=r38;break}}}while(0);r9=HEAP32[r37+20>>2];if((r9|0)==0){break}if(r9>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r38+20>>2]=r9;HEAP32[r9+24>>2]=r38;break}}}while(0);do{if(r36>>>0<16){r5=r36+r7|0;HEAP32[r37+4>>2]=r5|3;r9=r17+(r5+4)|0;HEAP32[r9>>2]=HEAP32[r9>>2]|1}else{HEAP32[r37+4>>2]=r7|3;HEAP32[r17+(r7|4)>>2]=r36|1;HEAP32[r17+(r36+r7)>>2]=r36;r9=r36>>>3;if(r36>>>0<256){r5=r9<<1;r13=1848+(r5<<2)|0;r18=HEAP32[1808>>2];r10=1<<r9;do{if((r18&r10|0)==0){HEAP32[1808>>2]=r18|r10;r41=r13;r42=1848+(r5+2<<2)|0}else{r9=1848+(r5+2<<2)|0;r4=HEAP32[r9>>2];if(r4>>>0>=HEAP32[1824>>2]>>>0){r41=r4;r42=r9;break}_abort()}}while(0);HEAP32[r42>>2]=r11;HEAP32[r41+12>>2]=r11;HEAP32[r17+(r7+8)>>2]=r41;HEAP32[r17+(r7+12)>>2]=r13;break}r5=r16;r10=r36>>>8;do{if((r10|0)==0){r43=0}else{if(r36>>>0>16777215){r43=31;break}r18=(r10+1048320|0)>>>16&8;r9=r10<<r18;r4=(r9+520192|0)>>>16&4;r28=r9<<r4;r9=(r28+245760|0)>>>16&2;r12=14-(r4|r18|r9)+(r28<<r9>>>15)|0;r43=r36>>>((r12+7|0)>>>0)&1|r12<<1}}while(0);r10=2112+(r43<<2)|0;HEAP32[r17+(r7+28)>>2]=r43;HEAP32[r17+(r7+20)>>2]=0;HEAP32[r17+(r7+16)>>2]=0;r13=HEAP32[1812>>2];r12=1<<r43;if((r13&r12|0)==0){HEAP32[1812>>2]=r13|r12;HEAP32[r10>>2]=r5;HEAP32[r17+(r7+24)>>2]=r10;HEAP32[r17+(r7+12)>>2]=r5;HEAP32[r17+(r7+8)>>2]=r5;break}if((r43|0)==31){r44=0}else{r44=25-(r43>>>1)|0}r12=r36<<r44;r13=HEAP32[r10>>2];while(1){if((HEAP32[r13+4>>2]&-8|0)==(r36|0)){break}r45=r13+16+(r12>>>31<<2)|0;r10=HEAP32[r45>>2];if((r10|0)==0){r2=151;break}else{r12=r12<<1;r13=r10}}if(r2==151){if(r45>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r45>>2]=r5;HEAP32[r17+(r7+24)>>2]=r13;HEAP32[r17+(r7+12)>>2]=r5;HEAP32[r17+(r7+8)>>2]=r5;break}}r12=r13+8|0;r10=HEAP32[r12>>2];r9=HEAP32[1824>>2];if(r13>>>0<r9>>>0){_abort()}if(r10>>>0<r9>>>0){_abort()}else{HEAP32[r10+12>>2]=r5;HEAP32[r12>>2]=r5;HEAP32[r17+(r7+8)>>2]=r10;HEAP32[r17+(r7+12)>>2]=r13;HEAP32[r17+(r7+24)>>2]=0;break}}}while(0);r17=r37+8|0;if((r17|0)==0){r15=r7;break}else{r14=r17}return r14}}while(0);r37=HEAP32[1816>>2];if(r15>>>0<=r37>>>0){r45=r37-r15|0;r36=HEAP32[1828>>2];if(r45>>>0>15){r44=r36;HEAP32[1828>>2]=r44+r15;HEAP32[1816>>2]=r45;HEAP32[r44+(r15+4)>>2]=r45|1;HEAP32[r44+r37>>2]=r45;HEAP32[r36+4>>2]=r15|3}else{HEAP32[1816>>2]=0;HEAP32[1828>>2]=0;HEAP32[r36+4>>2]=r37|3;r45=r36+(r37+4)|0;HEAP32[r45>>2]=HEAP32[r45>>2]|1}r14=r36+8|0;return r14}r36=HEAP32[1820>>2];if(r15>>>0<r36>>>0){r45=r36-r15|0;HEAP32[1820>>2]=r45;r36=HEAP32[1832>>2];r37=r36;HEAP32[1832>>2]=r37+r15;HEAP32[r37+(r15+4)>>2]=r45|1;HEAP32[r36+4>>2]=r15|3;r14=r36+8|0;return r14}do{if((HEAP32[1776>>2]|0)==0){r36=_sysconf(30);if((r36-1&r36|0)==0){HEAP32[1784>>2]=r36;HEAP32[1780>>2]=r36;HEAP32[1788>>2]=-1;HEAP32[1792>>2]=-1;HEAP32[1796>>2]=0;HEAP32[2252>>2]=0;HEAP32[1776>>2]=_time(0)&-16^1431655768;break}else{_abort()}}}while(0);r36=r15+48|0;r45=HEAP32[1784>>2];r37=r15+47|0;r44=r45+r37|0;r43=-r45|0;r45=r44&r43;if(r45>>>0<=r15>>>0){r14=0;return r14}r41=HEAP32[2248>>2];do{if((r41|0)!=0){r42=HEAP32[2240>>2];r38=r42+r45|0;if(r38>>>0<=r42>>>0|r38>>>0>r41>>>0){r14=0}else{break}return r14}}while(0);L268:do{if((HEAP32[2252>>2]&4|0)==0){r41=HEAP32[1832>>2];L270:do{if((r41|0)==0){r2=181}else{r38=r41;r42=2256;while(1){r46=r42|0;r39=HEAP32[r46>>2];if(r39>>>0<=r38>>>0){r47=r42+4|0;if((r39+HEAP32[r47>>2]|0)>>>0>r38>>>0){break}}r39=HEAP32[r42+8>>2];if((r39|0)==0){r2=181;break L270}else{r42=r39}}if((r42|0)==0){r2=181;break}r38=r44-HEAP32[1820>>2]&r43;if(r38>>>0>=2147483647){r48=0;break}r13=_sbrk(r38);r5=(r13|0)==(HEAP32[r46>>2]+HEAP32[r47>>2]|0);r49=r5?r13:-1;r50=r5?r38:0;r51=r13;r52=r38;r2=190}}while(0);do{if(r2==181){r41=_sbrk(0);if((r41|0)==-1){r48=0;break}r7=r41;r38=HEAP32[1780>>2];r13=r38-1|0;if((r13&r7|0)==0){r53=r45}else{r53=r45-r7+(r13+r7&-r38)|0}r38=HEAP32[2240>>2];r7=r38+r53|0;if(!(r53>>>0>r15>>>0&r53>>>0<2147483647)){r48=0;break}r13=HEAP32[2248>>2];if((r13|0)!=0){if(r7>>>0<=r38>>>0|r7>>>0>r13>>>0){r48=0;break}}r13=_sbrk(r53);r7=(r13|0)==(r41|0);r49=r7?r41:-1;r50=r7?r53:0;r51=r13;r52=r53;r2=190}}while(0);L290:do{if(r2==190){r13=-r52|0;if((r49|0)!=-1){r54=r50;r55=r49;r2=201;break L268}do{if((r51|0)!=-1&r52>>>0<2147483647&r52>>>0<r36>>>0){r7=HEAP32[1784>>2];r41=r37-r52+r7&-r7;if(r41>>>0>=2147483647){r56=r52;break}if((_sbrk(r41)|0)==-1){_sbrk(r13);r48=r50;break L290}else{r56=r41+r52|0;break}}else{r56=r52}}while(0);if((r51|0)==-1){r48=r50}else{r54=r56;r55=r51;r2=201;break L268}}}while(0);HEAP32[2252>>2]=HEAP32[2252>>2]|4;r57=r48;r2=198}else{r57=0;r2=198}}while(0);do{if(r2==198){if(r45>>>0>=2147483647){break}r48=_sbrk(r45);r51=_sbrk(0);if(!((r51|0)!=-1&(r48|0)!=-1&r48>>>0<r51>>>0)){break}r56=r51-r48|0;r51=r56>>>0>(r15+40|0)>>>0;r50=r51?r48:-1;if((r50|0)!=-1){r54=r51?r56:r57;r55=r50;r2=201}}}while(0);do{if(r2==201){r57=HEAP32[2240>>2]+r54|0;HEAP32[2240>>2]=r57;if(r57>>>0>HEAP32[2244>>2]>>>0){HEAP32[2244>>2]=r57}r57=HEAP32[1832>>2];L310:do{if((r57|0)==0){r45=HEAP32[1824>>2];if((r45|0)==0|r55>>>0<r45>>>0){HEAP32[1824>>2]=r55}HEAP32[2256>>2]=r55;HEAP32[2260>>2]=r54;HEAP32[2268>>2]=0;HEAP32[1844>>2]=HEAP32[1776>>2];HEAP32[1840>>2]=-1;r45=0;while(1){r50=r45<<1;r56=1848+(r50<<2)|0;HEAP32[1848+(r50+3<<2)>>2]=r56;HEAP32[1848+(r50+2<<2)>>2]=r56;r56=r45+1|0;if(r56>>>0<32){r45=r56}else{break}}r45=r55+8|0;if((r45&7|0)==0){r58=0}else{r58=-r45&7}r45=r54-40-r58|0;HEAP32[1832>>2]=r55+r58;HEAP32[1820>>2]=r45;HEAP32[r55+(r58+4)>>2]=r45|1;HEAP32[r55+(r54-36)>>2]=40;HEAP32[1836>>2]=HEAP32[1792>>2]}else{r45=2256;while(1){r59=HEAP32[r45>>2];r60=r45+4|0;r61=HEAP32[r60>>2];if((r55|0)==(r59+r61|0)){r2=213;break}r56=HEAP32[r45+8>>2];if((r56|0)==0){break}else{r45=r56}}do{if(r2==213){if((HEAP32[r45+12>>2]&8|0)!=0){break}r56=r57;if(!(r56>>>0>=r59>>>0&r56>>>0<r55>>>0)){break}HEAP32[r60>>2]=r61+r54;r56=HEAP32[1832>>2];r50=HEAP32[1820>>2]+r54|0;r51=r56;r48=r56+8|0;if((r48&7|0)==0){r62=0}else{r62=-r48&7}r48=r50-r62|0;HEAP32[1832>>2]=r51+r62;HEAP32[1820>>2]=r48;HEAP32[r51+(r62+4)>>2]=r48|1;HEAP32[r51+(r50+4)>>2]=40;HEAP32[1836>>2]=HEAP32[1792>>2];break L310}}while(0);if(r55>>>0<HEAP32[1824>>2]>>>0){HEAP32[1824>>2]=r55}r45=r55+r54|0;r50=2256;while(1){r63=r50|0;if((HEAP32[r63>>2]|0)==(r45|0)){r2=223;break}r51=HEAP32[r50+8>>2];if((r51|0)==0){break}else{r50=r51}}do{if(r2==223){if((HEAP32[r50+12>>2]&8|0)!=0){break}HEAP32[r63>>2]=r55;r45=r50+4|0;HEAP32[r45>>2]=HEAP32[r45>>2]+r54;r45=r55+8|0;if((r45&7|0)==0){r64=0}else{r64=-r45&7}r45=r55+(r54+8)|0;if((r45&7|0)==0){r65=0}else{r65=-r45&7}r45=r55+(r65+r54)|0;r51=r45;r48=r64+r15|0;r56=r55+r48|0;r52=r56;r37=r45-(r55+r64)-r15|0;HEAP32[r55+(r64+4)>>2]=r15|3;do{if((r51|0)==(HEAP32[1832>>2]|0)){r36=HEAP32[1820>>2]+r37|0;HEAP32[1820>>2]=r36;HEAP32[1832>>2]=r52;HEAP32[r55+(r48+4)>>2]=r36|1}else{if((r51|0)==(HEAP32[1828>>2]|0)){r36=HEAP32[1816>>2]+r37|0;HEAP32[1816>>2]=r36;HEAP32[1828>>2]=r52;HEAP32[r55+(r48+4)>>2]=r36|1;HEAP32[r55+(r36+r48)>>2]=r36;break}r36=r54+4|0;r49=HEAP32[r55+(r36+r65)>>2];if((r49&3|0)==1){r53=r49&-8;r47=r49>>>3;L355:do{if(r49>>>0<256){r46=HEAP32[r55+((r65|8)+r54)>>2];r43=HEAP32[r55+(r54+12+r65)>>2];r44=1848+(r47<<1<<2)|0;do{if((r46|0)!=(r44|0)){if(r46>>>0<HEAP32[1824>>2]>>>0){_abort()}if((HEAP32[r46+12>>2]|0)==(r51|0)){break}_abort()}}while(0);if((r43|0)==(r46|0)){HEAP32[1808>>2]=HEAP32[1808>>2]&~(1<<r47);break}do{if((r43|0)==(r44|0)){r66=r43+8|0}else{if(r43>>>0<HEAP32[1824>>2]>>>0){_abort()}r13=r43+8|0;if((HEAP32[r13>>2]|0)==(r51|0)){r66=r13;break}_abort()}}while(0);HEAP32[r46+12>>2]=r43;HEAP32[r66>>2]=r46}else{r44=r45;r13=HEAP32[r55+((r65|24)+r54)>>2];r42=HEAP32[r55+(r54+12+r65)>>2];do{if((r42|0)==(r44|0)){r41=r65|16;r7=r55+(r36+r41)|0;r38=HEAP32[r7>>2];if((r38|0)==0){r5=r55+(r41+r54)|0;r41=HEAP32[r5>>2];if((r41|0)==0){r67=0;break}else{r68=r41;r69=r5}}else{r68=r38;r69=r7}while(1){r7=r68+20|0;r38=HEAP32[r7>>2];if((r38|0)!=0){r68=r38;r69=r7;continue}r7=r68+16|0;r38=HEAP32[r7>>2];if((r38|0)==0){break}else{r68=r38;r69=r7}}if(r69>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r69>>2]=0;r67=r68;break}}else{r7=HEAP32[r55+((r65|8)+r54)>>2];if(r7>>>0<HEAP32[1824>>2]>>>0){_abort()}r38=r7+12|0;if((HEAP32[r38>>2]|0)!=(r44|0)){_abort()}r5=r42+8|0;if((HEAP32[r5>>2]|0)==(r44|0)){HEAP32[r38>>2]=r42;HEAP32[r5>>2]=r7;r67=r42;break}else{_abort()}}}while(0);if((r13|0)==0){break}r42=r55+(r54+28+r65)|0;r46=2112+(HEAP32[r42>>2]<<2)|0;do{if((r44|0)==(HEAP32[r46>>2]|0)){HEAP32[r46>>2]=r67;if((r67|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r42>>2]);break L355}else{if(r13>>>0<HEAP32[1824>>2]>>>0){_abort()}r43=r13+16|0;if((HEAP32[r43>>2]|0)==(r44|0)){HEAP32[r43>>2]=r67}else{HEAP32[r13+20>>2]=r67}if((r67|0)==0){break L355}}}while(0);if(r67>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r67+24>>2]=r13;r44=r65|16;r42=HEAP32[r55+(r44+r54)>>2];do{if((r42|0)!=0){if(r42>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r67+16>>2]=r42;HEAP32[r42+24>>2]=r67;break}}}while(0);r42=HEAP32[r55+(r36+r44)>>2];if((r42|0)==0){break}if(r42>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r67+20>>2]=r42;HEAP32[r42+24>>2]=r67;break}}}while(0);r70=r55+((r53|r65)+r54)|0;r71=r53+r37|0}else{r70=r51;r71=r37}r36=r70+4|0;HEAP32[r36>>2]=HEAP32[r36>>2]&-2;HEAP32[r55+(r48+4)>>2]=r71|1;HEAP32[r55+(r71+r48)>>2]=r71;r36=r71>>>3;if(r71>>>0<256){r47=r36<<1;r49=1848+(r47<<2)|0;r42=HEAP32[1808>>2];r13=1<<r36;do{if((r42&r13|0)==0){HEAP32[1808>>2]=r42|r13;r72=r49;r73=1848+(r47+2<<2)|0}else{r36=1848+(r47+2<<2)|0;r46=HEAP32[r36>>2];if(r46>>>0>=HEAP32[1824>>2]>>>0){r72=r46;r73=r36;break}_abort()}}while(0);HEAP32[r73>>2]=r52;HEAP32[r72+12>>2]=r52;HEAP32[r55+(r48+8)>>2]=r72;HEAP32[r55+(r48+12)>>2]=r49;break}r47=r56;r13=r71>>>8;do{if((r13|0)==0){r74=0}else{if(r71>>>0>16777215){r74=31;break}r42=(r13+1048320|0)>>>16&8;r53=r13<<r42;r36=(r53+520192|0)>>>16&4;r46=r53<<r36;r53=(r46+245760|0)>>>16&2;r43=14-(r36|r42|r53)+(r46<<r53>>>15)|0;r74=r71>>>((r43+7|0)>>>0)&1|r43<<1}}while(0);r13=2112+(r74<<2)|0;HEAP32[r55+(r48+28)>>2]=r74;HEAP32[r55+(r48+20)>>2]=0;HEAP32[r55+(r48+16)>>2]=0;r49=HEAP32[1812>>2];r43=1<<r74;if((r49&r43|0)==0){HEAP32[1812>>2]=r49|r43;HEAP32[r13>>2]=r47;HEAP32[r55+(r48+24)>>2]=r13;HEAP32[r55+(r48+12)>>2]=r47;HEAP32[r55+(r48+8)>>2]=r47;break}if((r74|0)==31){r75=0}else{r75=25-(r74>>>1)|0}r43=r71<<r75;r49=HEAP32[r13>>2];while(1){if((HEAP32[r49+4>>2]&-8|0)==(r71|0)){break}r76=r49+16+(r43>>>31<<2)|0;r13=HEAP32[r76>>2];if((r13|0)==0){r2=296;break}else{r43=r43<<1;r49=r13}}if(r2==296){if(r76>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r76>>2]=r47;HEAP32[r55+(r48+24)>>2]=r49;HEAP32[r55+(r48+12)>>2]=r47;HEAP32[r55+(r48+8)>>2]=r47;break}}r43=r49+8|0;r13=HEAP32[r43>>2];r53=HEAP32[1824>>2];if(r49>>>0<r53>>>0){_abort()}if(r13>>>0<r53>>>0){_abort()}else{HEAP32[r13+12>>2]=r47;HEAP32[r43>>2]=r47;HEAP32[r55+(r48+8)>>2]=r13;HEAP32[r55+(r48+12)>>2]=r49;HEAP32[r55+(r48+24)>>2]=0;break}}}while(0);r14=r55+(r64|8)|0;return r14}}while(0);r50=r57;r48=2256;while(1){r77=HEAP32[r48>>2];if(r77>>>0<=r50>>>0){r78=HEAP32[r48+4>>2];r79=r77+r78|0;if(r79>>>0>r50>>>0){break}}r48=HEAP32[r48+8>>2]}r48=r77+(r78-39)|0;if((r48&7|0)==0){r80=0}else{r80=-r48&7}r48=r77+(r78-47+r80)|0;r56=r48>>>0<(r57+16|0)>>>0?r50:r48;r48=r56+8|0;r52=r55+8|0;if((r52&7|0)==0){r81=0}else{r81=-r52&7}r52=r54-40-r81|0;HEAP32[1832>>2]=r55+r81;HEAP32[1820>>2]=r52;HEAP32[r55+(r81+4)>>2]=r52|1;HEAP32[r55+(r54-36)>>2]=40;HEAP32[1836>>2]=HEAP32[1792>>2];HEAP32[r56+4>>2]=27;HEAP32[r48>>2]=HEAP32[2256>>2];HEAP32[r48+4>>2]=HEAP32[2260>>2];HEAP32[r48+8>>2]=HEAP32[2264>>2];HEAP32[r48+12>>2]=HEAP32[2268>>2];HEAP32[2256>>2]=r55;HEAP32[2260>>2]=r54;HEAP32[2268>>2]=0;HEAP32[2264>>2]=r48;r48=r56+28|0;HEAP32[r48>>2]=7;if((r56+32|0)>>>0<r79>>>0){r52=r48;while(1){r48=r52+4|0;HEAP32[r48>>2]=7;if((r52+8|0)>>>0<r79>>>0){r52=r48}else{break}}}if((r56|0)==(r50|0)){break}r52=r56-r57|0;r48=r50+(r52+4)|0;HEAP32[r48>>2]=HEAP32[r48>>2]&-2;HEAP32[r57+4>>2]=r52|1;HEAP32[r50+r52>>2]=r52;r48=r52>>>3;if(r52>>>0<256){r37=r48<<1;r51=1848+(r37<<2)|0;r45=HEAP32[1808>>2];r13=1<<r48;do{if((r45&r13|0)==0){HEAP32[1808>>2]=r45|r13;r82=r51;r83=1848+(r37+2<<2)|0}else{r48=1848+(r37+2<<2)|0;r43=HEAP32[r48>>2];if(r43>>>0>=HEAP32[1824>>2]>>>0){r82=r43;r83=r48;break}_abort()}}while(0);HEAP32[r83>>2]=r57;HEAP32[r82+12>>2]=r57;HEAP32[r57+8>>2]=r82;HEAP32[r57+12>>2]=r51;break}r37=r57;r13=r52>>>8;do{if((r13|0)==0){r84=0}else{if(r52>>>0>16777215){r84=31;break}r45=(r13+1048320|0)>>>16&8;r50=r13<<r45;r56=(r50+520192|0)>>>16&4;r48=r50<<r56;r50=(r48+245760|0)>>>16&2;r43=14-(r56|r45|r50)+(r48<<r50>>>15)|0;r84=r52>>>((r43+7|0)>>>0)&1|r43<<1}}while(0);r13=2112+(r84<<2)|0;HEAP32[r57+28>>2]=r84;HEAP32[r57+20>>2]=0;HEAP32[r57+16>>2]=0;r51=HEAP32[1812>>2];r43=1<<r84;if((r51&r43|0)==0){HEAP32[1812>>2]=r51|r43;HEAP32[r13>>2]=r37;HEAP32[r57+24>>2]=r13;HEAP32[r57+12>>2]=r57;HEAP32[r57+8>>2]=r57;break}if((r84|0)==31){r85=0}else{r85=25-(r84>>>1)|0}r43=r52<<r85;r51=HEAP32[r13>>2];while(1){if((HEAP32[r51+4>>2]&-8|0)==(r52|0)){break}r86=r51+16+(r43>>>31<<2)|0;r13=HEAP32[r86>>2];if((r13|0)==0){r2=331;break}else{r43=r43<<1;r51=r13}}if(r2==331){if(r86>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r86>>2]=r37;HEAP32[r57+24>>2]=r51;HEAP32[r57+12>>2]=r57;HEAP32[r57+8>>2]=r57;break}}r43=r51+8|0;r52=HEAP32[r43>>2];r13=HEAP32[1824>>2];if(r51>>>0<r13>>>0){_abort()}if(r52>>>0<r13>>>0){_abort()}else{HEAP32[r52+12>>2]=r37;HEAP32[r43>>2]=r37;HEAP32[r57+8>>2]=r52;HEAP32[r57+12>>2]=r51;HEAP32[r57+24>>2]=0;break}}}while(0);r57=HEAP32[1820>>2];if(r57>>>0<=r15>>>0){break}r52=r57-r15|0;HEAP32[1820>>2]=r52;r57=HEAP32[1832>>2];r43=r57;HEAP32[1832>>2]=r43+r15;HEAP32[r43+(r15+4)>>2]=r52|1;HEAP32[r57+4>>2]=r15|3;r14=r57+8|0;return r14}}while(0);HEAP32[___errno_location()>>2]=12;r14=0;return r14}function _free(r1){var r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32,r33,r34,r35,r36,r37,r38,r39,r40;r2=0;if((r1|0)==0){return}r3=r1-8|0;r4=r3;r5=HEAP32[1824>>2];if(r3>>>0<r5>>>0){_abort()}r6=HEAP32[r1-4>>2];r7=r6&3;if((r7|0)==1){_abort()}r8=r6&-8;r9=r1+(r8-8)|0;r10=r9;L10:do{if((r6&1|0)==0){r11=HEAP32[r3>>2];if((r7|0)==0){return}r12=-8-r11|0;r13=r1+r12|0;r14=r13;r15=r11+r8|0;if(r13>>>0<r5>>>0){_abort()}if((r14|0)==(HEAP32[1828>>2]|0)){r16=r1+(r8-4)|0;if((HEAP32[r16>>2]&3|0)!=3){r17=r14;r18=r15;break}HEAP32[1816>>2]=r15;HEAP32[r16>>2]=HEAP32[r16>>2]&-2;HEAP32[r1+(r12+4)>>2]=r15|1;HEAP32[r9>>2]=r15;return}r16=r11>>>3;if(r11>>>0<256){r11=HEAP32[r1+(r12+8)>>2];r19=HEAP32[r1+(r12+12)>>2];r20=1848+(r16<<1<<2)|0;do{if((r11|0)!=(r20|0)){if(r11>>>0<r5>>>0){_abort()}if((HEAP32[r11+12>>2]|0)==(r14|0)){break}_abort()}}while(0);if((r19|0)==(r11|0)){HEAP32[1808>>2]=HEAP32[1808>>2]&~(1<<r16);r17=r14;r18=r15;break}do{if((r19|0)==(r20|0)){r21=r19+8|0}else{if(r19>>>0<r5>>>0){_abort()}r22=r19+8|0;if((HEAP32[r22>>2]|0)==(r14|0)){r21=r22;break}_abort()}}while(0);HEAP32[r11+12>>2]=r19;HEAP32[r21>>2]=r11;r17=r14;r18=r15;break}r20=r13;r16=HEAP32[r1+(r12+24)>>2];r22=HEAP32[r1+(r12+12)>>2];do{if((r22|0)==(r20|0)){r23=r1+(r12+20)|0;r24=HEAP32[r23>>2];if((r24|0)==0){r25=r1+(r12+16)|0;r26=HEAP32[r25>>2];if((r26|0)==0){r27=0;break}else{r28=r26;r29=r25}}else{r28=r24;r29=r23}while(1){r23=r28+20|0;r24=HEAP32[r23>>2];if((r24|0)!=0){r28=r24;r29=r23;continue}r23=r28+16|0;r24=HEAP32[r23>>2];if((r24|0)==0){break}else{r28=r24;r29=r23}}if(r29>>>0<r5>>>0){_abort()}else{HEAP32[r29>>2]=0;r27=r28;break}}else{r23=HEAP32[r1+(r12+8)>>2];if(r23>>>0<r5>>>0){_abort()}r24=r23+12|0;if((HEAP32[r24>>2]|0)!=(r20|0)){_abort()}r25=r22+8|0;if((HEAP32[r25>>2]|0)==(r20|0)){HEAP32[r24>>2]=r22;HEAP32[r25>>2]=r23;r27=r22;break}else{_abort()}}}while(0);if((r16|0)==0){r17=r14;r18=r15;break}r22=r1+(r12+28)|0;r13=2112+(HEAP32[r22>>2]<<2)|0;do{if((r20|0)==(HEAP32[r13>>2]|0)){HEAP32[r13>>2]=r27;if((r27|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r22>>2]);r17=r14;r18=r15;break L10}else{if(r16>>>0<HEAP32[1824>>2]>>>0){_abort()}r11=r16+16|0;if((HEAP32[r11>>2]|0)==(r20|0)){HEAP32[r11>>2]=r27}else{HEAP32[r16+20>>2]=r27}if((r27|0)==0){r17=r14;r18=r15;break L10}}}while(0);if(r27>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r27+24>>2]=r16;r20=HEAP32[r1+(r12+16)>>2];do{if((r20|0)!=0){if(r20>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r27+16>>2]=r20;HEAP32[r20+24>>2]=r27;break}}}while(0);r20=HEAP32[r1+(r12+20)>>2];if((r20|0)==0){r17=r14;r18=r15;break}if(r20>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r27+20>>2]=r20;HEAP32[r20+24>>2]=r27;r17=r14;r18=r15;break}}else{r17=r4;r18=r8}}while(0);r4=r17;if(r4>>>0>=r9>>>0){_abort()}r27=r1+(r8-4)|0;r5=HEAP32[r27>>2];if((r5&1|0)==0){_abort()}do{if((r5&2|0)==0){if((r10|0)==(HEAP32[1832>>2]|0)){r28=HEAP32[1820>>2]+r18|0;HEAP32[1820>>2]=r28;HEAP32[1832>>2]=r17;HEAP32[r17+4>>2]=r28|1;if((r17|0)!=(HEAP32[1828>>2]|0)){return}HEAP32[1828>>2]=0;HEAP32[1816>>2]=0;return}if((r10|0)==(HEAP32[1828>>2]|0)){r28=HEAP32[1816>>2]+r18|0;HEAP32[1816>>2]=r28;HEAP32[1828>>2]=r17;HEAP32[r17+4>>2]=r28|1;HEAP32[r4+r28>>2]=r28;return}r28=(r5&-8)+r18|0;r29=r5>>>3;L113:do{if(r5>>>0<256){r21=HEAP32[r1+r8>>2];r7=HEAP32[r1+(r8|4)>>2];r3=1848+(r29<<1<<2)|0;do{if((r21|0)!=(r3|0)){if(r21>>>0<HEAP32[1824>>2]>>>0){_abort()}if((HEAP32[r21+12>>2]|0)==(r10|0)){break}_abort()}}while(0);if((r7|0)==(r21|0)){HEAP32[1808>>2]=HEAP32[1808>>2]&~(1<<r29);break}do{if((r7|0)==(r3|0)){r30=r7+8|0}else{if(r7>>>0<HEAP32[1824>>2]>>>0){_abort()}r6=r7+8|0;if((HEAP32[r6>>2]|0)==(r10|0)){r30=r6;break}_abort()}}while(0);HEAP32[r21+12>>2]=r7;HEAP32[r30>>2]=r21}else{r3=r9;r6=HEAP32[r1+(r8+16)>>2];r20=HEAP32[r1+(r8|4)>>2];do{if((r20|0)==(r3|0)){r16=r1+(r8+12)|0;r22=HEAP32[r16>>2];if((r22|0)==0){r13=r1+(r8+8)|0;r11=HEAP32[r13>>2];if((r11|0)==0){r31=0;break}else{r32=r11;r33=r13}}else{r32=r22;r33=r16}while(1){r16=r32+20|0;r22=HEAP32[r16>>2];if((r22|0)!=0){r32=r22;r33=r16;continue}r16=r32+16|0;r22=HEAP32[r16>>2];if((r22|0)==0){break}else{r32=r22;r33=r16}}if(r33>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r33>>2]=0;r31=r32;break}}else{r16=HEAP32[r1+r8>>2];if(r16>>>0<HEAP32[1824>>2]>>>0){_abort()}r22=r16+12|0;if((HEAP32[r22>>2]|0)!=(r3|0)){_abort()}r13=r20+8|0;if((HEAP32[r13>>2]|0)==(r3|0)){HEAP32[r22>>2]=r20;HEAP32[r13>>2]=r16;r31=r20;break}else{_abort()}}}while(0);if((r6|0)==0){break}r20=r1+(r8+20)|0;r21=2112+(HEAP32[r20>>2]<<2)|0;do{if((r3|0)==(HEAP32[r21>>2]|0)){HEAP32[r21>>2]=r31;if((r31|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r20>>2]);break L113}else{if(r6>>>0<HEAP32[1824>>2]>>>0){_abort()}r7=r6+16|0;if((HEAP32[r7>>2]|0)==(r3|0)){HEAP32[r7>>2]=r31}else{HEAP32[r6+20>>2]=r31}if((r31|0)==0){break L113}}}while(0);if(r31>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r31+24>>2]=r6;r3=HEAP32[r1+(r8+8)>>2];do{if((r3|0)!=0){if(r3>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r31+16>>2]=r3;HEAP32[r3+24>>2]=r31;break}}}while(0);r3=HEAP32[r1+(r8+12)>>2];if((r3|0)==0){break}if(r3>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r31+20>>2]=r3;HEAP32[r3+24>>2]=r31;break}}}while(0);HEAP32[r17+4>>2]=r28|1;HEAP32[r4+r28>>2]=r28;if((r17|0)!=(HEAP32[1828>>2]|0)){r34=r28;break}HEAP32[1816>>2]=r28;return}else{HEAP32[r27>>2]=r5&-2;HEAP32[r17+4>>2]=r18|1;HEAP32[r4+r18>>2]=r18;r34=r18}}while(0);r18=r34>>>3;if(r34>>>0<256){r4=r18<<1;r5=1848+(r4<<2)|0;r27=HEAP32[1808>>2];r31=1<<r18;do{if((r27&r31|0)==0){HEAP32[1808>>2]=r27|r31;r35=r5;r36=1848+(r4+2<<2)|0}else{r18=1848+(r4+2<<2)|0;r8=HEAP32[r18>>2];if(r8>>>0>=HEAP32[1824>>2]>>>0){r35=r8;r36=r18;break}_abort()}}while(0);HEAP32[r36>>2]=r17;HEAP32[r35+12>>2]=r17;HEAP32[r17+8>>2]=r35;HEAP32[r17+12>>2]=r5;return}r5=r17;r35=r34>>>8;do{if((r35|0)==0){r37=0}else{if(r34>>>0>16777215){r37=31;break}r36=(r35+1048320|0)>>>16&8;r4=r35<<r36;r31=(r4+520192|0)>>>16&4;r27=r4<<r31;r4=(r27+245760|0)>>>16&2;r18=14-(r31|r36|r4)+(r27<<r4>>>15)|0;r37=r34>>>((r18+7|0)>>>0)&1|r18<<1}}while(0);r35=2112+(r37<<2)|0;HEAP32[r17+28>>2]=r37;HEAP32[r17+20>>2]=0;HEAP32[r17+16>>2]=0;r18=HEAP32[1812>>2];r4=1<<r37;do{if((r18&r4|0)==0){HEAP32[1812>>2]=r18|r4;HEAP32[r35>>2]=r5;HEAP32[r17+24>>2]=r35;HEAP32[r17+12>>2]=r17;HEAP32[r17+8>>2]=r17}else{if((r37|0)==31){r38=0}else{r38=25-(r37>>>1)|0}r27=r34<<r38;r36=HEAP32[r35>>2];while(1){if((HEAP32[r36+4>>2]&-8|0)==(r34|0)){break}r39=r36+16+(r27>>>31<<2)|0;r31=HEAP32[r39>>2];if((r31|0)==0){r2=129;break}else{r27=r27<<1;r36=r31}}if(r2==129){if(r39>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r39>>2]=r5;HEAP32[r17+24>>2]=r36;HEAP32[r17+12>>2]=r17;HEAP32[r17+8>>2]=r17;break}}r27=r36+8|0;r28=HEAP32[r27>>2];r31=HEAP32[1824>>2];if(r36>>>0<r31>>>0){_abort()}if(r28>>>0<r31>>>0){_abort()}else{HEAP32[r28+12>>2]=r5;HEAP32[r27>>2]=r5;HEAP32[r17+8>>2]=r28;HEAP32[r17+12>>2]=r36;HEAP32[r17+24>>2]=0;break}}}while(0);r17=HEAP32[1840>>2]-1|0;HEAP32[1840>>2]=r17;if((r17|0)==0){r40=2264}else{return}while(1){r17=HEAP32[r40>>2];if((r17|0)==0){break}else{r40=r17+8|0}}HEAP32[1840>>2]=-1;return}function _realloc(r1,r2){var r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32,r33;if((r1|0)==0){r3=_malloc(r2);return r3}if(r2>>>0>4294967231){HEAP32[___errno_location()>>2]=12;r3=0;return r3}if(r2>>>0<11){r4=16}else{r4=r2+11&-8}r5=r1-8|0;r6=r1-4|0;r7=HEAP32[r6>>2];r8=r7&-8;r9=r8-8|0;r10=r1+r9|0;r11=r10;r12=HEAP32[1824>>2];if(r5>>>0<r12>>>0){_abort()}r13=r7&3;if(!((r13|0)!=1&(r9|0)>-8)){_abort()}r9=r8|4;r14=r1+(r9-8)|0;r15=HEAP32[r14>>2];if((r15&1|0)==0){_abort()}L21:do{if((r13|0)==0){if(r4>>>0<256|r8>>>0<(r4|4)>>>0){break}if((r8-r4|0)>>>0>HEAP32[1784>>2]<<1>>>0|(r5|0)==0){break}else{r3=r1}return r3}else{do{if(r8>>>0<r4>>>0){if((r11|0)==(HEAP32[1832>>2]|0)){r16=HEAP32[1820>>2]+r8|0;if(r16>>>0<=r4>>>0){break L21}r17=r16-r4|0;HEAP32[r6>>2]=r7&1|r4|2;HEAP32[r1+((r4|4)-8)>>2]=r17|1;HEAP32[1832>>2]=r1+(r4-8);HEAP32[1820>>2]=r17;break}if((r11|0)==(HEAP32[1828>>2]|0)){r17=HEAP32[1816>>2]+r8|0;if(r17>>>0<r4>>>0){break L21}r16=r17-r4|0;if(r16>>>0>15){HEAP32[r6>>2]=r7&1|r4|2;HEAP32[r1+((r4|4)-8)>>2]=r16|1;HEAP32[r1+(r17-8)>>2]=r16;r18=r1+(r17-4)|0;HEAP32[r18>>2]=HEAP32[r18>>2]&-2;r19=r1+(r4-8)|0;r20=r16}else{HEAP32[r6>>2]=r7&1|r17|2;r16=r1+(r17-4)|0;HEAP32[r16>>2]=HEAP32[r16>>2]|1;r19=0;r20=0}HEAP32[1816>>2]=r20;HEAP32[1828>>2]=r19;break}if((r15&2|0)!=0){break L21}r16=(r15&-8)+r8|0;if(r16>>>0<r4>>>0){break L21}r17=r16-r4|0;r18=r15>>>3;L45:do{if(r15>>>0<256){r21=HEAP32[r1+r8>>2];r22=HEAP32[r1+r9>>2];r23=1848+(r18<<1<<2)|0;do{if((r21|0)!=(r23|0)){if(r21>>>0<r12>>>0){_abort()}if((HEAP32[r21+12>>2]|0)==(r11|0)){break}_abort()}}while(0);if((r22|0)==(r21|0)){HEAP32[1808>>2]=HEAP32[1808>>2]&~(1<<r18);break}do{if((r22|0)==(r23|0)){r24=r22+8|0}else{if(r22>>>0<r12>>>0){_abort()}r25=r22+8|0;if((HEAP32[r25>>2]|0)==(r11|0)){r24=r25;break}_abort()}}while(0);HEAP32[r21+12>>2]=r22;HEAP32[r24>>2]=r21}else{r23=r10;r25=HEAP32[r1+(r8+16)>>2];r26=HEAP32[r1+r9>>2];do{if((r26|0)==(r23|0)){r27=r1+(r8+12)|0;r28=HEAP32[r27>>2];if((r28|0)==0){r29=r1+(r8+8)|0;r30=HEAP32[r29>>2];if((r30|0)==0){r31=0;break}else{r32=r30;r33=r29}}else{r32=r28;r33=r27}while(1){r27=r32+20|0;r28=HEAP32[r27>>2];if((r28|0)!=0){r32=r28;r33=r27;continue}r27=r32+16|0;r28=HEAP32[r27>>2];if((r28|0)==0){break}else{r32=r28;r33=r27}}if(r33>>>0<r12>>>0){_abort()}else{HEAP32[r33>>2]=0;r31=r32;break}}else{r27=HEAP32[r1+r8>>2];if(r27>>>0<r12>>>0){_abort()}r28=r27+12|0;if((HEAP32[r28>>2]|0)!=(r23|0)){_abort()}r29=r26+8|0;if((HEAP32[r29>>2]|0)==(r23|0)){HEAP32[r28>>2]=r26;HEAP32[r29>>2]=r27;r31=r26;break}else{_abort()}}}while(0);if((r25|0)==0){break}r26=r1+(r8+20)|0;r21=2112+(HEAP32[r26>>2]<<2)|0;do{if((r23|0)==(HEAP32[r21>>2]|0)){HEAP32[r21>>2]=r31;if((r31|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r26>>2]);break L45}else{if(r25>>>0<HEAP32[1824>>2]>>>0){_abort()}r22=r25+16|0;if((HEAP32[r22>>2]|0)==(r23|0)){HEAP32[r22>>2]=r31}else{HEAP32[r25+20>>2]=r31}if((r31|0)==0){break L45}}}while(0);if(r31>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r31+24>>2]=r25;r23=HEAP32[r1+(r8+8)>>2];do{if((r23|0)!=0){if(r23>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r31+16>>2]=r23;HEAP32[r23+24>>2]=r31;break}}}while(0);r23=HEAP32[r1+(r8+12)>>2];if((r23|0)==0){break}if(r23>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r31+20>>2]=r23;HEAP32[r23+24>>2]=r31;break}}}while(0);if(r17>>>0>=16){HEAP32[r6>>2]=HEAP32[r6>>2]&1|r4|2;HEAP32[r1+((r4|4)-8)>>2]=r17|3;r18=r1+((r16|4)-8)|0;HEAP32[r18>>2]=HEAP32[r18>>2]|1;_dispose_chunk(r1+(r4-8)|0,r17);break}HEAP32[r6>>2]=r16|HEAP32[r6>>2]&1|2;r18=r1+((r16|4)-8)|0;HEAP32[r18>>2]=HEAP32[r18>>2]|1;r3=r1;return r3}else{r18=r8-r4|0;if(r18>>>0<=15){break}HEAP32[r6>>2]=r7&1|r4|2;HEAP32[r1+((r4|4)-8)>>2]=r18|3;HEAP32[r14>>2]=HEAP32[r14>>2]|1;_dispose_chunk(r1+(r4-8)|0,r18);r3=r1;return r3}}while(0);if((r5|0)==0){break}else{r3=r1}return r3}}while(0);r5=_malloc(r2);if((r5|0)==0){r3=0;return r3}r4=HEAP32[r6>>2];r6=(r4&-8)-((r4&3|0)==0?8:4)|0;_memcpy(r5,r1,r6>>>0<r2>>>0?r6:r2)|0;_free(r1);r3=r5;return r3}function _dispose_chunk(r1,r2){var r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32,r33,r34,r35,r36,r37;r3=0;r4=r1;r5=r4+r2|0;r6=r5;r7=HEAP32[r1+4>>2];L1:do{if((r7&1|0)==0){r8=HEAP32[r1>>2];if((r7&3|0)==0){return}r9=r4+ -r8|0;r10=r9;r11=r8+r2|0;r12=HEAP32[1824>>2];if(r9>>>0<r12>>>0){_abort()}if((r10|0)==(HEAP32[1828>>2]|0)){r13=r4+(r2+4)|0;if((HEAP32[r13>>2]&3|0)!=3){r14=r10;r15=r11;break}HEAP32[1816>>2]=r11;HEAP32[r13>>2]=HEAP32[r13>>2]&-2;HEAP32[r4+(4-r8)>>2]=r11|1;HEAP32[r5>>2]=r11;return}r13=r8>>>3;if(r8>>>0<256){r16=HEAP32[r4+(8-r8)>>2];r17=HEAP32[r4+(12-r8)>>2];r18=1848+(r13<<1<<2)|0;do{if((r16|0)!=(r18|0)){if(r16>>>0<r12>>>0){_abort()}if((HEAP32[r16+12>>2]|0)==(r10|0)){break}_abort()}}while(0);if((r17|0)==(r16|0)){HEAP32[1808>>2]=HEAP32[1808>>2]&~(1<<r13);r14=r10;r15=r11;break}do{if((r17|0)==(r18|0)){r19=r17+8|0}else{if(r17>>>0<r12>>>0){_abort()}r20=r17+8|0;if((HEAP32[r20>>2]|0)==(r10|0)){r19=r20;break}_abort()}}while(0);HEAP32[r16+12>>2]=r17;HEAP32[r19>>2]=r16;r14=r10;r15=r11;break}r18=r9;r13=HEAP32[r4+(24-r8)>>2];r20=HEAP32[r4+(12-r8)>>2];do{if((r20|0)==(r18|0)){r21=16-r8|0;r22=r4+(r21+4)|0;r23=HEAP32[r22>>2];if((r23|0)==0){r24=r4+r21|0;r21=HEAP32[r24>>2];if((r21|0)==0){r25=0;break}else{r26=r21;r27=r24}}else{r26=r23;r27=r22}while(1){r22=r26+20|0;r23=HEAP32[r22>>2];if((r23|0)!=0){r26=r23;r27=r22;continue}r22=r26+16|0;r23=HEAP32[r22>>2];if((r23|0)==0){break}else{r26=r23;r27=r22}}if(r27>>>0<r12>>>0){_abort()}else{HEAP32[r27>>2]=0;r25=r26;break}}else{r22=HEAP32[r4+(8-r8)>>2];if(r22>>>0<r12>>>0){_abort()}r23=r22+12|0;if((HEAP32[r23>>2]|0)!=(r18|0)){_abort()}r24=r20+8|0;if((HEAP32[r24>>2]|0)==(r18|0)){HEAP32[r23>>2]=r20;HEAP32[r24>>2]=r22;r25=r20;break}else{_abort()}}}while(0);if((r13|0)==0){r14=r10;r15=r11;break}r20=r4+(28-r8)|0;r12=2112+(HEAP32[r20>>2]<<2)|0;do{if((r18|0)==(HEAP32[r12>>2]|0)){HEAP32[r12>>2]=r25;if((r25|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r20>>2]);r14=r10;r15=r11;break L1}else{if(r13>>>0<HEAP32[1824>>2]>>>0){_abort()}r9=r13+16|0;if((HEAP32[r9>>2]|0)==(r18|0)){HEAP32[r9>>2]=r25}else{HEAP32[r13+20>>2]=r25}if((r25|0)==0){r14=r10;r15=r11;break L1}}}while(0);if(r25>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r25+24>>2]=r13;r18=16-r8|0;r20=HEAP32[r4+r18>>2];do{if((r20|0)!=0){if(r20>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r25+16>>2]=r20;HEAP32[r20+24>>2]=r25;break}}}while(0);r20=HEAP32[r4+(r18+4)>>2];if((r20|0)==0){r14=r10;r15=r11;break}if(r20>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r25+20>>2]=r20;HEAP32[r20+24>>2]=r25;r14=r10;r15=r11;break}}else{r14=r1;r15=r2}}while(0);r1=HEAP32[1824>>2];if(r5>>>0<r1>>>0){_abort()}r25=r4+(r2+4)|0;r26=HEAP32[r25>>2];do{if((r26&2|0)==0){if((r6|0)==(HEAP32[1832>>2]|0)){r27=HEAP32[1820>>2]+r15|0;HEAP32[1820>>2]=r27;HEAP32[1832>>2]=r14;HEAP32[r14+4>>2]=r27|1;if((r14|0)!=(HEAP32[1828>>2]|0)){return}HEAP32[1828>>2]=0;HEAP32[1816>>2]=0;return}if((r6|0)==(HEAP32[1828>>2]|0)){r27=HEAP32[1816>>2]+r15|0;HEAP32[1816>>2]=r27;HEAP32[1828>>2]=r14;HEAP32[r14+4>>2]=r27|1;HEAP32[r14+r27>>2]=r27;return}r27=(r26&-8)+r15|0;r19=r26>>>3;L100:do{if(r26>>>0<256){r7=HEAP32[r4+(r2+8)>>2];r20=HEAP32[r4+(r2+12)>>2];r8=1848+(r19<<1<<2)|0;do{if((r7|0)!=(r8|0)){if(r7>>>0<r1>>>0){_abort()}if((HEAP32[r7+12>>2]|0)==(r6|0)){break}_abort()}}while(0);if((r20|0)==(r7|0)){HEAP32[1808>>2]=HEAP32[1808>>2]&~(1<<r19);break}do{if((r20|0)==(r8|0)){r28=r20+8|0}else{if(r20>>>0<r1>>>0){_abort()}r13=r20+8|0;if((HEAP32[r13>>2]|0)==(r6|0)){r28=r13;break}_abort()}}while(0);HEAP32[r7+12>>2]=r20;HEAP32[r28>>2]=r7}else{r8=r5;r13=HEAP32[r4+(r2+24)>>2];r12=HEAP32[r4+(r2+12)>>2];do{if((r12|0)==(r8|0)){r9=r4+(r2+20)|0;r16=HEAP32[r9>>2];if((r16|0)==0){r17=r4+(r2+16)|0;r22=HEAP32[r17>>2];if((r22|0)==0){r29=0;break}else{r30=r22;r31=r17}}else{r30=r16;r31=r9}while(1){r9=r30+20|0;r16=HEAP32[r9>>2];if((r16|0)!=0){r30=r16;r31=r9;continue}r9=r30+16|0;r16=HEAP32[r9>>2];if((r16|0)==0){break}else{r30=r16;r31=r9}}if(r31>>>0<r1>>>0){_abort()}else{HEAP32[r31>>2]=0;r29=r30;break}}else{r9=HEAP32[r4+(r2+8)>>2];if(r9>>>0<r1>>>0){_abort()}r16=r9+12|0;if((HEAP32[r16>>2]|0)!=(r8|0)){_abort()}r17=r12+8|0;if((HEAP32[r17>>2]|0)==(r8|0)){HEAP32[r16>>2]=r12;HEAP32[r17>>2]=r9;r29=r12;break}else{_abort()}}}while(0);if((r13|0)==0){break}r12=r4+(r2+28)|0;r7=2112+(HEAP32[r12>>2]<<2)|0;do{if((r8|0)==(HEAP32[r7>>2]|0)){HEAP32[r7>>2]=r29;if((r29|0)!=0){break}HEAP32[1812>>2]=HEAP32[1812>>2]&~(1<<HEAP32[r12>>2]);break L100}else{if(r13>>>0<HEAP32[1824>>2]>>>0){_abort()}r20=r13+16|0;if((HEAP32[r20>>2]|0)==(r8|0)){HEAP32[r20>>2]=r29}else{HEAP32[r13+20>>2]=r29}if((r29|0)==0){break L100}}}while(0);if(r29>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r29+24>>2]=r13;r8=HEAP32[r4+(r2+16)>>2];do{if((r8|0)!=0){if(r8>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r29+16>>2]=r8;HEAP32[r8+24>>2]=r29;break}}}while(0);r8=HEAP32[r4+(r2+20)>>2];if((r8|0)==0){break}if(r8>>>0<HEAP32[1824>>2]>>>0){_abort()}else{HEAP32[r29+20>>2]=r8;HEAP32[r8+24>>2]=r29;break}}}while(0);HEAP32[r14+4>>2]=r27|1;HEAP32[r14+r27>>2]=r27;if((r14|0)!=(HEAP32[1828>>2]|0)){r32=r27;break}HEAP32[1816>>2]=r27;return}else{HEAP32[r25>>2]=r26&-2;HEAP32[r14+4>>2]=r15|1;HEAP32[r14+r15>>2]=r15;r32=r15}}while(0);r15=r32>>>3;if(r32>>>0<256){r26=r15<<1;r25=1848+(r26<<2)|0;r29=HEAP32[1808>>2];r2=1<<r15;do{if((r29&r2|0)==0){HEAP32[1808>>2]=r29|r2;r33=r25;r34=1848+(r26+2<<2)|0}else{r15=1848+(r26+2<<2)|0;r4=HEAP32[r15>>2];if(r4>>>0>=HEAP32[1824>>2]>>>0){r33=r4;r34=r15;break}_abort()}}while(0);HEAP32[r34>>2]=r14;HEAP32[r33+12>>2]=r14;HEAP32[r14+8>>2]=r33;HEAP32[r14+12>>2]=r25;return}r25=r14;r33=r32>>>8;do{if((r33|0)==0){r35=0}else{if(r32>>>0>16777215){r35=31;break}r34=(r33+1048320|0)>>>16&8;r26=r33<<r34;r2=(r26+520192|0)>>>16&4;r29=r26<<r2;r26=(r29+245760|0)>>>16&2;r15=14-(r2|r34|r26)+(r29<<r26>>>15)|0;r35=r32>>>((r15+7|0)>>>0)&1|r15<<1}}while(0);r33=2112+(r35<<2)|0;HEAP32[r14+28>>2]=r35;HEAP32[r14+20>>2]=0;HEAP32[r14+16>>2]=0;r15=HEAP32[1812>>2];r26=1<<r35;if((r15&r26|0)==0){HEAP32[1812>>2]=r15|r26;HEAP32[r33>>2]=r25;HEAP32[r14+24>>2]=r33;HEAP32[r14+12>>2]=r14;HEAP32[r14+8>>2]=r14;return}if((r35|0)==31){r36=0}else{r36=25-(r35>>>1)|0}r35=r32<<r36;r36=HEAP32[r33>>2];while(1){if((HEAP32[r36+4>>2]&-8|0)==(r32|0)){break}r37=r36+16+(r35>>>31<<2)|0;r33=HEAP32[r37>>2];if((r33|0)==0){r3=126;break}else{r35=r35<<1;r36=r33}}if(r3==126){if(r37>>>0<HEAP32[1824>>2]>>>0){_abort()}HEAP32[r37>>2]=r25;HEAP32[r14+24>>2]=r36;HEAP32[r14+12>>2]=r14;HEAP32[r14+8>>2]=r14;return}r37=r36+8|0;r3=HEAP32[r37>>2];r35=HEAP32[1824>>2];if(r36>>>0<r35>>>0){_abort()}if(r3>>>0<r35>>>0){_abort()}HEAP32[r3+12>>2]=r25;HEAP32[r37>>2]=r25;HEAP32[r14+8>>2]=r3;HEAP32[r14+12>>2]=r36;HEAP32[r14+24>>2]=0;return}function __ZNSt9bad_allocD0Ev(r1){if((r1|0)==0){return}_free(r1);return}function __ZNSt9bad_allocD2Ev(r1){return}function __ZNKSt9bad_alloc4whatEv(r1){return 224}
// EMSCRIPTEN_END_FUNCS
Module["___getTypeName"] = ___getTypeName;
Module["_malloc"] = _malloc;
Module["_free"] = _free;
Module["_realloc"] = _realloc;
// Warning: printing of i64 values may be slightly rounded! No deep i64 math used, so precise i64 code not included
var i64Math = null;
// === Auto-generated postamble setup entry stuff ===
if (memoryInitializer) {
  function applyData(data) {
    HEAPU8.set(data, STATIC_BASE);
  }
  if (ENVIRONMENT_IS_NODE || ENVIRONMENT_IS_SHELL) {
    applyData(Module['readBinary'](memoryInitializer));
  } else {
    addRunDependency('memory initializer');
    Browser.asyncLoad(memoryInitializer, function(data) {
      applyData(data);
      removeRunDependency('memory initializer');
    }, function(data) {
      throw 'could not load memory initializer ' + memoryInitializer;
    });
  }
}
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;
var initialStackTop;
var preloadStartTime = null;
var calledMain = false;
dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun'] && shouldRunNow) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}
Module['callMain'] = Module.callMain = function callMain(args) {
  assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on __ATMAIN__)');
  assert(__ATPRERUN__.length == 0, 'cannot call main when preRun functions remain to be called');
  args = args || [];
  if (ENVIRONMENT_IS_WEB && preloadStartTime !== null) {
    Module.printErr('preload time: ' + (Date.now() - preloadStartTime) + ' ms');
  }
  ensureInitRuntime();
  var argc = args.length+1;
  function pad() {
    for (var i = 0; i < 4-1; i++) {
      argv.push(0);
    }
  }
  var argv = [allocate(intArrayFromString("/bin/this.program"), 'i8', ALLOC_NORMAL) ];
  pad();
  for (var i = 0; i < argc-1; i = i + 1) {
    argv.push(allocate(intArrayFromString(args[i]), 'i8', ALLOC_NORMAL));
    pad();
  }
  argv.push(0);
  argv = allocate(argv, 'i32', ALLOC_NORMAL);
  initialStackTop = STACKTOP;
  try {
    var ret = Module['_main'](argc, argv, 0);
    // if we're not running an evented main loop, it's time to exit
    if (!Module['noExitRuntime']) {
      exit(ret);
    }
  }
  catch(e) {
    if (e instanceof ExitStatus) {
      // exit() throws this once it's done to make sure execution
      // has been stopped completely
      return;
    } else if (e == 'SimulateInfiniteLoop') {
      // running an evented main loop, don't immediately exit
      Module['noExitRuntime'] = true;
      return;
    } else {
      if (e && typeof e === 'object' && e.stack) Module.printErr('exception thrown: ' + [e, e.stack]);
      throw e;
    }
  } finally {
    calledMain = true;
  }
}
function run(args) {
  args = args || Module['arguments'];
  if (preloadStartTime === null) preloadStartTime = Date.now();
  if (runDependencies > 0) {
    Module.printErr('run() called, but dependencies remain, so not running');
    return;
  }
  preRun();
  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame
  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;
    ensureInitRuntime();
    preMain();
    if (Module['_main'] && shouldRunNow) {
      Module['callMain'](args);
    }
    postRun();
  }
  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      if (!ABORT) doRun();
    }, 1);
  } else {
    doRun();
  }
}
Module['run'] = Module.run = run;
function exit(status) {
  ABORT = true;
  EXITSTATUS = status;
  STACKTOP = initialStackTop;
  // exit the runtime
  exitRuntime();
  // TODO We should handle this differently based on environment.
  // In the browser, the best we can do is throw an exception
  // to halt execution, but in node we could process.exit and
  // I'd imagine SM shell would have something equivalent.
  // This would let us set a proper exit status (which
  // would be great for checking test exit statuses).
  // https://github.com/kripken/emscripten/issues/1371
  // throw an exception to halt the current execution
  throw new ExitStatus(status);
}
Module['exit'] = Module.exit = exit;
function abort(text) {
  if (text) {
    Module.print(text);
    Module.printErr(text);
  }
  ABORT = true;
  EXITSTATUS = 1;
  throw 'abort() at ' + stackTrace();
}
Module['abort'] = Module.abort = abort;
// {{PRE_RUN_ADDITIONS}}
/*global Module*/
/*global _malloc, _free, _memcpy*/
/*global FUNCTION_TABLE, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32*/
/*global readLatin1String*/
/*global __emval_register, _emval_handle_array, __emval_decref*/
/*global ___getTypeName*/
/*jslint sub:true*/ /* The symbols 'fromWireType' and 'toWireType' must be accessed via array notation to be closure-safe since craftInvokerFunction crafts functions as strings that can't be closured. */
var InternalError = Module['InternalError'] = extendError(Error, 'InternalError');
var BindingError = Module['BindingError'] = extendError(Error, 'BindingError');
var UnboundTypeError = Module['UnboundTypeError'] = extendError(BindingError, 'UnboundTypeError');
function throwInternalError(message) {
    throw new InternalError(message);
}
function throwBindingError(message) {
    throw new BindingError(message);
}
function throwUnboundTypeError(message, types) {
    var unboundTypes = [];
    var seen = {};
    function visit(type) {
        if (seen[type]) {
            return;
        }
        if (registeredTypes[type]) {
            return;
        }
        if (typeDependencies[type]) {
            typeDependencies[type].forEach(visit);
            return;
        }
        unboundTypes.push(type);
        seen[type] = true;
    }
    types.forEach(visit);
    throw new UnboundTypeError(message + ': ' + unboundTypes.map(getTypeName).join([', ']));
}
// Creates a function overload resolution table to the given method 'methodName' in the given prototype,
// if the overload table doesn't yet exist.
function ensureOverloadTable(proto, methodName, humanName) {
    if (undefined === proto[methodName].overloadTable) {
        var prevFunc = proto[methodName];
        // Inject an overload resolver function that routes to the appropriate overload based on the number of arguments.
        proto[methodName] = function() {
            // TODO This check can be removed in -O3 level "unsafe" optimizations.
            if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
                throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
            }
            return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
        };
        // Move the previous function into the overload table.
        proto[methodName].overloadTable = [];
        proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
    }            
}
/* Registers a symbol (function, class, enum, ...) as part of the Module JS object so that
   hand-written code is able to access that symbol via 'Module.name'.
   name: The name of the symbol that's being exposed.
   value: The object itself to expose (function, class, ...)
   numArguments: For functions, specifies the number of arguments the function takes in. For other types, unused and undefined.
   To implement support for multiple overloads of a function, an 'overload selector' function is used. That selector function chooses
   the appropriate overload to call from an function overload table. This selector function is only used if multiple overloads are
   actually registered, since it carries a slight performance penalty. */
function exposePublicSymbol(name, value, numArguments) {
    if (Module.hasOwnProperty(name)) {
        if (undefined === numArguments || (undefined !== Module[name].overloadTable && undefined !== Module[name].overloadTable[numArguments])) {
            throwBindingError("Cannot register public name '" + name + "' twice");
        }
        // We are exposing a function with the same name as an existing function. Create an overload table and a function selector
        // that routes between the two.
        ensureOverloadTable(Module, name, name);
        if (Module.hasOwnProperty(numArguments)) {
            throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
        }
        // Add the new function into the overload table.
        Module[name].overloadTable[numArguments] = value;
    }
    else {
        Module[name] = value;
        if (undefined !== numArguments) {
            Module[name].numArguments = numArguments;
        }
    }
}
function replacePublicSymbol(name, value, numArguments) {
    if (!Module.hasOwnProperty(name)) {
        throwInternalError('Replacing nonexistant public symbol');
    }
    // If there's an overload table for this symbol, replace the symbol in the overload table instead.
    if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
        Module[name].overloadTable[numArguments] = value;
    }
    else {
        Module[name] = value;
    }
}
// from https://github.com/imvu/imvujs/blob/master/src/error.js
function extendError(baseErrorType, errorName) {
    var errorClass = createNamedFunction(errorName, function(message) {
        this.name = errorName;
        this.message = message;
        var stack = (new Error(message)).stack;
        if (stack !== undefined) {
            this.stack = this.toString() + '\n' +
                stack.replace(/^Error(:[^\n]*)?\n/, '');
        }
    });
    errorClass.prototype = Object.create(baseErrorType.prototype);
    errorClass.prototype.constructor = errorClass;
    errorClass.prototype.toString = function() {
        if (this.message === undefined) {
            return this.name;
        } else {
            return this.name + ': ' + this.message;
        }
    };
    return errorClass;
}
// from https://github.com/imvu/imvujs/blob/master/src/function.js
function createNamedFunction(name, body) {
    name = makeLegalFunctionName(name);
    /*jshint evil:true*/
    return new Function(
        "body",
        "return function " + name + "() {\n" +
        "    \"use strict\";" +
        "    return body.apply(this, arguments);\n" +
        "};\n"
    )(body);
}
function _embind_repr(v) {
    var t = typeof v;
    if (t === 'object' || t === 'array' || t === 'function') {
        return v.toString();
    } else {
        return '' + v;
    }
}
// typeID -> { toWireType: ..., fromWireType: ... }
var registeredTypes = {};
// typeID -> [callback]
var awaitingDependencies = {};
// typeID -> [dependentTypes]
var typeDependencies = {};
// class typeID -> {pointerType: ..., constPointerType: ...}
var registeredPointers = {};
function registerType(rawType, registeredInstance) {
    var name = registeredInstance.name;
    if (!rawType) {
        throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
    }
    if (registeredTypes.hasOwnProperty(rawType)) {
        throwBindingError("Cannot register type '" + name + "' twice");
    }
    registeredTypes[rawType] = registeredInstance;
    delete typeDependencies[rawType];
    if (awaitingDependencies.hasOwnProperty(rawType)) {
        var callbacks = awaitingDependencies[rawType];
        delete awaitingDependencies[rawType];
        callbacks.forEach(function(cb) {
            cb();
        });
    }
}
function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
    myTypes.forEach(function(type) {
        typeDependencies[type] = dependentTypes;
    });
    function onComplete(typeConverters) {
        var myTypeConverters = getTypeConverters(typeConverters);
        if (myTypeConverters.length !== myTypes.length) {
            throwInternalError('Mismatched type converter count');
        }
        for (var i = 0; i < myTypes.length; ++i) {
            registerType(myTypes[i], myTypeConverters[i]);
        }
    }
    var typeConverters = new Array(dependentTypes.length);
    var unregisteredTypes = [];
    var registered = 0;
    dependentTypes.forEach(function(dt, i) {
        if (registeredTypes.hasOwnProperty(dt)) {
            typeConverters[i] = registeredTypes[dt];
        } else {
            unregisteredTypes.push(dt);
            if (!awaitingDependencies.hasOwnProperty(dt)) {
                awaitingDependencies[dt] = [];
            }
            awaitingDependencies[dt].push(function() {
                typeConverters[i] = registeredTypes[dt];
                ++registered;
                if (registered === unregisteredTypes.length) {
                    onComplete(typeConverters);
                }
            });
        }
    });
    if (0 === unregisteredTypes.length) {
        onComplete(typeConverters);
    }
}
var __charCodes = (function() {
    var codes = new Array(256);
    for (var i = 0; i < 256; ++i) {
        codes[i] = String.fromCharCode(i);
    }
    return codes;
})();
function readLatin1String(ptr) {
    var ret = "";
    var c = ptr;
    while (HEAPU8[c]) {
        ret += __charCodes[HEAPU8[c++]];
    }
    return ret;
}
function getTypeName(type) {
    var ptr = ___getTypeName(type);
    var rv = readLatin1String(ptr);
    _free(ptr);
    return rv;
}
function heap32VectorToArray(count, firstElement) {
    var array = [];
    for (var i = 0; i < count; i++) {
        array.push(HEAP32[(firstElement >> 2) + i]);
    }
    return array;
}
function requireRegisteredType(rawType, humanName) {
    var impl = registeredTypes[rawType];
    if (undefined === impl) {
        throwBindingError(humanName + " has unknown type " + getTypeName(rawType));
    }
    return impl;
}
function __embind_register_void(rawType, name) {
    name = readLatin1String(name);
    registerType(rawType, {
        name: name,
        'fromWireType': function() {
            return undefined;
        },
        'toWireType': function(destructors, o) {
            // TODO: assert if anything else is given?
            return undefined;
        },
    });
}
function __embind_register_bool(rawType, name, trueValue, falseValue) {
    name = readLatin1String(name);
    registerType(rawType, {
        name: name,
        'fromWireType': function(wt) {
            // ambiguous emscripten ABI: sometimes return values are
            // true or false, and sometimes integers (0 or 1)
            return !!wt;
        },
        'toWireType': function(destructors, o) {
            return o ? trueValue : falseValue;
        },
        destructorFunction: null, // This type does not need a destructor
    });
}
// When converting a number from JS to C++ side, the valid range of the number is
// [minRange, maxRange], inclusive.
function __embind_register_integer(primitiveType, name, minRange, maxRange) {
    name = readLatin1String(name);
    if (maxRange === -1) { // LLVM doesn't have signed and unsigned 32-bit types, so u32 literals come out as 'i32 -1'. Always treat those as max u32.
        maxRange = 4294967295;
    }
    registerType(primitiveType, {
        name: name,
        minRange: minRange,
        maxRange: maxRange,
        'fromWireType': function(value) {
            return value;
        },
        'toWireType': function(destructors, value) {
            // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
            // avoid the following two if()s and assume value is of proper type.
            if (typeof value !== "number" && typeof value !== "boolean") {
                throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
            }
            if (value < minRange || value > maxRange) {
                throw new TypeError('Passing a number "' + _embind_repr(value) + '" from JS side to C/C++ side to an argument of type "' + name + '", which is outside the valid range [' + minRange + ', ' + maxRange + ']!');
            }
            return value | 0;
        },
        destructorFunction: null, // This type does not need a destructor
    });
}
function __embind_register_float(rawType, name) {
    name = readLatin1String(name);
    registerType(rawType, {
        name: name,
        'fromWireType': function(value) {
            return value;
        },
        'toWireType': function(destructors, value) {
            // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
            // avoid the following if() and assume value is of proper type.
            if (typeof value !== "number" && typeof value !== "boolean") {
                throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
            }
            return value;
        },
        destructorFunction: null, // This type does not need a destructor
    });
}
function __embind_register_std_string(rawType, name) {
    name = readLatin1String(name);
    registerType(rawType, {
        name: name,
        'fromWireType': function(value) {
            var length = HEAPU32[value >> 2];
            var a = new Array(length);
            for (var i = 0; i < length; ++i) {
                a[i] = String.fromCharCode(HEAPU8[value + 4 + i]);
            }
            _free(value);
            return a.join('');
        },
        'toWireType': function(destructors, value) {
            if (value instanceof ArrayBuffer) {
                value = new Uint8Array(value);
            }
            function getTAElement(ta, index) {
                return ta[index];
            }
            function getStringElement(string, index) {
                return string.charCodeAt(index);
            }
            var getElement;
            if (value instanceof Uint8Array) {
                getElement = getTAElement;
            } else if (value instanceof Int8Array) {
                getElement = getTAElement;
            } else if (typeof value === 'string') {
                getElement = getStringElement;
            } else {
                throwBindingError('Cannot pass non-string to std::string');
            }
            // assumes 4-byte alignment
            var length = value.length;
            var ptr = _malloc(4 + length);
            HEAPU32[ptr >> 2] = length;
            for (var i = 0; i < length; ++i) {
                var charCode = getElement(value, i);
                if (charCode > 255) {
                    _free(ptr);
                    throwBindingError('String has UTF-16 code units that do not fit in 8 bits');
                }
                HEAPU8[ptr + 4 + i] = charCode;
            }
            if (destructors !== null) {
                destructors.push(_free, ptr);
            }
            return ptr;
        },
        destructorFunction: function(ptr) { _free(ptr); },
    });
}
function __embind_register_std_wstring(rawType, charSize, name) {
    name = readLatin1String(name);
    var HEAP, shift;
    if (charSize === 2) {
        HEAP = HEAPU16;
        shift = 1;
    } else if (charSize === 4) {
        HEAP = HEAPU32;
        shift = 2;
    }
    registerType(rawType, {
        name: name,
        'fromWireType': function(value) {
            var length = HEAPU32[value >> 2];
            var a = new Array(length);
            var start = (value + 4) >> shift;
            for (var i = 0; i < length; ++i) {
                a[i] = String.fromCharCode(HEAP[start + i]);
            }
            _free(value);
            return a.join('');
        },
        'toWireType': function(destructors, value) {
            // assumes 4-byte alignment
            var length = value.length;
            var ptr = _malloc(4 + length * charSize);
            HEAPU32[ptr >> 2] = length;
            var start = (ptr + 4) >> shift;
            for (var i = 0; i < length; ++i) {
                HEAP[start + i] = value.charCodeAt(i);
            }
            if (destructors !== null) {
                destructors.push(_free, ptr);
            }
            return ptr;
        },
        destructorFunction: function(ptr) { _free(ptr); },
    });
}
function __embind_register_emval(rawType, name) {
    name = readLatin1String(name);
    registerType(rawType, {
        name: name,
        'fromWireType': function(handle) {
            var rv = _emval_handle_array[handle].value;
            __emval_decref(handle);
            return rv;
        },
        'toWireType': function(destructors, value) {
            return __emval_register(value);
        },
        destructorFunction: null, // This type does not need a destructor
    });
}
function __embind_register_memory_view(rawType, name) {
    var typeMapping = [
        Int8Array,
        Uint8Array,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,        
    ];
    name = readLatin1String(name);
    registerType(rawType, {
        name: name,
        'fromWireType': function(handle) {
            var type = HEAPU32[handle >> 2];
            var size = HEAPU32[(handle >> 2) + 1]; // in elements
            var data = HEAPU32[(handle >> 2) + 2]; // byte offset into emscripten heap
            var TA = typeMapping[type];
            return new TA(HEAP8.buffer, data, size);
        },
    });
}
function runDestructors(destructors) {
    while (destructors.length) {
        var ptr = destructors.pop();
        var del = destructors.pop();
        del(ptr);
    }
}
// Function implementation of operator new, per
// http://www.ecma-international.org/publications/files/ECMA-ST/Ecma-262.pdf
// 13.2.2
// ES3
function new_(constructor, argumentList) {
    if (!(constructor instanceof Function)) {
        throw new TypeError('new_ called with constructor type ' + typeof(constructor) + " which is not a function");
    }
    /*
     * Previously, the following line was just:
     function dummy() {};
     * Unfortunately, Chrome was preserving 'dummy' as the object's name, even though at creation, the 'dummy' has the
     * correct constructor name.  Thus, objects created with IMVU.new would show up in the debugger as 'dummy', which
     * isn't very helpful.  Using IMVU.createNamedFunction addresses the issue.  Doublely-unfortunately, there's no way
     * to write a test for this behavior.  -NRD 2013.02.22
     */
    var dummy = createNamedFunction(constructor.name, function(){});
    dummy.prototype = constructor.prototype;
    var obj = new dummy;
    var r = constructor.apply(obj, argumentList);
    return (r instanceof Object) ? r : obj;
}
// The path to interop from JS code to C++ code:
// (hand-written JS code) -> (autogenerated JS invoker) -> (template-generated C++ invoker) -> (target C++ function)
// craftInvokerFunction generates the JS invoker function for each function exposed to JS through embind.
function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
    // humanName: a human-readable string name for the function to be generated.
    // argTypes: An array that contains the embind type objects for all types in the function signature.
    //    argTypes[0] is the type object for the function return value.
    //    argTypes[1] is the type object for function this object/class type, or null if not crafting an invoker for a class method.
    //    argTypes[2...] are the actual function parameters.
    // classType: The embind type object for the class to be bound, or null if this is not a method of a class.
    // cppInvokerFunc: JS Function object to the C++-side function that interops into C++ code.
    // cppTargetFunc: Function pointer (an integer to FUNCTION_TABLE) to the target C++ function the cppInvokerFunc will end up calling.
    var argCount = argTypes.length;
    if (argCount < 2) {
        throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
    }
    var isClassMethodFunc = (argTypes[1] !== null && classType !== null);
    if (!isClassMethodFunc && !FUNCTION_TABLE[cppTargetFunc]) {
        throwBindingError('Global function '+humanName+' is not defined!');
    }
    // Free functions with signature "void function()" do not need an invoker that marshalls between wire types.
// TODO: This omits argument count check - enable only at -O3 or similar.
//    if (ENABLE_UNSAFE_OPTS && argCount == 2 && argTypes[0].name == "void" && !isClassMethodFunc) {
//       return FUNCTION_TABLE[fn];
//    }
    var argsList = "";
    var argsListWired = "";
    for(var i = 0; i < argCount-2; ++i) {
        argsList += (i!==0?", ":"")+"arg"+i;
        argsListWired += (i!==0?", ":"")+"arg"+i+"Wired";
    }
    var invokerFnBody =
        "return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\n" +
        "if (arguments.length !== "+(argCount - 2)+") {\n" +
            "throwBindingError('function "+humanName+" called with ' + arguments.length + ' arguments, expected "+(argCount - 2)+" args!');\n" +
        "}\n";
    // Determine if we need to use a dynamic stack to store the destructors for the function parameters.
    // TODO: Remove this completely once all function invokers are being dynamically generated.
    var needsDestructorStack = false;
    for(var i = 1; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here.
        if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) { // The type does not define a destructor function - must use dynamic stack
            needsDestructorStack = true;
            break;
        }
    }
    if (needsDestructorStack) {
        invokerFnBody +=
            "var destructors = [];\n";
    }
    var dtorStack = needsDestructorStack ? "destructors" : "null";
    var args1 = ["throwBindingError", "classType", "invoker", "fn", "runDestructors", "retType", "classParam"];
    var args2 = [throwBindingError, classType, cppInvokerFunc, cppTargetFunc, runDestructors, argTypes[0], argTypes[1]];
    if (isClassMethodFunc) {
        invokerFnBody += "var thisWired = classParam.toWireType("+dtorStack+", this);\n";
    }
    for(var i = 0; i < argCount-2; ++i) {
        invokerFnBody += "var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\n";
        args1.push("argType"+i);
        args2.push(argTypes[i+2]);
    }
    if (isClassMethodFunc) {
        argsListWired = "thisWired" + (argsListWired.length > 0 ? ", " : "") + argsListWired;
    }
    var returns = (argTypes[0].name !== "void");
    invokerFnBody +=
        (returns?"var rv = ":"") + "invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\n";
    if (needsDestructorStack) {
        invokerFnBody += "runDestructors(destructors);\n";
    } else {
        for(var i = isClassMethodFunc?1:2; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here. Also skip class type if not a method.
            var paramName = (i === 1 ? "thisWired" : ("arg"+(i-2)+"Wired"));
            if (argTypes[i].destructorFunction !== null) {
                invokerFnBody += paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\n";
                args1.push(paramName+"_dtor");
                args2.push(argTypes[i].destructorFunction);
            }
        }
    }
    if (returns) {
        invokerFnBody += "return retType.fromWireType(rv);\n";
    }
    invokerFnBody += "}\n";
    args1.push(invokerFnBody);
    var invokerFunction = new_(Function, args1).apply(null, args2);
    return invokerFunction;
}
function __embind_register_function(name, argCount, rawArgTypesAddr, rawInvoker, fn) {
    var argTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
    name = readLatin1String(name);
    rawInvoker = FUNCTION_TABLE[rawInvoker];
    exposePublicSymbol(name, function() {
        throwUnboundTypeError('Cannot call ' + name + ' due to unbound types', argTypes);
    }, argCount - 1);
    whenDependentTypesAreResolved([], argTypes, function(argTypes) {
        var invokerArgsArray = [argTypes[0] /* return value */, null /* no class 'this'*/].concat(argTypes.slice(1) /* actual params */);
        replacePublicSymbol(name, craftInvokerFunction(name, invokerArgsArray, null /* no class 'this'*/, rawInvoker, fn), argCount - 1);
        return [];
    });
}
var tupleRegistrations = {};
function __embind_register_value_array(rawType, name, rawConstructor, rawDestructor) {
    tupleRegistrations[rawType] = {
        name: readLatin1String(name),
        rawConstructor: FUNCTION_TABLE[rawConstructor],
        rawDestructor: FUNCTION_TABLE[rawDestructor],
        elements: [],
    };
}
function __embind_register_value_array_element(
    rawTupleType,
    getterReturnType,
    getter,
    getterContext,
    setterArgumentType,
    setter,
    setterContext
) {
    tupleRegistrations[rawTupleType].elements.push({
        getterReturnType: getterReturnType,
        getter: FUNCTION_TABLE[getter],
        getterContext: getterContext,
        setterArgumentType: setterArgumentType,
        setter: FUNCTION_TABLE[setter],
        setterContext: setterContext,
    });
}
function __embind_finalize_value_array(rawTupleType) {
    var reg = tupleRegistrations[rawTupleType];
    delete tupleRegistrations[rawTupleType];
    var elements = reg.elements;
    var elementsLength = elements.length;
    var elementTypes = elements.map(function(elt) { return elt.getterReturnType; }).
                concat(elements.map(function(elt) { return elt.setterArgumentType; }));
    var rawConstructor = reg.rawConstructor;
    var rawDestructor = reg.rawDestructor;
    whenDependentTypesAreResolved([rawTupleType], elementTypes, function(elementTypes) {
        elements.forEach(function(elt, i) {
            var getterReturnType = elementTypes[i];
            var getter = elt.getter;
            var getterContext = elt.getterContext;
            var setterArgumentType = elementTypes[i + elementsLength];
            var setter = elt.setter;
            var setterContext = elt.setterContext;
            elt.read = function(ptr) {
                return getterReturnType['fromWireType'](getter(getterContext, ptr));
            };
            elt.write = function(ptr, o) {
                var destructors = [];
                setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, o));
                runDestructors(destructors);
            };
        });
        return [{
            name: reg.name,
            'fromWireType': function(ptr) {
                var rv = new Array(elementsLength);
                for (var i = 0; i < elementsLength; ++i) {
                    rv[i] = elements[i].read(ptr);
                }
                rawDestructor(ptr);
                return rv;
            },
            'toWireType': function(destructors, o) {
                if (elementsLength !== o.length) {
                    throw new TypeError("Incorrect number of tuple elements for " + reg.name + ": expected=" + elementsLength + ", actual=" + o.length);
                }
                var ptr = rawConstructor();
                for (var i = 0; i < elementsLength; ++i) {
                    elements[i].write(ptr, o[i]);
                }
                if (destructors !== null) {
                    destructors.push(rawDestructor, ptr);
                }
                return ptr;
            },
            destructorFunction: rawDestructor,
        }];
    });
}
var structRegistrations = {};
function __embind_register_value_object(
    rawType,
    name,
    rawConstructor,
    rawDestructor
) {
    structRegistrations[rawType] = {
        name: readLatin1String(name),
        rawConstructor: FUNCTION_TABLE[rawConstructor],
        rawDestructor: FUNCTION_TABLE[rawDestructor],
        fields: [],
    };
}
function __embind_register_value_object_field(
    structType,
    fieldName,
    getterReturnType,
    getter,
    getterContext,
    setterArgumentType,
    setter,
    setterContext
) {
    structRegistrations[structType].fields.push({
        fieldName: readLatin1String(fieldName),
        getterReturnType: getterReturnType,
        getter: FUNCTION_TABLE[getter],
        getterContext: getterContext,
        setterArgumentType: setterArgumentType,
        setter: FUNCTION_TABLE[setter],
        setterContext: setterContext,
    });
}
function __embind_finalize_value_object(structType) {
    var reg = structRegistrations[structType];
    delete structRegistrations[structType];
    var rawConstructor = reg.rawConstructor;
    var rawDestructor = reg.rawDestructor;
    var fieldRecords = reg.fields;
    var fieldTypes = fieldRecords.map(function(field) { return field.getterReturnType; }).
              concat(fieldRecords.map(function(field) { return field.setterArgumentType; }));
    whenDependentTypesAreResolved([structType], fieldTypes, function(fieldTypes) {
        var fields = {};
        fieldRecords.forEach(function(field, i) {
            var fieldName = field.fieldName;
            var getterReturnType = fieldTypes[i];
            var getter = field.getter;
            var getterContext = field.getterContext;
            var setterArgumentType = fieldTypes[i + fieldRecords.length];
            var setter = field.setter;
            var setterContext = field.setterContext;
            fields[fieldName] = {
                read: function(ptr) {
                    return getterReturnType['fromWireType'](
                        getter(getterContext, ptr));
                },
                write: function(ptr, o) {
                    var destructors = [];
                    setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, o));
                    runDestructors(destructors);
                }
            };
        });
        return [{
            name: reg.name,
            'fromWireType': function(ptr) {
                var rv = {};
                for (var i in fields) {
                    rv[i] = fields[i].read(ptr);
                }
                rawDestructor(ptr);
                return rv;
            },
            'toWireType': function(destructors, o) {
                // todo: Here we have an opportunity for -O3 level "unsafe" optimizations:
                // assume all fields are present without checking.
                for (var fieldName in fields) {
                    if (!(fieldName in o)) {
                        throw new TypeError('Missing field');
                    }
                }
                var ptr = rawConstructor();
                for (fieldName in fields) {
                    fields[fieldName].write(ptr, o[fieldName]);
                }
                if (destructors !== null) {
                    destructors.push(rawDestructor, ptr);
                }
                return ptr;
            },
            destructorFunction: rawDestructor,
        }];
    });
}
var genericPointerToWireType = function(destructors, handle) {
    if (handle === null) {
        if (this.isReference) {
            throwBindingError('null is not a valid ' + this.name);
        }
        if (this.isSmartPointer) {
            var ptr = this.rawConstructor();
            if (destructors !== null) {
                destructors.push(this.rawDestructor, ptr);
            }
            return ptr;
        } else {
            return 0;
        }
    }
    if (!handle.$$) {
        throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
    }
    if (!handle.$$.ptr) {
        throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
    }
    if (!this.isConst && handle.$$.ptrType.isConst) {
        throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
    }
    var handleClass = handle.$$.ptrType.registeredClass;
    var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
    if (this.isSmartPointer) {
        // TODO: this is not strictly true
        // We could support BY_EMVAL conversions from raw pointers to smart pointers
        // because the smart pointer can hold a reference to the handle
        if (undefined === handle.$$.smartPtr) {
            throwBindingError('Passing raw pointer to smart pointer is illegal');
        }
        switch (this.sharingPolicy) {
            case 0: // NONE
                // no upcasting
                if (handle.$$.smartPtrType === this) {
                    ptr = handle.$$.smartPtr;
                } else {
                    throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
                }
                break;
            case 1: // INTRUSIVE
                ptr = handle.$$.smartPtr;
                break;
            case 2: // BY_EMVAL
                if (handle.$$.smartPtrType === this) {
                    ptr = handle.$$.smartPtr;
                } else {
                    var clonedHandle = handle['clone']();
                    ptr = this.rawShare(
                        ptr,
                        __emval_register(function() {
                            clonedHandle['delete']();
                        })
                    );
                    if (destructors !== null) {
                        destructors.push(this.rawDestructor, ptr);
                    }
                }
                break;
            default:
                throwBindingError('Unsupporting sharing policy');
        }
    }
    return ptr;
};
// If we know a pointer type is not going to have SmartPtr logic in it, we can
// special-case optimize it a bit (compare to genericPointerToWireType)
var constNoSmartPtrRawPointerToWireType = function(destructors, handle) {
    if (handle === null) {
        if (this.isReference) {
            throwBindingError('null is not a valid ' + this.name);
        }
        return 0;
    }
    if (!handle.$$) {
        throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
    }
    if (!handle.$$.ptr) {
        throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
    }
    var handleClass = handle.$$.ptrType.registeredClass;
    var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
    return ptr;
};
// An optimized version for non-const method accesses - there we must additionally restrict that
// the pointer is not a const-pointer.
var nonConstNoSmartPtrRawPointerToWireType = function(destructors, handle) {
    if (handle === null) {
        if (this.isReference) {
            throwBindingError('null is not a valid ' + this.name);
        }
        return 0;
    }
    if (!handle.$$) {
        throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
    }
    if (!handle.$$.ptr) {
        throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
    }
    if (handle.$$.ptrType.isConst) {
        throwBindingError('Cannot convert argument of type ' + handle.$$.ptrType.name + ' to parameter type ' + this.name);
    }
    var handleClass = handle.$$.ptrType.registeredClass;
    var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
    return ptr;
};
function RegisteredPointer(
    name,
    registeredClass,
    isReference,
    isConst,
    // smart pointer properties
    isSmartPointer,
    pointeeType,
    sharingPolicy,
    rawGetPointee,
    rawConstructor,
    rawShare,
    rawDestructor
) {
    this.name = name;
    this.registeredClass = registeredClass;
    this.isReference = isReference;
    this.isConst = isConst;
    // smart pointer properties
    this.isSmartPointer = isSmartPointer;
    this.pointeeType = pointeeType;
    this.sharingPolicy = sharingPolicy;
    this.rawGetPointee = rawGetPointee;
    this.rawConstructor = rawConstructor;
    this.rawShare = rawShare;
    this.rawDestructor = rawDestructor;
    if (!isSmartPointer && registeredClass.baseClass === undefined) {
        if (isConst) {
            this['toWireType'] = constNoSmartPtrRawPointerToWireType;
            this.destructorFunction = null;
        } else {
            this['toWireType'] = nonConstNoSmartPtrRawPointerToWireType;
            this.destructorFunction = null;
        }
    } else {
        this['toWireType'] = genericPointerToWireType;
        // Here we must leave this.destructorFunction undefined, since whether genericPointerToWireType returns
        // a pointer that needs to be freed up is runtime-dependent, and cannot be evaluated at registration time.
        // TODO: Create an alternative mechanism that allows removing the use of var destructors = []; array in 
        //       craftInvokerFunction altogether.
    }
}
RegisteredPointer.prototype.getPointee = function(ptr) {
    if (this.rawGetPointee) {
        ptr = this.rawGetPointee(ptr);
    }
    return ptr;
};
RegisteredPointer.prototype.destructor = function(ptr) {
    if (this.rawDestructor) {
        this.rawDestructor(ptr);
    }
};
RegisteredPointer.prototype['fromWireType'] = function(ptr) {
    // ptr is a raw pointer (or a raw smartpointer)
    // rawPointer is a maybe-null raw pointer
    var rawPointer = this.getPointee(ptr);
    if (!rawPointer) {
        this.destructor(ptr);
        return null;
    }
    function makeDefaultHandle() {
        if (this.isSmartPointer) {
            return makeClassHandle(this.registeredClass.instancePrototype, {
                ptrType: this.pointeeType,
                ptr: rawPointer,
                smartPtrType: this,
                smartPtr: ptr,
            });
        } else {
            return makeClassHandle(this.registeredClass.instancePrototype, {
                ptrType: this,
                ptr: ptr,
            });
        }
    }
    var actualType = this.registeredClass.getActualType(rawPointer);
    var registeredPointerRecord = registeredPointers[actualType];
    if (!registeredPointerRecord) {
        return makeDefaultHandle.call(this);
    }
    var toType;
    if (this.isConst) {
        toType = registeredPointerRecord.constPointerType;
    } else {
        toType = registeredPointerRecord.pointerType;
    }
    var dp = downcastPointer(
        rawPointer,
        this.registeredClass,
        toType.registeredClass);
    if (dp === null) {
        return makeDefaultHandle.call(this);
    }
    if (this.isSmartPointer) {
        return makeClassHandle(toType.registeredClass.instancePrototype, {
            ptrType: toType,
            ptr: dp,
            smartPtrType: this,
            smartPtr: ptr,
        });
    } else {
        return makeClassHandle(toType.registeredClass.instancePrototype, {
            ptrType: toType,
            ptr: dp,
        });
    }
};
function makeClassHandle(prototype, record) {
    if (!record.ptrType || !record.ptr) {
        throwInternalError('makeClassHandle requires ptr and ptrType');
    }
    var hasSmartPtrType = !!record.smartPtrType;
    var hasSmartPtr = !!record.smartPtr;
    if (hasSmartPtrType !== hasSmartPtr) {
        throwInternalError('Both smartPtrType and smartPtr must be specified');
    }
    record.count = { value: 1 };
    return Object.create(prototype, {
        $$: {
            value: record,
        },
    });
}
// root of all pointer and smart pointer handles in embind
function ClassHandle() {
}
function getInstanceTypeName(handle) {
    return handle.$$.ptrType.registeredClass.name;
}
ClassHandle.prototype['isAliasOf'] = function(other) {
    if (!(this instanceof ClassHandle)) {
        return false;
    }
    if (!(other instanceof ClassHandle)) {
        return false;
    }
    var leftClass = this.$$.ptrType.registeredClass;
    var left = this.$$.ptr;
    var rightClass = other.$$.ptrType.registeredClass;
    var right = other.$$.ptr;
    while (leftClass.baseClass) {
        left = leftClass.upcast(left);
        leftClass = leftClass.baseClass;
    }
    while (rightClass.baseClass) {
        right = rightClass.upcast(right);
        rightClass = rightClass.baseClass;
    }
    return leftClass === rightClass && left === right;
};
function throwInstanceAlreadyDeleted(obj) {
    throwBindingError(getInstanceTypeName(obj) + ' instance already deleted');
}
ClassHandle.prototype['clone'] = function() {
    if (!this.$$.ptr) {
        throwInstanceAlreadyDeleted(this);
    }
    var clone = Object.create(Object.getPrototypeOf(this), {
        $$: {
            value: shallowCopy(this.$$),
        }
    });
    clone.$$.count.value += 1;
    return clone;
};
function runDestructor(handle) {
    var $$ = handle.$$;
    if ($$.smartPtr) {
        $$.smartPtrType.rawDestructor($$.smartPtr);
    } else {
        $$.ptrType.registeredClass.rawDestructor($$.ptr);
    }
}
ClassHandle.prototype['delete'] = function ClassHandle_delete() {
    if (!this.$$.ptr) {
        throwInstanceAlreadyDeleted(this);
    }
    if (this.$$.deleteScheduled) {
        throwBindingError('Object already scheduled for deletion');
    }
    this.$$.count.value -= 1;
    if (0 === this.$$.count.value) {
        runDestructor(this);
    }
    this.$$.smartPtr = undefined;
    this.$$.ptr = undefined;
};
var deletionQueue = [];
ClassHandle.prototype['isDeleted'] = function isDeleted() {
    return !this.$$.ptr;
};
ClassHandle.prototype['deleteLater'] = function deleteLater() {
    if (!this.$$.ptr) {
        throwInstanceAlreadyDeleted(this);
    }
    if (this.$$.deleteScheduled) {
        throwBindingError('Object already scheduled for deletion');
    }
    deletionQueue.push(this);
    if (deletionQueue.length === 1 && delayFunction) {
        delayFunction(flushPendingDeletes);
    }
    this.$$.deleteScheduled = true;
    return this;
};
function flushPendingDeletes() {
    while (deletionQueue.length) {
        var obj = deletionQueue.pop();
        obj.$$.deleteScheduled = false;
        obj['delete']();
    }
}
Module['flushPendingDeletes'] = flushPendingDeletes;
var delayFunction;
Module['setDelayFunction'] = function setDelayFunction(fn) {
    delayFunction = fn;
    if (deletionQueue.length && delayFunction) {
        delayFunction(flushPendingDeletes);
    }
};
function RegisteredClass(
    name,
    constructor,
    instancePrototype,
    rawDestructor,
    baseClass,
    getActualType,
    upcast,
    downcast
) {
    this.name = name;
    this.constructor = constructor;
    this.instancePrototype = instancePrototype;
    this.rawDestructor = rawDestructor;
    this.baseClass = baseClass;
    this.getActualType = getActualType;
    this.upcast = upcast;
    this.downcast = downcast;
}
function shallowCopy(o) {
    var rv = {};
    for (var k in o) {
        rv[k] = o[k];
    }
    return rv;
}
function __embind_register_class(
    rawType,
    rawPointerType,
    rawConstPointerType,
    baseClassRawType,
    getActualType,
    upcast,
    downcast,
    name,
    rawDestructor
) {
    name = readLatin1String(name);
    rawDestructor = FUNCTION_TABLE[rawDestructor];
    getActualType = FUNCTION_TABLE[getActualType];
    upcast = FUNCTION_TABLE[upcast];
    downcast = FUNCTION_TABLE[downcast];
    var legalFunctionName = makeLegalFunctionName(name);
    exposePublicSymbol(legalFunctionName, function() {
        // this code cannot run if baseClassRawType is zero
        throwUnboundTypeError('Cannot construct ' + name + ' due to unbound types', [baseClassRawType]);
    });
    whenDependentTypesAreResolved(
        [rawType, rawPointerType, rawConstPointerType],
        baseClassRawType ? [baseClassRawType] : [],
        function(base) {
            base = base[0];
            var baseClass;
            var basePrototype;
            if (baseClassRawType) {
                baseClass = base.registeredClass;
                basePrototype = baseClass.instancePrototype;
            } else {
                basePrototype = ClassHandle.prototype;
            }
            var constructor = createNamedFunction(legalFunctionName, function() {
                if (Object.getPrototypeOf(this) !== instancePrototype) {
                    throw new BindingError("Use 'new' to construct " + name);
                }
                if (undefined === registeredClass.constructor_body) {
                    throw new BindingError(name + " has no accessible constructor");
                }
                var body = registeredClass.constructor_body[arguments.length];
                if (undefined === body) {
                    throw new BindingError("Tried to invoke ctor of " + name + " with invalid number of parameters (" + arguments.length + ") - expected (" + Object.keys(registeredClass.constructor_body).toString() + ") parameters instead!");
                }
                return body.apply(this, arguments);
            });
            var instancePrototype = Object.create(basePrototype, {
                constructor: { value: constructor },
            });
            constructor.prototype = instancePrototype;
            var registeredClass = new RegisteredClass(
                name,
                constructor,
                instancePrototype,
                rawDestructor,
                baseClass,
                getActualType,
                upcast,
                downcast);
            var referenceConverter = new RegisteredPointer(
                name,
                registeredClass,
                true,
                false,
                false);
            var pointerConverter = new RegisteredPointer(
                name + '*',
                registeredClass,
                false,
                false,
                false);
            var constPointerConverter = new RegisteredPointer(
                name + ' const*',
                registeredClass,
                false,
                true,
                false);
            registeredPointers[rawType] = {
                pointerType: pointerConverter,
                constPointerType: constPointerConverter
            };
            replacePublicSymbol(legalFunctionName, constructor);
            return [referenceConverter, pointerConverter, constPointerConverter];
        }
    );
}
function __embind_register_class_constructor(
    rawClassType,
    argCount,
    rawArgTypesAddr,
    invoker,
    rawConstructor
) {
    var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
    invoker = FUNCTION_TABLE[invoker];
    whenDependentTypesAreResolved([], [rawClassType], function(classType) {
        classType = classType[0];
        var humanName = 'constructor ' + classType.name;
        if (undefined === classType.registeredClass.constructor_body) {
            classType.registeredClass.constructor_body = [];
        }
        if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
            throw new BindingError("Cannot register multiple constructors with identical number of parameters (" + (argCount-1) + ") for class '" + classType.name + "'! Overload resolution is currently only performed using the parameter count, not actual type info!");
        }
        classType.registeredClass.constructor_body[argCount - 1] = function() {
            throwUnboundTypeError('Cannot construct ' + classType.name + ' due to unbound types', rawArgTypes);
        };
        whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
            classType.registeredClass.constructor_body[argCount - 1] = function() {
                if (arguments.length !== argCount - 1) {
                    throwBindingError(humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argCount-1));
                }
                var destructors = [];
                var args = new Array(argCount);
                args[0] = rawConstructor;
                for (var i = 1; i < argCount; ++i) {
                    args[i] = argTypes[i]['toWireType'](destructors, arguments[i - 1]);
                }
                var ptr = invoker.apply(null, args);
                runDestructors(destructors);
                return argTypes[0]['fromWireType'](ptr);
            };
            return [];
        });
        return [];
    });
}
function downcastPointer(ptr, ptrClass, desiredClass) {
    if (ptrClass === desiredClass) {
        return ptr;
    }
    if (undefined === desiredClass.baseClass) {
        return null; // no conversion
    }
    // O(depth) stack space used
    return desiredClass.downcast(
        downcastPointer(ptr, ptrClass, desiredClass.baseClass));
}
function upcastPointer(ptr, ptrClass, desiredClass) {
    while (ptrClass !== desiredClass) {
        if (!ptrClass.upcast) {
            throwBindingError("Expected null or instance of " + desiredClass.name + ", got an instance of " + ptrClass.name);
        }
        ptr = ptrClass.upcast(ptr);
        ptrClass = ptrClass.baseClass;
    }
    return ptr;
}
function validateThis(this_, classType, humanName) {
    if (!(this_ instanceof Object)) {
        throwBindingError(humanName + ' with invalid "this": ' + this_);
    }
    if (!(this_ instanceof classType.registeredClass.constructor)) {
        throwBindingError(humanName + ' incompatible with "this" of type ' + this_.constructor.name);
    }
    if (!this_.$$.ptr) {
        throwBindingError('cannot call emscripten binding method ' + humanName + ' on deleted object');
    }
    // todo: kill this
    return upcastPointer(
        this_.$$.ptr,
        this_.$$.ptrType.registeredClass,
        classType.registeredClass);
}
function __embind_register_class_function(
    rawClassType,
    methodName,
    argCount,
    rawArgTypesAddr, // [ReturnType, ThisType, Args...]
    rawInvoker,
    context
) {
    var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
    methodName = readLatin1String(methodName);
    rawInvoker = FUNCTION_TABLE[rawInvoker];
    whenDependentTypesAreResolved([], [rawClassType], function(classType) {
        classType = classType[0];
        var humanName = classType.name + '.' + methodName;
        var unboundTypesHandler = function() {
            throwUnboundTypeError('Cannot call ' + humanName + ' due to unbound types', rawArgTypes);
        };
        var proto = classType.registeredClass.instancePrototype;
        var method = proto[methodName];
        if (undefined === method || (undefined === method.overloadTable && method.className !== classType.name && method.argCount === argCount-2)) {
            // This is the first overload to be registered, OR we are replacing a function in the base class with a function in the derived class.
            unboundTypesHandler.argCount = argCount-2;
            unboundTypesHandler.className = classType.name;
            proto[methodName] = unboundTypesHandler;
        } else {
            // There was an existing function with the same name registered. Set up a function overload routing table.
            ensureOverloadTable(proto, methodName, humanName);
            proto[methodName].overloadTable[argCount-2] = unboundTypesHandler;
        }
        whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
            var memberFunction = craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context);
            // Replace the initial unbound-handler-stub function with the appropriate member function, now that all types
            // are resolved. If multiple overloads are registered for this function, the function goes into an overload table.
            if (undefined === proto[methodName].overloadTable) {
                proto[methodName] = memberFunction;
            } else {
                proto[methodName].overloadTable[argCount-2] = memberFunction;
            }
            return [];
        });
        return [];
    });
}
function __embind_register_class_class_function(
    rawClassType,
    methodName,
    argCount,
    rawArgTypesAddr,
    rawInvoker,
    fn
) {
    var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
    methodName = readLatin1String(methodName);
    rawInvoker = FUNCTION_TABLE[rawInvoker];
    whenDependentTypesAreResolved([], [rawClassType], function(classType) {
        classType = classType[0];
        var humanName = classType.name + '.' + methodName;
        var unboundTypesHandler = function() {
                throwUnboundTypeError('Cannot call ' + humanName + ' due to unbound types', rawArgTypes);
            };
        var proto = classType.registeredClass.constructor;
        if (undefined === proto[methodName]) {
            // This is the first function to be registered with this name.
            unboundTypesHandler.argCount = argCount-1;
            proto[methodName] = unboundTypesHandler;
        } else {
            // There was an existing function with the same name registered. Set up a function overload routing table.
            ensureOverloadTable(proto, methodName, humanName);
            proto[methodName].overloadTable[argCount-1] = unboundTypesHandler;
        }
        whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
            // Replace the initial unbound-types-handler stub with the proper function. If multiple overloads are registered,
            // the function handlers go into an overload table.
            var invokerArgsArray = [argTypes[0] /* return value */, null /* no class 'this'*/].concat(argTypes.slice(1) /* actual params */);
            var func = craftInvokerFunction(humanName, invokerArgsArray, null /* no class 'this'*/, rawInvoker, fn);
            if (undefined === proto[methodName].overloadTable) {
                proto[methodName] = func;
            } else {
                proto[methodName].overloadTable[argCount-1] = func;
            }
            return [];
        });
        return [];
    });
}
function __embind_register_class_property(
    classType,
    fieldName,
    getterReturnType,
    getter,
    getterContext,
    setterArgumentType,
    setter,
    setterContext
) {
    fieldName = readLatin1String(fieldName);
    getter = FUNCTION_TABLE[getter];
    whenDependentTypesAreResolved([], [classType], function(classType) {
        classType = classType[0];
        var humanName = classType.name + '.' + fieldName;
        var desc = {
            get: function() {
                throwUnboundTypeError('Cannot access ' + humanName + ' due to unbound types', [getterReturnType, setterArgumentType]);
            },
            enumerable: true,
            configurable: true
        };
        if (setter) {
            desc.set = function() {
                throwUnboundTypeError('Cannot access ' + humanName + ' due to unbound types', [getterReturnType, setterArgumentType]);
            };
        } else {
            desc.set = function(v) {
                throwBindingError(humanName + ' is a read-only property');
            };
        }
        Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
        whenDependentTypesAreResolved(
            [],
            (setter ? [getterReturnType, setterArgumentType] : [getterReturnType]),
        function(types) {
            var getterReturnType = types[0];
            var desc = {
                get: function() {
                    var ptr = validateThis(this, classType, humanName + ' getter');
                    return getterReturnType['fromWireType'](getter(getterContext, ptr));
                },
                enumerable: true
            };
            if (setter) {
                setter = FUNCTION_TABLE[setter];
                var setterArgumentType = types[1];
                desc.set = function(v) {
                    var ptr = validateThis(this, classType, humanName + ' setter');
                    var destructors = [];
                    setter(setterContext, ptr, setterArgumentType['toWireType'](destructors, v));
                    runDestructors(destructors);
                };
            }
            Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
            return [];
        });
        return [];
    });
}
var char_0 = '0'.charCodeAt(0);
var char_9 = '9'.charCodeAt(0);
function makeLegalFunctionName(name) {
    name = name.replace(/[^a-zA-Z0-9_]/g, '$');
    var f = name.charCodeAt(0);
    if (f >= char_0 && f <= char_9) {
        return '_' + name;
    } else {
        return name;
    }
}
function __embind_register_smart_ptr(
    rawType,
    rawPointeeType,
    name,
    sharingPolicy,
    rawGetPointee,
    rawConstructor,
    rawShare,
    rawDestructor
) {
    name = readLatin1String(name);
    rawGetPointee = FUNCTION_TABLE[rawGetPointee];
    rawConstructor = FUNCTION_TABLE[rawConstructor];
    rawShare = FUNCTION_TABLE[rawShare];
    rawDestructor = FUNCTION_TABLE[rawDestructor];
    whenDependentTypesAreResolved([rawType], [rawPointeeType], function(pointeeType) {
        pointeeType = pointeeType[0];
        var registeredPointer = new RegisteredPointer(
            name,
            pointeeType.registeredClass,
            false,
            false,
            // smart pointer properties
            true,
            pointeeType,
            sharingPolicy,
            rawGetPointee,
            rawConstructor,
            rawShare,
            rawDestructor);
        return [registeredPointer];
    });
}
function __embind_register_enum(
    rawType,
    name
) {
    name = readLatin1String(name);
    function constructor() {
    }
    constructor.values = {};
    registerType(rawType, {
        name: name,
        constructor: constructor,
        'fromWireType': function(c) {
            return this.constructor.values[c];
        },
        'toWireType': function(destructors, c) {
            return c.value;
        },
        destructorFunction: null,
    });
    exposePublicSymbol(name, constructor);
}
function __embind_register_enum_value(
    rawEnumType,
    name,
    enumValue
) {
    var enumType = requireRegisteredType(rawEnumType, 'enum');
    name = readLatin1String(name);
    var Enum = enumType.constructor;
    var Value = Object.create(enumType.constructor.prototype, {
        value: {value: enumValue},
        constructor: {value: createNamedFunction(enumType.name + '_' + name, function() {})},
    });
    Enum.values[enumValue] = Value;
    Enum[name] = Value;
}
function __embind_register_constant(name, type, value) {
    name = readLatin1String(name);
    whenDependentTypesAreResolved([], [type], function(type) {
        type = type[0];
        Module[name] = type['fromWireType'](value);
        return [];
    });
}
/*global Module:true, Runtime*/
/*global HEAP32*/
/*global new_*/
/*global createNamedFunction*/
/*global readLatin1String, writeStringToMemory*/
/*global requireRegisteredType, throwBindingError*/
/*jslint sub:true*/ /* The symbols 'fromWireType' and 'toWireType' must be accessed via array notation to be closure-safe since craftInvokerFunction crafts functions as strings that can't be closured. */
var Module = Module || {};
var _emval_handle_array = [{}]; // reserve zero
var _emval_free_list = [];
// Public JS API
/** @expose */
Module.count_emval_handles = function() {
    var count = 0;
    for (var i = 1; i < _emval_handle_array.length; ++i) {
        if (_emval_handle_array[i] !== undefined) {
            ++count;
        }
    }
    return count;
};
/** @expose */
Module.get_first_emval = function() {
    for (var i = 1; i < _emval_handle_array.length; ++i) {
        if (_emval_handle_array[i] !== undefined) {
            return _emval_handle_array[i];
        }
    }
    return null;
};
// Private C++ API
var _emval_symbols = {}; // address -> string
function __emval_register_symbol(address) {
    _emval_symbols[address] = readLatin1String(address);
}
function getStringOrSymbol(address) {
    var symbol = _emval_symbols[address];
    if (symbol === undefined) {
        return readLatin1String(address);
    } else {
        return symbol;
    }
}
function requireHandle(handle) {
    if (!handle) {
        throwBindingError('Cannot use deleted val. handle = ' + handle);
    }
}
function __emval_register(value) {
    var handle = _emval_free_list.length ?
        _emval_free_list.pop() :
        _emval_handle_array.length;
    _emval_handle_array[handle] = {refcount: 1, value: value};
    return handle;
}
function __emval_incref(handle) {
    if (handle) {
        _emval_handle_array[handle].refcount += 1;
    }
}
function __emval_decref(handle) {
    if (handle && 0 === --_emval_handle_array[handle].refcount) {
        _emval_handle_array[handle] = undefined;
        _emval_free_list.push(handle);
    }
}
function __emval_new_array() {
    return __emval_register([]);
}
function __emval_new_object() {
    return __emval_register({});
}
function __emval_undefined() {
    return __emval_register(undefined);
}
function __emval_null() {
    return __emval_register(null);
}
function __emval_new_cstring(v) {
    return __emval_register(getStringOrSymbol(v));
}
function __emval_take_value(type, v) {
    type = requireRegisteredType(type, '_emval_take_value');
    v = type['fromWireType'](v);
    return __emval_register(v);
}
var __newers = {}; // arity -> function
function craftEmvalAllocator(argCount) {
    /*This function returns a new function that looks like this:
    function emval_allocator_3(handle, argTypes, arg0Wired, arg1Wired, arg2Wired) {
        var argType0 = requireRegisteredType(HEAP32[(argTypes >> 2)], "parameter 0");
        var arg0 = argType0.fromWireType(arg0Wired);
        var argType1 = requireRegisteredType(HEAP32[(argTypes >> 2) + 1], "parameter 1");
        var arg1 = argType1.fromWireType(arg1Wired);
        var argType2 = requireRegisteredType(HEAP32[(argTypes >> 2) + 2], "parameter 2");
        var arg2 = argType2.fromWireType(arg2Wired);
        var constructor = _emval_handle_array[handle].value;
        var emval = new constructor(arg0, arg1, arg2);
        return emval;
    } */
    var args1 = ["requireRegisteredType", "HEAP32", "_emval_handle_array", "__emval_register"];
    var args2 = [requireRegisteredType, HEAP32, _emval_handle_array, __emval_register];
    var argsList = "";
    var argsListWired = "";
    for(var i = 0; i < argCount; ++i) {
        argsList += (i!==0?", ":"")+"arg"+i; // 'arg0, arg1, ..., argn'
        argsListWired += ", arg"+i+"Wired"; // ', arg0Wired, arg1Wired, ..., argnWired'
    }
    var invokerFnBody =
        "return function emval_allocator_"+argCount+"(handle, argTypes " + argsListWired + ") {\n";
    for(var i = 0; i < argCount; ++i) {
        invokerFnBody += 
            "var argType"+i+" = requireRegisteredType(HEAP32[(argTypes >> 2) + "+i+"], \"parameter "+i+"\");\n" +
            "var arg"+i+" = argType"+i+".fromWireType(arg"+i+"Wired);\n";
    }
    invokerFnBody +=
        "var constructor = _emval_handle_array[handle].value;\n" +
        "var obj = new constructor("+argsList+");\n" +
        "return __emval_register(obj);\n" +
        "}\n";
    args1.push(invokerFnBody);
    var invokerFunction = new_(Function, args1).apply(null, args2);
    return invokerFunction;
}
function __emval_new(handle, argCount, argTypes) {
    requireHandle(handle);
    var newer = __newers[argCount];
    if (!newer) {
        newer = craftEmvalAllocator(argCount);
        __newers[argCount] = newer;
    }
    if (argCount === 0) {
        return newer(handle, argTypes);
    } else if (argCount === 1) {
        return newer(handle, argTypes, arguments[3]);
    } else if (argCount === 2) {
        return newer(handle, argTypes, arguments[3], arguments[4]);
    } else if (argCount === 3) {
        return newer(handle, argTypes, arguments[3], arguments[4], arguments[5]);
    } else if (argCount === 4) {
        return newer(handle, argTypes, arguments[3], arguments[4], arguments[5], arguments[6]);
    } else {
        // This is a slow path! (.apply and .splice are slow), so a few specializations are present above.
        return newer.apply(null, arguments.splice(1));
    }
}
// appease jshint (technically this code uses eval)
var global = (function(){return Function;})()('return this')();
function __emval_get_global(name) {
    name = getStringOrSymbol(name);
    return __emval_register(global[name]);
}
function __emval_get_module_property(name) {
    name = getStringOrSymbol(name);
    return __emval_register(Module[name]);
}
function __emval_get_property(handle, key) {
    requireHandle(handle);
    return __emval_register(_emval_handle_array[handle].value[_emval_handle_array[key].value]);
}
function __emval_set_property(handle, key, value) {
    requireHandle(handle);
    _emval_handle_array[handle].value[_emval_handle_array[key].value] = _emval_handle_array[value].value;
}
function __emval_as(handle, returnType) {
    requireHandle(handle);
    returnType = requireRegisteredType(returnType, 'emval::as');
    var destructors = [];
    // caller owns destructing
    return returnType['toWireType'](destructors, _emval_handle_array[handle].value);
}
function parseParameters(argCount, argTypes, argWireTypes) {
    var a = new Array(argCount);
    for (var i = 0; i < argCount; ++i) {
        var argType = requireRegisteredType(
            HEAP32[(argTypes >> 2) + i],
            "parameter " + i);
        a[i] = argType['fromWireType'](argWireTypes[i]);
    }
    return a;
}
function __emval_call(handle, argCount, argTypes) {
    requireHandle(handle);
    var types = lookupTypes(argCount, argTypes);
    var args = new Array(argCount);
    for (var i = 0; i < argCount; ++i) {
        args[i] = types[i]['fromWireType'](arguments[3 + i]);
    }
    var fn = _emval_handle_array[handle].value;
    var rv = fn.apply(undefined, args);
    return __emval_register(rv);
}
function lookupTypes(argCount, argTypes, argWireTypes) {
    var a = new Array(argCount);
    for (var i = 0; i < argCount; ++i) {
        a[i] = requireRegisteredType(
            HEAP32[(argTypes >> 2) + i],
            "parameter " + i);
    }
    return a;
}
function __emval_get_method_caller(argCount, argTypes) {
    var types = lookupTypes(argCount, argTypes);
    var retType = types[0];
    var signatureName = retType.name + "_$" + types.slice(1).map(function (t) { return t.name; }).join("_") + "$";
    var args1 = ["addFunction", "createNamedFunction", "requireHandle", "getStringOrSymbol", "_emval_handle_array", "retType"];
    var args2 = [Runtime.addFunction, createNamedFunction, requireHandle, getStringOrSymbol, _emval_handle_array, retType];
    var argsList = ""; // 'arg0, arg1, arg2, ... , argN'
    var argsListWired = ""; // 'arg0Wired, ..., argNWired'
    for (var i = 0; i < argCount - 1; ++i) {
        argsList += (i !== 0 ? ", " : "") + "arg" + i;
        argsListWired += ", arg" + i + "Wired";
        args1.push("argType" + i);
        args2.push(types[1 + i]);
    }
    var invokerFnBody =
        "return addFunction(createNamedFunction('" + signatureName + "', function (handle, name" + argsListWired + ") {\n" +
        "requireHandle(handle);\n" +
        "name = getStringOrSymbol(name);\n";
    for (var i = 0; i < argCount - 1; ++i) {
        invokerFnBody += "var arg" + i + " = argType" + i + ".fromWireType(arg" + i + "Wired);\n";
    }
    invokerFnBody +=
        "var obj = _emval_handle_array[handle].value;\n" +
        "return retType.toWireType(null, obj[name](" + argsList + "));\n" + 
        "}));\n";
    args1.push(invokerFnBody);
    var invokerFunction = new_(Function, args1).apply(null, args2);
    return invokerFunction;
}
function __emval_has_function(handle, name) {
    name = getStringOrSymbol(name);
    return _emval_handle_array[handle].value[name] instanceof Function;
}
if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}
// shouldRunNow refers to calling main(), not run().
var shouldRunNow = true;
if (Module['noInitialRun']) {
  shouldRunNow = false;
}
run();
// {{POST_RUN_ADDITIONS}}
// {{MODULE_ADDITIONS}}
return ThinPlateSpline;
})();
if (typeof importScripts === 'function') {
  /* Worker loader */
  var tps = new ThinPlateSpline();
  tps.isWorker = true;
  self.onmessage = function(event) {
    var payload = event.data;
    var method  = payload.method;
    var data    = payload.data;
    self.postMessage({'event':'echo','data':payload});
    switch (method){
      case 'push_points':
        tps.push_points(data);
        self.postMessage({'event':'solved'});
        break;
      case 'load_points':
        var xhr = new XMLHttpRequest();
        xhr.open('GET', data, true);
        xhr.onload = function(e) {
          if (this.status == 200) {
            var points = JSON.parse(this.response);
            tps.push_points(points);
            self.postMessage({'event':'solved'});
          } else {
            self.postMessage({'event':'cannotLoad'});
          }
        };
        xhr.send();
        break;
      case 'deserialize':
        //var serial = JSON.parse(data);
        tps.deserialize(data);
        self.postMessage({'event':'solved'});
        break;
      case 'load_serial':
        var xhr = new XMLHttpRequest();
        xhr.open('GET', data, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function(e) {
          if (this.status == 200) {
            var serial = new Uint8Array(this.response);
            self.postMessage({'event':'serialized','serial':serial});
          } else {
            self.postMessage({'event':'cannotLoad'});
          }
        };
        xhr.send();
        break;
      case 'serialize':
        var serial = tps.serialize();
        self.postMessage({'event':'serialized','serial':serial});
        break;
      case 'transform':
        var coord = data.coord;
        var inv   = data.inv;
        var dst   = tps.transform(coord,inv);
        self.postMessage({'event':'transformed','inv':inv,'coord':dst});
        break;
      case 'echo':
        self.postMessage({'event':'echo'});
        break;
      case 'destruct':
        break;
    }
  };
}
