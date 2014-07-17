(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
  // Detect if browser supports Typed Arrays. Supported browsers are IE 10+, Firefox 4+,
  // Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+. If the browser does not support adding
  // properties to `Uint8Array` instances, then that's the same as no `Uint8Array` support
  // because we need to be able to add all the node Buffer API methods. This is an issue
  // in Firefox 4-29. Now fixed: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // assume that object is array-like
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer._useTypedArrays) {
    for (var i = 0; i < len; i++)
      target[i + target_start] = this[i + start]
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/index.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer")
},{"1YiZ5S":4,"base64-js":2,"buffer":1,"ieee754":3}],2:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib")
},{"1YiZ5S":4,"buffer":1}],3:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754")
},{"1YiZ5S":4,"buffer":1}],4:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/gulp-browserify/node_modules/browserify/node_modules/process/browser.js","/../node_modules/gulp-browserify/node_modules/browserify/node_modules/process")
},{"1YiZ5S":4,"buffer":1}],5:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// Generated by CoffeeScript 1.7.1
(function() {
  var LEVELS, PATTERNS, XRegExp, get_type, root,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  root = typeof exports !== "undefined" && exports !== null ? exports : this;

  XRegExp = require("xregexp").XRegExp;

  PATTERNS = {
    brief: XRegExp("^(?<level>[VDIWEAF])\\/(?<tag>[^)]{0,23}?)\\(\\s*(?<pid>\\d+)\\):\\s(?<message>.*)$"),
    threadtime: XRegExp("^(?<timestamp>\\d\\d-\\d\\d\\s\\d\\d:\\d\\d:\\d\\d\\.\\d+)\\s*(?<pid>\\d+)\\s*(?<tid>\\d+)\\s(?<level>[VDIWEAF])\\s(?<tag>.*?):\\s(?<message>.*)$"),
    time: XRegExp("^(?<timestamp>\\d\\d-\\d\\d\\s\\d\\d:\\d\\d:\\d\\d\\.\\d+):*\\s(?<level>[VDIWEAF])\\/(?<tag>.*?)\\((?<pid>\\s*\\d+)\\):\\s(?<message>.*)$"),
    process: XRegExp("^(?<level>[VDIWEAF])\\(\\s*(?<pid>\\d+)\\)\\s(?<message>.*)$"),
    tag: XRegExp("^(?<level>[VDIWEAF])\\/(?<tag>[^)]{0,23}?):\\s(?<message>.*)$"),
    thread: XRegExp("^(?<level>[VDIWEAF])\\(\\s*(?<pid>\\d+):(?<tid>0x.*?)\\)\\s(?<message>.*)$"),
    ddms_save: XRegExp("^(?<timestamp>\\d\\d-\\d\\d\\s\\d\\d:\\d\\d:\\d\\d\\.\\d+):*\\s(?<level>VERBOSE|DEBUG|ERROR|WARN|INFO|ASSERT)\\/(?<tag>.*?)\\((?<pid>\\s*\\d+)\\):\\s(?<message>.*)$")
  };

  root.PATTERNS = PATTERNS;

  LEVELS = {
    V: "verbose",
    D: "debug",
    I: "info",
    W: "warn",
    E: "error",
    A: "assert",
    F: "fatal",
    S: "silent"
  };

  root.LEVELS = LEVELS;

  get_type = function(line) {
    var pattern, type;
    for (type in PATTERNS) {
      pattern = PATTERNS[type];
      console.log("trying " + type + " - " + pattern);
      if (pattern.test(line)) {
        return type;
      }
    }
    return null;
  };

  root.parse = function(contents) {
    var badlines, line, messages, type, _fn, _i, _len, _ref;
    type = null;
    badlines = 0;
    messages = [];
    _ref = contents.split("\n");
    _fn = function(line) {
      var e, match, message, regex;
      line = line.replace(/\s+$/g, "");
      if (!type) {
        type = get_type(line);
      }
      if (type && line.length > 0) {
        message = {};
        regex = PATTERNS[type];
        try {
          match = XRegExp.exec(line, regex);
          if (__indexOf.call(regex.xregexp.captureNames, 'level') >= 0) {
            message.level = match.level;
          }
          if (__indexOf.call(regex.xregexp.captureNames, 'timestamp') >= 0) {
            message.timestamp = match.level;
          }
          if (__indexOf.call(regex.xregexp.captureNames, 'pid') >= 0) {
            message.pid = match.pid;
          }
          if (__indexOf.call(regex.xregexp.captureNames, 'tid') >= 0) {
            message.tid = match.tid;
          }
          if (__indexOf.call(regex.xregexp.captureNames, 'tag') >= 0) {
            message.tag = match.tag;
          }
          if (__indexOf.call(regex.xregexp.captureNames, 'message') >= 0) {
            message.message = match.message;
          }
          return messages.push(message);
        } catch (_error) {
          e = _error;
          return badlines += 1;
        }
      }
    };
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      line = _ref[_i];
      _fn(line);
    }
    return {
      type: type,
      messages: messages,
      badlines: badlines
    };
  };

}).call(this);

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/logcat-parse/lib/logcat-parse.js","/../node_modules/logcat-parse/lib")
},{"1YiZ5S":4,"buffer":1,"xregexp":6}],6:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){

/***** xregexp.js *****/

/*!
 * XRegExp v2.0.0
 * (c) 2007-2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 */

/**
 * XRegExp provides augmented, extensible JavaScript regular expressions. You get new syntax,
 * flags, and methods beyond what browsers support natively. XRegExp is also a regex utility belt
 * with tools to make your client-side grepping simpler and more powerful, while freeing you from
 * worrying about pesky cross-browser inconsistencies and the dubious `lastIndex` property. See
 * XRegExp's documentation (http://xregexp.com/) for more details.
 * @module xregexp
 * @requires N/A
 */
var XRegExp;

// Avoid running twice; that would reset tokens and could break references to native globals
XRegExp = XRegExp || (function (undef) {
    "use strict";

/*--------------------------------------
 *  Private variables
 *------------------------------------*/

    var self,
        addToken,
        add,

// Optional features; can be installed and uninstalled
        features = {
            natives: false,
            extensibility: false
        },

// Store native methods to use and restore ("native" is an ES3 reserved keyword)
        nativ = {
            exec: RegExp.prototype.exec,
            test: RegExp.prototype.test,
            match: String.prototype.match,
            replace: String.prototype.replace,
            split: String.prototype.split
        },

// Storage for fixed/extended native methods
        fixed = {},

// Storage for cached regexes
        cache = {},

// Storage for addon tokens
        tokens = [],

// Token scopes
        defaultScope = "default",
        classScope = "class",

// Regexes that match native regex syntax
        nativeTokens = {
            // Any native multicharacter token in default scope (includes octals, excludes character classes)
            "default": /^(?:\\(?:0(?:[0-3][0-7]{0,2}|[4-7][0-7]?)?|[1-9]\d*|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|c[A-Za-z]|[\s\S])|\(\?[:=!]|[?*+]\?|{\d+(?:,\d*)?}\??)/,
            // Any native multicharacter token in character class scope (includes octals)
            "class": /^(?:\\(?:[0-3][0-7]{0,2}|[4-7][0-7]?|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|c[A-Za-z]|[\s\S]))/
        },

// Any backreference in replacement strings
        replacementToken = /\$(?:{([\w$]+)}|(\d\d?|[\s\S]))/g,

// Any character with a later instance in the string
        duplicateFlags = /([\s\S])(?=[\s\S]*\1)/g,

// Any greedy/lazy quantifier
        quantifier = /^(?:[?*+]|{\d+(?:,\d*)?})\??/,

// Check for correct `exec` handling of nonparticipating capturing groups
        compliantExecNpcg = nativ.exec.call(/()??/, "")[1] === undef,

// Check for flag y support (Firefox 3+)
        hasNativeY = RegExp.prototype.sticky !== undef,

// Used to kill infinite recursion during XRegExp construction
        isInsideConstructor = false,

// Storage for known flags, including addon flags
        registeredFlags = "gim" + (hasNativeY ? "y" : "");

/*--------------------------------------
 *  Private helper functions
 *------------------------------------*/

/**
 * Attaches XRegExp.prototype properties and named capture supporting data to a regex object.
 * @private
 * @param {RegExp} regex Regex to augment.
 * @param {Array} captureNames Array with capture names, or null.
 * @param {Boolean} [isNative] Whether the regex was created by `RegExp` rather than `XRegExp`.
 * @returns {RegExp} Augmented regex.
 */
    function augment(regex, captureNames, isNative) {
        var p;
        // Can't auto-inherit these since the XRegExp constructor returns a nonprimitive value
        for (p in self.prototype) {
            if (self.prototype.hasOwnProperty(p)) {
                regex[p] = self.prototype[p];
            }
        }
        regex.xregexp = {captureNames: captureNames, isNative: !!isNative};
        return regex;
    }

/**
 * Returns native `RegExp` flags used by a regex object.
 * @private
 * @param {RegExp} regex Regex to check.
 * @returns {String} Native flags in use.
 */
    function getNativeFlags(regex) {
        //return nativ.exec.call(/\/([a-z]*)$/i, String(regex))[1];
        return (regex.global     ? "g" : "") +
               (regex.ignoreCase ? "i" : "") +
               (regex.multiline  ? "m" : "") +
               (regex.extended   ? "x" : "") + // Proposed for ES6, included in AS3
               (regex.sticky     ? "y" : ""); // Proposed for ES6, included in Firefox 3+
    }

/**
 * Copies a regex object while preserving special properties for named capture and augmenting with
 * `XRegExp.prototype` methods. The copy has a fresh `lastIndex` property (set to zero). Allows
 * adding and removing flags while copying the regex.
 * @private
 * @param {RegExp} regex Regex to copy.
 * @param {String} [addFlags] Flags to be added while copying the regex.
 * @param {String} [removeFlags] Flags to be removed while copying the regex.
 * @returns {RegExp} Copy of the provided regex, possibly with modified flags.
 */
    function copy(regex, addFlags, removeFlags) {
        if (!self.isRegExp(regex)) {
            throw new TypeError("type RegExp expected");
        }
        var flags = nativ.replace.call(getNativeFlags(regex) + (addFlags || ""), duplicateFlags, "");
        if (removeFlags) {
            // Would need to escape `removeFlags` if this was public
            flags = nativ.replace.call(flags, new RegExp("[" + removeFlags + "]+", "g"), "");
        }
        if (regex.xregexp && !regex.xregexp.isNative) {
            // Compiling the current (rather than precompilation) source preserves the effects of nonnative source flags
            regex = augment(self(regex.source, flags),
                            regex.xregexp.captureNames ? regex.xregexp.captureNames.slice(0) : null);
        } else {
            // Augment with `XRegExp.prototype` methods, but use native `RegExp` (avoid searching for special tokens)
            regex = augment(new RegExp(regex.source, flags), null, true);
        }
        return regex;
    }

/*
 * Returns the last index at which a given value can be found in an array, or `-1` if it's not
 * present. The array is searched backwards.
 * @private
 * @param {Array} array Array to search.
 * @param {*} value Value to locate in the array.
 * @returns {Number} Last zero-based index at which the item is found, or -1.
 */
    function lastIndexOf(array, value) {
        var i = array.length;
        if (Array.prototype.lastIndexOf) {
            return array.lastIndexOf(value); // Use the native method if available
        }
        while (i--) {
            if (array[i] === value) {
                return i;
            }
        }
        return -1;
    }

/**
 * Determines whether an object is of the specified type.
 * @private
 * @param {*} value Object to check.
 * @param {String} type Type to check for, in lowercase.
 * @returns {Boolean} Whether the object matches the type.
 */
    function isType(value, type) {
        return Object.prototype.toString.call(value).toLowerCase() === "[object " + type + "]";
    }

/**
 * Prepares an options object from the given value.
 * @private
 * @param {String|Object} value Value to convert to an options object.
 * @returns {Object} Options object.
 */
    function prepareOptions(value) {
        value = value || {};
        if (value === "all" || value.all) {
            value = {natives: true, extensibility: true};
        } else if (isType(value, "string")) {
            value = self.forEach(value, /[^\s,]+/, function (m) {
                this[m] = true;
            }, {});
        }
        return value;
    }

/**
 * Runs built-in/custom tokens in reverse insertion order, until a match is found.
 * @private
 * @param {String} pattern Original pattern from which an XRegExp object is being built.
 * @param {Number} pos Position to search for tokens within `pattern`.
 * @param {Number} scope Current regex scope.
 * @param {Object} context Context object assigned to token handler functions.
 * @returns {Object} Object with properties `output` (the substitution string returned by the
 *   successful token handler) and `match` (the token's match array), or null.
 */
    function runTokens(pattern, pos, scope, context) {
        var i = tokens.length,
            result = null,
            match,
            t;
        // Protect against constructing XRegExps within token handler and trigger functions
        isInsideConstructor = true;
        // Must reset `isInsideConstructor`, even if a `trigger` or `handler` throws
        try {
            while (i--) { // Run in reverse order
                t = tokens[i];
                if ((t.scope === "all" || t.scope === scope) && (!t.trigger || t.trigger.call(context))) {
                    t.pattern.lastIndex = pos;
                    match = fixed.exec.call(t.pattern, pattern); // Fixed `exec` here allows use of named backreferences, etc.
                    if (match && match.index === pos) {
                        result = {
                            output: t.handler.call(context, match, scope),
                            match: match
                        };
                        break;
                    }
                }
            }
        } catch (err) {
            throw err;
        } finally {
            isInsideConstructor = false;
        }
        return result;
    }

/**
 * Enables or disables XRegExp syntax and flag extensibility.
 * @private
 * @param {Boolean} on `true` to enable; `false` to disable.
 */
    function setExtensibility(on) {
        self.addToken = addToken[on ? "on" : "off"];
        features.extensibility = on;
    }

/**
 * Enables or disables native method overrides.
 * @private
 * @param {Boolean} on `true` to enable; `false` to disable.
 */
    function setNatives(on) {
        RegExp.prototype.exec = (on ? fixed : nativ).exec;
        RegExp.prototype.test = (on ? fixed : nativ).test;
        String.prototype.match = (on ? fixed : nativ).match;
        String.prototype.replace = (on ? fixed : nativ).replace;
        String.prototype.split = (on ? fixed : nativ).split;
        features.natives = on;
    }

/*--------------------------------------
 *  Constructor
 *------------------------------------*/

/**
 * Creates an extended regular expression object for matching text with a pattern. Differs from a
 * native regular expression in that additional syntax and flags are supported. The returned object
 * is in fact a native `RegExp` and works with all native methods.
 * @class XRegExp
 * @constructor
 * @param {String|RegExp} pattern Regex pattern string, or an existing `RegExp` object to copy.
 * @param {String} [flags] Any combination of flags:
 *   <li>`g` - global
 *   <li>`i` - ignore case
 *   <li>`m` - multiline anchors
 *   <li>`n` - explicit capture
 *   <li>`s` - dot matches all (aka singleline)
 *   <li>`x` - free-spacing and line comments (aka extended)
 *   <li>`y` - sticky (Firefox 3+ only)
 *   Flags cannot be provided when constructing one `RegExp` from another.
 * @returns {RegExp} Extended regular expression object.
 * @example
 *
 * // With named capture and flag x
 * date = XRegExp('(?<year>  [0-9]{4}) -?  # year  \n\
 *                 (?<month> [0-9]{2}) -?  # month \n\
 *                 (?<day>   [0-9]{2})     # day   ', 'x');
 *
 * // Passing a regex object to copy it. The copy maintains special properties for named capture,
 * // is augmented with `XRegExp.prototype` methods, and has a fresh `lastIndex` property (set to
 * // zero). Native regexes are not recompiled using XRegExp syntax.
 * XRegExp(/regex/);
 */
    self = function (pattern, flags) {
        if (self.isRegExp(pattern)) {
            if (flags !== undef) {
                throw new TypeError("can't supply flags when constructing one RegExp from another");
            }
            return copy(pattern);
        }
        // Tokens become part of the regex construction process, so protect against infinite recursion
        // when an XRegExp is constructed within a token handler function
        if (isInsideConstructor) {
            throw new Error("can't call the XRegExp constructor within token definition functions");
        }

        var output = [],
            scope = defaultScope,
            tokenContext = {
                hasNamedCapture: false,
                captureNames: [],
                hasFlag: function (flag) {
                    return flags.indexOf(flag) > -1;
                }
            },
            pos = 0,
            tokenResult,
            match,
            chr;
        pattern = pattern === undef ? "" : String(pattern);
        flags = flags === undef ? "" : String(flags);

        if (nativ.match.call(flags, duplicateFlags)) { // Don't use test/exec because they would update lastIndex
            throw new SyntaxError("invalid duplicate regular expression flag");
        }
        // Strip/apply leading mode modifier with any combination of flags except g or y: (?imnsx)
        pattern = nativ.replace.call(pattern, /^\(\?([\w$]+)\)/, function ($0, $1) {
            if (nativ.test.call(/[gy]/, $1)) {
                throw new SyntaxError("can't use flag g or y in mode modifier");
            }
            flags = nativ.replace.call(flags + $1, duplicateFlags, "");
            return "";
        });
        self.forEach(flags, /[\s\S]/, function (m) {
            if (registeredFlags.indexOf(m[0]) < 0) {
                throw new SyntaxError("invalid regular expression flag " + m[0]);
            }
        });

        while (pos < pattern.length) {
            // Check for custom tokens at the current position
            tokenResult = runTokens(pattern, pos, scope, tokenContext);
            if (tokenResult) {
                output.push(tokenResult.output);
                pos += (tokenResult.match[0].length || 1);
            } else {
                // Check for native tokens (except character classes) at the current position
                match = nativ.exec.call(nativeTokens[scope], pattern.slice(pos));
                if (match) {
                    output.push(match[0]);
                    pos += match[0].length;
                } else {
                    chr = pattern.charAt(pos);
                    if (chr === "[") {
                        scope = classScope;
                    } else if (chr === "]") {
                        scope = defaultScope;
                    }
                    // Advance position by one character
                    output.push(chr);
                    ++pos;
                }
            }
        }

        return augment(new RegExp(output.join(""), nativ.replace.call(flags, /[^gimy]+/g, "")),
                       tokenContext.hasNamedCapture ? tokenContext.captureNames : null);
    };

/*--------------------------------------
 *  Public methods/properties
 *------------------------------------*/

// Installed and uninstalled states for `XRegExp.addToken`
    addToken = {
        on: function (regex, handler, options) {
            options = options || {};
            if (regex) {
                tokens.push({
                    pattern: copy(regex, "g" + (hasNativeY ? "y" : "")),
                    handler: handler,
                    scope: options.scope || defaultScope,
                    trigger: options.trigger || null
                });
            }
            // Providing `customFlags` with null `regex` and `handler` allows adding flags that do
            // nothing, but don't throw an error
            if (options.customFlags) {
                registeredFlags = nativ.replace.call(registeredFlags + options.customFlags, duplicateFlags, "");
            }
        },
        off: function () {
            throw new Error("extensibility must be installed before using addToken");
        }
    };

/**
 * Extends or changes XRegExp syntax and allows custom flags. This is used internally and can be
 * used to create XRegExp addons. `XRegExp.install('extensibility')` must be run before calling
 * this function, or an error is thrown. If more than one token can match the same string, the last
 * added wins.
 * @memberOf XRegExp
 * @param {RegExp} regex Regex object that matches the new token.
 * @param {Function} handler Function that returns a new pattern string (using native regex syntax)
 *   to replace the matched token within all future XRegExp regexes. Has access to persistent
 *   properties of the regex being built, through `this`. Invoked with two arguments:
 *   <li>The match array, with named backreference properties.
 *   <li>The regex scope where the match was found.
 * @param {Object} [options] Options object with optional properties:
 *   <li>`scope` {String} Scopes where the token applies: 'default', 'class', or 'all'.
 *   <li>`trigger` {Function} Function that returns `true` when the token should be applied; e.g.,
 *     if a flag is set. If `false` is returned, the matched string can be matched by other tokens.
 *     Has access to persistent properties of the regex being built, through `this` (including
 *     function `this.hasFlag`).
 *   <li>`customFlags` {String} Nonnative flags used by the token's handler or trigger functions.
 *     Prevents XRegExp from throwing an invalid flag error when the specified flags are used.
 * @example
 *
 * // Basic usage: Adds \a for ALERT character
 * XRegExp.addToken(
 *   /\\a/,
 *   function () {return '\\x07';},
 *   {scope: 'all'}
 * );
 * XRegExp('\\a[\\a-\\n]+').test('\x07\n\x07'); // -> true
 */
    self.addToken = addToken.off;

/**
 * Caches and returns the result of calling `XRegExp(pattern, flags)`. On any subsequent call with
 * the same pattern and flag combination, the cached copy is returned.
 * @memberOf XRegExp
 * @param {String} pattern Regex pattern string.
 * @param {String} [flags] Any combination of XRegExp flags.
 * @returns {RegExp} Cached XRegExp object.
 * @example
 *
 * while (match = XRegExp.cache('.', 'gs').exec(str)) {
 *   // The regex is compiled once only
 * }
 */
    self.cache = function (pattern, flags) {
        var key = pattern + "/" + (flags || "");
        return cache[key] || (cache[key] = self(pattern, flags));
    };

/**
 * Escapes any regular expression metacharacters, for use when matching literal strings. The result
 * can safely be used at any point within a regex that uses any flags.
 * @memberOf XRegExp
 * @param {String} str String to escape.
 * @returns {String} String with regex metacharacters escaped.
 * @example
 *
 * XRegExp.escape('Escaped? <.>');
 * // -> 'Escaped\?\ <\.>'
 */
    self.escape = function (str) {
        return nativ.replace.call(str, /[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    };

/**
 * Executes a regex search in a specified string. Returns a match array or `null`. If the provided
 * regex uses named capture, named backreference properties are included on the match array.
 * Optional `pos` and `sticky` arguments specify the search start position, and whether the match
 * must start at the specified position only. The `lastIndex` property of the provided regex is not
 * used, but is updated for compatibility. Also fixes browser bugs compared to the native
 * `RegExp.prototype.exec` and can be used reliably cross-browser.
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {Number} [pos=0] Zero-based index at which to start the search.
 * @param {Boolean|String} [sticky=false] Whether the match must start at the specified position
 *   only. The string `'sticky'` is accepted as an alternative to `true`.
 * @returns {Array} Match array with named backreference properties, or null.
 * @example
 *
 * // Basic use, with named backreference
 * var match = XRegExp.exec('U+2620', XRegExp('U\\+(?<hex>[0-9A-F]{4})'));
 * match.hex; // -> '2620'
 *
 * // With pos and sticky, in a loop
 * var pos = 2, result = [], match;
 * while (match = XRegExp.exec('<1><2><3><4>5<6>', /<(\d)>/, pos, 'sticky')) {
 *   result.push(match[1]);
 *   pos = match.index + match[0].length;
 * }
 * // result -> ['2', '3', '4']
 */
    self.exec = function (str, regex, pos, sticky) {
        var r2 = copy(regex, "g" + (sticky && hasNativeY ? "y" : ""), (sticky === false ? "y" : "")),
            match;
        r2.lastIndex = pos = pos || 0;
        match = fixed.exec.call(r2, str); // Fixed `exec` required for `lastIndex` fix, etc.
        if (sticky && match && match.index !== pos) {
            match = null;
        }
        if (regex.global) {
            regex.lastIndex = match ? r2.lastIndex : 0;
        }
        return match;
    };

/**
 * Executes a provided function once per regex match.
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {Function} callback Function to execute for each match. Invoked with four arguments:
 *   <li>The match array, with named backreference properties.
 *   <li>The zero-based match index.
 *   <li>The string being traversed.
 *   <li>The regex object being used to traverse the string.
 * @param {*} [context] Object to use as `this` when executing `callback`.
 * @returns {*} Provided `context` object.
 * @example
 *
 * // Extracts every other digit from a string
 * XRegExp.forEach('1a2345', /\d/, function (match, i) {
 *   if (i % 2) this.push(+match[0]);
 * }, []);
 * // -> [2, 4]
 */
    self.forEach = function (str, regex, callback, context) {
        var pos = 0,
            i = -1,
            match;
        while ((match = self.exec(str, regex, pos))) {
            callback.call(context, match, ++i, str, regex);
            pos = match.index + (match[0].length || 1);
        }
        return context;
    };

/**
 * Copies a regex object and adds flag `g`. The copy maintains special properties for named
 * capture, is augmented with `XRegExp.prototype` methods, and has a fresh `lastIndex` property
 * (set to zero). Native regexes are not recompiled using XRegExp syntax.
 * @memberOf XRegExp
 * @param {RegExp} regex Regex to globalize.
 * @returns {RegExp} Copy of the provided regex with flag `g` added.
 * @example
 *
 * var globalCopy = XRegExp.globalize(/regex/);
 * globalCopy.global; // -> true
 */
    self.globalize = function (regex) {
        return copy(regex, "g");
    };

/**
 * Installs optional features according to the specified options.
 * @memberOf XRegExp
 * @param {Object|String} options Options object or string.
 * @example
 *
 * // With an options object
 * XRegExp.install({
 *   // Overrides native regex methods with fixed/extended versions that support named
 *   // backreferences and fix numerous cross-browser bugs
 *   natives: true,
 *
 *   // Enables extensibility of XRegExp syntax and flags
 *   extensibility: true
 * });
 *
 * // With an options string
 * XRegExp.install('natives extensibility');
 *
 * // Using a shortcut to install all optional features
 * XRegExp.install('all');
 */
    self.install = function (options) {
        options = prepareOptions(options);
        if (!features.natives && options.natives) {
            setNatives(true);
        }
        if (!features.extensibility && options.extensibility) {
            setExtensibility(true);
        }
    };

/**
 * Checks whether an individual optional feature is installed.
 * @memberOf XRegExp
 * @param {String} feature Name of the feature to check. One of:
 *   <li>`natives`
 *   <li>`extensibility`
 * @returns {Boolean} Whether the feature is installed.
 * @example
 *
 * XRegExp.isInstalled('natives');
 */
    self.isInstalled = function (feature) {
        return !!(features[feature]);
    };

/**
 * Returns `true` if an object is a regex; `false` if it isn't. This works correctly for regexes
 * created in another frame, when `instanceof` and `constructor` checks would fail.
 * @memberOf XRegExp
 * @param {*} value Object to check.
 * @returns {Boolean} Whether the object is a `RegExp` object.
 * @example
 *
 * XRegExp.isRegExp('string'); // -> false
 * XRegExp.isRegExp(/regex/i); // -> true
 * XRegExp.isRegExp(RegExp('^', 'm')); // -> true
 * XRegExp.isRegExp(XRegExp('(?s).')); // -> true
 */
    self.isRegExp = function (value) {
        return isType(value, "regexp");
    };

/**
 * Retrieves the matches from searching a string using a chain of regexes that successively search
 * within previous matches. The provided `chain` array can contain regexes and objects with `regex`
 * and `backref` properties. When a backreference is specified, the named or numbered backreference
 * is passed forward to the next regex or returned.
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {Array} chain Regexes that each search for matches within preceding results.
 * @returns {Array} Matches by the last regex in the chain, or an empty array.
 * @example
 *
 * // Basic usage; matches numbers within <b> tags
 * XRegExp.matchChain('1 <b>2</b> 3 <b>4 a 56</b>', [
 *   XRegExp('(?is)<b>.*?</b>'),
 *   /\d+/
 * ]);
 * // -> ['2', '4', '56']
 *
 * // Passing forward and returning specific backreferences
 * html = '<a href="http://xregexp.com/api/">XRegExp</a>\
 *         <a href="http://www.google.com/">Google</a>';
 * XRegExp.matchChain(html, [
 *   {regex: /<a href="([^"]+)">/i, backref: 1},
 *   {regex: XRegExp('(?i)^https?://(?<domain>[^/?#]+)'), backref: 'domain'}
 * ]);
 * // -> ['xregexp.com', 'www.google.com']
 */
    self.matchChain = function (str, chain) {
        return (function recurseChain(values, level) {
            var item = chain[level].regex ? chain[level] : {regex: chain[level]},
                matches = [],
                addMatch = function (match) {
                    matches.push(item.backref ? (match[item.backref] || "") : match[0]);
                },
                i;
            for (i = 0; i < values.length; ++i) {
                self.forEach(values[i], item.regex, addMatch);
            }
            return ((level === chain.length - 1) || !matches.length) ?
                    matches :
                    recurseChain(matches, level + 1);
        }([str], 0));
    };

/**
 * Returns a new string with one or all matches of a pattern replaced. The pattern can be a string
 * or regex, and the replacement can be a string or a function to be called for each match. To
 * perform a global search and replace, use the optional `scope` argument or include flag `g` if
 * using a regex. Replacement strings can use `${n}` for named and numbered backreferences.
 * Replacement functions can use named backreferences via `arguments[0].name`. Also fixes browser
 * bugs compared to the native `String.prototype.replace` and can be used reliably cross-browser.
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp|String} search Search pattern to be replaced.
 * @param {String|Function} replacement Replacement string or a function invoked to create it.
 *   Replacement strings can include special replacement syntax:
 *     <li>$$ - Inserts a literal '$'.
 *     <li>$&, $0 - Inserts the matched substring.
 *     <li>$` - Inserts the string that precedes the matched substring (left context).
 *     <li>$' - Inserts the string that follows the matched substring (right context).
 *     <li>$n, $nn - Where n/nn are digits referencing an existent capturing group, inserts
 *       backreference n/nn.
 *     <li>${n} - Where n is a name or any number of digits that reference an existent capturing
 *       group, inserts backreference n.
 *   Replacement functions are invoked with three or more arguments:
 *     <li>The matched substring (corresponds to $& above). Named backreferences are accessible as
 *       properties of this first argument.
 *     <li>0..n arguments, one for each backreference (corresponding to $1, $2, etc. above).
 *     <li>The zero-based index of the match within the total search string.
 *     <li>The total string being searched.
 * @param {String} [scope='one'] Use 'one' to replace the first match only, or 'all'. If not
 *   explicitly specified and using a regex with flag `g`, `scope` is 'all'.
 * @returns {String} New string with one or all matches replaced.
 * @example
 *
 * // Regex search, using named backreferences in replacement string
 * var name = XRegExp('(?<first>\\w+) (?<last>\\w+)');
 * XRegExp.replace('John Smith', name, '${last}, ${first}');
 * // -> 'Smith, John'
 *
 * // Regex search, using named backreferences in replacement function
 * XRegExp.replace('John Smith', name, function (match) {
 *   return match.last + ', ' + match.first;
 * });
 * // -> 'Smith, John'
 *
 * // Global string search/replacement
 * XRegExp.replace('RegExp builds RegExps', 'RegExp', 'XRegExp', 'all');
 * // -> 'XRegExp builds XRegExps'
 */
    self.replace = function (str, search, replacement, scope) {
        var isRegex = self.isRegExp(search),
            search2 = search,
            result;
        if (isRegex) {
            if (scope === undef && search.global) {
                scope = "all"; // Follow flag g when `scope` isn't explicit
            }
            // Note that since a copy is used, `search`'s `lastIndex` isn't updated *during* replacement iterations
            search2 = copy(search, scope === "all" ? "g" : "", scope === "all" ? "" : "g");
        } else if (scope === "all") {
            search2 = new RegExp(self.escape(String(search)), "g");
        }
        result = fixed.replace.call(String(str), search2, replacement); // Fixed `replace` required for named backreferences, etc.
        if (isRegex && search.global) {
            search.lastIndex = 0; // Fixes IE, Safari bug (last tested IE 9, Safari 5.1)
        }
        return result;
    };

/**
 * Splits a string into an array of strings using a regex or string separator. Matches of the
 * separator are not included in the result array. However, if `separator` is a regex that contains
 * capturing groups, backreferences are spliced into the result each time `separator` is matched.
 * Fixes browser bugs compared to the native `String.prototype.split` and can be used reliably
 * cross-browser.
 * @memberOf XRegExp
 * @param {String} str String to split.
 * @param {RegExp|String} separator Regex or string to use for separating the string.
 * @param {Number} [limit] Maximum number of items to include in the result array.
 * @returns {Array} Array of substrings.
 * @example
 *
 * // Basic use
 * XRegExp.split('a b c', ' ');
 * // -> ['a', 'b', 'c']
 *
 * // With limit
 * XRegExp.split('a b c', ' ', 2);
 * // -> ['a', 'b']
 *
 * // Backreferences in result array
 * XRegExp.split('..word1..', /([a-z]+)(\d+)/i);
 * // -> ['..', 'word', '1', '..']
 */
    self.split = function (str, separator, limit) {
        return fixed.split.call(str, separator, limit);
    };

/**
 * Executes a regex search in a specified string. Returns `true` or `false`. Optional `pos` and
 * `sticky` arguments specify the search start position, and whether the match must start at the
 * specified position only. The `lastIndex` property of the provided regex is not used, but is
 * updated for compatibility. Also fixes browser bugs compared to the native
 * `RegExp.prototype.test` and can be used reliably cross-browser.
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {RegExp} regex Regex to search with.
 * @param {Number} [pos=0] Zero-based index at which to start the search.
 * @param {Boolean|String} [sticky=false] Whether the match must start at the specified position
 *   only. The string `'sticky'` is accepted as an alternative to `true`.
 * @returns {Boolean} Whether the regex matched the provided value.
 * @example
 *
 * // Basic use
 * XRegExp.test('abc', /c/); // -> true
 *
 * // With pos and sticky
 * XRegExp.test('abc', /c/, 0, 'sticky'); // -> false
 */
    self.test = function (str, regex, pos, sticky) {
        // Do this the easy way :-)
        return !!self.exec(str, regex, pos, sticky);
    };

/**
 * Uninstalls optional features according to the specified options.
 * @memberOf XRegExp
 * @param {Object|String} options Options object or string.
 * @example
 *
 * // With an options object
 * XRegExp.uninstall({
 *   // Restores native regex methods
 *   natives: true,
 *
 *   // Disables additional syntax and flag extensions
 *   extensibility: true
 * });
 *
 * // With an options string
 * XRegExp.uninstall('natives extensibility');
 *
 * // Using a shortcut to uninstall all optional features
 * XRegExp.uninstall('all');
 */
    self.uninstall = function (options) {
        options = prepareOptions(options);
        if (features.natives && options.natives) {
            setNatives(false);
        }
        if (features.extensibility && options.extensibility) {
            setExtensibility(false);
        }
    };

/**
 * Returns an XRegExp object that is the union of the given patterns. Patterns can be provided as
 * regex objects or strings. Metacharacters are escaped in patterns provided as strings.
 * Backreferences in provided regex objects are automatically renumbered to work correctly. Native
 * flags used by provided regexes are ignored in favor of the `flags` argument.
 * @memberOf XRegExp
 * @param {Array} patterns Regexes and strings to combine.
 * @param {String} [flags] Any combination of XRegExp flags.
 * @returns {RegExp} Union of the provided regexes and strings.
 * @example
 *
 * XRegExp.union(['a+b*c', /(dogs)\1/, /(cats)\1/], 'i');
 * // -> /a\+b\*c|(dogs)\1|(cats)\2/i
 *
 * XRegExp.union([XRegExp('(?<pet>dogs)\\k<pet>'), XRegExp('(?<pet>cats)\\k<pet>')]);
 * // -> XRegExp('(?<pet>dogs)\\k<pet>|(?<pet>cats)\\k<pet>')
 */
    self.union = function (patterns, flags) {
        var parts = /(\()(?!\?)|\\([1-9]\d*)|\\[\s\S]|\[(?:[^\\\]]|\\[\s\S])*]/g,
            numCaptures = 0,
            numPriorCaptures,
            captureNames,
            rewrite = function (match, paren, backref) {
                var name = captureNames[numCaptures - numPriorCaptures];
                if (paren) { // Capturing group
                    ++numCaptures;
                    if (name) { // If the current capture has a name
                        return "(?<" + name + ">";
                    }
                } else if (backref) { // Backreference
                    return "\\" + (+backref + numPriorCaptures);
                }
                return match;
            },
            output = [],
            pattern,
            i;
        if (!(isType(patterns, "array") && patterns.length)) {
            throw new TypeError("patterns must be a nonempty array");
        }
        for (i = 0; i < patterns.length; ++i) {
            pattern = patterns[i];
            if (self.isRegExp(pattern)) {
                numPriorCaptures = numCaptures;
                captureNames = (pattern.xregexp && pattern.xregexp.captureNames) || [];
                // Rewrite backreferences. Passing to XRegExp dies on octals and ensures patterns
                // are independently valid; helps keep this simple. Named captures are put back
                output.push(self(pattern.source).source.replace(parts, rewrite));
            } else {
                output.push(self.escape(pattern));
            }
        }
        return self(output.join("|"), flags);
    };

/**
 * The XRegExp version number.
 * @static
 * @memberOf XRegExp
 * @type String
 */
    self.version = "2.0.0";

/*--------------------------------------
 *  Fixed/extended native methods
 *------------------------------------*/

/**
 * Adds named capture support (with backreferences returned as `result.name`), and fixes browser
 * bugs in the native `RegExp.prototype.exec`. Calling `XRegExp.install('natives')` uses this to
 * override the native method. Use via `XRegExp.exec` without overriding natives.
 * @private
 * @param {String} str String to search.
 * @returns {Array} Match array with named backreference properties, or null.
 */
    fixed.exec = function (str) {
        var match, name, r2, origLastIndex, i;
        if (!this.global) {
            origLastIndex = this.lastIndex;
        }
        match = nativ.exec.apply(this, arguments);
        if (match) {
            // Fix browsers whose `exec` methods don't consistently return `undefined` for
            // nonparticipating capturing groups
            if (!compliantExecNpcg && match.length > 1 && lastIndexOf(match, "") > -1) {
                r2 = new RegExp(this.source, nativ.replace.call(getNativeFlags(this), "g", ""));
                // Using `str.slice(match.index)` rather than `match[0]` in case lookahead allowed
                // matching due to characters outside the match
                nativ.replace.call(String(str).slice(match.index), r2, function () {
                    var i;
                    for (i = 1; i < arguments.length - 2; ++i) {
                        if (arguments[i] === undef) {
                            match[i] = undef;
                        }
                    }
                });
            }
            // Attach named capture properties
            if (this.xregexp && this.xregexp.captureNames) {
                for (i = 1; i < match.length; ++i) {
                    name = this.xregexp.captureNames[i - 1];
                    if (name) {
                        match[name] = match[i];
                    }
                }
            }
            // Fix browsers that increment `lastIndex` after zero-length matches
            if (this.global && !match[0].length && (this.lastIndex > match.index)) {
                this.lastIndex = match.index;
            }
        }
        if (!this.global) {
            this.lastIndex = origLastIndex; // Fixes IE, Opera bug (last tested IE 9, Opera 11.6)
        }
        return match;
    };

/**
 * Fixes browser bugs in the native `RegExp.prototype.test`. Calling `XRegExp.install('natives')`
 * uses this to override the native method.
 * @private
 * @param {String} str String to search.
 * @returns {Boolean} Whether the regex matched the provided value.
 */
    fixed.test = function (str) {
        // Do this the easy way :-)
        return !!fixed.exec.call(this, str);
    };

/**
 * Adds named capture support (with backreferences returned as `result.name`), and fixes browser
 * bugs in the native `String.prototype.match`. Calling `XRegExp.install('natives')` uses this to
 * override the native method.
 * @private
 * @param {RegExp} regex Regex to search with.
 * @returns {Array} If `regex` uses flag g, an array of match strings or null. Without flag g, the
 *   result of calling `regex.exec(this)`.
 */
    fixed.match = function (regex) {
        if (!self.isRegExp(regex)) {
            regex = new RegExp(regex); // Use native `RegExp`
        } else if (regex.global) {
            var result = nativ.match.apply(this, arguments);
            regex.lastIndex = 0; // Fixes IE bug
            return result;
        }
        return fixed.exec.call(regex, this);
    };

/**
 * Adds support for `${n}` tokens for named and numbered backreferences in replacement text, and
 * provides named backreferences to replacement functions as `arguments[0].name`. Also fixes
 * browser bugs in replacement text syntax when performing a replacement using a nonregex search
 * value, and the value of a replacement regex's `lastIndex` property during replacement iterations
 * and upon completion. Note that this doesn't support SpiderMonkey's proprietary third (`flags`)
 * argument. Calling `XRegExp.install('natives')` uses this to override the native method. Use via
 * `XRegExp.replace` without overriding natives.
 * @private
 * @param {RegExp|String} search Search pattern to be replaced.
 * @param {String|Function} replacement Replacement string or a function invoked to create it.
 * @returns {String} New string with one or all matches replaced.
 */
    fixed.replace = function (search, replacement) {
        var isRegex = self.isRegExp(search), captureNames, result, str, origLastIndex;
        if (isRegex) {
            if (search.xregexp) {
                captureNames = search.xregexp.captureNames;
            }
            if (!search.global) {
                origLastIndex = search.lastIndex;
            }
        } else {
            search += "";
        }
        if (isType(replacement, "function")) {
            result = nativ.replace.call(String(this), search, function () {
                var args = arguments, i;
                if (captureNames) {
                    // Change the `arguments[0]` string primitive to a `String` object that can store properties
                    args[0] = new String(args[0]);
                    // Store named backreferences on the first argument
                    for (i = 0; i < captureNames.length; ++i) {
                        if (captureNames[i]) {
                            args[0][captureNames[i]] = args[i + 1];
                        }
                    }
                }
                // Update `lastIndex` before calling `replacement`.
                // Fixes IE, Chrome, Firefox, Safari bug (last tested IE 9, Chrome 17, Firefox 11, Safari 5.1)
                if (isRegex && search.global) {
                    search.lastIndex = args[args.length - 2] + args[0].length;
                }
                return replacement.apply(null, args);
            });
        } else {
            str = String(this); // Ensure `args[args.length - 1]` will be a string when given nonstring `this`
            result = nativ.replace.call(str, search, function () {
                var args = arguments; // Keep this function's `arguments` available through closure
                return nativ.replace.call(String(replacement), replacementToken, function ($0, $1, $2) {
                    var n;
                    // Named or numbered backreference with curly brackets
                    if ($1) {
                        /* XRegExp behavior for `${n}`:
                         * 1. Backreference to numbered capture, where `n` is 1+ digits. `0`, `00`, etc. is the entire match.
                         * 2. Backreference to named capture `n`, if it exists and is not a number overridden by numbered capture.
                         * 3. Otherwise, it's an error.
                         */
                        n = +$1; // Type-convert; drop leading zeros
                        if (n <= args.length - 3) {
                            return args[n] || "";
                        }
                        n = captureNames ? lastIndexOf(captureNames, $1) : -1;
                        if (n < 0) {
                            throw new SyntaxError("backreference to undefined group " + $0);
                        }
                        return args[n + 1] || "";
                    }
                    // Else, special variable or numbered backreference (without curly brackets)
                    if ($2 === "$") return "$";
                    if ($2 === "&" || +$2 === 0) return args[0]; // $&, $0 (not followed by 1-9), $00
                    if ($2 === "`") return args[args.length - 1].slice(0, args[args.length - 2]);
                    if ($2 === "'") return args[args.length - 1].slice(args[args.length - 2] + args[0].length);
                    // Else, numbered backreference (without curly brackets)
                    $2 = +$2; // Type-convert; drop leading zero
                    /* XRegExp behavior:
                     * - Backreferences without curly brackets end after 1 or 2 digits. Use `${..}` for more digits.
                     * - `$1` is an error if there are no capturing groups.
                     * - `$10` is an error if there are less than 10 capturing groups. Use `${1}0` instead.
                     * - `$01` is equivalent to `$1` if a capturing group exists, otherwise it's an error.
                     * - `$0` (not followed by 1-9), `$00`, and `$&` are the entire match.
                     * Native behavior, for comparison:
                     * - Backreferences end after 1 or 2 digits. Cannot use backreference to capturing group 100+.
                     * - `$1` is a literal `$1` if there are no capturing groups.
                     * - `$10` is `$1` followed by a literal `0` if there are less than 10 capturing groups.
                     * - `$01` is equivalent to `$1` if a capturing group exists, otherwise it's a literal `$01`.
                     * - `$0` is a literal `$0`. `$&` is the entire match.
                     */
                    if (!isNaN($2)) {
                        if ($2 > args.length - 3) {
                            throw new SyntaxError("backreference to undefined group " + $0);
                        }
                        return args[$2] || "";
                    }
                    throw new SyntaxError("invalid token " + $0);
                });
            });
        }
        if (isRegex) {
            if (search.global) {
                search.lastIndex = 0; // Fixes IE, Safari bug (last tested IE 9, Safari 5.1)
            } else {
                search.lastIndex = origLastIndex; // Fixes IE, Opera bug (last tested IE 9, Opera 11.6)
            }
        }
        return result;
    };

/**
 * Fixes browser bugs in the native `String.prototype.split`. Calling `XRegExp.install('natives')`
 * uses this to override the native method. Use via `XRegExp.split` without overriding natives.
 * @private
 * @param {RegExp|String} separator Regex or string to use for separating the string.
 * @param {Number} [limit] Maximum number of items to include in the result array.
 * @returns {Array} Array of substrings.
 */
    fixed.split = function (separator, limit) {
        if (!self.isRegExp(separator)) {
            return nativ.split.apply(this, arguments); // use faster native method
        }
        var str = String(this),
            origLastIndex = separator.lastIndex,
            output = [],
            lastLastIndex = 0,
            lastLength;
        /* Values for `limit`, per the spec:
         * If undefined: pow(2,32) - 1
         * If 0, Infinity, or NaN: 0
         * If positive number: limit = floor(limit); if (limit >= pow(2,32)) limit -= pow(2,32);
         * If negative number: pow(2,32) - floor(abs(limit))
         * If other: Type-convert, then use the above rules
         */
        limit = (limit === undef ? -1 : limit) >>> 0;
        self.forEach(str, separator, function (match) {
            if ((match.index + match[0].length) > lastLastIndex) { // != `if (match[0].length)`
                output.push(str.slice(lastLastIndex, match.index));
                if (match.length > 1 && match.index < str.length) {
                    Array.prototype.push.apply(output, match.slice(1));
                }
                lastLength = match[0].length;
                lastLastIndex = match.index + lastLength;
            }
        });
        if (lastLastIndex === str.length) {
            if (!nativ.test.call(separator, "") || lastLength) {
                output.push("");
            }
        } else {
            output.push(str.slice(lastLastIndex));
        }
        separator.lastIndex = origLastIndex;
        return output.length > limit ? output.slice(0, limit) : output;
    };

/*--------------------------------------
 *  Built-in tokens
 *------------------------------------*/

// Shortcut
    add = addToken.on;

/* Letter identity escapes that natively match literal characters: \p, \P, etc.
 * Should be SyntaxErrors but are allowed in web reality. XRegExp makes them errors for cross-
 * browser consistency and to reserve their syntax, but lets them be superseded by XRegExp addons.
 */
    add(/\\([ABCE-RTUVXYZaeg-mopqyz]|c(?![A-Za-z])|u(?![\dA-Fa-f]{4})|x(?![\dA-Fa-f]{2}))/,
        function (match, scope) {
            // \B is allowed in default scope only
            if (match[1] === "B" && scope === defaultScope) {
                return match[0];
            }
            throw new SyntaxError("invalid escape " + match[0]);
        },
        {scope: "all"});

/* Empty character class: [] or [^]
 * Fixes a critical cross-browser syntax inconsistency. Unless this is standardized (per the spec),
 * regex syntax can't be accurately parsed because character class endings can't be determined.
 */
    add(/\[(\^?)]/,
        function (match) {
            // For cross-browser compatibility with ES3, convert [] to \b\B and [^] to [\s\S].
            // (?!) should work like \b\B, but is unreliable in Firefox
            return match[1] ? "[\\s\\S]" : "\\b\\B";
        });

/* Comment pattern: (?# )
 * Inline comments are an alternative to the line comments allowed in free-spacing mode (flag x).
 */
    add(/(?:\(\?#[^)]*\))+/,
        function (match) {
            // Keep tokens separated unless the following token is a quantifier
            return nativ.test.call(quantifier, match.input.slice(match.index + match[0].length)) ? "" : "(?:)";
        });

/* Named backreference: \k<name>
 * Backreference names can use the characters A-Z, a-z, 0-9, _, and $ only.
 */
    add(/\\k<([\w$]+)>/,
        function (match) {
            var index = isNaN(match[1]) ? (lastIndexOf(this.captureNames, match[1]) + 1) : +match[1],
                endIndex = match.index + match[0].length;
            if (!index || index > this.captureNames.length) {
                throw new SyntaxError("backreference to undefined group " + match[0]);
            }
            // Keep backreferences separate from subsequent literal numbers
            return "\\" + index + (
                endIndex === match.input.length || isNaN(match.input.charAt(endIndex)) ? "" : "(?:)"
            );
        });

/* Whitespace and line comments, in free-spacing mode (aka extended mode, flag x) only.
 */
    add(/(?:\s+|#.*)+/,
        function (match) {
            // Keep tokens separated unless the following token is a quantifier
            return nativ.test.call(quantifier, match.input.slice(match.index + match[0].length)) ? "" : "(?:)";
        },
        {
            trigger: function () {
                return this.hasFlag("x");
            },
            customFlags: "x"
        });

/* Dot, in dotall mode (aka singleline mode, flag s) only.
 */
    add(/\./,
        function () {
            return "[\\s\\S]";
        },
        {
            trigger: function () {
                return this.hasFlag("s");
            },
            customFlags: "s"
        });

/* Named capturing group; match the opening delimiter only: (?<name>
 * Capture names can use the characters A-Z, a-z, 0-9, _, and $ only. Names can't be integers.
 * Supports Python-style (?P<name> as an alternate syntax to avoid issues in recent Opera (which
 * natively supports the Python-style syntax). Otherwise, XRegExp might treat numbered
 * backreferences to Python-style named capture as octals.
 */
    add(/\(\?P?<([\w$]+)>/,
        function (match) {
            if (!isNaN(match[1])) {
                // Avoid incorrect lookups, since named backreferences are added to match arrays
                throw new SyntaxError("can't use integer as capture name " + match[0]);
            }
            this.captureNames.push(match[1]);
            this.hasNamedCapture = true;
            return "(";
        });

/* Numbered backreference or octal, plus any following digits: \0, \11, etc.
 * Octals except \0 not followed by 0-9 and backreferences to unopened capture groups throw an
 * error. Other matches are returned unaltered. IE <= 8 doesn't support backreferences greater than
 * \99 in regex syntax.
 */
    add(/\\(\d+)/,
        function (match, scope) {
            if (!(scope === defaultScope && /^[1-9]/.test(match[1]) && +match[1] <= this.captureNames.length) &&
                    match[1] !== "0") {
                throw new SyntaxError("can't use octal escape or backreference to undefined group " + match[0]);
            }
            return match[0];
        },
        {scope: "all"});

/* Capturing group; match the opening parenthesis only.
 * Required for support of named capturing groups. Also adds explicit capture mode (flag n).
 */
    add(/\((?!\?)/,
        function () {
            if (this.hasFlag("n")) {
                return "(?:";
            }
            this.captureNames.push(null);
            return "(";
        },
        {customFlags: "n"});

/*--------------------------------------
 *  Expose XRegExp
 *------------------------------------*/

// For CommonJS enviroments
    if (typeof exports !== "undefined") {
        exports.XRegExp = self;
    }

    return self;

}());


/***** unicode-base.js *****/

/*!
 * XRegExp Unicode Base v1.0.0
 * (c) 2008-2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 * Uses Unicode 6.1 <http://unicode.org/>
 */

/**
 * Adds support for the `\p{L}` or `\p{Letter}` Unicode category. Addon packages for other Unicode
 * categories, scripts, blocks, and properties are available separately. All Unicode tokens can be
 * inverted using `\P{..}` or `\p{^..}`. Token names are case insensitive, and any spaces, hyphens,
 * and underscores are ignored.
 * @requires XRegExp
 */
(function (XRegExp) {
    "use strict";

    var unicode = {};

/*--------------------------------------
 *  Private helper functions
 *------------------------------------*/

// Generates a standardized token name (lowercase, with hyphens, spaces, and underscores removed)
    function slug(name) {
        return name.replace(/[- _]+/g, "").toLowerCase();
    }

// Expands a list of Unicode code points and ranges to be usable in a regex character class
    function expand(str) {
        return str.replace(/\w{4}/g, "\\u$&");
    }

// Adds leading zeros if shorter than four characters
    function pad4(str) {
        while (str.length < 4) {
            str = "0" + str;
        }
        return str;
    }

// Converts a hexadecimal number to decimal
    function dec(hex) {
        return parseInt(hex, 16);
    }

// Converts a decimal number to hexadecimal
    function hex(dec) {
        return parseInt(dec, 10).toString(16);
    }

// Inverts a list of Unicode code points and ranges
    function invert(range) {
        var output = [],
            lastEnd = -1,
            start;
        XRegExp.forEach(range, /\\u(\w{4})(?:-\\u(\w{4}))?/, function (m) {
            start = dec(m[1]);
            if (start > (lastEnd + 1)) {
                output.push("\\u" + pad4(hex(lastEnd + 1)));
                if (start > (lastEnd + 2)) {
                    output.push("-\\u" + pad4(hex(start - 1)));
                }
            }
            lastEnd = dec(m[2] || m[1]);
        });
        if (lastEnd < 0xFFFF) {
            output.push("\\u" + pad4(hex(lastEnd + 1)));
            if (lastEnd < 0xFFFE) {
                output.push("-\\uFFFF");
            }
        }
        return output.join("");
    }

// Generates an inverted token on first use
    function cacheInversion(item) {
        return unicode["^" + item] || (unicode["^" + item] = invert(unicode[item]));
    }

/*--------------------------------------
 *  Core functionality
 *------------------------------------*/

    XRegExp.install("extensibility");

/**
 * Adds to the list of Unicode properties that XRegExp regexes can match via \p{..} or \P{..}.
 * @memberOf XRegExp
 * @param {Object} pack Named sets of Unicode code points and ranges.
 * @param {Object} [aliases] Aliases for the primary token names.
 * @example
 *
 * XRegExp.addUnicodePackage({
 *   XDigit: '0030-00390041-00460061-0066' // 0-9A-Fa-f
 * }, {
 *   XDigit: 'Hexadecimal'
 * });
 */
    XRegExp.addUnicodePackage = function (pack, aliases) {
        var p;
        if (!XRegExp.isInstalled("extensibility")) {
            throw new Error("extensibility must be installed before adding Unicode packages");
        }
        if (pack) {
            for (p in pack) {
                if (pack.hasOwnProperty(p)) {
                    unicode[slug(p)] = expand(pack[p]);
                }
            }
        }
        if (aliases) {
            for (p in aliases) {
                if (aliases.hasOwnProperty(p)) {
                    unicode[slug(aliases[p])] = unicode[slug(p)];
                }
            }
        }
    };

/* Adds data for the Unicode `Letter` category. Addon packages include other categories, scripts,
 * blocks, and properties.
 */
    XRegExp.addUnicodePackage({
        L: "0041-005A0061-007A00AA00B500BA00C0-00D600D8-00F600F8-02C102C6-02D102E0-02E402EC02EE0370-037403760377037A-037D03860388-038A038C038E-03A103A3-03F503F7-0481048A-05270531-055605590561-058705D0-05EA05F0-05F20620-064A066E066F0671-06D306D506E506E606EE06EF06FA-06FC06FF07100712-072F074D-07A507B107CA-07EA07F407F507FA0800-0815081A082408280840-085808A008A2-08AC0904-0939093D09500958-09610971-09770979-097F0985-098C098F09900993-09A809AA-09B009B209B6-09B909BD09CE09DC09DD09DF-09E109F009F10A05-0A0A0A0F0A100A13-0A280A2A-0A300A320A330A350A360A380A390A59-0A5C0A5E0A72-0A740A85-0A8D0A8F-0A910A93-0AA80AAA-0AB00AB20AB30AB5-0AB90ABD0AD00AE00AE10B05-0B0C0B0F0B100B13-0B280B2A-0B300B320B330B35-0B390B3D0B5C0B5D0B5F-0B610B710B830B85-0B8A0B8E-0B900B92-0B950B990B9A0B9C0B9E0B9F0BA30BA40BA8-0BAA0BAE-0BB90BD00C05-0C0C0C0E-0C100C12-0C280C2A-0C330C35-0C390C3D0C580C590C600C610C85-0C8C0C8E-0C900C92-0CA80CAA-0CB30CB5-0CB90CBD0CDE0CE00CE10CF10CF20D05-0D0C0D0E-0D100D12-0D3A0D3D0D4E0D600D610D7A-0D7F0D85-0D960D9A-0DB10DB3-0DBB0DBD0DC0-0DC60E01-0E300E320E330E40-0E460E810E820E840E870E880E8A0E8D0E94-0E970E99-0E9F0EA1-0EA30EA50EA70EAA0EAB0EAD-0EB00EB20EB30EBD0EC0-0EC40EC60EDC-0EDF0F000F40-0F470F49-0F6C0F88-0F8C1000-102A103F1050-1055105A-105D106110651066106E-10701075-1081108E10A0-10C510C710CD10D0-10FA10FC-1248124A-124D1250-12561258125A-125D1260-1288128A-128D1290-12B012B2-12B512B8-12BE12C012C2-12C512C8-12D612D8-13101312-13151318-135A1380-138F13A0-13F41401-166C166F-167F1681-169A16A0-16EA1700-170C170E-17111720-17311740-17511760-176C176E-17701780-17B317D717DC1820-18771880-18A818AA18B0-18F51900-191C1950-196D1970-19741980-19AB19C1-19C71A00-1A161A20-1A541AA71B05-1B331B45-1B4B1B83-1BA01BAE1BAF1BBA-1BE51C00-1C231C4D-1C4F1C5A-1C7D1CE9-1CEC1CEE-1CF11CF51CF61D00-1DBF1E00-1F151F18-1F1D1F20-1F451F48-1F4D1F50-1F571F591F5B1F5D1F5F-1F7D1F80-1FB41FB6-1FBC1FBE1FC2-1FC41FC6-1FCC1FD0-1FD31FD6-1FDB1FE0-1FEC1FF2-1FF41FF6-1FFC2071207F2090-209C21022107210A-211321152119-211D212421262128212A-212D212F-2139213C-213F2145-2149214E218321842C00-2C2E2C30-2C5E2C60-2CE42CEB-2CEE2CF22CF32D00-2D252D272D2D2D30-2D672D6F2D80-2D962DA0-2DA62DA8-2DAE2DB0-2DB62DB8-2DBE2DC0-2DC62DC8-2DCE2DD0-2DD62DD8-2DDE2E2F300530063031-3035303B303C3041-3096309D-309F30A1-30FA30FC-30FF3105-312D3131-318E31A0-31BA31F0-31FF3400-4DB54E00-9FCCA000-A48CA4D0-A4FDA500-A60CA610-A61FA62AA62BA640-A66EA67F-A697A6A0-A6E5A717-A71FA722-A788A78B-A78EA790-A793A7A0-A7AAA7F8-A801A803-A805A807-A80AA80C-A822A840-A873A882-A8B3A8F2-A8F7A8FBA90A-A925A930-A946A960-A97CA984-A9B2A9CFAA00-AA28AA40-AA42AA44-AA4BAA60-AA76AA7AAA80-AAAFAAB1AAB5AAB6AAB9-AABDAAC0AAC2AADB-AADDAAE0-AAEAAAF2-AAF4AB01-AB06AB09-AB0EAB11-AB16AB20-AB26AB28-AB2EABC0-ABE2AC00-D7A3D7B0-D7C6D7CB-D7FBF900-FA6DFA70-FAD9FB00-FB06FB13-FB17FB1DFB1F-FB28FB2A-FB36FB38-FB3CFB3EFB40FB41FB43FB44FB46-FBB1FBD3-FD3DFD50-FD8FFD92-FDC7FDF0-FDFBFE70-FE74FE76-FEFCFF21-FF3AFF41-FF5AFF66-FFBEFFC2-FFC7FFCA-FFCFFFD2-FFD7FFDA-FFDC"
    }, {
        L: "Letter"
    });

/* Adds Unicode property syntax to XRegExp: \p{..}, \P{..}, \p{^..}
 */
    XRegExp.addToken(
        /\\([pP]){(\^?)([^}]*)}/,
        function (match, scope) {
            var inv = (match[1] === "P" || match[2]) ? "^" : "",
                item = slug(match[3]);
            // The double negative \P{^..} is invalid
            if (match[1] === "P" && match[2]) {
                throw new SyntaxError("invalid double negation \\P{^");
            }
            if (!unicode.hasOwnProperty(item)) {
                throw new SyntaxError("invalid or unknown Unicode property " + match[0]);
            }
            return scope === "class" ?
                    (inv ? cacheInversion(item) : unicode[item]) :
                    "[" + inv + unicode[item] + "]";
        },
        {scope: "all"}
    );

}(XRegExp));


/***** unicode-categories.js *****/

/*!
 * XRegExp Unicode Categories v1.2.0
 * (c) 2010-2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 * Uses Unicode 6.1 <http://unicode.org/>
 */

/**
 * Adds support for all Unicode categories (aka properties) E.g., `\p{Lu}` or
 * `\p{Uppercase Letter}`. Token names are case insensitive, and any spaces, hyphens, and
 * underscores are ignored.
 * @requires XRegExp, XRegExp Unicode Base
 */
(function (XRegExp) {
    "use strict";

    if (!XRegExp.addUnicodePackage) {
        throw new ReferenceError("Unicode Base must be loaded before Unicode Categories");
    }

    XRegExp.install("extensibility");

    XRegExp.addUnicodePackage({
        //L: "", // Included in the Unicode Base addon
        Ll: "0061-007A00B500DF-00F600F8-00FF01010103010501070109010B010D010F01110113011501170119011B011D011F01210123012501270129012B012D012F01310133013501370138013A013C013E014001420144014601480149014B014D014F01510153015501570159015B015D015F01610163016501670169016B016D016F0171017301750177017A017C017E-0180018301850188018C018D019201950199-019B019E01A101A301A501A801AA01AB01AD01B001B401B601B901BA01BD-01BF01C601C901CC01CE01D001D201D401D601D801DA01DC01DD01DF01E101E301E501E701E901EB01ED01EF01F001F301F501F901FB01FD01FF02010203020502070209020B020D020F02110213021502170219021B021D021F02210223022502270229022B022D022F02310233-0239023C023F0240024202470249024B024D024F-02930295-02AF037103730377037B-037D039003AC-03CE03D003D103D5-03D703D903DB03DD03DF03E103E303E503E703E903EB03ED03EF-03F303F503F803FB03FC0430-045F04610463046504670469046B046D046F04710473047504770479047B047D047F0481048B048D048F04910493049504970499049B049D049F04A104A304A504A704A904AB04AD04AF04B104B304B504B704B904BB04BD04BF04C204C404C604C804CA04CC04CE04CF04D104D304D504D704D904DB04DD04DF04E104E304E504E704E904EB04ED04EF04F104F304F504F704F904FB04FD04FF05010503050505070509050B050D050F05110513051505170519051B051D051F05210523052505270561-05871D00-1D2B1D6B-1D771D79-1D9A1E011E031E051E071E091E0B1E0D1E0F1E111E131E151E171E191E1B1E1D1E1F1E211E231E251E271E291E2B1E2D1E2F1E311E331E351E371E391E3B1E3D1E3F1E411E431E451E471E491E4B1E4D1E4F1E511E531E551E571E591E5B1E5D1E5F1E611E631E651E671E691E6B1E6D1E6F1E711E731E751E771E791E7B1E7D1E7F1E811E831E851E871E891E8B1E8D1E8F1E911E931E95-1E9D1E9F1EA11EA31EA51EA71EA91EAB1EAD1EAF1EB11EB31EB51EB71EB91EBB1EBD1EBF1EC11EC31EC51EC71EC91ECB1ECD1ECF1ED11ED31ED51ED71ED91EDB1EDD1EDF1EE11EE31EE51EE71EE91EEB1EED1EEF1EF11EF31EF51EF71EF91EFB1EFD1EFF-1F071F10-1F151F20-1F271F30-1F371F40-1F451F50-1F571F60-1F671F70-1F7D1F80-1F871F90-1F971FA0-1FA71FB0-1FB41FB61FB71FBE1FC2-1FC41FC61FC71FD0-1FD31FD61FD71FE0-1FE71FF2-1FF41FF61FF7210A210E210F2113212F21342139213C213D2146-2149214E21842C30-2C5E2C612C652C662C682C6A2C6C2C712C732C742C76-2C7B2C812C832C852C872C892C8B2C8D2C8F2C912C932C952C972C992C9B2C9D2C9F2CA12CA32CA52CA72CA92CAB2CAD2CAF2CB12CB32CB52CB72CB92CBB2CBD2CBF2CC12CC32CC52CC72CC92CCB2CCD2CCF2CD12CD32CD52CD72CD92CDB2CDD2CDF2CE12CE32CE42CEC2CEE2CF32D00-2D252D272D2DA641A643A645A647A649A64BA64DA64FA651A653A655A657A659A65BA65DA65FA661A663A665A667A669A66BA66DA681A683A685A687A689A68BA68DA68FA691A693A695A697A723A725A727A729A72BA72DA72F-A731A733A735A737A739A73BA73DA73FA741A743A745A747A749A74BA74DA74FA751A753A755A757A759A75BA75DA75FA761A763A765A767A769A76BA76DA76FA771-A778A77AA77CA77FA781A783A785A787A78CA78EA791A793A7A1A7A3A7A5A7A7A7A9A7FAFB00-FB06FB13-FB17FF41-FF5A",
        Lu: "0041-005A00C0-00D600D8-00DE01000102010401060108010A010C010E01100112011401160118011A011C011E01200122012401260128012A012C012E01300132013401360139013B013D013F0141014301450147014A014C014E01500152015401560158015A015C015E01600162016401660168016A016C016E017001720174017601780179017B017D018101820184018601870189-018B018E-0191019301940196-0198019C019D019F01A001A201A401A601A701A901AC01AE01AF01B1-01B301B501B701B801BC01C401C701CA01CD01CF01D101D301D501D701D901DB01DE01E001E201E401E601E801EA01EC01EE01F101F401F6-01F801FA01FC01FE02000202020402060208020A020C020E02100212021402160218021A021C021E02200222022402260228022A022C022E02300232023A023B023D023E02410243-02460248024A024C024E03700372037603860388-038A038C038E038F0391-03A103A3-03AB03CF03D2-03D403D803DA03DC03DE03E003E203E403E603E803EA03EC03EE03F403F703F903FA03FD-042F04600462046404660468046A046C046E04700472047404760478047A047C047E0480048A048C048E04900492049404960498049A049C049E04A004A204A404A604A804AA04AC04AE04B004B204B404B604B804BA04BC04BE04C004C104C304C504C704C904CB04CD04D004D204D404D604D804DA04DC04DE04E004E204E404E604E804EA04EC04EE04F004F204F404F604F804FA04FC04FE05000502050405060508050A050C050E05100512051405160518051A051C051E05200522052405260531-055610A0-10C510C710CD1E001E021E041E061E081E0A1E0C1E0E1E101E121E141E161E181E1A1E1C1E1E1E201E221E241E261E281E2A1E2C1E2E1E301E321E341E361E381E3A1E3C1E3E1E401E421E441E461E481E4A1E4C1E4E1E501E521E541E561E581E5A1E5C1E5E1E601E621E641E661E681E6A1E6C1E6E1E701E721E741E761E781E7A1E7C1E7E1E801E821E841E861E881E8A1E8C1E8E1E901E921E941E9E1EA01EA21EA41EA61EA81EAA1EAC1EAE1EB01EB21EB41EB61EB81EBA1EBC1EBE1EC01EC21EC41EC61EC81ECA1ECC1ECE1ED01ED21ED41ED61ED81EDA1EDC1EDE1EE01EE21EE41EE61EE81EEA1EEC1EEE1EF01EF21EF41EF61EF81EFA1EFC1EFE1F08-1F0F1F18-1F1D1F28-1F2F1F38-1F3F1F48-1F4D1F591F5B1F5D1F5F1F68-1F6F1FB8-1FBB1FC8-1FCB1FD8-1FDB1FE8-1FEC1FF8-1FFB21022107210B-210D2110-211221152119-211D212421262128212A-212D2130-2133213E213F214521832C00-2C2E2C602C62-2C642C672C692C6B2C6D-2C702C722C752C7E-2C802C822C842C862C882C8A2C8C2C8E2C902C922C942C962C982C9A2C9C2C9E2CA02CA22CA42CA62CA82CAA2CAC2CAE2CB02CB22CB42CB62CB82CBA2CBC2CBE2CC02CC22CC42CC62CC82CCA2CCC2CCE2CD02CD22CD42CD62CD82CDA2CDC2CDE2CE02CE22CEB2CED2CF2A640A642A644A646A648A64AA64CA64EA650A652A654A656A658A65AA65CA65EA660A662A664A666A668A66AA66CA680A682A684A686A688A68AA68CA68EA690A692A694A696A722A724A726A728A72AA72CA72EA732A734A736A738A73AA73CA73EA740A742A744A746A748A74AA74CA74EA750A752A754A756A758A75AA75CA75EA760A762A764A766A768A76AA76CA76EA779A77BA77DA77EA780A782A784A786A78BA78DA790A792A7A0A7A2A7A4A7A6A7A8A7AAFF21-FF3A",
        Lt: "01C501C801CB01F21F88-1F8F1F98-1F9F1FA8-1FAF1FBC1FCC1FFC",
        Lm: "02B0-02C102C6-02D102E0-02E402EC02EE0374037A0559064006E506E607F407F507FA081A0824082809710E460EC610FC17D718431AA71C78-1C7D1D2C-1D6A1D781D9B-1DBF2071207F2090-209C2C7C2C7D2D6F2E2F30053031-3035303B309D309E30FC-30FEA015A4F8-A4FDA60CA67FA717-A71FA770A788A7F8A7F9A9CFAA70AADDAAF3AAF4FF70FF9EFF9F",
        Lo: "00AA00BA01BB01C0-01C3029405D0-05EA05F0-05F20620-063F0641-064A066E066F0671-06D306D506EE06EF06FA-06FC06FF07100712-072F074D-07A507B107CA-07EA0800-08150840-085808A008A2-08AC0904-0939093D09500958-09610972-09770979-097F0985-098C098F09900993-09A809AA-09B009B209B6-09B909BD09CE09DC09DD09DF-09E109F009F10A05-0A0A0A0F0A100A13-0A280A2A-0A300A320A330A350A360A380A390A59-0A5C0A5E0A72-0A740A85-0A8D0A8F-0A910A93-0AA80AAA-0AB00AB20AB30AB5-0AB90ABD0AD00AE00AE10B05-0B0C0B0F0B100B13-0B280B2A-0B300B320B330B35-0B390B3D0B5C0B5D0B5F-0B610B710B830B85-0B8A0B8E-0B900B92-0B950B990B9A0B9C0B9E0B9F0BA30BA40BA8-0BAA0BAE-0BB90BD00C05-0C0C0C0E-0C100C12-0C280C2A-0C330C35-0C390C3D0C580C590C600C610C85-0C8C0C8E-0C900C92-0CA80CAA-0CB30CB5-0CB90CBD0CDE0CE00CE10CF10CF20D05-0D0C0D0E-0D100D12-0D3A0D3D0D4E0D600D610D7A-0D7F0D85-0D960D9A-0DB10DB3-0DBB0DBD0DC0-0DC60E01-0E300E320E330E40-0E450E810E820E840E870E880E8A0E8D0E94-0E970E99-0E9F0EA1-0EA30EA50EA70EAA0EAB0EAD-0EB00EB20EB30EBD0EC0-0EC40EDC-0EDF0F000F40-0F470F49-0F6C0F88-0F8C1000-102A103F1050-1055105A-105D106110651066106E-10701075-1081108E10D0-10FA10FD-1248124A-124D1250-12561258125A-125D1260-1288128A-128D1290-12B012B2-12B512B8-12BE12C012C2-12C512C8-12D612D8-13101312-13151318-135A1380-138F13A0-13F41401-166C166F-167F1681-169A16A0-16EA1700-170C170E-17111720-17311740-17511760-176C176E-17701780-17B317DC1820-18421844-18771880-18A818AA18B0-18F51900-191C1950-196D1970-19741980-19AB19C1-19C71A00-1A161A20-1A541B05-1B331B45-1B4B1B83-1BA01BAE1BAF1BBA-1BE51C00-1C231C4D-1C4F1C5A-1C771CE9-1CEC1CEE-1CF11CF51CF62135-21382D30-2D672D80-2D962DA0-2DA62DA8-2DAE2DB0-2DB62DB8-2DBE2DC0-2DC62DC8-2DCE2DD0-2DD62DD8-2DDE3006303C3041-3096309F30A1-30FA30FF3105-312D3131-318E31A0-31BA31F0-31FF3400-4DB54E00-9FCCA000-A014A016-A48CA4D0-A4F7A500-A60BA610-A61FA62AA62BA66EA6A0-A6E5A7FB-A801A803-A805A807-A80AA80C-A822A840-A873A882-A8B3A8F2-A8F7A8FBA90A-A925A930-A946A960-A97CA984-A9B2AA00-AA28AA40-AA42AA44-AA4BAA60-AA6FAA71-AA76AA7AAA80-AAAFAAB1AAB5AAB6AAB9-AABDAAC0AAC2AADBAADCAAE0-AAEAAAF2AB01-AB06AB09-AB0EAB11-AB16AB20-AB26AB28-AB2EABC0-ABE2AC00-D7A3D7B0-D7C6D7CB-D7FBF900-FA6DFA70-FAD9FB1DFB1F-FB28FB2A-FB36FB38-FB3CFB3EFB40FB41FB43FB44FB46-FBB1FBD3-FD3DFD50-FD8FFD92-FDC7FDF0-FDFBFE70-FE74FE76-FEFCFF66-FF6FFF71-FF9DFFA0-FFBEFFC2-FFC7FFCA-FFCFFFD2-FFD7FFDA-FFDC",
        M: "0300-036F0483-04890591-05BD05BF05C105C205C405C505C70610-061A064B-065F067006D6-06DC06DF-06E406E706E806EA-06ED07110730-074A07A6-07B007EB-07F30816-0819081B-08230825-08270829-082D0859-085B08E4-08FE0900-0903093A-093C093E-094F0951-0957096209630981-098309BC09BE-09C409C709C809CB-09CD09D709E209E30A01-0A030A3C0A3E-0A420A470A480A4B-0A4D0A510A700A710A750A81-0A830ABC0ABE-0AC50AC7-0AC90ACB-0ACD0AE20AE30B01-0B030B3C0B3E-0B440B470B480B4B-0B4D0B560B570B620B630B820BBE-0BC20BC6-0BC80BCA-0BCD0BD70C01-0C030C3E-0C440C46-0C480C4A-0C4D0C550C560C620C630C820C830CBC0CBE-0CC40CC6-0CC80CCA-0CCD0CD50CD60CE20CE30D020D030D3E-0D440D46-0D480D4A-0D4D0D570D620D630D820D830DCA0DCF-0DD40DD60DD8-0DDF0DF20DF30E310E34-0E3A0E47-0E4E0EB10EB4-0EB90EBB0EBC0EC8-0ECD0F180F190F350F370F390F3E0F3F0F71-0F840F860F870F8D-0F970F99-0FBC0FC6102B-103E1056-1059105E-10601062-10641067-106D1071-10741082-108D108F109A-109D135D-135F1712-17141732-1734175217531772177317B4-17D317DD180B-180D18A91920-192B1930-193B19B0-19C019C819C91A17-1A1B1A55-1A5E1A60-1A7C1A7F1B00-1B041B34-1B441B6B-1B731B80-1B821BA1-1BAD1BE6-1BF31C24-1C371CD0-1CD21CD4-1CE81CED1CF2-1CF41DC0-1DE61DFC-1DFF20D0-20F02CEF-2CF12D7F2DE0-2DFF302A-302F3099309AA66F-A672A674-A67DA69FA6F0A6F1A802A806A80BA823-A827A880A881A8B4-A8C4A8E0-A8F1A926-A92DA947-A953A980-A983A9B3-A9C0AA29-AA36AA43AA4CAA4DAA7BAAB0AAB2-AAB4AAB7AAB8AABEAABFAAC1AAEB-AAEFAAF5AAF6ABE3-ABEAABECABEDFB1EFE00-FE0FFE20-FE26",
        Mn: "0300-036F0483-04870591-05BD05BF05C105C205C405C505C70610-061A064B-065F067006D6-06DC06DF-06E406E706E806EA-06ED07110730-074A07A6-07B007EB-07F30816-0819081B-08230825-08270829-082D0859-085B08E4-08FE0900-0902093A093C0941-0948094D0951-095709620963098109BC09C1-09C409CD09E209E30A010A020A3C0A410A420A470A480A4B-0A4D0A510A700A710A750A810A820ABC0AC1-0AC50AC70AC80ACD0AE20AE30B010B3C0B3F0B41-0B440B4D0B560B620B630B820BC00BCD0C3E-0C400C46-0C480C4A-0C4D0C550C560C620C630CBC0CBF0CC60CCC0CCD0CE20CE30D41-0D440D4D0D620D630DCA0DD2-0DD40DD60E310E34-0E3A0E47-0E4E0EB10EB4-0EB90EBB0EBC0EC8-0ECD0F180F190F350F370F390F71-0F7E0F80-0F840F860F870F8D-0F970F99-0FBC0FC6102D-10301032-10371039103A103D103E10581059105E-10601071-1074108210851086108D109D135D-135F1712-17141732-1734175217531772177317B417B517B7-17BD17C617C9-17D317DD180B-180D18A91920-19221927192819321939-193B1A171A181A561A58-1A5E1A601A621A65-1A6C1A73-1A7C1A7F1B00-1B031B341B36-1B3A1B3C1B421B6B-1B731B801B811BA2-1BA51BA81BA91BAB1BE61BE81BE91BED1BEF-1BF11C2C-1C331C361C371CD0-1CD21CD4-1CE01CE2-1CE81CED1CF41DC0-1DE61DFC-1DFF20D0-20DC20E120E5-20F02CEF-2CF12D7F2DE0-2DFF302A-302D3099309AA66FA674-A67DA69FA6F0A6F1A802A806A80BA825A826A8C4A8E0-A8F1A926-A92DA947-A951A980-A982A9B3A9B6-A9B9A9BCAA29-AA2EAA31AA32AA35AA36AA43AA4CAAB0AAB2-AAB4AAB7AAB8AABEAABFAAC1AAECAAEDAAF6ABE5ABE8ABEDFB1EFE00-FE0FFE20-FE26",
        Mc: "0903093B093E-09400949-094C094E094F0982098309BE-09C009C709C809CB09CC09D70A030A3E-0A400A830ABE-0AC00AC90ACB0ACC0B020B030B3E0B400B470B480B4B0B4C0B570BBE0BBF0BC10BC20BC6-0BC80BCA-0BCC0BD70C01-0C030C41-0C440C820C830CBE0CC0-0CC40CC70CC80CCA0CCB0CD50CD60D020D030D3E-0D400D46-0D480D4A-0D4C0D570D820D830DCF-0DD10DD8-0DDF0DF20DF30F3E0F3F0F7F102B102C10311038103B103C105610571062-10641067-106D108310841087-108C108F109A-109C17B617BE-17C517C717C81923-19261929-192B193019311933-193819B0-19C019C819C91A19-1A1B1A551A571A611A631A641A6D-1A721B041B351B3B1B3D-1B411B431B441B821BA11BA61BA71BAA1BAC1BAD1BE71BEA-1BEC1BEE1BF21BF31C24-1C2B1C341C351CE11CF21CF3302E302FA823A824A827A880A881A8B4-A8C3A952A953A983A9B4A9B5A9BAA9BBA9BD-A9C0AA2FAA30AA33AA34AA4DAA7BAAEBAAEEAAEFAAF5ABE3ABE4ABE6ABE7ABE9ABEAABEC",
        Me: "0488048920DD-20E020E2-20E4A670-A672",
        N: "0030-003900B200B300B900BC-00BE0660-066906F0-06F907C0-07C90966-096F09E6-09EF09F4-09F90A66-0A6F0AE6-0AEF0B66-0B6F0B72-0B770BE6-0BF20C66-0C6F0C78-0C7E0CE6-0CEF0D66-0D750E50-0E590ED0-0ED90F20-0F331040-10491090-10991369-137C16EE-16F017E0-17E917F0-17F91810-18191946-194F19D0-19DA1A80-1A891A90-1A991B50-1B591BB0-1BB91C40-1C491C50-1C5920702074-20792080-20892150-21822185-21892460-249B24EA-24FF2776-27932CFD30073021-30293038-303A3192-31953220-32293248-324F3251-325F3280-328932B1-32BFA620-A629A6E6-A6EFA830-A835A8D0-A8D9A900-A909A9D0-A9D9AA50-AA59ABF0-ABF9FF10-FF19",
        Nd: "0030-00390660-066906F0-06F907C0-07C90966-096F09E6-09EF0A66-0A6F0AE6-0AEF0B66-0B6F0BE6-0BEF0C66-0C6F0CE6-0CEF0D66-0D6F0E50-0E590ED0-0ED90F20-0F291040-10491090-109917E0-17E91810-18191946-194F19D0-19D91A80-1A891A90-1A991B50-1B591BB0-1BB91C40-1C491C50-1C59A620-A629A8D0-A8D9A900-A909A9D0-A9D9AA50-AA59ABF0-ABF9FF10-FF19",
        Nl: "16EE-16F02160-21822185-218830073021-30293038-303AA6E6-A6EF",
        No: "00B200B300B900BC-00BE09F4-09F90B72-0B770BF0-0BF20C78-0C7E0D70-0D750F2A-0F331369-137C17F0-17F919DA20702074-20792080-20892150-215F21892460-249B24EA-24FF2776-27932CFD3192-31953220-32293248-324F3251-325F3280-328932B1-32BFA830-A835",
        P: "0021-00230025-002A002C-002F003A003B003F0040005B-005D005F007B007D00A100A700AB00B600B700BB00BF037E0387055A-055F0589058A05BE05C005C305C605F305F40609060A060C060D061B061E061F066A-066D06D40700-070D07F7-07F90830-083E085E0964096509700AF00DF40E4F0E5A0E5B0F04-0F120F140F3A-0F3D0F850FD0-0FD40FD90FDA104A-104F10FB1360-13681400166D166E169B169C16EB-16ED1735173617D4-17D617D8-17DA1800-180A194419451A1E1A1F1AA0-1AA61AA8-1AAD1B5A-1B601BFC-1BFF1C3B-1C3F1C7E1C7F1CC0-1CC71CD32010-20272030-20432045-20512053-205E207D207E208D208E2329232A2768-277527C527C627E6-27EF2983-299829D8-29DB29FC29FD2CF9-2CFC2CFE2CFF2D702E00-2E2E2E30-2E3B3001-30033008-30113014-301F3030303D30A030FBA4FEA4FFA60D-A60FA673A67EA6F2-A6F7A874-A877A8CEA8CFA8F8-A8FAA92EA92FA95FA9C1-A9CDA9DEA9DFAA5C-AA5FAADEAADFAAF0AAF1ABEBFD3EFD3FFE10-FE19FE30-FE52FE54-FE61FE63FE68FE6AFE6BFF01-FF03FF05-FF0AFF0C-FF0FFF1AFF1BFF1FFF20FF3B-FF3DFF3FFF5BFF5DFF5F-FF65",
        Pd: "002D058A05BE140018062010-20152E172E1A2E3A2E3B301C303030A0FE31FE32FE58FE63FF0D",
        Ps: "0028005B007B0F3A0F3C169B201A201E2045207D208D23292768276A276C276E27702772277427C527E627E827EA27EC27EE2983298529872989298B298D298F299129932995299729D829DA29FC2E222E242E262E283008300A300C300E3010301430163018301A301DFD3EFE17FE35FE37FE39FE3BFE3DFE3FFE41FE43FE47FE59FE5BFE5DFF08FF3BFF5BFF5FFF62",
        Pe: "0029005D007D0F3B0F3D169C2046207E208E232A2769276B276D276F27712773277527C627E727E927EB27ED27EF298429862988298A298C298E2990299229942996299829D929DB29FD2E232E252E272E293009300B300D300F3011301530173019301B301E301FFD3FFE18FE36FE38FE3AFE3CFE3EFE40FE42FE44FE48FE5AFE5CFE5EFF09FF3DFF5DFF60FF63",
        Pi: "00AB2018201B201C201F20392E022E042E092E0C2E1C2E20",
        Pf: "00BB2019201D203A2E032E052E0A2E0D2E1D2E21",
        Pc: "005F203F20402054FE33FE34FE4D-FE4FFF3F",
        Po: "0021-00230025-0027002A002C002E002F003A003B003F0040005C00A100A700B600B700BF037E0387055A-055F058905C005C305C605F305F40609060A060C060D061B061E061F066A-066D06D40700-070D07F7-07F90830-083E085E0964096509700AF00DF40E4F0E5A0E5B0F04-0F120F140F850FD0-0FD40FD90FDA104A-104F10FB1360-1368166D166E16EB-16ED1735173617D4-17D617D8-17DA1800-18051807-180A194419451A1E1A1F1AA0-1AA61AA8-1AAD1B5A-1B601BFC-1BFF1C3B-1C3F1C7E1C7F1CC0-1CC71CD3201620172020-20272030-2038203B-203E2041-20432047-205120532055-205E2CF9-2CFC2CFE2CFF2D702E002E012E06-2E082E0B2E0E-2E162E182E192E1B2E1E2E1F2E2A-2E2E2E30-2E393001-3003303D30FBA4FEA4FFA60D-A60FA673A67EA6F2-A6F7A874-A877A8CEA8CFA8F8-A8FAA92EA92FA95FA9C1-A9CDA9DEA9DFAA5C-AA5FAADEAADFAAF0AAF1ABEBFE10-FE16FE19FE30FE45FE46FE49-FE4CFE50-FE52FE54-FE57FE5F-FE61FE68FE6AFE6BFF01-FF03FF05-FF07FF0AFF0CFF0EFF0FFF1AFF1BFF1FFF20FF3CFF61FF64FF65",
        S: "0024002B003C-003E005E0060007C007E00A2-00A600A800A900AC00AE-00B100B400B800D700F702C2-02C502D2-02DF02E5-02EB02ED02EF-02FF03750384038503F60482058F0606-0608060B060E060F06DE06E906FD06FE07F609F209F309FA09FB0AF10B700BF3-0BFA0C7F0D790E3F0F01-0F030F130F15-0F170F1A-0F1F0F340F360F380FBE-0FC50FC7-0FCC0FCE0FCF0FD5-0FD8109E109F1390-139917DB194019DE-19FF1B61-1B6A1B74-1B7C1FBD1FBF-1FC11FCD-1FCF1FDD-1FDF1FED-1FEF1FFD1FFE20442052207A-207C208A-208C20A0-20B9210021012103-21062108210921142116-2118211E-2123212521272129212E213A213B2140-2144214A-214D214F2190-2328232B-23F32400-24262440-244A249C-24E92500-26FF2701-27672794-27C427C7-27E527F0-29822999-29D729DC-29FB29FE-2B4C2B50-2B592CE5-2CEA2E80-2E992E9B-2EF32F00-2FD52FF0-2FFB300430123013302030363037303E303F309B309C319031913196-319F31C0-31E33200-321E322A-324732503260-327F328A-32B032C0-32FE3300-33FF4DC0-4DFFA490-A4C6A700-A716A720A721A789A78AA828-A82BA836-A839AA77-AA79FB29FBB2-FBC1FDFCFDFDFE62FE64-FE66FE69FF04FF0BFF1C-FF1EFF3EFF40FF5CFF5EFFE0-FFE6FFE8-FFEEFFFCFFFD",
        Sm: "002B003C-003E007C007E00AC00B100D700F703F60606-060820442052207A-207C208A-208C21182140-2144214B2190-2194219A219B21A021A321A621AE21CE21CF21D221D421F4-22FF2308-230B23202321237C239B-23B323DC-23E125B725C125F8-25FF266F27C0-27C427C7-27E527F0-27FF2900-29822999-29D729DC-29FB29FE-2AFF2B30-2B442B47-2B4CFB29FE62FE64-FE66FF0BFF1C-FF1EFF5CFF5EFFE2FFE9-FFEC",
        Sc: "002400A2-00A5058F060B09F209F309FB0AF10BF90E3F17DB20A0-20B9A838FDFCFE69FF04FFE0FFE1FFE5FFE6",
        Sk: "005E006000A800AF00B400B802C2-02C502D2-02DF02E5-02EB02ED02EF-02FF0375038403851FBD1FBF-1FC11FCD-1FCF1FDD-1FDF1FED-1FEF1FFD1FFE309B309CA700-A716A720A721A789A78AFBB2-FBC1FF3EFF40FFE3",
        So: "00A600A900AE00B00482060E060F06DE06E906FD06FE07F609FA0B700BF3-0BF80BFA0C7F0D790F01-0F030F130F15-0F170F1A-0F1F0F340F360F380FBE-0FC50FC7-0FCC0FCE0FCF0FD5-0FD8109E109F1390-1399194019DE-19FF1B61-1B6A1B74-1B7C210021012103-210621082109211421162117211E-2123212521272129212E213A213B214A214C214D214F2195-2199219C-219F21A121A221A421A521A7-21AD21AF-21CD21D021D121D321D5-21F32300-2307230C-231F2322-2328232B-237B237D-239A23B4-23DB23E2-23F32400-24262440-244A249C-24E92500-25B625B8-25C025C2-25F72600-266E2670-26FF2701-27672794-27BF2800-28FF2B00-2B2F2B452B462B50-2B592CE5-2CEA2E80-2E992E9B-2EF32F00-2FD52FF0-2FFB300430123013302030363037303E303F319031913196-319F31C0-31E33200-321E322A-324732503260-327F328A-32B032C0-32FE3300-33FF4DC0-4DFFA490-A4C6A828-A82BA836A837A839AA77-AA79FDFDFFE4FFE8FFEDFFEEFFFCFFFD",
        Z: "002000A01680180E2000-200A20282029202F205F3000",
        Zs: "002000A01680180E2000-200A202F205F3000",
        Zl: "2028",
        Zp: "2029",
        C: "0000-001F007F-009F00AD03780379037F-0383038B038D03A20528-05300557055805600588058B-058E059005C8-05CF05EB-05EF05F5-0605061C061D06DD070E070F074B074C07B2-07BF07FB-07FF082E082F083F085C085D085F-089F08A108AD-08E308FF097809800984098D098E0991099209A909B109B3-09B509BA09BB09C509C609C909CA09CF-09D609D8-09DB09DE09E409E509FC-0A000A040A0B-0A0E0A110A120A290A310A340A370A3A0A3B0A3D0A43-0A460A490A4A0A4E-0A500A52-0A580A5D0A5F-0A650A76-0A800A840A8E0A920AA90AB10AB40ABA0ABB0AC60ACA0ACE0ACF0AD1-0ADF0AE40AE50AF2-0B000B040B0D0B0E0B110B120B290B310B340B3A0B3B0B450B460B490B4A0B4E-0B550B58-0B5B0B5E0B640B650B78-0B810B840B8B-0B8D0B910B96-0B980B9B0B9D0BA0-0BA20BA5-0BA70BAB-0BAD0BBA-0BBD0BC3-0BC50BC90BCE0BCF0BD1-0BD60BD8-0BE50BFB-0C000C040C0D0C110C290C340C3A-0C3C0C450C490C4E-0C540C570C5A-0C5F0C640C650C70-0C770C800C810C840C8D0C910CA90CB40CBA0CBB0CC50CC90CCE-0CD40CD7-0CDD0CDF0CE40CE50CF00CF3-0D010D040D0D0D110D3B0D3C0D450D490D4F-0D560D58-0D5F0D640D650D76-0D780D800D810D840D97-0D990DB20DBC0DBE0DBF0DC7-0DC90DCB-0DCE0DD50DD70DE0-0DF10DF5-0E000E3B-0E3E0E5C-0E800E830E850E860E890E8B0E8C0E8E-0E930E980EA00EA40EA60EA80EA90EAC0EBA0EBE0EBF0EC50EC70ECE0ECF0EDA0EDB0EE0-0EFF0F480F6D-0F700F980FBD0FCD0FDB-0FFF10C610C8-10CC10CE10CF1249124E124F12571259125E125F1289128E128F12B112B612B712BF12C112C612C712D7131113161317135B135C137D-137F139A-139F13F5-13FF169D-169F16F1-16FF170D1715-171F1737-173F1754-175F176D17711774-177F17DE17DF17EA-17EF17FA-17FF180F181A-181F1878-187F18AB-18AF18F6-18FF191D-191F192C-192F193C-193F1941-1943196E196F1975-197F19AC-19AF19CA-19CF19DB-19DD1A1C1A1D1A5F1A7D1A7E1A8A-1A8F1A9A-1A9F1AAE-1AFF1B4C-1B4F1B7D-1B7F1BF4-1BFB1C38-1C3A1C4A-1C4C1C80-1CBF1CC8-1CCF1CF7-1CFF1DE7-1DFB1F161F171F1E1F1F1F461F471F4E1F4F1F581F5A1F5C1F5E1F7E1F7F1FB51FC51FD41FD51FDC1FF01FF11FF51FFF200B-200F202A-202E2060-206F20722073208F209D-209F20BA-20CF20F1-20FF218A-218F23F4-23FF2427-243F244B-245F27002B4D-2B4F2B5A-2BFF2C2F2C5F2CF4-2CF82D262D28-2D2C2D2E2D2F2D68-2D6E2D71-2D7E2D97-2D9F2DA72DAF2DB72DBF2DC72DCF2DD72DDF2E3C-2E7F2E9A2EF4-2EFF2FD6-2FEF2FFC-2FFF3040309730983100-3104312E-3130318F31BB-31BF31E4-31EF321F32FF4DB6-4DBF9FCD-9FFFA48D-A48FA4C7-A4CFA62C-A63FA698-A69EA6F8-A6FFA78FA794-A79FA7AB-A7F7A82C-A82FA83A-A83FA878-A87FA8C5-A8CDA8DA-A8DFA8FC-A8FFA954-A95EA97D-A97FA9CEA9DA-A9DDA9E0-A9FFAA37-AA3FAA4EAA4FAA5AAA5BAA7C-AA7FAAC3-AADAAAF7-AB00AB07AB08AB0FAB10AB17-AB1FAB27AB2F-ABBFABEEABEFABFA-ABFFD7A4-D7AFD7C7-D7CAD7FC-F8FFFA6EFA6FFADA-FAFFFB07-FB12FB18-FB1CFB37FB3DFB3FFB42FB45FBC2-FBD2FD40-FD4FFD90FD91FDC8-FDEFFDFEFDFFFE1A-FE1FFE27-FE2FFE53FE67FE6C-FE6FFE75FEFD-FF00FFBF-FFC1FFC8FFC9FFD0FFD1FFD8FFD9FFDD-FFDFFFE7FFEF-FFFBFFFEFFFF",
        Cc: "0000-001F007F-009F",
        Cf: "00AD0600-060406DD070F200B-200F202A-202E2060-2064206A-206FFEFFFFF9-FFFB",
        Co: "E000-F8FF",
        Cs: "D800-DFFF",
        Cn: "03780379037F-0383038B038D03A20528-05300557055805600588058B-058E059005C8-05CF05EB-05EF05F5-05FF0605061C061D070E074B074C07B2-07BF07FB-07FF082E082F083F085C085D085F-089F08A108AD-08E308FF097809800984098D098E0991099209A909B109B3-09B509BA09BB09C509C609C909CA09CF-09D609D8-09DB09DE09E409E509FC-0A000A040A0B-0A0E0A110A120A290A310A340A370A3A0A3B0A3D0A43-0A460A490A4A0A4E-0A500A52-0A580A5D0A5F-0A650A76-0A800A840A8E0A920AA90AB10AB40ABA0ABB0AC60ACA0ACE0ACF0AD1-0ADF0AE40AE50AF2-0B000B040B0D0B0E0B110B120B290B310B340B3A0B3B0B450B460B490B4A0B4E-0B550B58-0B5B0B5E0B640B650B78-0B810B840B8B-0B8D0B910B96-0B980B9B0B9D0BA0-0BA20BA5-0BA70BAB-0BAD0BBA-0BBD0BC3-0BC50BC90BCE0BCF0BD1-0BD60BD8-0BE50BFB-0C000C040C0D0C110C290C340C3A-0C3C0C450C490C4E-0C540C570C5A-0C5F0C640C650C70-0C770C800C810C840C8D0C910CA90CB40CBA0CBB0CC50CC90CCE-0CD40CD7-0CDD0CDF0CE40CE50CF00CF3-0D010D040D0D0D110D3B0D3C0D450D490D4F-0D560D58-0D5F0D640D650D76-0D780D800D810D840D97-0D990DB20DBC0DBE0DBF0DC7-0DC90DCB-0DCE0DD50DD70DE0-0DF10DF5-0E000E3B-0E3E0E5C-0E800E830E850E860E890E8B0E8C0E8E-0E930E980EA00EA40EA60EA80EA90EAC0EBA0EBE0EBF0EC50EC70ECE0ECF0EDA0EDB0EE0-0EFF0F480F6D-0F700F980FBD0FCD0FDB-0FFF10C610C8-10CC10CE10CF1249124E124F12571259125E125F1289128E128F12B112B612B712BF12C112C612C712D7131113161317135B135C137D-137F139A-139F13F5-13FF169D-169F16F1-16FF170D1715-171F1737-173F1754-175F176D17711774-177F17DE17DF17EA-17EF17FA-17FF180F181A-181F1878-187F18AB-18AF18F6-18FF191D-191F192C-192F193C-193F1941-1943196E196F1975-197F19AC-19AF19CA-19CF19DB-19DD1A1C1A1D1A5F1A7D1A7E1A8A-1A8F1A9A-1A9F1AAE-1AFF1B4C-1B4F1B7D-1B7F1BF4-1BFB1C38-1C3A1C4A-1C4C1C80-1CBF1CC8-1CCF1CF7-1CFF1DE7-1DFB1F161F171F1E1F1F1F461F471F4E1F4F1F581F5A1F5C1F5E1F7E1F7F1FB51FC51FD41FD51FDC1FF01FF11FF51FFF2065-206920722073208F209D-209F20BA-20CF20F1-20FF218A-218F23F4-23FF2427-243F244B-245F27002B4D-2B4F2B5A-2BFF2C2F2C5F2CF4-2CF82D262D28-2D2C2D2E2D2F2D68-2D6E2D71-2D7E2D97-2D9F2DA72DAF2DB72DBF2DC72DCF2DD72DDF2E3C-2E7F2E9A2EF4-2EFF2FD6-2FEF2FFC-2FFF3040309730983100-3104312E-3130318F31BB-31BF31E4-31EF321F32FF4DB6-4DBF9FCD-9FFFA48D-A48FA4C7-A4CFA62C-A63FA698-A69EA6F8-A6FFA78FA794-A79FA7AB-A7F7A82C-A82FA83A-A83FA878-A87FA8C5-A8CDA8DA-A8DFA8FC-A8FFA954-A95EA97D-A97FA9CEA9DA-A9DDA9E0-A9FFAA37-AA3FAA4EAA4FAA5AAA5BAA7C-AA7FAAC3-AADAAAF7-AB00AB07AB08AB0FAB10AB17-AB1FAB27AB2F-ABBFABEEABEFABFA-ABFFD7A4-D7AFD7C7-D7CAD7FC-D7FFFA6EFA6FFADA-FAFFFB07-FB12FB18-FB1CFB37FB3DFB3FFB42FB45FBC2-FBD2FD40-FD4FFD90FD91FDC8-FDEFFDFEFDFFFE1A-FE1FFE27-FE2FFE53FE67FE6C-FE6FFE75FEFDFEFEFF00FFBF-FFC1FFC8FFC9FFD0FFD1FFD8FFD9FFDD-FFDFFFE7FFEF-FFF8FFFEFFFF"
    }, {
        //L: "Letter", // Included in the Unicode Base addon
        Ll: "Lowercase_Letter",
        Lu: "Uppercase_Letter",
        Lt: "Titlecase_Letter",
        Lm: "Modifier_Letter",
        Lo: "Other_Letter",
        M: "Mark",
        Mn: "Nonspacing_Mark",
        Mc: "Spacing_Mark",
        Me: "Enclosing_Mark",
        N: "Number",
        Nd: "Decimal_Number",
        Nl: "Letter_Number",
        No: "Other_Number",
        P: "Punctuation",
        Pd: "Dash_Punctuation",
        Ps: "Open_Punctuation",
        Pe: "Close_Punctuation",
        Pi: "Initial_Punctuation",
        Pf: "Final_Punctuation",
        Pc: "Connector_Punctuation",
        Po: "Other_Punctuation",
        S: "Symbol",
        Sm: "Math_Symbol",
        Sc: "Currency_Symbol",
        Sk: "Modifier_Symbol",
        So: "Other_Symbol",
        Z: "Separator",
        Zs: "Space_Separator",
        Zl: "Line_Separator",
        Zp: "Paragraph_Separator",
        C: "Other",
        Cc: "Control",
        Cf: "Format",
        Co: "Private_Use",
        Cs: "Surrogate",
        Cn: "Unassigned"
    });

}(XRegExp));


/***** unicode-scripts.js *****/

/*!
 * XRegExp Unicode Scripts v1.2.0
 * (c) 2010-2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 * Uses Unicode 6.1 <http://unicode.org/>
 */

/**
 * Adds support for all Unicode scripts in the Basic Multilingual Plane (U+0000-U+FFFF).
 * E.g., `\p{Latin}`. Token names are case insensitive, and any spaces, hyphens, and underscores
 * are ignored.
 * @requires XRegExp, XRegExp Unicode Base
 */
(function (XRegExp) {
    "use strict";

    if (!XRegExp.addUnicodePackage) {
        throw new ReferenceError("Unicode Base must be loaded before Unicode Scripts");
    }

    XRegExp.install("extensibility");

    XRegExp.addUnicodePackage({
        Arabic: "0600-06040606-060B060D-061A061E0620-063F0641-064A0656-065E066A-066F0671-06DC06DE-06FF0750-077F08A008A2-08AC08E4-08FEFB50-FBC1FBD3-FD3DFD50-FD8FFD92-FDC7FDF0-FDFCFE70-FE74FE76-FEFC",
        Armenian: "0531-05560559-055F0561-0587058A058FFB13-FB17",
        Balinese: "1B00-1B4B1B50-1B7C",
        Bamum: "A6A0-A6F7",
        Batak: "1BC0-1BF31BFC-1BFF",
        Bengali: "0981-09830985-098C098F09900993-09A809AA-09B009B209B6-09B909BC-09C409C709C809CB-09CE09D709DC09DD09DF-09E309E6-09FB",
        Bopomofo: "02EA02EB3105-312D31A0-31BA",
        Braille: "2800-28FF",
        Buginese: "1A00-1A1B1A1E1A1F",
        Buhid: "1740-1753",
        Canadian_Aboriginal: "1400-167F18B0-18F5",
        Cham: "AA00-AA36AA40-AA4DAA50-AA59AA5C-AA5F",
        Cherokee: "13A0-13F4",
        Common: "0000-0040005B-0060007B-00A900AB-00B900BB-00BF00D700F702B9-02DF02E5-02E902EC-02FF0374037E038503870589060C061B061F06400660-066906DD096409650E3F0FD5-0FD810FB16EB-16ED173517361802180318051CD31CE11CE9-1CEC1CEE-1CF31CF51CF62000-200B200E-2064206A-20702074-207E2080-208E20A0-20B92100-21252127-2129212C-21312133-214D214F-215F21892190-23F32400-24262440-244A2460-26FF2701-27FF2900-2B4C2B50-2B592E00-2E3B2FF0-2FFB3000-300430063008-30203030-3037303C-303F309B309C30A030FB30FC3190-319F31C0-31E33220-325F327F-32CF3358-33FF4DC0-4DFFA700-A721A788-A78AA830-A839FD3EFD3FFDFDFE10-FE19FE30-FE52FE54-FE66FE68-FE6BFEFFFF01-FF20FF3B-FF40FF5B-FF65FF70FF9EFF9FFFE0-FFE6FFE8-FFEEFFF9-FFFD",
        Coptic: "03E2-03EF2C80-2CF32CF9-2CFF",
        Cyrillic: "0400-04840487-05271D2B1D782DE0-2DFFA640-A697A69F",
        Devanagari: "0900-09500953-09630966-09770979-097FA8E0-A8FB",
        Ethiopic: "1200-1248124A-124D1250-12561258125A-125D1260-1288128A-128D1290-12B012B2-12B512B8-12BE12C012C2-12C512C8-12D612D8-13101312-13151318-135A135D-137C1380-13992D80-2D962DA0-2DA62DA8-2DAE2DB0-2DB62DB8-2DBE2DC0-2DC62DC8-2DCE2DD0-2DD62DD8-2DDEAB01-AB06AB09-AB0EAB11-AB16AB20-AB26AB28-AB2E",
        Georgian: "10A0-10C510C710CD10D0-10FA10FC-10FF2D00-2D252D272D2D",
        Glagolitic: "2C00-2C2E2C30-2C5E",
        Greek: "0370-03730375-0377037A-037D038403860388-038A038C038E-03A103A3-03E103F0-03FF1D26-1D2A1D5D-1D611D66-1D6A1DBF1F00-1F151F18-1F1D1F20-1F451F48-1F4D1F50-1F571F591F5B1F5D1F5F-1F7D1F80-1FB41FB6-1FC41FC6-1FD31FD6-1FDB1FDD-1FEF1FF2-1FF41FF6-1FFE2126",
        Gujarati: "0A81-0A830A85-0A8D0A8F-0A910A93-0AA80AAA-0AB00AB20AB30AB5-0AB90ABC-0AC50AC7-0AC90ACB-0ACD0AD00AE0-0AE30AE6-0AF1",
        Gurmukhi: "0A01-0A030A05-0A0A0A0F0A100A13-0A280A2A-0A300A320A330A350A360A380A390A3C0A3E-0A420A470A480A4B-0A4D0A510A59-0A5C0A5E0A66-0A75",
        Han: "2E80-2E992E9B-2EF32F00-2FD5300530073021-30293038-303B3400-4DB54E00-9FCCF900-FA6DFA70-FAD9",
        Hangul: "1100-11FF302E302F3131-318E3200-321E3260-327EA960-A97CAC00-D7A3D7B0-D7C6D7CB-D7FBFFA0-FFBEFFC2-FFC7FFCA-FFCFFFD2-FFD7FFDA-FFDC",
        Hanunoo: "1720-1734",
        Hebrew: "0591-05C705D0-05EA05F0-05F4FB1D-FB36FB38-FB3CFB3EFB40FB41FB43FB44FB46-FB4F",
        Hiragana: "3041-3096309D-309F",
        Inherited: "0300-036F04850486064B-0655065F0670095109521CD0-1CD21CD4-1CE01CE2-1CE81CED1CF41DC0-1DE61DFC-1DFF200C200D20D0-20F0302A-302D3099309AFE00-FE0FFE20-FE26",
        Javanese: "A980-A9CDA9CF-A9D9A9DEA9DF",
        Kannada: "0C820C830C85-0C8C0C8E-0C900C92-0CA80CAA-0CB30CB5-0CB90CBC-0CC40CC6-0CC80CCA-0CCD0CD50CD60CDE0CE0-0CE30CE6-0CEF0CF10CF2",
        Katakana: "30A1-30FA30FD-30FF31F0-31FF32D0-32FE3300-3357FF66-FF6FFF71-FF9D",
        Kayah_Li: "A900-A92F",
        Khmer: "1780-17DD17E0-17E917F0-17F919E0-19FF",
        Lao: "0E810E820E840E870E880E8A0E8D0E94-0E970E99-0E9F0EA1-0EA30EA50EA70EAA0EAB0EAD-0EB90EBB-0EBD0EC0-0EC40EC60EC8-0ECD0ED0-0ED90EDC-0EDF",
        Latin: "0041-005A0061-007A00AA00BA00C0-00D600D8-00F600F8-02B802E0-02E41D00-1D251D2C-1D5C1D62-1D651D6B-1D771D79-1DBE1E00-1EFF2071207F2090-209C212A212B2132214E2160-21882C60-2C7FA722-A787A78B-A78EA790-A793A7A0-A7AAA7F8-A7FFFB00-FB06FF21-FF3AFF41-FF5A",
        Lepcha: "1C00-1C371C3B-1C491C4D-1C4F",
        Limbu: "1900-191C1920-192B1930-193B19401944-194F",
        Lisu: "A4D0-A4FF",
        Malayalam: "0D020D030D05-0D0C0D0E-0D100D12-0D3A0D3D-0D440D46-0D480D4A-0D4E0D570D60-0D630D66-0D750D79-0D7F",
        Mandaic: "0840-085B085E",
        Meetei_Mayek: "AAE0-AAF6ABC0-ABEDABF0-ABF9",
        Mongolian: "1800180118041806-180E1810-18191820-18771880-18AA",
        Myanmar: "1000-109FAA60-AA7B",
        New_Tai_Lue: "1980-19AB19B0-19C919D0-19DA19DE19DF",
        Nko: "07C0-07FA",
        Ogham: "1680-169C",
        Ol_Chiki: "1C50-1C7F",
        Oriya: "0B01-0B030B05-0B0C0B0F0B100B13-0B280B2A-0B300B320B330B35-0B390B3C-0B440B470B480B4B-0B4D0B560B570B5C0B5D0B5F-0B630B66-0B77",
        Phags_Pa: "A840-A877",
        Rejang: "A930-A953A95F",
        Runic: "16A0-16EA16EE-16F0",
        Samaritan: "0800-082D0830-083E",
        Saurashtra: "A880-A8C4A8CE-A8D9",
        Sinhala: "0D820D830D85-0D960D9A-0DB10DB3-0DBB0DBD0DC0-0DC60DCA0DCF-0DD40DD60DD8-0DDF0DF2-0DF4",
        Sundanese: "1B80-1BBF1CC0-1CC7",
        Syloti_Nagri: "A800-A82B",
        Syriac: "0700-070D070F-074A074D-074F",
        Tagalog: "1700-170C170E-1714",
        Tagbanwa: "1760-176C176E-177017721773",
        Tai_Le: "1950-196D1970-1974",
        Tai_Tham: "1A20-1A5E1A60-1A7C1A7F-1A891A90-1A991AA0-1AAD",
        Tai_Viet: "AA80-AAC2AADB-AADF",
        Tamil: "0B820B830B85-0B8A0B8E-0B900B92-0B950B990B9A0B9C0B9E0B9F0BA30BA40BA8-0BAA0BAE-0BB90BBE-0BC20BC6-0BC80BCA-0BCD0BD00BD70BE6-0BFA",
        Telugu: "0C01-0C030C05-0C0C0C0E-0C100C12-0C280C2A-0C330C35-0C390C3D-0C440C46-0C480C4A-0C4D0C550C560C580C590C60-0C630C66-0C6F0C78-0C7F",
        Thaana: "0780-07B1",
        Thai: "0E01-0E3A0E40-0E5B",
        Tibetan: "0F00-0F470F49-0F6C0F71-0F970F99-0FBC0FBE-0FCC0FCE-0FD40FD90FDA",
        Tifinagh: "2D30-2D672D6F2D702D7F",
        Vai: "A500-A62B",
        Yi: "A000-A48CA490-A4C6"
    });

}(XRegExp));


/***** unicode-blocks.js *****/

/*!
 * XRegExp Unicode Blocks v1.2.0
 * (c) 2010-2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 * Uses Unicode 6.1 <http://unicode.org/>
 */

/**
 * Adds support for all Unicode blocks in the Basic Multilingual Plane (U+0000-U+FFFF). Unicode
 * blocks use the prefix "In". E.g., `\p{InBasicLatin}`. Token names are case insensitive, and any
 * spaces, hyphens, and underscores are ignored.
 * @requires XRegExp, XRegExp Unicode Base
 */
(function (XRegExp) {
    "use strict";

    if (!XRegExp.addUnicodePackage) {
        throw new ReferenceError("Unicode Base must be loaded before Unicode Blocks");
    }

    XRegExp.install("extensibility");

    XRegExp.addUnicodePackage({
        InBasic_Latin: "0000-007F",
        InLatin_1_Supplement: "0080-00FF",
        InLatin_Extended_A: "0100-017F",
        InLatin_Extended_B: "0180-024F",
        InIPA_Extensions: "0250-02AF",
        InSpacing_Modifier_Letters: "02B0-02FF",
        InCombining_Diacritical_Marks: "0300-036F",
        InGreek_and_Coptic: "0370-03FF",
        InCyrillic: "0400-04FF",
        InCyrillic_Supplement: "0500-052F",
        InArmenian: "0530-058F",
        InHebrew: "0590-05FF",
        InArabic: "0600-06FF",
        InSyriac: "0700-074F",
        InArabic_Supplement: "0750-077F",
        InThaana: "0780-07BF",
        InNKo: "07C0-07FF",
        InSamaritan: "0800-083F",
        InMandaic: "0840-085F",
        InArabic_Extended_A: "08A0-08FF",
        InDevanagari: "0900-097F",
        InBengali: "0980-09FF",
        InGurmukhi: "0A00-0A7F",
        InGujarati: "0A80-0AFF",
        InOriya: "0B00-0B7F",
        InTamil: "0B80-0BFF",
        InTelugu: "0C00-0C7F",
        InKannada: "0C80-0CFF",
        InMalayalam: "0D00-0D7F",
        InSinhala: "0D80-0DFF",
        InThai: "0E00-0E7F",
        InLao: "0E80-0EFF",
        InTibetan: "0F00-0FFF",
        InMyanmar: "1000-109F",
        InGeorgian: "10A0-10FF",
        InHangul_Jamo: "1100-11FF",
        InEthiopic: "1200-137F",
        InEthiopic_Supplement: "1380-139F",
        InCherokee: "13A0-13FF",
        InUnified_Canadian_Aboriginal_Syllabics: "1400-167F",
        InOgham: "1680-169F",
        InRunic: "16A0-16FF",
        InTagalog: "1700-171F",
        InHanunoo: "1720-173F",
        InBuhid: "1740-175F",
        InTagbanwa: "1760-177F",
        InKhmer: "1780-17FF",
        InMongolian: "1800-18AF",
        InUnified_Canadian_Aboriginal_Syllabics_Extended: "18B0-18FF",
        InLimbu: "1900-194F",
        InTai_Le: "1950-197F",
        InNew_Tai_Lue: "1980-19DF",
        InKhmer_Symbols: "19E0-19FF",
        InBuginese: "1A00-1A1F",
        InTai_Tham: "1A20-1AAF",
        InBalinese: "1B00-1B7F",
        InSundanese: "1B80-1BBF",
        InBatak: "1BC0-1BFF",
        InLepcha: "1C00-1C4F",
        InOl_Chiki: "1C50-1C7F",
        InSundanese_Supplement: "1CC0-1CCF",
        InVedic_Extensions: "1CD0-1CFF",
        InPhonetic_Extensions: "1D00-1D7F",
        InPhonetic_Extensions_Supplement: "1D80-1DBF",
        InCombining_Diacritical_Marks_Supplement: "1DC0-1DFF",
        InLatin_Extended_Additional: "1E00-1EFF",
        InGreek_Extended: "1F00-1FFF",
        InGeneral_Punctuation: "2000-206F",
        InSuperscripts_and_Subscripts: "2070-209F",
        InCurrency_Symbols: "20A0-20CF",
        InCombining_Diacritical_Marks_for_Symbols: "20D0-20FF",
        InLetterlike_Symbols: "2100-214F",
        InNumber_Forms: "2150-218F",
        InArrows: "2190-21FF",
        InMathematical_Operators: "2200-22FF",
        InMiscellaneous_Technical: "2300-23FF",
        InControl_Pictures: "2400-243F",
        InOptical_Character_Recognition: "2440-245F",
        InEnclosed_Alphanumerics: "2460-24FF",
        InBox_Drawing: "2500-257F",
        InBlock_Elements: "2580-259F",
        InGeometric_Shapes: "25A0-25FF",
        InMiscellaneous_Symbols: "2600-26FF",
        InDingbats: "2700-27BF",
        InMiscellaneous_Mathematical_Symbols_A: "27C0-27EF",
        InSupplemental_Arrows_A: "27F0-27FF",
        InBraille_Patterns: "2800-28FF",
        InSupplemental_Arrows_B: "2900-297F",
        InMiscellaneous_Mathematical_Symbols_B: "2980-29FF",
        InSupplemental_Mathematical_Operators: "2A00-2AFF",
        InMiscellaneous_Symbols_and_Arrows: "2B00-2BFF",
        InGlagolitic: "2C00-2C5F",
        InLatin_Extended_C: "2C60-2C7F",
        InCoptic: "2C80-2CFF",
        InGeorgian_Supplement: "2D00-2D2F",
        InTifinagh: "2D30-2D7F",
        InEthiopic_Extended: "2D80-2DDF",
        InCyrillic_Extended_A: "2DE0-2DFF",
        InSupplemental_Punctuation: "2E00-2E7F",
        InCJK_Radicals_Supplement: "2E80-2EFF",
        InKangxi_Radicals: "2F00-2FDF",
        InIdeographic_Description_Characters: "2FF0-2FFF",
        InCJK_Symbols_and_Punctuation: "3000-303F",
        InHiragana: "3040-309F",
        InKatakana: "30A0-30FF",
        InBopomofo: "3100-312F",
        InHangul_Compatibility_Jamo: "3130-318F",
        InKanbun: "3190-319F",
        InBopomofo_Extended: "31A0-31BF",
        InCJK_Strokes: "31C0-31EF",
        InKatakana_Phonetic_Extensions: "31F0-31FF",
        InEnclosed_CJK_Letters_and_Months: "3200-32FF",
        InCJK_Compatibility: "3300-33FF",
        InCJK_Unified_Ideographs_Extension_A: "3400-4DBF",
        InYijing_Hexagram_Symbols: "4DC0-4DFF",
        InCJK_Unified_Ideographs: "4E00-9FFF",
        InYi_Syllables: "A000-A48F",
        InYi_Radicals: "A490-A4CF",
        InLisu: "A4D0-A4FF",
        InVai: "A500-A63F",
        InCyrillic_Extended_B: "A640-A69F",
        InBamum: "A6A0-A6FF",
        InModifier_Tone_Letters: "A700-A71F",
        InLatin_Extended_D: "A720-A7FF",
        InSyloti_Nagri: "A800-A82F",
        InCommon_Indic_Number_Forms: "A830-A83F",
        InPhags_pa: "A840-A87F",
        InSaurashtra: "A880-A8DF",
        InDevanagari_Extended: "A8E0-A8FF",
        InKayah_Li: "A900-A92F",
        InRejang: "A930-A95F",
        InHangul_Jamo_Extended_A: "A960-A97F",
        InJavanese: "A980-A9DF",
        InCham: "AA00-AA5F",
        InMyanmar_Extended_A: "AA60-AA7F",
        InTai_Viet: "AA80-AADF",
        InMeetei_Mayek_Extensions: "AAE0-AAFF",
        InEthiopic_Extended_A: "AB00-AB2F",
        InMeetei_Mayek: "ABC0-ABFF",
        InHangul_Syllables: "AC00-D7AF",
        InHangul_Jamo_Extended_B: "D7B0-D7FF",
        InHigh_Surrogates: "D800-DB7F",
        InHigh_Private_Use_Surrogates: "DB80-DBFF",
        InLow_Surrogates: "DC00-DFFF",
        InPrivate_Use_Area: "E000-F8FF",
        InCJK_Compatibility_Ideographs: "F900-FAFF",
        InAlphabetic_Presentation_Forms: "FB00-FB4F",
        InArabic_Presentation_Forms_A: "FB50-FDFF",
        InVariation_Selectors: "FE00-FE0F",
        InVertical_Forms: "FE10-FE1F",
        InCombining_Half_Marks: "FE20-FE2F",
        InCJK_Compatibility_Forms: "FE30-FE4F",
        InSmall_Form_Variants: "FE50-FE6F",
        InArabic_Presentation_Forms_B: "FE70-FEFF",
        InHalfwidth_and_Fullwidth_Forms: "FF00-FFEF",
        InSpecials: "FFF0-FFFF"
    });

}(XRegExp));


/***** unicode-properties.js *****/

/*!
 * XRegExp Unicode Properties v1.0.0
 * (c) 2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 * Uses Unicode 6.1 <http://unicode.org/>
 */

/**
 * Adds Unicode properties necessary to meet Level 1 Unicode support (detailed in UTS#18 RL1.2).
 * Includes code points from the Basic Multilingual Plane (U+0000-U+FFFF) only. Token names are
 * case insensitive, and any spaces, hyphens, and underscores are ignored.
 * @requires XRegExp, XRegExp Unicode Base
 */
(function (XRegExp) {
    "use strict";

    if (!XRegExp.addUnicodePackage) {
        throw new ReferenceError("Unicode Base must be loaded before Unicode Properties");
    }

    XRegExp.install("extensibility");

    XRegExp.addUnicodePackage({
        Alphabetic: "0041-005A0061-007A00AA00B500BA00C0-00D600D8-00F600F8-02C102C6-02D102E0-02E402EC02EE03450370-037403760377037A-037D03860388-038A038C038E-03A103A3-03F503F7-0481048A-05270531-055605590561-058705B0-05BD05BF05C105C205C405C505C705D0-05EA05F0-05F20610-061A0620-06570659-065F066E-06D306D5-06DC06E1-06E806ED-06EF06FA-06FC06FF0710-073F074D-07B107CA-07EA07F407F507FA0800-0817081A-082C0840-085808A008A2-08AC08E4-08E908F0-08FE0900-093B093D-094C094E-09500955-09630971-09770979-097F0981-09830985-098C098F09900993-09A809AA-09B009B209B6-09B909BD-09C409C709C809CB09CC09CE09D709DC09DD09DF-09E309F009F10A01-0A030A05-0A0A0A0F0A100A13-0A280A2A-0A300A320A330A350A360A380A390A3E-0A420A470A480A4B0A4C0A510A59-0A5C0A5E0A70-0A750A81-0A830A85-0A8D0A8F-0A910A93-0AA80AAA-0AB00AB20AB30AB5-0AB90ABD-0AC50AC7-0AC90ACB0ACC0AD00AE0-0AE30B01-0B030B05-0B0C0B0F0B100B13-0B280B2A-0B300B320B330B35-0B390B3D-0B440B470B480B4B0B4C0B560B570B5C0B5D0B5F-0B630B710B820B830B85-0B8A0B8E-0B900B92-0B950B990B9A0B9C0B9E0B9F0BA30BA40BA8-0BAA0BAE-0BB90BBE-0BC20BC6-0BC80BCA-0BCC0BD00BD70C01-0C030C05-0C0C0C0E-0C100C12-0C280C2A-0C330C35-0C390C3D-0C440C46-0C480C4A-0C4C0C550C560C580C590C60-0C630C820C830C85-0C8C0C8E-0C900C92-0CA80CAA-0CB30CB5-0CB90CBD-0CC40CC6-0CC80CCA-0CCC0CD50CD60CDE0CE0-0CE30CF10CF20D020D030D05-0D0C0D0E-0D100D12-0D3A0D3D-0D440D46-0D480D4A-0D4C0D4E0D570D60-0D630D7A-0D7F0D820D830D85-0D960D9A-0DB10DB3-0DBB0DBD0DC0-0DC60DCF-0DD40DD60DD8-0DDF0DF20DF30E01-0E3A0E40-0E460E4D0E810E820E840E870E880E8A0E8D0E94-0E970E99-0E9F0EA1-0EA30EA50EA70EAA0EAB0EAD-0EB90EBB-0EBD0EC0-0EC40EC60ECD0EDC-0EDF0F000F40-0F470F49-0F6C0F71-0F810F88-0F970F99-0FBC1000-10361038103B-103F1050-10621065-1068106E-1086108E109C109D10A0-10C510C710CD10D0-10FA10FC-1248124A-124D1250-12561258125A-125D1260-1288128A-128D1290-12B012B2-12B512B8-12BE12C012C2-12C512C8-12D612D8-13101312-13151318-135A135F1380-138F13A0-13F41401-166C166F-167F1681-169A16A0-16EA16EE-16F01700-170C170E-17131720-17331740-17531760-176C176E-1770177217731780-17B317B6-17C817D717DC1820-18771880-18AA18B0-18F51900-191C1920-192B1930-19381950-196D1970-19741980-19AB19B0-19C91A00-1A1B1A20-1A5E1A61-1A741AA71B00-1B331B35-1B431B45-1B4B1B80-1BA91BAC-1BAF1BBA-1BE51BE7-1BF11C00-1C351C4D-1C4F1C5A-1C7D1CE9-1CEC1CEE-1CF31CF51CF61D00-1DBF1E00-1F151F18-1F1D1F20-1F451F48-1F4D1F50-1F571F591F5B1F5D1F5F-1F7D1F80-1FB41FB6-1FBC1FBE1FC2-1FC41FC6-1FCC1FD0-1FD31FD6-1FDB1FE0-1FEC1FF2-1FF41FF6-1FFC2071207F2090-209C21022107210A-211321152119-211D212421262128212A-212D212F-2139213C-213F2145-2149214E2160-218824B6-24E92C00-2C2E2C30-2C5E2C60-2CE42CEB-2CEE2CF22CF32D00-2D252D272D2D2D30-2D672D6F2D80-2D962DA0-2DA62DA8-2DAE2DB0-2DB62DB8-2DBE2DC0-2DC62DC8-2DCE2DD0-2DD62DD8-2DDE2DE0-2DFF2E2F3005-30073021-30293031-30353038-303C3041-3096309D-309F30A1-30FA30FC-30FF3105-312D3131-318E31A0-31BA31F0-31FF3400-4DB54E00-9FCCA000-A48CA4D0-A4FDA500-A60CA610-A61FA62AA62BA640-A66EA674-A67BA67F-A697A69F-A6EFA717-A71FA722-A788A78B-A78EA790-A793A7A0-A7AAA7F8-A801A803-A805A807-A80AA80C-A827A840-A873A880-A8C3A8F2-A8F7A8FBA90A-A92AA930-A952A960-A97CA980-A9B2A9B4-A9BFA9CFAA00-AA36AA40-AA4DAA60-AA76AA7AAA80-AABEAAC0AAC2AADB-AADDAAE0-AAEFAAF2-AAF5AB01-AB06AB09-AB0EAB11-AB16AB20-AB26AB28-AB2EABC0-ABEAAC00-D7A3D7B0-D7C6D7CB-D7FBF900-FA6DFA70-FAD9FB00-FB06FB13-FB17FB1D-FB28FB2A-FB36FB38-FB3CFB3EFB40FB41FB43FB44FB46-FBB1FBD3-FD3DFD50-FD8FFD92-FDC7FDF0-FDFBFE70-FE74FE76-FEFCFF21-FF3AFF41-FF5AFF66-FFBEFFC2-FFC7FFCA-FFCFFFD2-FFD7FFDA-FFDC",
        Uppercase: "0041-005A00C0-00D600D8-00DE01000102010401060108010A010C010E01100112011401160118011A011C011E01200122012401260128012A012C012E01300132013401360139013B013D013F0141014301450147014A014C014E01500152015401560158015A015C015E01600162016401660168016A016C016E017001720174017601780179017B017D018101820184018601870189-018B018E-0191019301940196-0198019C019D019F01A001A201A401A601A701A901AC01AE01AF01B1-01B301B501B701B801BC01C401C701CA01CD01CF01D101D301D501D701D901DB01DE01E001E201E401E601E801EA01EC01EE01F101F401F6-01F801FA01FC01FE02000202020402060208020A020C020E02100212021402160218021A021C021E02200222022402260228022A022C022E02300232023A023B023D023E02410243-02460248024A024C024E03700372037603860388-038A038C038E038F0391-03A103A3-03AB03CF03D2-03D403D803DA03DC03DE03E003E203E403E603E803EA03EC03EE03F403F703F903FA03FD-042F04600462046404660468046A046C046E04700472047404760478047A047C047E0480048A048C048E04900492049404960498049A049C049E04A004A204A404A604A804AA04AC04AE04B004B204B404B604B804BA04BC04BE04C004C104C304C504C704C904CB04CD04D004D204D404D604D804DA04DC04DE04E004E204E404E604E804EA04EC04EE04F004F204F404F604F804FA04FC04FE05000502050405060508050A050C050E05100512051405160518051A051C051E05200522052405260531-055610A0-10C510C710CD1E001E021E041E061E081E0A1E0C1E0E1E101E121E141E161E181E1A1E1C1E1E1E201E221E241E261E281E2A1E2C1E2E1E301E321E341E361E381E3A1E3C1E3E1E401E421E441E461E481E4A1E4C1E4E1E501E521E541E561E581E5A1E5C1E5E1E601E621E641E661E681E6A1E6C1E6E1E701E721E741E761E781E7A1E7C1E7E1E801E821E841E861E881E8A1E8C1E8E1E901E921E941E9E1EA01EA21EA41EA61EA81EAA1EAC1EAE1EB01EB21EB41EB61EB81EBA1EBC1EBE1EC01EC21EC41EC61EC81ECA1ECC1ECE1ED01ED21ED41ED61ED81EDA1EDC1EDE1EE01EE21EE41EE61EE81EEA1EEC1EEE1EF01EF21EF41EF61EF81EFA1EFC1EFE1F08-1F0F1F18-1F1D1F28-1F2F1F38-1F3F1F48-1F4D1F591F5B1F5D1F5F1F68-1F6F1FB8-1FBB1FC8-1FCB1FD8-1FDB1FE8-1FEC1FF8-1FFB21022107210B-210D2110-211221152119-211D212421262128212A-212D2130-2133213E213F21452160-216F218324B6-24CF2C00-2C2E2C602C62-2C642C672C692C6B2C6D-2C702C722C752C7E-2C802C822C842C862C882C8A2C8C2C8E2C902C922C942C962C982C9A2C9C2C9E2CA02CA22CA42CA62CA82CAA2CAC2CAE2CB02CB22CB42CB62CB82CBA2CBC2CBE2CC02CC22CC42CC62CC82CCA2CCC2CCE2CD02CD22CD42CD62CD82CDA2CDC2CDE2CE02CE22CEB2CED2CF2A640A642A644A646A648A64AA64CA64EA650A652A654A656A658A65AA65CA65EA660A662A664A666A668A66AA66CA680A682A684A686A688A68AA68CA68EA690A692A694A696A722A724A726A728A72AA72CA72EA732A734A736A738A73AA73CA73EA740A742A744A746A748A74AA74CA74EA750A752A754A756A758A75AA75CA75EA760A762A764A766A768A76AA76CA76EA779A77BA77DA77EA780A782A784A786A78BA78DA790A792A7A0A7A2A7A4A7A6A7A8A7AAFF21-FF3A",
        Lowercase: "0061-007A00AA00B500BA00DF-00F600F8-00FF01010103010501070109010B010D010F01110113011501170119011B011D011F01210123012501270129012B012D012F01310133013501370138013A013C013E014001420144014601480149014B014D014F01510153015501570159015B015D015F01610163016501670169016B016D016F0171017301750177017A017C017E-0180018301850188018C018D019201950199-019B019E01A101A301A501A801AA01AB01AD01B001B401B601B901BA01BD-01BF01C601C901CC01CE01D001D201D401D601D801DA01DC01DD01DF01E101E301E501E701E901EB01ED01EF01F001F301F501F901FB01FD01FF02010203020502070209020B020D020F02110213021502170219021B021D021F02210223022502270229022B022D022F02310233-0239023C023F0240024202470249024B024D024F-02930295-02B802C002C102E0-02E40345037103730377037A-037D039003AC-03CE03D003D103D5-03D703D903DB03DD03DF03E103E303E503E703E903EB03ED03EF-03F303F503F803FB03FC0430-045F04610463046504670469046B046D046F04710473047504770479047B047D047F0481048B048D048F04910493049504970499049B049D049F04A104A304A504A704A904AB04AD04AF04B104B304B504B704B904BB04BD04BF04C204C404C604C804CA04CC04CE04CF04D104D304D504D704D904DB04DD04DF04E104E304E504E704E904EB04ED04EF04F104F304F504F704F904FB04FD04FF05010503050505070509050B050D050F05110513051505170519051B051D051F05210523052505270561-05871D00-1DBF1E011E031E051E071E091E0B1E0D1E0F1E111E131E151E171E191E1B1E1D1E1F1E211E231E251E271E291E2B1E2D1E2F1E311E331E351E371E391E3B1E3D1E3F1E411E431E451E471E491E4B1E4D1E4F1E511E531E551E571E591E5B1E5D1E5F1E611E631E651E671E691E6B1E6D1E6F1E711E731E751E771E791E7B1E7D1E7F1E811E831E851E871E891E8B1E8D1E8F1E911E931E95-1E9D1E9F1EA11EA31EA51EA71EA91EAB1EAD1EAF1EB11EB31EB51EB71EB91EBB1EBD1EBF1EC11EC31EC51EC71EC91ECB1ECD1ECF1ED11ED31ED51ED71ED91EDB1EDD1EDF1EE11EE31EE51EE71EE91EEB1EED1EEF1EF11EF31EF51EF71EF91EFB1EFD1EFF-1F071F10-1F151F20-1F271F30-1F371F40-1F451F50-1F571F60-1F671F70-1F7D1F80-1F871F90-1F971FA0-1FA71FB0-1FB41FB61FB71FBE1FC2-1FC41FC61FC71FD0-1FD31FD61FD71FE0-1FE71FF2-1FF41FF61FF72071207F2090-209C210A210E210F2113212F21342139213C213D2146-2149214E2170-217F218424D0-24E92C30-2C5E2C612C652C662C682C6A2C6C2C712C732C742C76-2C7D2C812C832C852C872C892C8B2C8D2C8F2C912C932C952C972C992C9B2C9D2C9F2CA12CA32CA52CA72CA92CAB2CAD2CAF2CB12CB32CB52CB72CB92CBB2CBD2CBF2CC12CC32CC52CC72CC92CCB2CCD2CCF2CD12CD32CD52CD72CD92CDB2CDD2CDF2CE12CE32CE42CEC2CEE2CF32D00-2D252D272D2DA641A643A645A647A649A64BA64DA64FA651A653A655A657A659A65BA65DA65FA661A663A665A667A669A66BA66DA681A683A685A687A689A68BA68DA68FA691A693A695A697A723A725A727A729A72BA72DA72F-A731A733A735A737A739A73BA73DA73FA741A743A745A747A749A74BA74DA74FA751A753A755A757A759A75BA75DA75FA761A763A765A767A769A76BA76DA76F-A778A77AA77CA77FA781A783A785A787A78CA78EA791A793A7A1A7A3A7A5A7A7A7A9A7F8-A7FAFB00-FB06FB13-FB17FF41-FF5A",
        White_Space: "0009-000D0020008500A01680180E2000-200A20282029202F205F3000",
        Noncharacter_Code_Point: "FDD0-FDEFFFFEFFFF",
        Default_Ignorable_Code_Point: "00AD034F115F116017B417B5180B-180D200B-200F202A-202E2060-206F3164FE00-FE0FFEFFFFA0FFF0-FFF8",
        // \p{Any} matches a code unit. To match any code point via surrogate pairs, use (?:[\0-\uD7FF\uDC00-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF])
        Any: "0000-FFFF", // \p{^Any} compiles to [^\u0000-\uFFFF]; [\p{^Any}] to []
        Ascii: "0000-007F",
        // \p{Assigned} is equivalent to \p{^Cn}
        //Assigned: XRegExp("[\\p{^Cn}]").source.replace(/[[\]]|\\u/g, "") // Negation inside a character class triggers inversion
        Assigned: "0000-0377037A-037E0384-038A038C038E-03A103A3-05270531-05560559-055F0561-05870589058A058F0591-05C705D0-05EA05F0-05F40600-06040606-061B061E-070D070F-074A074D-07B107C0-07FA0800-082D0830-083E0840-085B085E08A008A2-08AC08E4-08FE0900-09770979-097F0981-09830985-098C098F09900993-09A809AA-09B009B209B6-09B909BC-09C409C709C809CB-09CE09D709DC09DD09DF-09E309E6-09FB0A01-0A030A05-0A0A0A0F0A100A13-0A280A2A-0A300A320A330A350A360A380A390A3C0A3E-0A420A470A480A4B-0A4D0A510A59-0A5C0A5E0A66-0A750A81-0A830A85-0A8D0A8F-0A910A93-0AA80AAA-0AB00AB20AB30AB5-0AB90ABC-0AC50AC7-0AC90ACB-0ACD0AD00AE0-0AE30AE6-0AF10B01-0B030B05-0B0C0B0F0B100B13-0B280B2A-0B300B320B330B35-0B390B3C-0B440B470B480B4B-0B4D0B560B570B5C0B5D0B5F-0B630B66-0B770B820B830B85-0B8A0B8E-0B900B92-0B950B990B9A0B9C0B9E0B9F0BA30BA40BA8-0BAA0BAE-0BB90BBE-0BC20BC6-0BC80BCA-0BCD0BD00BD70BE6-0BFA0C01-0C030C05-0C0C0C0E-0C100C12-0C280C2A-0C330C35-0C390C3D-0C440C46-0C480C4A-0C4D0C550C560C580C590C60-0C630C66-0C6F0C78-0C7F0C820C830C85-0C8C0C8E-0C900C92-0CA80CAA-0CB30CB5-0CB90CBC-0CC40CC6-0CC80CCA-0CCD0CD50CD60CDE0CE0-0CE30CE6-0CEF0CF10CF20D020D030D05-0D0C0D0E-0D100D12-0D3A0D3D-0D440D46-0D480D4A-0D4E0D570D60-0D630D66-0D750D79-0D7F0D820D830D85-0D960D9A-0DB10DB3-0DBB0DBD0DC0-0DC60DCA0DCF-0DD40DD60DD8-0DDF0DF2-0DF40E01-0E3A0E3F-0E5B0E810E820E840E870E880E8A0E8D0E94-0E970E99-0E9F0EA1-0EA30EA50EA70EAA0EAB0EAD-0EB90EBB-0EBD0EC0-0EC40EC60EC8-0ECD0ED0-0ED90EDC-0EDF0F00-0F470F49-0F6C0F71-0F970F99-0FBC0FBE-0FCC0FCE-0FDA1000-10C510C710CD10D0-1248124A-124D1250-12561258125A-125D1260-1288128A-128D1290-12B012B2-12B512B8-12BE12C012C2-12C512C8-12D612D8-13101312-13151318-135A135D-137C1380-139913A0-13F41400-169C16A0-16F01700-170C170E-17141720-17361740-17531760-176C176E-1770177217731780-17DD17E0-17E917F0-17F91800-180E1810-18191820-18771880-18AA18B0-18F51900-191C1920-192B1930-193B19401944-196D1970-19741980-19AB19B0-19C919D0-19DA19DE-1A1B1A1E-1A5E1A60-1A7C1A7F-1A891A90-1A991AA0-1AAD1B00-1B4B1B50-1B7C1B80-1BF31BFC-1C371C3B-1C491C4D-1C7F1CC0-1CC71CD0-1CF61D00-1DE61DFC-1F151F18-1F1D1F20-1F451F48-1F4D1F50-1F571F591F5B1F5D1F5F-1F7D1F80-1FB41FB6-1FC41FC6-1FD31FD6-1FDB1FDD-1FEF1FF2-1FF41FF6-1FFE2000-2064206A-20712074-208E2090-209C20A0-20B920D0-20F02100-21892190-23F32400-24262440-244A2460-26FF2701-2B4C2B50-2B592C00-2C2E2C30-2C5E2C60-2CF32CF9-2D252D272D2D2D30-2D672D6F2D702D7F-2D962DA0-2DA62DA8-2DAE2DB0-2DB62DB8-2DBE2DC0-2DC62DC8-2DCE2DD0-2DD62DD8-2DDE2DE0-2E3B2E80-2E992E9B-2EF32F00-2FD52FF0-2FFB3000-303F3041-30963099-30FF3105-312D3131-318E3190-31BA31C0-31E331F0-321E3220-32FE3300-4DB54DC0-9FCCA000-A48CA490-A4C6A4D0-A62BA640-A697A69F-A6F7A700-A78EA790-A793A7A0-A7AAA7F8-A82BA830-A839A840-A877A880-A8C4A8CE-A8D9A8E0-A8FBA900-A953A95F-A97CA980-A9CDA9CF-A9D9A9DEA9DFAA00-AA36AA40-AA4DAA50-AA59AA5C-AA7BAA80-AAC2AADB-AAF6AB01-AB06AB09-AB0EAB11-AB16AB20-AB26AB28-AB2EABC0-ABEDABF0-ABF9AC00-D7A3D7B0-D7C6D7CB-D7FBD800-FA6DFA70-FAD9FB00-FB06FB13-FB17FB1D-FB36FB38-FB3CFB3EFB40FB41FB43FB44FB46-FBC1FBD3-FD3FFD50-FD8FFD92-FDC7FDF0-FDFDFE00-FE19FE20-FE26FE30-FE52FE54-FE66FE68-FE6BFE70-FE74FE76-FEFCFEFFFF01-FFBEFFC2-FFC7FFCA-FFCFFFD2-FFD7FFDA-FFDCFFE0-FFE6FFE8-FFEEFFF9-FFFD"
    });

}(XRegExp));


/***** matchrecursive.js *****/

/*!
 * XRegExp.matchRecursive v0.2.0
 * (c) 2009-2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 */

(function (XRegExp) {
    "use strict";

/**
 * Returns a match detail object composed of the provided values.
 * @private
 */
    function row(value, name, start, end) {
        return {value:value, name:name, start:start, end:end};
    }

/**
 * Returns an array of match strings between outermost left and right delimiters, or an array of
 * objects with detailed match parts and position data. An error is thrown if delimiters are
 * unbalanced within the data.
 * @memberOf XRegExp
 * @param {String} str String to search.
 * @param {String} left Left delimiter as an XRegExp pattern.
 * @param {String} right Right delimiter as an XRegExp pattern.
 * @param {String} [flags] Flags for the left and right delimiters. Use any of: `gimnsxy`.
 * @param {Object} [options] Lets you specify `valueNames` and `escapeChar` options.
 * @returns {Array} Array of matches, or an empty array.
 * @example
 *
 * // Basic usage
 * var str = '(t((e))s)t()(ing)';
 * XRegExp.matchRecursive(str, '\\(', '\\)', 'g');
 * // -> ['t((e))s', '', 'ing']
 *
 * // Extended information mode with valueNames
 * str = 'Here is <div> <div>an</div></div> example';
 * XRegExp.matchRecursive(str, '<div\\s*>', '</div>', 'gi', {
 *   valueNames: ['between', 'left', 'match', 'right']
 * });
 * // -> [
 * // {name: 'between', value: 'Here is ',       start: 0,  end: 8},
 * // {name: 'left',    value: '<div>',          start: 8,  end: 13},
 * // {name: 'match',   value: ' <div>an</div>', start: 13, end: 27},
 * // {name: 'right',   value: '</div>',         start: 27, end: 33},
 * // {name: 'between', value: ' example',       start: 33, end: 41}
 * // ]
 *
 * // Omitting unneeded parts with null valueNames, and using escapeChar
 * str = '...{1}\\{{function(x,y){return y+x;}}';
 * XRegExp.matchRecursive(str, '{', '}', 'g', {
 *   valueNames: ['literal', null, 'value', null],
 *   escapeChar: '\\'
 * });
 * // -> [
 * // {name: 'literal', value: '...', start: 0, end: 3},
 * // {name: 'value',   value: '1',   start: 4, end: 5},
 * // {name: 'literal', value: '\\{', start: 6, end: 8},
 * // {name: 'value',   value: 'function(x,y){return y+x;}', start: 9, end: 35}
 * // ]
 *
 * // Sticky mode via flag y
 * str = '<1><<<2>>><3>4<5>';
 * XRegExp.matchRecursive(str, '<', '>', 'gy');
 * // -> ['1', '<<2>>', '3']
 */
    XRegExp.matchRecursive = function (str, left, right, flags, options) {
        flags = flags || "";
        options = options || {};
        var global = flags.indexOf("g") > -1,
            sticky = flags.indexOf("y") > -1,
            basicFlags = flags.replace(/y/g, ""), // Flag y controlled internally
            escapeChar = options.escapeChar,
            vN = options.valueNames,
            output = [],
            openTokens = 0,
            delimStart = 0,
            delimEnd = 0,
            lastOuterEnd = 0,
            outerStart,
            innerStart,
            leftMatch,
            rightMatch,
            esc;
        left = XRegExp(left, basicFlags);
        right = XRegExp(right, basicFlags);

        if (escapeChar) {
            if (escapeChar.length > 1) {
                throw new SyntaxError("can't use more than one escape character");
            }
            escapeChar = XRegExp.escape(escapeChar);
            // Using XRegExp.union safely rewrites backreferences in `left` and `right`
            esc = new RegExp(
                "(?:" + escapeChar + "[\\S\\s]|(?:(?!" + XRegExp.union([left, right]).source + ")[^" + escapeChar + "])+)+",
                flags.replace(/[^im]+/g, "") // Flags gy not needed here; flags nsx handled by XRegExp
            );
        }

        while (true) {
            // If using an escape character, advance to the delimiter's next starting position,
            // skipping any escaped characters in between
            if (escapeChar) {
                delimEnd += (XRegExp.exec(str, esc, delimEnd, "sticky") || [""])[0].length;
            }
            leftMatch = XRegExp.exec(str, left, delimEnd);
            rightMatch = XRegExp.exec(str, right, delimEnd);
            // Keep the leftmost match only
            if (leftMatch && rightMatch) {
                if (leftMatch.index <= rightMatch.index) {
                    rightMatch = null;
                } else {
                    leftMatch = null;
                }
            }
            /* Paths (LM:leftMatch, RM:rightMatch, OT:openTokens):
            LM | RM | OT | Result
            1  | 0  | 1  | loop
            1  | 0  | 0  | loop
            0  | 1  | 1  | loop
            0  | 1  | 0  | throw
            0  | 0  | 1  | throw
            0  | 0  | 0  | break
            * Doesn't include the sticky mode special case
            * Loop ends after the first completed match if `!global` */
            if (leftMatch || rightMatch) {
                delimStart = (leftMatch || rightMatch).index;
                delimEnd = delimStart + (leftMatch || rightMatch)[0].length;
            } else if (!openTokens) {
                break;
            }
            if (sticky && !openTokens && delimStart > lastOuterEnd) {
                break;
            }
            if (leftMatch) {
                if (!openTokens) {
                    outerStart = delimStart;
                    innerStart = delimEnd;
                }
                ++openTokens;
            } else if (rightMatch && openTokens) {
                if (!--openTokens) {
                    if (vN) {
                        if (vN[0] && outerStart > lastOuterEnd) {
                            output.push(row(vN[0], str.slice(lastOuterEnd, outerStart), lastOuterEnd, outerStart));
                        }
                        if (vN[1]) {
                            output.push(row(vN[1], str.slice(outerStart, innerStart), outerStart, innerStart));
                        }
                        if (vN[2]) {
                            output.push(row(vN[2], str.slice(innerStart, delimStart), innerStart, delimStart));
                        }
                        if (vN[3]) {
                            output.push(row(vN[3], str.slice(delimStart, delimEnd), delimStart, delimEnd));
                        }
                    } else {
                        output.push(str.slice(innerStart, delimStart));
                    }
                    lastOuterEnd = delimEnd;
                    if (!global) {
                        break;
                    }
                }
            } else {
                throw new Error("string contains unbalanced delimiters");
            }
            // If the delimiter matched an empty string, avoid an infinite loop
            if (delimStart === delimEnd) {
                ++delimEnd;
            }
        }

        if (global && !sticky && vN && vN[0] && str.length > lastOuterEnd) {
            output.push(row(vN[0], str.slice(lastOuterEnd), lastOuterEnd, str.length));
        }

        return output;
    };

}(XRegExp));


/***** build.js *****/

/*!
 * XRegExp.build v0.1.0
 * (c) 2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 * Inspired by RegExp.create by Lea Verou <http://lea.verou.me/>
 */

(function (XRegExp) {
    "use strict";

    var subparts = /(\()(?!\?)|\\([1-9]\d*)|\\[\s\S]|\[(?:[^\\\]]|\\[\s\S])*]/g,
        parts = XRegExp.union([/\({{([\w$]+)}}\)|{{([\w$]+)}}/, subparts], "g");

/**
 * Strips a leading `^` and trailing unescaped `$`, if both are present.
 * @private
 * @param {String} pattern Pattern to process.
 * @returns {String} Pattern with edge anchors removed.
 */
    function deanchor(pattern) {
        var startAnchor = /^(?:\(\?:\))?\^/, // Leading `^` or `(?:)^` (handles /x cruft)
            endAnchor = /\$(?:\(\?:\))?$/; // Trailing `$` or `$(?:)` (handles /x cruft)
        if (endAnchor.test(pattern.replace(/\\[\s\S]/g, ""))) { // Ensure trailing `$` isn't escaped
            return pattern.replace(startAnchor, "").replace(endAnchor, "");
        }
        return pattern;
    }

/**
 * Converts the provided value to an XRegExp.
 * @private
 * @param {String|RegExp} value Value to convert.
 * @returns {RegExp} XRegExp object with XRegExp syntax applied.
 */
    function asXRegExp(value) {
        return XRegExp.isRegExp(value) ?
                (value.xregexp && !value.xregexp.isNative ? value : XRegExp(value.source)) :
                XRegExp(value);
    }

/**
 * Builds regexes using named subpatterns, for readability and pattern reuse. Backreferences in the
 * outer pattern and provided subpatterns are automatically renumbered to work correctly. Native
 * flags used by provided subpatterns are ignored in favor of the `flags` argument.
 * @memberOf XRegExp
 * @param {String} pattern XRegExp pattern using `{{name}}` for embedded subpatterns. Allows
 *   `({{name}})` as shorthand for `(?<name>{{name}})`. Patterns cannot be embedded within
 *   character classes.
 * @param {Object} subs Lookup object for named subpatterns. Values can be strings or regexes. A
 *   leading `^` and trailing unescaped `$` are stripped from subpatterns, if both are present.
 * @param {String} [flags] Any combination of XRegExp flags.
 * @returns {RegExp} Regex with interpolated subpatterns.
 * @example
 *
 * var time = XRegExp.build('(?x)^ {{hours}} ({{minutes}}) $', {
 *   hours: XRegExp.build('{{h12}} : | {{h24}}', {
 *     h12: /1[0-2]|0?[1-9]/,
 *     h24: /2[0-3]|[01][0-9]/
 *   }, 'x'),
 *   minutes: /^[0-5][0-9]$/
 * });
 * time.test('10:59'); // -> true
 * XRegExp.exec('10:59', time).minutes; // -> '59'
 */
    XRegExp.build = function (pattern, subs, flags) {
        var inlineFlags = /^\(\?([\w$]+)\)/.exec(pattern),
            data = {},
            numCaps = 0, // Caps is short for captures
            numPriorCaps,
            numOuterCaps = 0,
            outerCapsMap = [0],
            outerCapNames,
            sub,
            p;

        // Add flags within a leading mode modifier to the overall pattern's flags
        if (inlineFlags) {
            flags = flags || "";
            inlineFlags[1].replace(/./g, function (flag) {
                flags += (flags.indexOf(flag) > -1 ? "" : flag); // Don't add duplicates
            });
        }

        for (p in subs) {
            if (subs.hasOwnProperty(p)) {
                // Passing to XRegExp enables entended syntax for subpatterns provided as strings
                // and ensures independent validity, lest an unescaped `(`, `)`, `[`, or trailing
                // `\` breaks the `(?:)` wrapper. For subpatterns provided as regexes, it dies on
                // octals and adds the `xregexp` property, for simplicity
                sub = asXRegExp(subs[p]);
                // Deanchoring allows embedding independently useful anchored regexes. If you
                // really need to keep your anchors, double them (i.e., `^^...$$`)
                data[p] = {pattern: deanchor(sub.source), names: sub.xregexp.captureNames || []};
            }
        }

        // Passing to XRegExp dies on octals and ensures the outer pattern is independently valid;
        // helps keep this simple. Named captures will be put back
        pattern = asXRegExp(pattern);
        outerCapNames = pattern.xregexp.captureNames || [];
        pattern = pattern.source.replace(parts, function ($0, $1, $2, $3, $4) {
            var subName = $1 || $2, capName, intro;
            if (subName) { // Named subpattern
                if (!data.hasOwnProperty(subName)) {
                    throw new ReferenceError("undefined property " + $0);
                }
                if ($1) { // Named subpattern was wrapped in a capturing group
                    capName = outerCapNames[numOuterCaps];
                    outerCapsMap[++numOuterCaps] = ++numCaps;
                    // If it's a named group, preserve the name. Otherwise, use the subpattern name
                    // as the capture name
                    intro = "(?<" + (capName || subName) + ">";
                } else {
                    intro = "(?:";
                }
                numPriorCaps = numCaps;
                return intro + data[subName].pattern.replace(subparts, function (match, paren, backref) {
                    if (paren) { // Capturing group
                        capName = data[subName].names[numCaps - numPriorCaps];
                        ++numCaps;
                        if (capName) { // If the current capture has a name, preserve the name
                            return "(?<" + capName + ">";
                        }
                    } else if (backref) { // Backreference
                        return "\\" + (+backref + numPriorCaps); // Rewrite the backreference
                    }
                    return match;
                }) + ")";
            }
            if ($3) { // Capturing group
                capName = outerCapNames[numOuterCaps];
                outerCapsMap[++numOuterCaps] = ++numCaps;
                if (capName) { // If the current capture has a name, preserve the name
                    return "(?<" + capName + ">";
                }
            } else if ($4) { // Backreference
                return "\\" + outerCapsMap[+$4]; // Rewrite the backreference
            }
            return $0;
        });

        return XRegExp(pattern, flags);
    };

}(XRegExp));


/***** prototypes.js *****/

/*!
 * XRegExp Prototype Methods v1.0.0
 * (c) 2012 Steven Levithan <http://xregexp.com/>
 * MIT License
 */

/**
 * Adds a collection of methods to `XRegExp.prototype`. RegExp objects copied by XRegExp are also
 * augmented with any `XRegExp.prototype` methods. Hence, the following work equivalently:
 *
 * XRegExp('[a-z]', 'ig').xexec('abc');
 * XRegExp(/[a-z]/ig).xexec('abc');
 * XRegExp.globalize(/[a-z]/i).xexec('abc');
 */
(function (XRegExp) {
    "use strict";

/**
 * Copy properties of `b` to `a`.
 * @private
 * @param {Object} a Object that will receive new properties.
 * @param {Object} b Object whose properties will be copied.
 */
    function extend(a, b) {
        for (var p in b) {
            if (b.hasOwnProperty(p)) {
                a[p] = b[p];
            }
        }
        //return a;
    }

    extend(XRegExp.prototype, {

/**
 * Implicitly calls the regex's `test` method with the first value in the provided arguments array.
 * @memberOf XRegExp.prototype
 * @param {*} context Ignored. Accepted only for congruity with `Function.prototype.apply`.
 * @param {Array} args Array with the string to search as its first value.
 * @returns {Boolean} Whether the regex matched the provided value.
 * @example
 *
 * XRegExp('[a-z]').apply(null, ['abc']); // -> true
 */
        apply: function (context, args) {
            return this.test(args[0]);
        },

/**
 * Implicitly calls the regex's `test` method with the provided string.
 * @memberOf XRegExp.prototype
 * @param {*} context Ignored. Accepted only for congruity with `Function.prototype.call`.
 * @param {String} str String to search.
 * @returns {Boolean} Whether the regex matched the provided value.
 * @example
 *
 * XRegExp('[a-z]').call(null, 'abc'); // -> true
 */
        call: function (context, str) {
            return this.test(str);
        },

/**
 * Implicitly calls {@link #XRegExp.forEach}.
 * @memberOf XRegExp.prototype
 * @example
 *
 * XRegExp('\\d').forEach('1a2345', function (match, i) {
 *   if (i % 2) this.push(+match[0]);
 * }, []);
 * // -> [2, 4]
 */
        forEach: function (str, callback, context) {
            return XRegExp.forEach(str, this, callback, context);
        },

/**
 * Implicitly calls {@link #XRegExp.globalize}.
 * @memberOf XRegExp.prototype
 * @example
 *
 * var globalCopy = XRegExp('regex').globalize();
 * globalCopy.global; // -> true
 */
        globalize: function () {
            return XRegExp.globalize(this);
        },

/**
 * Implicitly calls {@link #XRegExp.exec}.
 * @memberOf XRegExp.prototype
 * @example
 *
 * var match = XRegExp('U\\+(?<hex>[0-9A-F]{4})').xexec('U+2620');
 * match.hex; // -> '2620'
 */
        xexec: function (str, pos, sticky) {
            return XRegExp.exec(str, this, pos, sticky);
        },

/**
 * Implicitly calls {@link #XRegExp.test}.
 * @memberOf XRegExp.prototype
 * @example
 *
 * XRegExp('c').xtest('abc'); // -> true
 */
        xtest: function (str, pos, sticky) {
            return XRegExp.test(str, this, pos, sticky);
        }

    });

}(XRegExp));


}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../node_modules/logcat-parse/node_modules/xregexp/xregexp-all.js","/../node_modules/logcat-parse/node_modules/xregexp")
},{"1YiZ5S":4,"buffer":1}],7:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){

var parser = require('logcat-parse');

var GIST_ID_PATTERN = /^[0-9a-f]+$/i
var BLACKLIST_TAGS = [
 /*   "ConnectivityService",
    "PhoneApp",
    "QcrilMsgTunnelSocket",
    "PerformBackupTask",
    "audio_hw_primary",
    "AudioTrack",
    "AudioFlinger",
    "AudioPolicyManagerBase",
    "SurfaceFlinger"*/
    ];

var $content = $("#gist-content");

var loadGist = function(gistId) {
    console.log("attempting to load gist with id " + gistId);
    $content.html("Loading...");
    if (!GIST_ID_PATTERN.test(gistId)) {
        $content.text("Not a valid gist id.");
        return;
    }
    $.getJSON("https://api.github.com/gists/"+gistId, function(gist_info) {
            var files = gist_info["files"];
            for (var file in files) {
                if (files.hasOwnProperty(file)) {
                    console.log("using file " + file);
                    logcat = parser.parse(files[file]["content"]);
                    console.log(logcat);
                    var fragment = "";
                    var i, len;
                    for (i = 0, len = logcat.messages.length; i < len; i++) {
                        var line = logcat.messages[i];
                        if (BLACKLIST_TAGS.indexOf(line.tag.trim()) < 0) {
                            fragment += "  <div class=\"log\">\n";
                            fragment += "   <span class=\"left-block\">";
                            fragment += "    <span class=\"tag\">" + line.tag + "</span>\n";
                            fragment += "    <span class=\"level level-"+line.level+"\">" + line.level + "</span>\n";
                            fragment += "   </span><span class=\"right-block\">";
                            fragment += "    <span class=\"msg\">" + line.message + "</span>\n";
                            fragment += "   </span>";
                            fragment += "  </div>\n";
                        }
                    }
                    $content.html(fragment);
                    return;
                }
            }
        })
        .fail(function() {
            $content.text("Couldn't load the gist, sorry.");
        });
};

var loadHashGist = function() { loadGist($.url().attr('fragment')); };
$(window).on('hashchange', loadHashGist);
loadHashGist();

}).call(this,require("1YiZ5S"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/fake_ca7a9abf.js","/")
},{"1YiZ5S":4,"buffer":1,"logcat-parse":5}]},{},[7])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy9rYW9uYXNoaS9naXQvY2F0bG9nY2F0L25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIi9Vc2Vycy9rYW9uYXNoaS9naXQvY2F0bG9nY2F0L25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qcyIsIi9Vc2Vycy9rYW9uYXNoaS9naXQvY2F0bG9nY2F0L25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIvVXNlcnMva2FvbmFzaGkvZ2l0L2NhdGxvZ2NhdC9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCIvVXNlcnMva2FvbmFzaGkvZ2l0L2NhdGxvZ2NhdC9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCIvVXNlcnMva2FvbmFzaGkvZ2l0L2NhdGxvZ2NhdC9ub2RlX21vZHVsZXMvbG9nY2F0LXBhcnNlL2xpYi9sb2djYXQtcGFyc2UuanMiLCIvVXNlcnMva2FvbmFzaGkvZ2l0L2NhdGxvZ2NhdC9ub2RlX21vZHVsZXMvbG9nY2F0LXBhcnNlL25vZGVfbW9kdWxlcy94cmVnZXhwL3hyZWdleHAtYWxsLmpzIiwiL1VzZXJzL2thb25hc2hpL2dpdC9jYXRsb2djYXQvc3JjL2Zha2VfY2E3YTlhYmYuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3R3RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3Rocm93IG5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIil9dmFyIGY9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGYuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sZixmLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTJcblxuLyoqXG4gKiBJZiBgQnVmZmVyLl91c2VUeXBlZEFycmF5c2A6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChjb21wYXRpYmxlIGRvd24gdG8gSUU2KVxuICovXG5CdWZmZXIuX3VzZVR5cGVkQXJyYXlzID0gKGZ1bmN0aW9uICgpIHtcbiAgLy8gRGV0ZWN0IGlmIGJyb3dzZXIgc3VwcG9ydHMgVHlwZWQgQXJyYXlzLiBTdXBwb3J0ZWQgYnJvd3NlcnMgYXJlIElFIDEwKywgRmlyZWZveCA0KyxcbiAgLy8gQ2hyb21lIDcrLCBTYWZhcmkgNS4xKywgT3BlcmEgMTEuNissIGlPUyA0LjIrLiBJZiB0aGUgYnJvd3NlciBkb2VzIG5vdCBzdXBwb3J0IGFkZGluZ1xuICAvLyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMsIHRoZW4gdGhhdCdzIHRoZSBzYW1lIGFzIG5vIGBVaW50OEFycmF5YCBzdXBwb3J0XG4gIC8vIGJlY2F1c2Ugd2UgbmVlZCB0byBiZSBhYmxlIHRvIGFkZCBhbGwgdGhlIG5vZGUgQnVmZmVyIEFQSSBtZXRob2RzLiBUaGlzIGlzIGFuIGlzc3VlXG4gIC8vIGluIEZpcmVmb3ggNC0yOS4gTm93IGZpeGVkOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzhcbiAgdHJ5IHtcbiAgICB2YXIgYnVmID0gbmV3IEFycmF5QnVmZmVyKDApXG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIHJldHVybiA0MiA9PT0gYXJyLmZvbygpICYmXG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgLy8gQ2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pXG5cbiAgdmFyIHR5cGUgPSB0eXBlb2Ygc3ViamVjdFxuXG4gIC8vIFdvcmthcm91bmQ6IG5vZGUncyBiYXNlNjQgaW1wbGVtZW50YXRpb24gYWxsb3dzIGZvciBub24tcGFkZGVkIHN0cmluZ3NcbiAgLy8gd2hpbGUgYmFzZTY0LWpzIGRvZXMgbm90LlxuICBpZiAoZW5jb2RpbmcgPT09ICdiYXNlNjQnICYmIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgc3ViamVjdCA9IHN0cmluZ3RyaW0oc3ViamVjdClcbiAgICB3aGlsZSAoc3ViamVjdC5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgICBzdWJqZWN0ID0gc3ViamVjdCArICc9J1xuICAgIH1cbiAgfVxuXG4gIC8vIEZpbmQgdGhlIGxlbmd0aFxuICB2YXIgbGVuZ3RoXG4gIGlmICh0eXBlID09PSAnbnVtYmVyJylcbiAgICBsZW5ndGggPSBjb2VyY2Uoc3ViamVjdClcbiAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpXG4gICAgbGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdvYmplY3QnKVxuICAgIGxlbmd0aCA9IGNvZXJjZShzdWJqZWN0Lmxlbmd0aCkgLy8gYXNzdW1lIHRoYXQgb2JqZWN0IGlzIGFycmF5LWxpa2VcbiAgZWxzZVxuICAgIHRocm93IG5ldyBFcnJvcignRmlyc3QgYXJndW1lbnQgbmVlZHMgdG8gYmUgYSBudW1iZXIsIGFycmF5IG9yIHN0cmluZy4nKVxuXG4gIHZhciBidWZcbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMpIHtcbiAgICAvLyBQcmVmZXJyZWQ6IFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYnVmID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBUSElTIGluc3RhbmNlIG9mIEJ1ZmZlciAoY3JlYXRlZCBieSBgbmV3YClcbiAgICBidWYgPSB0aGlzXG4gICAgYnVmLmxlbmd0aCA9IGxlbmd0aFxuICAgIGJ1Zi5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgaVxuICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cyAmJiB0eXBlb2Ygc3ViamVjdC5ieXRlTGVuZ3RoID09PSAnbnVtYmVyJykge1xuICAgIC8vIFNwZWVkIG9wdGltaXphdGlvbiAtLSB1c2Ugc2V0IGlmIHdlJ3JlIGNvcHlpbmcgZnJvbSBhIHR5cGVkIGFycmF5XG4gICAgYnVmLl9zZXQoc3ViamVjdClcbiAgfSBlbHNlIGlmIChpc0FycmF5aXNoKHN1YmplY3QpKSB7XG4gICAgLy8gVHJlYXQgYXJyYXktaXNoIG9iamVjdHMgYXMgYSBieXRlIGFycmF5XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpKVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0LnJlYWRVSW50OChpKVxuICAgICAgZWxzZVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0W2ldXG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgYnVmLndyaXRlKHN1YmplY3QsIDAsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmICFCdWZmZXIuX3VzZVR5cGVkQXJyYXlzICYmICFub1plcm8pIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIGJ1ZltpXSA9IDBcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnVmXG59XG5cbi8vIFNUQVRJQyBNRVRIT0RTXG4vLyA9PT09PT09PT09PT09PVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gKGIpIHtcbiAgcmV0dXJuICEhKGIgIT09IG51bGwgJiYgYiAhPT0gdW5kZWZpbmVkICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIChzdHIsIGVuY29kaW5nKSB7XG4gIHZhciByZXRcbiAgc3RyID0gc3RyICsgJydcbiAgc3dpdGNoIChlbmNvZGluZyB8fCAndXRmOCcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCAvIDJcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAncmF3JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IGJhc2U2NFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggKiAyXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vua25vd24gZW5jb2RpbmcnKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIChsaXN0LCB0b3RhbExlbmd0aCkge1xuICBhc3NlcnQoaXNBcnJheShsaXN0KSwgJ1VzYWdlOiBCdWZmZXIuY29uY2F0KGxpc3QsIFt0b3RhbExlbmd0aF0pXFxuJyArXG4gICAgICAnbGlzdCBzaG91bGQgYmUgYW4gQXJyYXkuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF1cbiAgfVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdG90YWxMZW5ndGggIT09ICdudW1iZXInKSB7XG4gICAgdG90YWxMZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIHRvdGFsTGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIodG90YWxMZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuLy8gQlVGRkVSIElOU1RBTkNFIE1FVEhPRFNcbi8vID09PT09PT09PT09PT09PT09PT09PT09XG5cbmZ1bmN0aW9uIF9oZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGFzc2VydChzdHJMZW4gJSAyID09PSAwLCAnSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGJ5dGUgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgYXNzZXJ0KCFpc05hTihieXRlKSwgJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gYnl0ZVxuICB9XG4gIEJ1ZmZlci5fY2hhcnNXcml0dGVuID0gaSAqIDJcbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gX3V0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF9hc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IEJ1ZmZlci5fY2hhcnNXcml0dGVuID1cbiAgICBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF9iaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBfYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIF9iYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gX3V0ZjE2bGVXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gU3VwcG9ydCBib3RoIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZylcbiAgLy8gYW5kIHRoZSBsZWdhY3kgKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIGlmICghaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfSBlbHNlIHsgIC8vIGxlZ2FjeVxuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IF9oZXhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSBfdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IF9hc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBfYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IF9iYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gX3V0ZjE2bGVXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG5cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG4gIHN0YXJ0ID0gTnVtYmVyKHN0YXJ0KSB8fCAwXG4gIGVuZCA9IChlbmQgIT09IHVuZGVmaW5lZClcbiAgICA/IE51bWJlcihlbmQpXG4gICAgOiBlbmQgPSBzZWxmLmxlbmd0aFxuXG4gIC8vIEZhc3RwYXRoIGVtcHR5IHN0cmluZ3NcbiAgaWYgKGVuZCA9PT0gc3RhcnQpXG4gICAgcmV0dXJuICcnXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IF9oZXhTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSBfdXRmOFNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IF9hc2NpaVNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBfYmluYXJ5U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IF9iYXNlNjRTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gX3V0ZjE2bGVTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uICh0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICB2YXIgc291cmNlID0gdGhpc1xuXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICghdGFyZ2V0X3N0YXJ0KSB0YXJnZXRfc3RhcnQgPSAwXG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgc291cmNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBhc3NlcnQoZW5kID49IHN0YXJ0LCAnc291cmNlRW5kIDwgc291cmNlU3RhcnQnKVxuICBhc3NlcnQodGFyZ2V0X3N0YXJ0ID49IDAgJiYgdGFyZ2V0X3N0YXJ0IDwgdGFyZ2V0Lmxlbmd0aCxcbiAgICAgICd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgYXNzZXJ0KHN0YXJ0ID49IDAgJiYgc3RhcnQgPCBzb3VyY2UubGVuZ3RoLCAnc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChlbmQgPj0gMCAmJiBlbmQgPD0gc291cmNlLmxlbmd0aCwgJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpXG4gICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgPCBlbmQgLSBzdGFydClcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0ICsgc3RhcnRcblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwIHx8ICFCdWZmZXIuX3VzZVR5cGVkQXJyYXlzKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0X3N0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0X3N0YXJ0KVxuICB9XG59XG5cbmZ1bmN0aW9uIF9iYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gX3V0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBfYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspXG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIF9iaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHJldHVybiBfYXNjaWlTbGljZShidWYsIHN0YXJ0LCBlbmQpXG59XG5cbmZ1bmN0aW9uIF9oZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIF91dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2krMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gY2xhbXAoc3RhcnQsIGxlbiwgMClcbiAgZW5kID0gY2xhbXAoZW5kLCBsZW4sIGxlbilcblxuICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgIHJldHVybiBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIHZhciBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQsIHRydWUpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gICAgcmV0dXJuIG5ld0J1ZlxuICB9XG59XG5cbi8vIGBnZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpXG4gICAgcmV0dXJuXG5cbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5mdW5jdGlvbiBfcmVhZFVJbnQxNiAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIHZhciB2YWxcbiAgaWYgKGxpdHRsZUVuZGlhbikge1xuICAgIHZhbCA9IGJ1ZltvZmZzZXRdXG4gICAgaWYgKG9mZnNldCArIDEgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDFdIDw8IDhcbiAgfSBlbHNlIHtcbiAgICB2YWwgPSBidWZbb2Zmc2V0XSA8PCA4XG4gICAgaWYgKG9mZnNldCArIDEgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDFdXG4gIH1cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQxNih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWRVSW50MzIgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsXG4gIGlmIChsaXR0bGVFbmRpYW4pIHtcbiAgICBpZiAob2Zmc2V0ICsgMiA8IGxlbilcbiAgICAgIHZhbCA9IGJ1ZltvZmZzZXQgKyAyXSA8PCAxNlxuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAxXSA8PCA4XG4gICAgdmFsIHw9IGJ1ZltvZmZzZXRdXG4gICAgaWYgKG9mZnNldCArIDMgPCBsZW4pXG4gICAgICB2YWwgPSB2YWwgKyAoYnVmW29mZnNldCArIDNdIDw8IDI0ID4+PiAwKVxuICB9IGVsc2Uge1xuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsID0gYnVmW29mZnNldCArIDFdIDw8IDE2XG4gICAgaWYgKG9mZnNldCArIDIgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDJdIDw8IDhcbiAgICBpZiAob2Zmc2V0ICsgMyA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgM11cbiAgICB2YWwgPSB2YWwgKyAoYnVmW29mZnNldF0gPDwgMjQgPj4+IDApXG4gIH1cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQzMih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQzMih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpXG4gICAgcmV0dXJuXG5cbiAgdmFyIG5lZyA9IHRoaXNbb2Zmc2V0XSAmIDB4ODBcbiAgaWYgKG5lZylcbiAgICByZXR1cm4gKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xXG4gIGVsc2VcbiAgICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbmZ1bmN0aW9uIF9yZWFkSW50MTYgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsID0gX3JlYWRVSW50MTYoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgdHJ1ZSlcbiAgdmFyIG5lZyA9IHZhbCAmIDB4ODAwMFxuICBpZiAobmVnKVxuICAgIHJldHVybiAoMHhmZmZmIC0gdmFsICsgMSkgKiAtMVxuICBlbHNlXG4gICAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkSW50MTYodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDE2KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZEludDMyIChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbCA9IF9yZWFkVUludDMyKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIHRydWUpXG4gIHZhciBuZWcgPSB2YWwgJiAweDgwMDAwMDAwXG4gIGlmIChuZWcpXG4gICAgcmV0dXJuICgweGZmZmZmZmZmIC0gdmFsICsgMSkgKiAtMVxuICBlbHNlXG4gICAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkSW50MzIodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDMyKHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZEZsb2F0IChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHJldHVybiBpZWVlNzU0LnJlYWQoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRGbG9hdCh0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRmxvYXQodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF9yZWFkRG91YmxlIChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgKyA3IDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHJldHVybiBpZWVlNzU0LnJlYWQoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRG91YmxlKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRG91YmxlKHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZilcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVyblxuXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG59XG5cbmZ1bmN0aW9uIF93cml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmZmYpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGxlbiAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPVxuICAgICAgICAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmZmZmZmZmKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihsZW4gLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID1cbiAgICAgICAgKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZzaW50KHZhbHVlLCAweDdmLCAtMHg4MClcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpXG4gICAgcmV0dXJuXG5cbiAgaWYgKHZhbHVlID49IDApXG4gICAgdGhpcy53cml0ZVVJbnQ4KHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KVxuICBlbHNlXG4gICAgdGhpcy53cml0ZVVJbnQ4KDB4ZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDEgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2ZmZiwgLTB4ODAwMClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGlmICh2YWx1ZSA+PSAwKVxuICAgIF93cml0ZVVJbnQxNihidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpXG4gIGVsc2VcbiAgICBfd3JpdGVVSW50MTYoYnVmLCAweGZmZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZiAodmFsdWUgPj0gMClcbiAgICBfd3JpdGVVSW50MzIoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxuICBlbHNlXG4gICAgX3dyaXRlVUludDMyKGJ1ZiwgMHhmZmZmZmZmZiArIHZhbHVlICsgMSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZJRUVFNzU0KHZhbHVlLCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgNyA8IGJ1Zi5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmSUVFRTc1NCh2YWx1ZSwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHZhbHVlID0gdmFsdWUuY2hhckNvZGVBdCgwKVxuICB9XG5cbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgJiYgIWlzTmFOKHZhbHVlKSwgJ3ZhbHVlIGlzIG5vdCBhIG51bWJlcicpXG4gIGFzc2VydChlbmQgPj0gc3RhcnQsICdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBhc3NlcnQoc3RhcnQgPj0gMCAmJiBzdGFydCA8IHRoaXMubGVuZ3RoLCAnc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChlbmQgPj0gMCAmJiBlbmQgPD0gdGhpcy5sZW5ndGgsICdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICB0aGlzW2ldID0gdmFsdWVcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBvdXQgPSBbXVxuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIG91dFtpXSA9IHRvSGV4KHRoaXNbaV0pXG4gICAgaWYgKGkgPT09IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMpIHtcbiAgICAgIG91dFtpICsgMV0gPSAnLi4uJ1xuICAgICAgYnJlYWtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBvdXQuam9pbignICcpICsgJz4nXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuX3VzZVR5cGVkQXJyYXlzKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKVxuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IGdldC9zZXQgbWV0aG9kcyBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9nZXQgPSBhcnIuZ2V0XG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbi8vIHNsaWNlKHN0YXJ0LCBlbmQpXG5mdW5jdGlvbiBjbGFtcCAoaW5kZXgsIGxlbiwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh0eXBlb2YgaW5kZXggIT09ICdudW1iZXInKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGluZGV4ID0gfn5pbmRleDsgIC8vIENvZXJjZSB0byBpbnRlZ2VyLlxuICBpZiAoaW5kZXggPj0gbGVuKSByZXR1cm4gbGVuXG4gIGlmIChpbmRleCA+PSAwKSByZXR1cm4gaW5kZXhcbiAgaW5kZXggKz0gbGVuXG4gIGlmIChpbmRleCA+PSAwKSByZXR1cm4gaW5kZXhcbiAgcmV0dXJuIDBcbn1cblxuZnVuY3Rpb24gY29lcmNlIChsZW5ndGgpIHtcbiAgLy8gQ29lcmNlIGxlbmd0aCB0byBhIG51bWJlciAocG9zc2libHkgTmFOKSwgcm91bmQgdXBcbiAgLy8gaW4gY2FzZSBpdCdzIGZyYWN0aW9uYWwgKGUuZy4gMTIzLjQ1NikgdGhlbiBkbyBhXG4gIC8vIGRvdWJsZSBuZWdhdGUgdG8gY29lcmNlIGEgTmFOIHRvIDAuIEVhc3ksIHJpZ2h0P1xuICBsZW5ndGggPSB+fk1hdGguY2VpbCgrbGVuZ3RoKVxuICByZXR1cm4gbGVuZ3RoIDwgMCA/IDAgOiBsZW5ndGhcbn1cblxuZnVuY3Rpb24gaXNBcnJheSAoc3ViamVjdCkge1xuICByZXR1cm4gKEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gKHN1YmplY3QpIHtcbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHN1YmplY3QpID09PSAnW29iamVjdCBBcnJheV0nXG4gIH0pKHN1YmplY3QpXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlpc2ggKHN1YmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXkoc3ViamVjdCkgfHwgQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpIHx8XG4gICAgICBzdWJqZWN0ICYmIHR5cGVvZiBzdWJqZWN0ID09PSAnb2JqZWN0JyAmJlxuICAgICAgdHlwZW9mIHN1YmplY3QubGVuZ3RoID09PSAnbnVtYmVyJ1xufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGIgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGlmIChiIDw9IDB4N0YpXG4gICAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSlcbiAgICBlbHNlIHtcbiAgICAgIHZhciBzdGFydCA9IGlcbiAgICAgIGlmIChiID49IDB4RDgwMCAmJiBiIDw9IDB4REZGRikgaSsrXG4gICAgICB2YXIgaCA9IGVuY29kZVVSSUNvbXBvbmVudChzdHIuc2xpY2Uoc3RhcnQsIGkrMSkpLnN1YnN0cigxKS5zcGxpdCgnJScpXG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGgubGVuZ3RoOyBqKyspXG4gICAgICAgIGJ5dGVBcnJheS5wdXNoKHBhcnNlSW50KGhbal0sIDE2KSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoc3RyKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIHBvc1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKVxuICAgICAgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cblxuLypcbiAqIFdlIGhhdmUgdG8gbWFrZSBzdXJlIHRoYXQgdGhlIHZhbHVlIGlzIGEgdmFsaWQgaW50ZWdlci4gVGhpcyBtZWFucyB0aGF0IGl0XG4gKiBpcyBub24tbmVnYXRpdmUuIEl0IGhhcyBubyBmcmFjdGlvbmFsIGNvbXBvbmVudCBhbmQgdGhhdCBpdCBkb2VzIG5vdFxuICogZXhjZWVkIHRoZSBtYXhpbXVtIGFsbG93ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHZlcmlmdWludCAodmFsdWUsIG1heCkge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPj0gMCwgJ3NwZWNpZmllZCBhIG5lZ2F0aXZlIHZhbHVlIGZvciB3cml0aW5nIGFuIHVuc2lnbmVkIHZhbHVlJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGlzIGxhcmdlciB0aGFuIG1heGltdW0gdmFsdWUgZm9yIHR5cGUnKVxuICBhc3NlcnQoTWF0aC5mbG9vcih2YWx1ZSkgPT09IHZhbHVlLCAndmFsdWUgaGFzIGEgZnJhY3Rpb25hbCBjb21wb25lbnQnKVxufVxuXG5mdW5jdGlvbiB2ZXJpZnNpbnQgKHZhbHVlLCBtYXgsIG1pbikge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPD0gbWF4LCAndmFsdWUgbGFyZ2VyIHRoYW4gbWF4aW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KHZhbHVlID49IG1pbiwgJ3ZhbHVlIHNtYWxsZXIgdGhhbiBtaW5pbXVtIGFsbG93ZWQgdmFsdWUnKVxuICBhc3NlcnQoTWF0aC5mbG9vcih2YWx1ZSkgPT09IHZhbHVlLCAndmFsdWUgaGFzIGEgZnJhY3Rpb25hbCBjb21wb25lbnQnKVxufVxuXG5mdW5jdGlvbiB2ZXJpZklFRUU3NTQgKHZhbHVlLCBtYXgsIG1pbikge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPD0gbWF4LCAndmFsdWUgbGFyZ2VyIHRoYW4gbWF4aW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KHZhbHVlID49IG1pbiwgJ3ZhbHVlIHNtYWxsZXIgdGhhbiBtaW5pbXVtIGFsbG93ZWQgdmFsdWUnKVxufVxuXG5mdW5jdGlvbiBhc3NlcnQgKHRlc3QsIG1lc3NhZ2UpIHtcbiAgaWYgKCF0ZXN0KSB0aHJvdyBuZXcgRXJyb3IobWVzc2FnZSB8fCAnRmFpbGVkIGFzc2VydGlvbicpXG59XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiMVlpWjVTXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUylcblx0XHRcdHJldHVybiA2MiAvLyAnKydcblx0XHRpZiAoY29kZSA9PT0gU0xBU0gpXG5cdFx0XHRyZXR1cm4gNjMgLy8gJy8nXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIpXG5cdFx0XHRyZXR1cm4gLTEgLy9ubyBtYXRjaFxuXHRcdGlmIChjb2RlIDwgTlVNQkVSICsgMTApXG5cdFx0XHRyZXR1cm4gY29kZSAtIE5VTUJFUiArIDI2ICsgMjZcblx0XHRpZiAoY29kZSA8IFVQUEVSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIFVQUEVSXG5cdFx0aWYgKGNvZGUgPCBMT1dFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBMT1dFUiArIDI2XG5cdH1cblxuXHRmdW5jdGlvbiBiNjRUb0J5dGVBcnJheSAoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnJcblxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG5cdFx0fVxuXG5cdFx0Ly8gdGhlIG51bWJlciBvZiBlcXVhbCBzaWducyAocGxhY2UgaG9sZGVycylcblx0XHQvLyBpZiB0aGVyZSBhcmUgdHdvIHBsYWNlaG9sZGVycywgdGhhbiB0aGUgdHdvIGNoYXJhY3RlcnMgYmVmb3JlIGl0XG5cdFx0Ly8gcmVwcmVzZW50IG9uZSBieXRlXG5cdFx0Ly8gaWYgdGhlcmUgaXMgb25seSBvbmUsIHRoZW4gdGhlIHRocmVlIGNoYXJhY3RlcnMgYmVmb3JlIGl0IHJlcHJlc2VudCAyIGJ5dGVzXG5cdFx0Ly8gdGhpcyBpcyBqdXN0IGEgY2hlYXAgaGFjayB0byBub3QgZG8gaW5kZXhPZiB0d2ljZVxuXHRcdHZhciBsZW4gPSBiNjQubGVuZ3RoXG5cdFx0cGxhY2VIb2xkZXJzID0gJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDIpID8gMiA6ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAxKSA/IDEgOiAwXG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBuZXcgQXJyKGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycylcblxuXHRcdC8vIGlmIHRoZXJlIGFyZSBwbGFjZWhvbGRlcnMsIG9ubHkgZ2V0IHVwIHRvIHRoZSBsYXN0IGNvbXBsZXRlIDQgY2hhcnNcblx0XHRsID0gcGxhY2VIb2xkZXJzID4gMCA/IGI2NC5sZW5ndGggLSA0IDogYjY0Lmxlbmd0aFxuXG5cdFx0dmFyIEwgPSAwXG5cblx0XHRmdW5jdGlvbiBwdXNoICh2KSB7XG5cdFx0XHRhcnJbTCsrXSA9IHZcblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDE4KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDEyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpIDw8IDYpIHwgZGVjb2RlKGI2NC5jaGFyQXQoaSArIDMpKVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwKSA+PiA4KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdGlmIChwbGFjZUhvbGRlcnMgPT09IDIpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA+PiA0KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH0gZWxzZSBpZiAocGxhY2VIb2xkZXJzID09PSAxKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDEwKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDQpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPj4gMilcblx0XHRcdHB1c2goKHRtcCA+PiA4KSAmIDB4RkYpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFyclxuXHR9XG5cblx0ZnVuY3Rpb24gdWludDhUb0Jhc2U2NCAodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aFxuXG5cdFx0ZnVuY3Rpb24gZW5jb2RlIChudW0pIHtcblx0XHRcdHJldHVybiBsb29rdXAuY2hhckF0KG51bSlcblx0XHR9XG5cblx0XHRmdW5jdGlvbiB0cmlwbGV0VG9CYXNlNjQgKG51bSkge1xuXHRcdFx0cmV0dXJuIGVuY29kZShudW0gPj4gMTggJiAweDNGKSArIGVuY29kZShudW0gPj4gMTIgJiAweDNGKSArIGVuY29kZShudW0gPj4gNiAmIDB4M0YpICsgZW5jb2RlKG51bSAmIDB4M0YpXG5cdFx0fVxuXG5cdFx0Ly8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuXHRcdGZvciAoaSA9IDAsIGxlbmd0aCA9IHVpbnQ4Lmxlbmd0aCAtIGV4dHJhQnl0ZXM7IGkgPCBsZW5ndGg7IGkgKz0gMykge1xuXHRcdFx0dGVtcCA9ICh1aW50OFtpXSA8PCAxNikgKyAodWludDhbaSArIDFdIDw8IDgpICsgKHVpbnQ4W2kgKyAyXSlcblx0XHRcdG91dHB1dCArPSB0cmlwbGV0VG9CYXNlNjQodGVtcClcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPT0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0XHRjYXNlIDI6XG5cdFx0XHRcdHRlbXAgPSAodWludDhbdWludDgubGVuZ3RoIC0gMl0gPDwgOCkgKyAodWludDhbdWludDgubGVuZ3RoIC0gMV0pXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAxMClcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA+PiA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgMikgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0fVxuXG5cdFx0cmV0dXJuIG91dHB1dFxuXHR9XG5cblx0ZXhwb3J0cy50b0J5dGVBcnJheSA9IGI2NFRvQnl0ZUFycmF5XG5cdGV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjRcbn0odHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnID8gKHRoaXMuYmFzZTY0anMgPSB7fSkgOiBleHBvcnRzKSlcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIxWWlaNVNcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9saWIvYjY0LmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24oYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBuQml0cyA9IC03LFxuICAgICAgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwLFxuICAgICAgZCA9IGlzTEUgPyAtMSA6IDEsXG4gICAgICBzID0gYnVmZmVyW29mZnNldCArIGldO1xuXG4gIGkgKz0gZDtcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgcyA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IGVMZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBlID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gbUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzO1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSk7XG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICBlID0gZSAtIGVCaWFzO1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pO1xufTtcblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKSxcbiAgICAgIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKSxcbiAgICAgIGQgPSBpc0xFID8gMSA6IC0xLFxuICAgICAgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMDtcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKTtcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMDtcbiAgICBlID0gZU1heDtcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMik7XG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tO1xuICAgICAgYyAqPSAyO1xuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gYztcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpO1xuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrKztcbiAgICAgIGMgLz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwO1xuICAgICAgZSA9IGVNYXg7XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IGUgKyBlQmlhcztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IDA7XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCk7XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbTtcbiAgZUxlbiArPSBtTGVuO1xuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpO1xuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyODtcbn07XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiMVlpWjVTXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0XCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxucHJvY2Vzcy5uZXh0VGljayA9IChmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGNhblNldEltbWVkaWF0ZSA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnXG4gICAgJiYgd2luZG93LnNldEltbWVkaWF0ZTtcbiAgICB2YXIgY2FuUG9zdCA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnXG4gICAgJiYgd2luZG93LnBvc3RNZXNzYWdlICYmIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyXG4gICAgO1xuXG4gICAgaWYgKGNhblNldEltbWVkaWF0ZSkge1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKGYpIHsgcmV0dXJuIHdpbmRvdy5zZXRJbW1lZGlhdGUoZikgfTtcbiAgICB9XG5cbiAgICBpZiAoY2FuUG9zdCkge1xuICAgICAgICB2YXIgcXVldWUgPSBbXTtcbiAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbiAoZXYpIHtcbiAgICAgICAgICAgIHZhciBzb3VyY2UgPSBldi5zb3VyY2U7XG4gICAgICAgICAgICBpZiAoKHNvdXJjZSA9PT0gd2luZG93IHx8IHNvdXJjZSA9PT0gbnVsbCkgJiYgZXYuZGF0YSA9PT0gJ3Byb2Nlc3MtdGljaycpIHtcbiAgICAgICAgICAgICAgICBldi5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICBpZiAocXVldWUubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZm4gPSBxdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgICAgICBmbigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgdHJ1ZSk7XG5cbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIG5leHRUaWNrKGZuKSB7XG4gICAgICAgICAgICBxdWV1ZS5wdXNoKGZuKTtcbiAgICAgICAgICAgIHdpbmRvdy5wb3N0TWVzc2FnZSgncHJvY2Vzcy10aWNrJywgJyonKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgc2V0VGltZW91dChmbiwgMCk7XG4gICAgfTtcbn0pKCk7XG5cbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufVxuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiMVlpWjVTXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzXCIsXCIvLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8vIEdlbmVyYXRlZCBieSBDb2ZmZWVTY3JpcHQgMS43LjFcbihmdW5jdGlvbigpIHtcbiAgdmFyIExFVkVMUywgUEFUVEVSTlMsIFhSZWdFeHAsIGdldF90eXBlLCByb290LFxuICAgIF9faW5kZXhPZiA9IFtdLmluZGV4T2YgfHwgZnVuY3Rpb24oaXRlbSkgeyBmb3IgKHZhciBpID0gMCwgbCA9IHRoaXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7IGlmIChpIGluIHRoaXMgJiYgdGhpc1tpXSA9PT0gaXRlbSkgcmV0dXJuIGk7IH0gcmV0dXJuIC0xOyB9O1xuXG4gIHJvb3QgPSB0eXBlb2YgZXhwb3J0cyAhPT0gXCJ1bmRlZmluZWRcIiAmJiBleHBvcnRzICE9PSBudWxsID8gZXhwb3J0cyA6IHRoaXM7XG5cbiAgWFJlZ0V4cCA9IHJlcXVpcmUoXCJ4cmVnZXhwXCIpLlhSZWdFeHA7XG5cbiAgUEFUVEVSTlMgPSB7XG4gICAgYnJpZWY6IFhSZWdFeHAoXCJeKD88bGV2ZWw+W1ZESVdFQUZdKVxcXFwvKD88dGFnPlteKV17MCwyM30/KVxcXFwoXFxcXHMqKD88cGlkPlxcXFxkKylcXFxcKTpcXFxccyg/PG1lc3NhZ2U+LiopJFwiKSxcbiAgICB0aHJlYWR0aW1lOiBYUmVnRXhwKFwiXig/PHRpbWVzdGFtcD5cXFxcZFxcXFxkLVxcXFxkXFxcXGRcXFxcc1xcXFxkXFxcXGQ6XFxcXGRcXFxcZDpcXFxcZFxcXFxkXFxcXC5cXFxcZCspXFxcXHMqKD88cGlkPlxcXFxkKylcXFxccyooPzx0aWQ+XFxcXGQrKVxcXFxzKD88bGV2ZWw+W1ZESVdFQUZdKVxcXFxzKD88dGFnPi4qPyk6XFxcXHMoPzxtZXNzYWdlPi4qKSRcIiksXG4gICAgdGltZTogWFJlZ0V4cChcIl4oPzx0aW1lc3RhbXA+XFxcXGRcXFxcZC1cXFxcZFxcXFxkXFxcXHNcXFxcZFxcXFxkOlxcXFxkXFxcXGQ6XFxcXGRcXFxcZFxcXFwuXFxcXGQrKToqXFxcXHMoPzxsZXZlbD5bVkRJV0VBRl0pXFxcXC8oPzx0YWc+Lio/KVxcXFwoKD88cGlkPlxcXFxzKlxcXFxkKylcXFxcKTpcXFxccyg/PG1lc3NhZ2U+LiopJFwiKSxcbiAgICBwcm9jZXNzOiBYUmVnRXhwKFwiXig/PGxldmVsPltWRElXRUFGXSlcXFxcKFxcXFxzKig/PHBpZD5cXFxcZCspXFxcXClcXFxccyg/PG1lc3NhZ2U+LiopJFwiKSxcbiAgICB0YWc6IFhSZWdFeHAoXCJeKD88bGV2ZWw+W1ZESVdFQUZdKVxcXFwvKD88dGFnPlteKV17MCwyM30/KTpcXFxccyg/PG1lc3NhZ2U+LiopJFwiKSxcbiAgICB0aHJlYWQ6IFhSZWdFeHAoXCJeKD88bGV2ZWw+W1ZESVdFQUZdKVxcXFwoXFxcXHMqKD88cGlkPlxcXFxkKyk6KD88dGlkPjB4Lio/KVxcXFwpXFxcXHMoPzxtZXNzYWdlPi4qKSRcIiksXG4gICAgZGRtc19zYXZlOiBYUmVnRXhwKFwiXig/PHRpbWVzdGFtcD5cXFxcZFxcXFxkLVxcXFxkXFxcXGRcXFxcc1xcXFxkXFxcXGQ6XFxcXGRcXFxcZDpcXFxcZFxcXFxkXFxcXC5cXFxcZCspOipcXFxccyg/PGxldmVsPlZFUkJPU0V8REVCVUd8RVJST1J8V0FSTnxJTkZPfEFTU0VSVClcXFxcLyg/PHRhZz4uKj8pXFxcXCgoPzxwaWQ+XFxcXHMqXFxcXGQrKVxcXFwpOlxcXFxzKD88bWVzc2FnZT4uKikkXCIpXG4gIH07XG5cbiAgcm9vdC5QQVRURVJOUyA9IFBBVFRFUk5TO1xuXG4gIExFVkVMUyA9IHtcbiAgICBWOiBcInZlcmJvc2VcIixcbiAgICBEOiBcImRlYnVnXCIsXG4gICAgSTogXCJpbmZvXCIsXG4gICAgVzogXCJ3YXJuXCIsXG4gICAgRTogXCJlcnJvclwiLFxuICAgIEE6IFwiYXNzZXJ0XCIsXG4gICAgRjogXCJmYXRhbFwiLFxuICAgIFM6IFwic2lsZW50XCJcbiAgfTtcblxuICByb290LkxFVkVMUyA9IExFVkVMUztcblxuICBnZXRfdHlwZSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgICB2YXIgcGF0dGVybiwgdHlwZTtcbiAgICBmb3IgKHR5cGUgaW4gUEFUVEVSTlMpIHtcbiAgICAgIHBhdHRlcm4gPSBQQVRURVJOU1t0eXBlXTtcbiAgICAgIGNvbnNvbGUubG9nKFwidHJ5aW5nIFwiICsgdHlwZSArIFwiIC0gXCIgKyBwYXR0ZXJuKTtcbiAgICAgIGlmIChwYXR0ZXJuLnRlc3QobGluZSkpIHtcbiAgICAgICAgcmV0dXJuIHR5cGU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9O1xuXG4gIHJvb3QucGFyc2UgPSBmdW5jdGlvbihjb250ZW50cykge1xuICAgIHZhciBiYWRsaW5lcywgbGluZSwgbWVzc2FnZXMsIHR5cGUsIF9mbiwgX2ksIF9sZW4sIF9yZWY7XG4gICAgdHlwZSA9IG51bGw7XG4gICAgYmFkbGluZXMgPSAwO1xuICAgIG1lc3NhZ2VzID0gW107XG4gICAgX3JlZiA9IGNvbnRlbnRzLnNwbGl0KFwiXFxuXCIpO1xuICAgIF9mbiA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHZhciBlLCBtYXRjaCwgbWVzc2FnZSwgcmVnZXg7XG4gICAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9cXHMrJC9nLCBcIlwiKTtcbiAgICAgIGlmICghdHlwZSkge1xuICAgICAgICB0eXBlID0gZ2V0X3R5cGUobGluZSk7XG4gICAgICB9XG4gICAgICBpZiAodHlwZSAmJiBsaW5lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbWVzc2FnZSA9IHt9O1xuICAgICAgICByZWdleCA9IFBBVFRFUk5TW3R5cGVdO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIG1hdGNoID0gWFJlZ0V4cC5leGVjKGxpbmUsIHJlZ2V4KTtcbiAgICAgICAgICBpZiAoX19pbmRleE9mLmNhbGwocmVnZXgueHJlZ2V4cC5jYXB0dXJlTmFtZXMsICdsZXZlbCcpID49IDApIHtcbiAgICAgICAgICAgIG1lc3NhZ2UubGV2ZWwgPSBtYXRjaC5sZXZlbDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKF9faW5kZXhPZi5jYWxsKHJlZ2V4LnhyZWdleHAuY2FwdHVyZU5hbWVzLCAndGltZXN0YW1wJykgPj0gMCkge1xuICAgICAgICAgICAgbWVzc2FnZS50aW1lc3RhbXAgPSBtYXRjaC5sZXZlbDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKF9faW5kZXhPZi5jYWxsKHJlZ2V4LnhyZWdleHAuY2FwdHVyZU5hbWVzLCAncGlkJykgPj0gMCkge1xuICAgICAgICAgICAgbWVzc2FnZS5waWQgPSBtYXRjaC5waWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChfX2luZGV4T2YuY2FsbChyZWdleC54cmVnZXhwLmNhcHR1cmVOYW1lcywgJ3RpZCcpID49IDApIHtcbiAgICAgICAgICAgIG1lc3NhZ2UudGlkID0gbWF0Y2gudGlkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoX19pbmRleE9mLmNhbGwocmVnZXgueHJlZ2V4cC5jYXB0dXJlTmFtZXMsICd0YWcnKSA+PSAwKSB7XG4gICAgICAgICAgICBtZXNzYWdlLnRhZyA9IG1hdGNoLnRhZztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKF9faW5kZXhPZi5jYWxsKHJlZ2V4LnhyZWdleHAuY2FwdHVyZU5hbWVzLCAnbWVzc2FnZScpID49IDApIHtcbiAgICAgICAgICAgIG1lc3NhZ2UubWVzc2FnZSA9IG1hdGNoLm1lc3NhZ2U7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBtZXNzYWdlcy5wdXNoKG1lc3NhZ2UpO1xuICAgICAgICB9IGNhdGNoIChfZXJyb3IpIHtcbiAgICAgICAgICBlID0gX2Vycm9yO1xuICAgICAgICAgIHJldHVybiBiYWRsaW5lcyArPSAxO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICBmb3IgKF9pID0gMCwgX2xlbiA9IF9yZWYubGVuZ3RoOyBfaSA8IF9sZW47IF9pKyspIHtcbiAgICAgIGxpbmUgPSBfcmVmW19pXTtcbiAgICAgIF9mbihsaW5lKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IHR5cGUsXG4gICAgICBtZXNzYWdlczogbWVzc2FnZXMsXG4gICAgICBiYWRsaW5lczogYmFkbGluZXNcbiAgICB9O1xuICB9O1xuXG59KS5jYWxsKHRoaXMpO1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIjFZaVo1U1wiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL25vZGVfbW9kdWxlcy9sb2djYXQtcGFyc2UvbGliL2xvZ2NhdC1wYXJzZS5qc1wiLFwiLy4uL25vZGVfbW9kdWxlcy9sb2djYXQtcGFyc2UvbGliXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xuXG4vKioqKiogeHJlZ2V4cC5qcyAqKioqKi9cblxuLyohXHJcbiAqIFhSZWdFeHAgdjIuMC4wXHJcbiAqIChjKSAyMDA3LTIwMTIgU3RldmVuIExldml0aGFuIDxodHRwOi8veHJlZ2V4cC5jb20vPlxyXG4gKiBNSVQgTGljZW5zZVxyXG4gKi9cclxuXHJcbi8qKlxyXG4gKiBYUmVnRXhwIHByb3ZpZGVzIGF1Z21lbnRlZCwgZXh0ZW5zaWJsZSBKYXZhU2NyaXB0IHJlZ3VsYXIgZXhwcmVzc2lvbnMuIFlvdSBnZXQgbmV3IHN5bnRheCxcclxuICogZmxhZ3MsIGFuZCBtZXRob2RzIGJleW9uZCB3aGF0IGJyb3dzZXJzIHN1cHBvcnQgbmF0aXZlbHkuIFhSZWdFeHAgaXMgYWxzbyBhIHJlZ2V4IHV0aWxpdHkgYmVsdFxyXG4gKiB3aXRoIHRvb2xzIHRvIG1ha2UgeW91ciBjbGllbnQtc2lkZSBncmVwcGluZyBzaW1wbGVyIGFuZCBtb3JlIHBvd2VyZnVsLCB3aGlsZSBmcmVlaW5nIHlvdSBmcm9tXHJcbiAqIHdvcnJ5aW5nIGFib3V0IHBlc2t5IGNyb3NzLWJyb3dzZXIgaW5jb25zaXN0ZW5jaWVzIGFuZCB0aGUgZHViaW91cyBgbGFzdEluZGV4YCBwcm9wZXJ0eS4gU2VlXHJcbiAqIFhSZWdFeHAncyBkb2N1bWVudGF0aW9uIChodHRwOi8veHJlZ2V4cC5jb20vKSBmb3IgbW9yZSBkZXRhaWxzLlxyXG4gKiBAbW9kdWxlIHhyZWdleHBcclxuICogQHJlcXVpcmVzIE4vQVxyXG4gKi9cclxudmFyIFhSZWdFeHA7XHJcblxyXG4vLyBBdm9pZCBydW5uaW5nIHR3aWNlOyB0aGF0IHdvdWxkIHJlc2V0IHRva2VucyBhbmQgY291bGQgYnJlYWsgcmVmZXJlbmNlcyB0byBuYXRpdmUgZ2xvYmFsc1xyXG5YUmVnRXhwID0gWFJlZ0V4cCB8fCAoZnVuY3Rpb24gKHVuZGVmKSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICogIFByaXZhdGUgdmFyaWFibGVzXHJcbiAqLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cclxuXHJcbiAgICB2YXIgc2VsZixcclxuICAgICAgICBhZGRUb2tlbixcclxuICAgICAgICBhZGQsXHJcblxyXG4vLyBPcHRpb25hbCBmZWF0dXJlczsgY2FuIGJlIGluc3RhbGxlZCBhbmQgdW5pbnN0YWxsZWRcclxuICAgICAgICBmZWF0dXJlcyA9IHtcclxuICAgICAgICAgICAgbmF0aXZlczogZmFsc2UsXHJcbiAgICAgICAgICAgIGV4dGVuc2liaWxpdHk6IGZhbHNlXHJcbiAgICAgICAgfSxcclxuXHJcbi8vIFN0b3JlIG5hdGl2ZSBtZXRob2RzIHRvIHVzZSBhbmQgcmVzdG9yZSAoXCJuYXRpdmVcIiBpcyBhbiBFUzMgcmVzZXJ2ZWQga2V5d29yZClcclxuICAgICAgICBuYXRpdiA9IHtcclxuICAgICAgICAgICAgZXhlYzogUmVnRXhwLnByb3RvdHlwZS5leGVjLFxyXG4gICAgICAgICAgICB0ZXN0OiBSZWdFeHAucHJvdG90eXBlLnRlc3QsXHJcbiAgICAgICAgICAgIG1hdGNoOiBTdHJpbmcucHJvdG90eXBlLm1hdGNoLFxyXG4gICAgICAgICAgICByZXBsYWNlOiBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UsXHJcbiAgICAgICAgICAgIHNwbGl0OiBTdHJpbmcucHJvdG90eXBlLnNwbGl0XHJcbiAgICAgICAgfSxcclxuXHJcbi8vIFN0b3JhZ2UgZm9yIGZpeGVkL2V4dGVuZGVkIG5hdGl2ZSBtZXRob2RzXHJcbiAgICAgICAgZml4ZWQgPSB7fSxcclxuXHJcbi8vIFN0b3JhZ2UgZm9yIGNhY2hlZCByZWdleGVzXHJcbiAgICAgICAgY2FjaGUgPSB7fSxcclxuXHJcbi8vIFN0b3JhZ2UgZm9yIGFkZG9uIHRva2Vuc1xyXG4gICAgICAgIHRva2VucyA9IFtdLFxyXG5cclxuLy8gVG9rZW4gc2NvcGVzXHJcbiAgICAgICAgZGVmYXVsdFNjb3BlID0gXCJkZWZhdWx0XCIsXHJcbiAgICAgICAgY2xhc3NTY29wZSA9IFwiY2xhc3NcIixcclxuXHJcbi8vIFJlZ2V4ZXMgdGhhdCBtYXRjaCBuYXRpdmUgcmVnZXggc3ludGF4XHJcbiAgICAgICAgbmF0aXZlVG9rZW5zID0ge1xyXG4gICAgICAgICAgICAvLyBBbnkgbmF0aXZlIG11bHRpY2hhcmFjdGVyIHRva2VuIGluIGRlZmF1bHQgc2NvcGUgKGluY2x1ZGVzIG9jdGFscywgZXhjbHVkZXMgY2hhcmFjdGVyIGNsYXNzZXMpXHJcbiAgICAgICAgICAgIFwiZGVmYXVsdFwiOiAvXig/OlxcXFwoPzowKD86WzAtM11bMC03XXswLDJ9fFs0LTddWzAtN10/KT98WzEtOV1cXGQqfHhbXFxkQS1GYS1mXXsyfXx1W1xcZEEtRmEtZl17NH18Y1tBLVphLXpdfFtcXHNcXFNdKXxcXChcXD9bOj0hXXxbPyorXVxcP3x7XFxkKyg/OixcXGQqKT99XFw/PykvLFxyXG4gICAgICAgICAgICAvLyBBbnkgbmF0aXZlIG11bHRpY2hhcmFjdGVyIHRva2VuIGluIGNoYXJhY3RlciBjbGFzcyBzY29wZSAoaW5jbHVkZXMgb2N0YWxzKVxyXG4gICAgICAgICAgICBcImNsYXNzXCI6IC9eKD86XFxcXCg/OlswLTNdWzAtN117MCwyfXxbNC03XVswLTddP3x4W1xcZEEtRmEtZl17Mn18dVtcXGRBLUZhLWZdezR9fGNbQS1aYS16XXxbXFxzXFxTXSkpL1xyXG4gICAgICAgIH0sXHJcblxyXG4vLyBBbnkgYmFja3JlZmVyZW5jZSBpbiByZXBsYWNlbWVudCBzdHJpbmdzXHJcbiAgICAgICAgcmVwbGFjZW1lbnRUb2tlbiA9IC9cXCQoPzp7KFtcXHckXSspfXwoXFxkXFxkP3xbXFxzXFxTXSkpL2csXHJcblxyXG4vLyBBbnkgY2hhcmFjdGVyIHdpdGggYSBsYXRlciBpbnN0YW5jZSBpbiB0aGUgc3RyaW5nXHJcbiAgICAgICAgZHVwbGljYXRlRmxhZ3MgPSAvKFtcXHNcXFNdKSg/PVtcXHNcXFNdKlxcMSkvZyxcclxuXHJcbi8vIEFueSBncmVlZHkvbGF6eSBxdWFudGlmaWVyXHJcbiAgICAgICAgcXVhbnRpZmllciA9IC9eKD86Wz8qK118e1xcZCsoPzosXFxkKik/fSlcXD8/LyxcclxuXHJcbi8vIENoZWNrIGZvciBjb3JyZWN0IGBleGVjYCBoYW5kbGluZyBvZiBub25wYXJ0aWNpcGF0aW5nIGNhcHR1cmluZyBncm91cHNcclxuICAgICAgICBjb21wbGlhbnRFeGVjTnBjZyA9IG5hdGl2LmV4ZWMuY2FsbCgvKCk/Py8sIFwiXCIpWzFdID09PSB1bmRlZixcclxuXHJcbi8vIENoZWNrIGZvciBmbGFnIHkgc3VwcG9ydCAoRmlyZWZveCAzKylcclxuICAgICAgICBoYXNOYXRpdmVZID0gUmVnRXhwLnByb3RvdHlwZS5zdGlja3kgIT09IHVuZGVmLFxyXG5cclxuLy8gVXNlZCB0byBraWxsIGluZmluaXRlIHJlY3Vyc2lvbiBkdXJpbmcgWFJlZ0V4cCBjb25zdHJ1Y3Rpb25cclxuICAgICAgICBpc0luc2lkZUNvbnN0cnVjdG9yID0gZmFsc2UsXHJcblxyXG4vLyBTdG9yYWdlIGZvciBrbm93biBmbGFncywgaW5jbHVkaW5nIGFkZG9uIGZsYWdzXHJcbiAgICAgICAgcmVnaXN0ZXJlZEZsYWdzID0gXCJnaW1cIiArIChoYXNOYXRpdmVZID8gXCJ5XCIgOiBcIlwiKTtcclxuXHJcbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICogIFByaXZhdGUgaGVscGVyIGZ1bmN0aW9uc1xyXG4gKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXHJcblxyXG4vKipcclxuICogQXR0YWNoZXMgWFJlZ0V4cC5wcm90b3R5cGUgcHJvcGVydGllcyBhbmQgbmFtZWQgY2FwdHVyZSBzdXBwb3J0aW5nIGRhdGEgdG8gYSByZWdleCBvYmplY3QuXHJcbiAqIEBwcml2YXRlXHJcbiAqIEBwYXJhbSB7UmVnRXhwfSByZWdleCBSZWdleCB0byBhdWdtZW50LlxyXG4gKiBAcGFyYW0ge0FycmF5fSBjYXB0dXJlTmFtZXMgQXJyYXkgd2l0aCBjYXB0dXJlIG5hbWVzLCBvciBudWxsLlxyXG4gKiBAcGFyYW0ge0Jvb2xlYW59IFtpc05hdGl2ZV0gV2hldGhlciB0aGUgcmVnZXggd2FzIGNyZWF0ZWQgYnkgYFJlZ0V4cGAgcmF0aGVyIHRoYW4gYFhSZWdFeHBgLlxyXG4gKiBAcmV0dXJucyB7UmVnRXhwfSBBdWdtZW50ZWQgcmVnZXguXHJcbiAqL1xyXG4gICAgZnVuY3Rpb24gYXVnbWVudChyZWdleCwgY2FwdHVyZU5hbWVzLCBpc05hdGl2ZSkge1xyXG4gICAgICAgIHZhciBwO1xyXG4gICAgICAgIC8vIENhbid0IGF1dG8taW5oZXJpdCB0aGVzZSBzaW5jZSB0aGUgWFJlZ0V4cCBjb25zdHJ1Y3RvciByZXR1cm5zIGEgbm9ucHJpbWl0aXZlIHZhbHVlXHJcbiAgICAgICAgZm9yIChwIGluIHNlbGYucHJvdG90eXBlKSB7XHJcbiAgICAgICAgICAgIGlmIChzZWxmLnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eShwKSkge1xyXG4gICAgICAgICAgICAgICAgcmVnZXhbcF0gPSBzZWxmLnByb3RvdHlwZVtwXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZWdleC54cmVnZXhwID0ge2NhcHR1cmVOYW1lczogY2FwdHVyZU5hbWVzLCBpc05hdGl2ZTogISFpc05hdGl2ZX07XHJcbiAgICAgICAgcmV0dXJuIHJlZ2V4O1xyXG4gICAgfVxyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgbmF0aXZlIGBSZWdFeHBgIGZsYWdzIHVzZWQgYnkgYSByZWdleCBvYmplY3QuXHJcbiAqIEBwcml2YXRlXHJcbiAqIEBwYXJhbSB7UmVnRXhwfSByZWdleCBSZWdleCB0byBjaGVjay5cclxuICogQHJldHVybnMge1N0cmluZ30gTmF0aXZlIGZsYWdzIGluIHVzZS5cclxuICovXHJcbiAgICBmdW5jdGlvbiBnZXROYXRpdmVGbGFncyhyZWdleCkge1xyXG4gICAgICAgIC8vcmV0dXJuIG5hdGl2LmV4ZWMuY2FsbCgvXFwvKFthLXpdKikkL2ksIFN0cmluZyhyZWdleCkpWzFdO1xyXG4gICAgICAgIHJldHVybiAocmVnZXguZ2xvYmFsICAgICA/IFwiZ1wiIDogXCJcIikgK1xyXG4gICAgICAgICAgICAgICAocmVnZXguaWdub3JlQ2FzZSA/IFwiaVwiIDogXCJcIikgK1xyXG4gICAgICAgICAgICAgICAocmVnZXgubXVsdGlsaW5lICA/IFwibVwiIDogXCJcIikgK1xyXG4gICAgICAgICAgICAgICAocmVnZXguZXh0ZW5kZWQgICA/IFwieFwiIDogXCJcIikgKyAvLyBQcm9wb3NlZCBmb3IgRVM2LCBpbmNsdWRlZCBpbiBBUzNcclxuICAgICAgICAgICAgICAgKHJlZ2V4LnN0aWNreSAgICAgPyBcInlcIiA6IFwiXCIpOyAvLyBQcm9wb3NlZCBmb3IgRVM2LCBpbmNsdWRlZCBpbiBGaXJlZm94IDMrXHJcbiAgICB9XHJcblxyXG4vKipcclxuICogQ29waWVzIGEgcmVnZXggb2JqZWN0IHdoaWxlIHByZXNlcnZpbmcgc3BlY2lhbCBwcm9wZXJ0aWVzIGZvciBuYW1lZCBjYXB0dXJlIGFuZCBhdWdtZW50aW5nIHdpdGhcclxuICogYFhSZWdFeHAucHJvdG90eXBlYCBtZXRob2RzLiBUaGUgY29weSBoYXMgYSBmcmVzaCBgbGFzdEluZGV4YCBwcm9wZXJ0eSAoc2V0IHRvIHplcm8pLiBBbGxvd3NcclxuICogYWRkaW5nIGFuZCByZW1vdmluZyBmbGFncyB3aGlsZSBjb3B5aW5nIHRoZSByZWdleC5cclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtSZWdFeHB9IHJlZ2V4IFJlZ2V4IHRvIGNvcHkuXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBbYWRkRmxhZ3NdIEZsYWdzIHRvIGJlIGFkZGVkIHdoaWxlIGNvcHlpbmcgdGhlIHJlZ2V4LlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gW3JlbW92ZUZsYWdzXSBGbGFncyB0byBiZSByZW1vdmVkIHdoaWxlIGNvcHlpbmcgdGhlIHJlZ2V4LlxyXG4gKiBAcmV0dXJucyB7UmVnRXhwfSBDb3B5IG9mIHRoZSBwcm92aWRlZCByZWdleCwgcG9zc2libHkgd2l0aCBtb2RpZmllZCBmbGFncy5cclxuICovXHJcbiAgICBmdW5jdGlvbiBjb3B5KHJlZ2V4LCBhZGRGbGFncywgcmVtb3ZlRmxhZ3MpIHtcclxuICAgICAgICBpZiAoIXNlbGYuaXNSZWdFeHAocmVnZXgpKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJ0eXBlIFJlZ0V4cCBleHBlY3RlZFwiKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIGZsYWdzID0gbmF0aXYucmVwbGFjZS5jYWxsKGdldE5hdGl2ZUZsYWdzKHJlZ2V4KSArIChhZGRGbGFncyB8fCBcIlwiKSwgZHVwbGljYXRlRmxhZ3MsIFwiXCIpO1xyXG4gICAgICAgIGlmIChyZW1vdmVGbGFncykge1xyXG4gICAgICAgICAgICAvLyBXb3VsZCBuZWVkIHRvIGVzY2FwZSBgcmVtb3ZlRmxhZ3NgIGlmIHRoaXMgd2FzIHB1YmxpY1xyXG4gICAgICAgICAgICBmbGFncyA9IG5hdGl2LnJlcGxhY2UuY2FsbChmbGFncywgbmV3IFJlZ0V4cChcIltcIiArIHJlbW92ZUZsYWdzICsgXCJdK1wiLCBcImdcIiksIFwiXCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocmVnZXgueHJlZ2V4cCAmJiAhcmVnZXgueHJlZ2V4cC5pc05hdGl2ZSkge1xyXG4gICAgICAgICAgICAvLyBDb21waWxpbmcgdGhlIGN1cnJlbnQgKHJhdGhlciB0aGFuIHByZWNvbXBpbGF0aW9uKSBzb3VyY2UgcHJlc2VydmVzIHRoZSBlZmZlY3RzIG9mIG5vbm5hdGl2ZSBzb3VyY2UgZmxhZ3NcclxuICAgICAgICAgICAgcmVnZXggPSBhdWdtZW50KHNlbGYocmVnZXguc291cmNlLCBmbGFncyksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdleC54cmVnZXhwLmNhcHR1cmVOYW1lcyA/IHJlZ2V4LnhyZWdleHAuY2FwdHVyZU5hbWVzLnNsaWNlKDApIDogbnVsbCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gQXVnbWVudCB3aXRoIGBYUmVnRXhwLnByb3RvdHlwZWAgbWV0aG9kcywgYnV0IHVzZSBuYXRpdmUgYFJlZ0V4cGAgKGF2b2lkIHNlYXJjaGluZyBmb3Igc3BlY2lhbCB0b2tlbnMpXHJcbiAgICAgICAgICAgIHJlZ2V4ID0gYXVnbWVudChuZXcgUmVnRXhwKHJlZ2V4LnNvdXJjZSwgZmxhZ3MpLCBudWxsLCB0cnVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHJlZ2V4O1xyXG4gICAgfVxyXG5cclxuLypcclxuICogUmV0dXJucyB0aGUgbGFzdCBpbmRleCBhdCB3aGljaCBhIGdpdmVuIHZhbHVlIGNhbiBiZSBmb3VuZCBpbiBhbiBhcnJheSwgb3IgYC0xYCBpZiBpdCdzIG5vdFxyXG4gKiBwcmVzZW50LiBUaGUgYXJyYXkgaXMgc2VhcmNoZWQgYmFja3dhcmRzLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge0FycmF5fSBhcnJheSBBcnJheSB0byBzZWFyY2guXHJcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVmFsdWUgdG8gbG9jYXRlIGluIHRoZSBhcnJheS5cclxuICogQHJldHVybnMge051bWJlcn0gTGFzdCB6ZXJvLWJhc2VkIGluZGV4IGF0IHdoaWNoIHRoZSBpdGVtIGlzIGZvdW5kLCBvciAtMS5cclxuICovXHJcbiAgICBmdW5jdGlvbiBsYXN0SW5kZXhPZihhcnJheSwgdmFsdWUpIHtcclxuICAgICAgICB2YXIgaSA9IGFycmF5Lmxlbmd0aDtcclxuICAgICAgICBpZiAoQXJyYXkucHJvdG90eXBlLmxhc3RJbmRleE9mKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBhcnJheS5sYXN0SW5kZXhPZih2YWx1ZSk7IC8vIFVzZSB0aGUgbmF0aXZlIG1ldGhvZCBpZiBhdmFpbGFibGVcclxuICAgICAgICB9XHJcbiAgICAgICAgd2hpbGUgKGktLSkge1xyXG4gICAgICAgICAgICBpZiAoYXJyYXlbaV0gPT09IHZhbHVlKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gaTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gLTE7XHJcbiAgICB9XHJcblxyXG4vKipcclxuICogRGV0ZXJtaW5lcyB3aGV0aGVyIGFuIG9iamVjdCBpcyBvZiB0aGUgc3BlY2lmaWVkIHR5cGUuXHJcbiAqIEBwcml2YXRlXHJcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgT2JqZWN0IHRvIGNoZWNrLlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gdHlwZSBUeXBlIHRvIGNoZWNrIGZvciwgaW4gbG93ZXJjYXNlLlxyXG4gKiBAcmV0dXJucyB7Qm9vbGVhbn0gV2hldGhlciB0aGUgb2JqZWN0IG1hdGNoZXMgdGhlIHR5cGUuXHJcbiAqL1xyXG4gICAgZnVuY3Rpb24gaXNUeXBlKHZhbHVlLCB0eXBlKSB7XHJcbiAgICAgICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh2YWx1ZSkudG9Mb3dlckNhc2UoKSA9PT0gXCJbb2JqZWN0IFwiICsgdHlwZSArIFwiXVwiO1xyXG4gICAgfVxyXG5cclxuLyoqXHJcbiAqIFByZXBhcmVzIGFuIG9wdGlvbnMgb2JqZWN0IGZyb20gdGhlIGdpdmVuIHZhbHVlLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IHZhbHVlIFZhbHVlIHRvIGNvbnZlcnQgdG8gYW4gb3B0aW9ucyBvYmplY3QuXHJcbiAqIEByZXR1cm5zIHtPYmplY3R9IE9wdGlvbnMgb2JqZWN0LlxyXG4gKi9cclxuICAgIGZ1bmN0aW9uIHByZXBhcmVPcHRpb25zKHZhbHVlKSB7XHJcbiAgICAgICAgdmFsdWUgPSB2YWx1ZSB8fCB7fTtcclxuICAgICAgICBpZiAodmFsdWUgPT09IFwiYWxsXCIgfHwgdmFsdWUuYWxsKSB7XHJcbiAgICAgICAgICAgIHZhbHVlID0ge25hdGl2ZXM6IHRydWUsIGV4dGVuc2liaWxpdHk6IHRydWV9O1xyXG4gICAgICAgIH0gZWxzZSBpZiAoaXNUeXBlKHZhbHVlLCBcInN0cmluZ1wiKSkge1xyXG4gICAgICAgICAgICB2YWx1ZSA9IHNlbGYuZm9yRWFjaCh2YWx1ZSwgL1teXFxzLF0rLywgZnVuY3Rpb24gKG0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXNbbV0gPSB0cnVlO1xyXG4gICAgICAgICAgICB9LCB7fSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB2YWx1ZTtcclxuICAgIH1cclxuXHJcbi8qKlxyXG4gKiBSdW5zIGJ1aWx0LWluL2N1c3RvbSB0b2tlbnMgaW4gcmV2ZXJzZSBpbnNlcnRpb24gb3JkZXIsIHVudGlsIGEgbWF0Y2ggaXMgZm91bmQuXHJcbiAqIEBwcml2YXRlXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBwYXR0ZXJuIE9yaWdpbmFsIHBhdHRlcm4gZnJvbSB3aGljaCBhbiBYUmVnRXhwIG9iamVjdCBpcyBiZWluZyBidWlsdC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IHBvcyBQb3NpdGlvbiB0byBzZWFyY2ggZm9yIHRva2VucyB3aXRoaW4gYHBhdHRlcm5gLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gc2NvcGUgQ3VycmVudCByZWdleCBzY29wZS5cclxuICogQHBhcmFtIHtPYmplY3R9IGNvbnRleHQgQ29udGV4dCBvYmplY3QgYXNzaWduZWQgdG8gdG9rZW4gaGFuZGxlciBmdW5jdGlvbnMuXHJcbiAqIEByZXR1cm5zIHtPYmplY3R9IE9iamVjdCB3aXRoIHByb3BlcnRpZXMgYG91dHB1dGAgKHRoZSBzdWJzdGl0dXRpb24gc3RyaW5nIHJldHVybmVkIGJ5IHRoZVxyXG4gKiAgIHN1Y2Nlc3NmdWwgdG9rZW4gaGFuZGxlcikgYW5kIGBtYXRjaGAgKHRoZSB0b2tlbidzIG1hdGNoIGFycmF5KSwgb3IgbnVsbC5cclxuICovXHJcbiAgICBmdW5jdGlvbiBydW5Ub2tlbnMocGF0dGVybiwgcG9zLCBzY29wZSwgY29udGV4dCkge1xyXG4gICAgICAgIHZhciBpID0gdG9rZW5zLmxlbmd0aCxcclxuICAgICAgICAgICAgcmVzdWx0ID0gbnVsbCxcclxuICAgICAgICAgICAgbWF0Y2gsXHJcbiAgICAgICAgICAgIHQ7XHJcbiAgICAgICAgLy8gUHJvdGVjdCBhZ2FpbnN0IGNvbnN0cnVjdGluZyBYUmVnRXhwcyB3aXRoaW4gdG9rZW4gaGFuZGxlciBhbmQgdHJpZ2dlciBmdW5jdGlvbnNcclxuICAgICAgICBpc0luc2lkZUNvbnN0cnVjdG9yID0gdHJ1ZTtcclxuICAgICAgICAvLyBNdXN0IHJlc2V0IGBpc0luc2lkZUNvbnN0cnVjdG9yYCwgZXZlbiBpZiBhIGB0cmlnZ2VyYCBvciBgaGFuZGxlcmAgdGhyb3dzXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgd2hpbGUgKGktLSkgeyAvLyBSdW4gaW4gcmV2ZXJzZSBvcmRlclxyXG4gICAgICAgICAgICAgICAgdCA9IHRva2Vuc1tpXTtcclxuICAgICAgICAgICAgICAgIGlmICgodC5zY29wZSA9PT0gXCJhbGxcIiB8fCB0LnNjb3BlID09PSBzY29wZSkgJiYgKCF0LnRyaWdnZXIgfHwgdC50cmlnZ2VyLmNhbGwoY29udGV4dCkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdC5wYXR0ZXJuLmxhc3RJbmRleCA9IHBvcztcclxuICAgICAgICAgICAgICAgICAgICBtYXRjaCA9IGZpeGVkLmV4ZWMuY2FsbCh0LnBhdHRlcm4sIHBhdHRlcm4pOyAvLyBGaXhlZCBgZXhlY2AgaGVyZSBhbGxvd3MgdXNlIG9mIG5hbWVkIGJhY2tyZWZlcmVuY2VzLCBldGMuXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoICYmIG1hdGNoLmluZGV4ID09PSBwb3MpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3V0cHV0OiB0LmhhbmRsZXIuY2FsbChjb250ZXh0LCBtYXRjaCwgc2NvcGUpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2g6IG1hdGNoXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICB0aHJvdyBlcnI7XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgICAgaXNJbnNpZGVDb25zdHJ1Y3RvciA9IGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfVxyXG5cclxuLyoqXHJcbiAqIEVuYWJsZXMgb3IgZGlzYWJsZXMgWFJlZ0V4cCBzeW50YXggYW5kIGZsYWcgZXh0ZW5zaWJpbGl0eS5cclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtCb29sZWFufSBvbiBgdHJ1ZWAgdG8gZW5hYmxlOyBgZmFsc2VgIHRvIGRpc2FibGUuXHJcbiAqL1xyXG4gICAgZnVuY3Rpb24gc2V0RXh0ZW5zaWJpbGl0eShvbikge1xyXG4gICAgICAgIHNlbGYuYWRkVG9rZW4gPSBhZGRUb2tlbltvbiA/IFwib25cIiA6IFwib2ZmXCJdO1xyXG4gICAgICAgIGZlYXR1cmVzLmV4dGVuc2liaWxpdHkgPSBvbjtcclxuICAgIH1cclxuXHJcbi8qKlxyXG4gKiBFbmFibGVzIG9yIGRpc2FibGVzIG5hdGl2ZSBtZXRob2Qgb3ZlcnJpZGVzLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge0Jvb2xlYW59IG9uIGB0cnVlYCB0byBlbmFibGU7IGBmYWxzZWAgdG8gZGlzYWJsZS5cclxuICovXHJcbiAgICBmdW5jdGlvbiBzZXROYXRpdmVzKG9uKSB7XHJcbiAgICAgICAgUmVnRXhwLnByb3RvdHlwZS5leGVjID0gKG9uID8gZml4ZWQgOiBuYXRpdikuZXhlYztcclxuICAgICAgICBSZWdFeHAucHJvdG90eXBlLnRlc3QgPSAob24gPyBmaXhlZCA6IG5hdGl2KS50ZXN0O1xyXG4gICAgICAgIFN0cmluZy5wcm90b3R5cGUubWF0Y2ggPSAob24gPyBmaXhlZCA6IG5hdGl2KS5tYXRjaDtcclxuICAgICAgICBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2UgPSAob24gPyBmaXhlZCA6IG5hdGl2KS5yZXBsYWNlO1xyXG4gICAgICAgIFN0cmluZy5wcm90b3R5cGUuc3BsaXQgPSAob24gPyBmaXhlZCA6IG5hdGl2KS5zcGxpdDtcclxuICAgICAgICBmZWF0dXJlcy5uYXRpdmVzID0gb247XHJcbiAgICB9XHJcblxyXG4vKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAqICBDb25zdHJ1Y3RvclxyXG4gKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXHJcblxyXG4vKipcclxuICogQ3JlYXRlcyBhbiBleHRlbmRlZCByZWd1bGFyIGV4cHJlc3Npb24gb2JqZWN0IGZvciBtYXRjaGluZyB0ZXh0IHdpdGggYSBwYXR0ZXJuLiBEaWZmZXJzIGZyb20gYVxyXG4gKiBuYXRpdmUgcmVndWxhciBleHByZXNzaW9uIGluIHRoYXQgYWRkaXRpb25hbCBzeW50YXggYW5kIGZsYWdzIGFyZSBzdXBwb3J0ZWQuIFRoZSByZXR1cm5lZCBvYmplY3RcclxuICogaXMgaW4gZmFjdCBhIG5hdGl2ZSBgUmVnRXhwYCBhbmQgd29ya3Mgd2l0aCBhbGwgbmF0aXZlIG1ldGhvZHMuXHJcbiAqIEBjbGFzcyBYUmVnRXhwXHJcbiAqIEBjb25zdHJ1Y3RvclxyXG4gKiBAcGFyYW0ge1N0cmluZ3xSZWdFeHB9IHBhdHRlcm4gUmVnZXggcGF0dGVybiBzdHJpbmcsIG9yIGFuIGV4aXN0aW5nIGBSZWdFeHBgIG9iamVjdCB0byBjb3B5LlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gW2ZsYWdzXSBBbnkgY29tYmluYXRpb24gb2YgZmxhZ3M6XHJcbiAqICAgPGxpPmBnYCAtIGdsb2JhbFxyXG4gKiAgIDxsaT5gaWAgLSBpZ25vcmUgY2FzZVxyXG4gKiAgIDxsaT5gbWAgLSBtdWx0aWxpbmUgYW5jaG9yc1xyXG4gKiAgIDxsaT5gbmAgLSBleHBsaWNpdCBjYXB0dXJlXHJcbiAqICAgPGxpPmBzYCAtIGRvdCBtYXRjaGVzIGFsbCAoYWthIHNpbmdsZWxpbmUpXHJcbiAqICAgPGxpPmB4YCAtIGZyZWUtc3BhY2luZyBhbmQgbGluZSBjb21tZW50cyAoYWthIGV4dGVuZGVkKVxyXG4gKiAgIDxsaT5geWAgLSBzdGlja3kgKEZpcmVmb3ggMysgb25seSlcclxuICogICBGbGFncyBjYW5ub3QgYmUgcHJvdmlkZWQgd2hlbiBjb25zdHJ1Y3Rpbmcgb25lIGBSZWdFeHBgIGZyb20gYW5vdGhlci5cclxuICogQHJldHVybnMge1JlZ0V4cH0gRXh0ZW5kZWQgcmVndWxhciBleHByZXNzaW9uIG9iamVjdC5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogLy8gV2l0aCBuYW1lZCBjYXB0dXJlIGFuZCBmbGFnIHhcclxuICogZGF0ZSA9IFhSZWdFeHAoJyg/PHllYXI+ICBbMC05XXs0fSkgLT8gICMgeWVhciAgXFxuXFxcclxuICogICAgICAgICAgICAgICAgICg/PG1vbnRoPiBbMC05XXsyfSkgLT8gICMgbW9udGggXFxuXFxcclxuICogICAgICAgICAgICAgICAgICg/PGRheT4gICBbMC05XXsyfSkgICAgICMgZGF5ICAgJywgJ3gnKTtcclxuICpcclxuICogLy8gUGFzc2luZyBhIHJlZ2V4IG9iamVjdCB0byBjb3B5IGl0LiBUaGUgY29weSBtYWludGFpbnMgc3BlY2lhbCBwcm9wZXJ0aWVzIGZvciBuYW1lZCBjYXB0dXJlLFxyXG4gKiAvLyBpcyBhdWdtZW50ZWQgd2l0aCBgWFJlZ0V4cC5wcm90b3R5cGVgIG1ldGhvZHMsIGFuZCBoYXMgYSBmcmVzaCBgbGFzdEluZGV4YCBwcm9wZXJ0eSAoc2V0IHRvXHJcbiAqIC8vIHplcm8pLiBOYXRpdmUgcmVnZXhlcyBhcmUgbm90IHJlY29tcGlsZWQgdXNpbmcgWFJlZ0V4cCBzeW50YXguXHJcbiAqIFhSZWdFeHAoL3JlZ2V4Lyk7XHJcbiAqL1xyXG4gICAgc2VsZiA9IGZ1bmN0aW9uIChwYXR0ZXJuLCBmbGFncykge1xyXG4gICAgICAgIGlmIChzZWxmLmlzUmVnRXhwKHBhdHRlcm4pKSB7XHJcbiAgICAgICAgICAgIGlmIChmbGFncyAhPT0gdW5kZWYpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJjYW4ndCBzdXBwbHkgZmxhZ3Mgd2hlbiBjb25zdHJ1Y3Rpbmcgb25lIFJlZ0V4cCBmcm9tIGFub3RoZXJcIik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIGNvcHkocGF0dGVybik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIFRva2VucyBiZWNvbWUgcGFydCBvZiB0aGUgcmVnZXggY29uc3RydWN0aW9uIHByb2Nlc3MsIHNvIHByb3RlY3QgYWdhaW5zdCBpbmZpbml0ZSByZWN1cnNpb25cclxuICAgICAgICAvLyB3aGVuIGFuIFhSZWdFeHAgaXMgY29uc3RydWN0ZWQgd2l0aGluIGEgdG9rZW4gaGFuZGxlciBmdW5jdGlvblxyXG4gICAgICAgIGlmIChpc0luc2lkZUNvbnN0cnVjdG9yKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNhbid0IGNhbGwgdGhlIFhSZWdFeHAgY29uc3RydWN0b3Igd2l0aGluIHRva2VuIGRlZmluaXRpb24gZnVuY3Rpb25zXCIpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdmFyIG91dHB1dCA9IFtdLFxyXG4gICAgICAgICAgICBzY29wZSA9IGRlZmF1bHRTY29wZSxcclxuICAgICAgICAgICAgdG9rZW5Db250ZXh0ID0ge1xyXG4gICAgICAgICAgICAgICAgaGFzTmFtZWRDYXB0dXJlOiBmYWxzZSxcclxuICAgICAgICAgICAgICAgIGNhcHR1cmVOYW1lczogW10sXHJcbiAgICAgICAgICAgICAgICBoYXNGbGFnOiBmdW5jdGlvbiAoZmxhZykge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmbGFncy5pbmRleE9mKGZsYWcpID4gLTE7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHBvcyA9IDAsXHJcbiAgICAgICAgICAgIHRva2VuUmVzdWx0LFxyXG4gICAgICAgICAgICBtYXRjaCxcclxuICAgICAgICAgICAgY2hyO1xyXG4gICAgICAgIHBhdHRlcm4gPSBwYXR0ZXJuID09PSB1bmRlZiA/IFwiXCIgOiBTdHJpbmcocGF0dGVybik7XHJcbiAgICAgICAgZmxhZ3MgPSBmbGFncyA9PT0gdW5kZWYgPyBcIlwiIDogU3RyaW5nKGZsYWdzKTtcclxuXHJcbiAgICAgICAgaWYgKG5hdGl2Lm1hdGNoLmNhbGwoZmxhZ3MsIGR1cGxpY2F0ZUZsYWdzKSkgeyAvLyBEb24ndCB1c2UgdGVzdC9leGVjIGJlY2F1c2UgdGhleSB3b3VsZCB1cGRhdGUgbGFzdEluZGV4XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcImludmFsaWQgZHVwbGljYXRlIHJlZ3VsYXIgZXhwcmVzc2lvbiBmbGFnXCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBTdHJpcC9hcHBseSBsZWFkaW5nIG1vZGUgbW9kaWZpZXIgd2l0aCBhbnkgY29tYmluYXRpb24gb2YgZmxhZ3MgZXhjZXB0IGcgb3IgeTogKD9pbW5zeClcclxuICAgICAgICBwYXR0ZXJuID0gbmF0aXYucmVwbGFjZS5jYWxsKHBhdHRlcm4sIC9eXFwoXFw/KFtcXHckXSspXFwpLywgZnVuY3Rpb24gKCQwLCAkMSkge1xyXG4gICAgICAgICAgICBpZiAobmF0aXYudGVzdC5jYWxsKC9bZ3ldLywgJDEpKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJjYW4ndCB1c2UgZmxhZyBnIG9yIHkgaW4gbW9kZSBtb2RpZmllclwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBmbGFncyA9IG5hdGl2LnJlcGxhY2UuY2FsbChmbGFncyArICQxLCBkdXBsaWNhdGVGbGFncywgXCJcIik7XHJcbiAgICAgICAgICAgIHJldHVybiBcIlwiO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHNlbGYuZm9yRWFjaChmbGFncywgL1tcXHNcXFNdLywgZnVuY3Rpb24gKG0pIHtcclxuICAgICAgICAgICAgaWYgKHJlZ2lzdGVyZWRGbGFncy5pbmRleE9mKG1bMF0pIDwgMCkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiaW52YWxpZCByZWd1bGFyIGV4cHJlc3Npb24gZmxhZyBcIiArIG1bMF0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHdoaWxlIChwb3MgPCBwYXR0ZXJuLmxlbmd0aCkge1xyXG4gICAgICAgICAgICAvLyBDaGVjayBmb3IgY3VzdG9tIHRva2VucyBhdCB0aGUgY3VycmVudCBwb3NpdGlvblxyXG4gICAgICAgICAgICB0b2tlblJlc3VsdCA9IHJ1blRva2VucyhwYXR0ZXJuLCBwb3MsIHNjb3BlLCB0b2tlbkNvbnRleHQpO1xyXG4gICAgICAgICAgICBpZiAodG9rZW5SZXN1bHQpIHtcclxuICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKHRva2VuUmVzdWx0Lm91dHB1dCk7XHJcbiAgICAgICAgICAgICAgICBwb3MgKz0gKHRva2VuUmVzdWx0Lm1hdGNoWzBdLmxlbmd0aCB8fCAxKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIENoZWNrIGZvciBuYXRpdmUgdG9rZW5zIChleGNlcHQgY2hhcmFjdGVyIGNsYXNzZXMpIGF0IHRoZSBjdXJyZW50IHBvc2l0aW9uXHJcbiAgICAgICAgICAgICAgICBtYXRjaCA9IG5hdGl2LmV4ZWMuY2FsbChuYXRpdmVUb2tlbnNbc2NvcGVdLCBwYXR0ZXJuLnNsaWNlKHBvcykpO1xyXG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgb3V0cHV0LnB1c2gobWF0Y2hbMF0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHBvcyArPSBtYXRjaFswXS5sZW5ndGg7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNociA9IHBhdHRlcm4uY2hhckF0KHBvcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGNociA9PT0gXCJbXCIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2NvcGUgPSBjbGFzc1Njb3BlO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hyID09PSBcIl1cIikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzY29wZSA9IGRlZmF1bHRTY29wZTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQWR2YW5jZSBwb3NpdGlvbiBieSBvbmUgY2hhcmFjdGVyXHJcbiAgICAgICAgICAgICAgICAgICAgb3V0cHV0LnB1c2goY2hyKTtcclxuICAgICAgICAgICAgICAgICAgICArK3BvcztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGF1Z21lbnQobmV3IFJlZ0V4cChvdXRwdXQuam9pbihcIlwiKSwgbmF0aXYucmVwbGFjZS5jYWxsKGZsYWdzLCAvW15naW15XSsvZywgXCJcIikpLFxyXG4gICAgICAgICAgICAgICAgICAgICAgIHRva2VuQ29udGV4dC5oYXNOYW1lZENhcHR1cmUgPyB0b2tlbkNvbnRleHQuY2FwdHVyZU5hbWVzIDogbnVsbCk7XHJcbiAgICB9O1xyXG5cclxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gKiAgUHVibGljIG1ldGhvZHMvcHJvcGVydGllc1xyXG4gKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXHJcblxyXG4vLyBJbnN0YWxsZWQgYW5kIHVuaW5zdGFsbGVkIHN0YXRlcyBmb3IgYFhSZWdFeHAuYWRkVG9rZW5gXHJcbiAgICBhZGRUb2tlbiA9IHtcclxuICAgICAgICBvbjogZnVuY3Rpb24gKHJlZ2V4LCBoYW5kbGVyLCBvcHRpb25zKSB7XHJcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgICAgICAgICBpZiAocmVnZXgpIHtcclxuICAgICAgICAgICAgICAgIHRva2Vucy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICBwYXR0ZXJuOiBjb3B5KHJlZ2V4LCBcImdcIiArIChoYXNOYXRpdmVZID8gXCJ5XCIgOiBcIlwiKSksXHJcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlcjogaGFuZGxlcixcclxuICAgICAgICAgICAgICAgICAgICBzY29wZTogb3B0aW9ucy5zY29wZSB8fCBkZWZhdWx0U2NvcGUsXHJcbiAgICAgICAgICAgICAgICAgICAgdHJpZ2dlcjogb3B0aW9ucy50cmlnZ2VyIHx8IG51bGxcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIFByb3ZpZGluZyBgY3VzdG9tRmxhZ3NgIHdpdGggbnVsbCBgcmVnZXhgIGFuZCBgaGFuZGxlcmAgYWxsb3dzIGFkZGluZyBmbGFncyB0aGF0IGRvXHJcbiAgICAgICAgICAgIC8vIG5vdGhpbmcsIGJ1dCBkb24ndCB0aHJvdyBhbiBlcnJvclxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5jdXN0b21GbGFncykge1xyXG4gICAgICAgICAgICAgICAgcmVnaXN0ZXJlZEZsYWdzID0gbmF0aXYucmVwbGFjZS5jYWxsKHJlZ2lzdGVyZWRGbGFncyArIG9wdGlvbnMuY3VzdG9tRmxhZ3MsIGR1cGxpY2F0ZUZsYWdzLCBcIlwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb2ZmOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImV4dGVuc2liaWxpdHkgbXVzdCBiZSBpbnN0YWxsZWQgYmVmb3JlIHVzaW5nIGFkZFRva2VuXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG4vKipcclxuICogRXh0ZW5kcyBvciBjaGFuZ2VzIFhSZWdFeHAgc3ludGF4IGFuZCBhbGxvd3MgY3VzdG9tIGZsYWdzLiBUaGlzIGlzIHVzZWQgaW50ZXJuYWxseSBhbmQgY2FuIGJlXHJcbiAqIHVzZWQgdG8gY3JlYXRlIFhSZWdFeHAgYWRkb25zLiBgWFJlZ0V4cC5pbnN0YWxsKCdleHRlbnNpYmlsaXR5JylgIG11c3QgYmUgcnVuIGJlZm9yZSBjYWxsaW5nXHJcbiAqIHRoaXMgZnVuY3Rpb24sIG9yIGFuIGVycm9yIGlzIHRocm93bi4gSWYgbW9yZSB0aGFuIG9uZSB0b2tlbiBjYW4gbWF0Y2ggdGhlIHNhbWUgc3RyaW5nLCB0aGUgbGFzdFxyXG4gKiBhZGRlZCB3aW5zLlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge1JlZ0V4cH0gcmVnZXggUmVnZXggb2JqZWN0IHRoYXQgbWF0Y2hlcyB0aGUgbmV3IHRva2VuLlxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBoYW5kbGVyIEZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhIG5ldyBwYXR0ZXJuIHN0cmluZyAodXNpbmcgbmF0aXZlIHJlZ2V4IHN5bnRheClcclxuICogICB0byByZXBsYWNlIHRoZSBtYXRjaGVkIHRva2VuIHdpdGhpbiBhbGwgZnV0dXJlIFhSZWdFeHAgcmVnZXhlcy4gSGFzIGFjY2VzcyB0byBwZXJzaXN0ZW50XHJcbiAqICAgcHJvcGVydGllcyBvZiB0aGUgcmVnZXggYmVpbmcgYnVpbHQsIHRocm91Z2ggYHRoaXNgLiBJbnZva2VkIHdpdGggdHdvIGFyZ3VtZW50czpcclxuICogICA8bGk+VGhlIG1hdGNoIGFycmF5LCB3aXRoIG5hbWVkIGJhY2tyZWZlcmVuY2UgcHJvcGVydGllcy5cclxuICogICA8bGk+VGhlIHJlZ2V4IHNjb3BlIHdoZXJlIHRoZSBtYXRjaCB3YXMgZm91bmQuXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gT3B0aW9ucyBvYmplY3Qgd2l0aCBvcHRpb25hbCBwcm9wZXJ0aWVzOlxyXG4gKiAgIDxsaT5gc2NvcGVgIHtTdHJpbmd9IFNjb3BlcyB3aGVyZSB0aGUgdG9rZW4gYXBwbGllczogJ2RlZmF1bHQnLCAnY2xhc3MnLCBvciAnYWxsJy5cclxuICogICA8bGk+YHRyaWdnZXJgIHtGdW5jdGlvbn0gRnVuY3Rpb24gdGhhdCByZXR1cm5zIGB0cnVlYCB3aGVuIHRoZSB0b2tlbiBzaG91bGQgYmUgYXBwbGllZDsgZS5nLixcclxuICogICAgIGlmIGEgZmxhZyBpcyBzZXQuIElmIGBmYWxzZWAgaXMgcmV0dXJuZWQsIHRoZSBtYXRjaGVkIHN0cmluZyBjYW4gYmUgbWF0Y2hlZCBieSBvdGhlciB0b2tlbnMuXHJcbiAqICAgICBIYXMgYWNjZXNzIHRvIHBlcnNpc3RlbnQgcHJvcGVydGllcyBvZiB0aGUgcmVnZXggYmVpbmcgYnVpbHQsIHRocm91Z2ggYHRoaXNgIChpbmNsdWRpbmdcclxuICogICAgIGZ1bmN0aW9uIGB0aGlzLmhhc0ZsYWdgKS5cclxuICogICA8bGk+YGN1c3RvbUZsYWdzYCB7U3RyaW5nfSBOb25uYXRpdmUgZmxhZ3MgdXNlZCBieSB0aGUgdG9rZW4ncyBoYW5kbGVyIG9yIHRyaWdnZXIgZnVuY3Rpb25zLlxyXG4gKiAgICAgUHJldmVudHMgWFJlZ0V4cCBmcm9tIHRocm93aW5nIGFuIGludmFsaWQgZmxhZyBlcnJvciB3aGVuIHRoZSBzcGVjaWZpZWQgZmxhZ3MgYXJlIHVzZWQuXHJcbiAqIEBleGFtcGxlXHJcbiAqXHJcbiAqIC8vIEJhc2ljIHVzYWdlOiBBZGRzIFxcYSBmb3IgQUxFUlQgY2hhcmFjdGVyXHJcbiAqIFhSZWdFeHAuYWRkVG9rZW4oXHJcbiAqICAgL1xcXFxhLyxcclxuICogICBmdW5jdGlvbiAoKSB7cmV0dXJuICdcXFxceDA3Jzt9LFxyXG4gKiAgIHtzY29wZTogJ2FsbCd9XHJcbiAqICk7XHJcbiAqIFhSZWdFeHAoJ1xcXFxhW1xcXFxhLVxcXFxuXSsnKS50ZXN0KCdcXHgwN1xcblxceDA3Jyk7IC8vIC0+IHRydWVcclxuICovXHJcbiAgICBzZWxmLmFkZFRva2VuID0gYWRkVG9rZW4ub2ZmO1xyXG5cclxuLyoqXHJcbiAqIENhY2hlcyBhbmQgcmV0dXJucyB0aGUgcmVzdWx0IG9mIGNhbGxpbmcgYFhSZWdFeHAocGF0dGVybiwgZmxhZ3MpYC4gT24gYW55IHN1YnNlcXVlbnQgY2FsbCB3aXRoXHJcbiAqIHRoZSBzYW1lIHBhdHRlcm4gYW5kIGZsYWcgY29tYmluYXRpb24sIHRoZSBjYWNoZWQgY29weSBpcyByZXR1cm5lZC5cclxuICogQG1lbWJlck9mIFhSZWdFeHBcclxuICogQHBhcmFtIHtTdHJpbmd9IHBhdHRlcm4gUmVnZXggcGF0dGVybiBzdHJpbmcuXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBbZmxhZ3NdIEFueSBjb21iaW5hdGlvbiBvZiBYUmVnRXhwIGZsYWdzLlxyXG4gKiBAcmV0dXJucyB7UmVnRXhwfSBDYWNoZWQgWFJlZ0V4cCBvYmplY3QuXHJcbiAqIEBleGFtcGxlXHJcbiAqXHJcbiAqIHdoaWxlIChtYXRjaCA9IFhSZWdFeHAuY2FjaGUoJy4nLCAnZ3MnKS5leGVjKHN0cikpIHtcclxuICogICAvLyBUaGUgcmVnZXggaXMgY29tcGlsZWQgb25jZSBvbmx5XHJcbiAqIH1cclxuICovXHJcbiAgICBzZWxmLmNhY2hlID0gZnVuY3Rpb24gKHBhdHRlcm4sIGZsYWdzKSB7XHJcbiAgICAgICAgdmFyIGtleSA9IHBhdHRlcm4gKyBcIi9cIiArIChmbGFncyB8fCBcIlwiKTtcclxuICAgICAgICByZXR1cm4gY2FjaGVba2V5XSB8fCAoY2FjaGVba2V5XSA9IHNlbGYocGF0dGVybiwgZmxhZ3MpKTtcclxuICAgIH07XHJcblxyXG4vKipcclxuICogRXNjYXBlcyBhbnkgcmVndWxhciBleHByZXNzaW9uIG1ldGFjaGFyYWN0ZXJzLCBmb3IgdXNlIHdoZW4gbWF0Y2hpbmcgbGl0ZXJhbCBzdHJpbmdzLiBUaGUgcmVzdWx0XHJcbiAqIGNhbiBzYWZlbHkgYmUgdXNlZCBhdCBhbnkgcG9pbnQgd2l0aGluIGEgcmVnZXggdGhhdCB1c2VzIGFueSBmbGFncy5cclxuICogQG1lbWJlck9mIFhSZWdFeHBcclxuICogQHBhcmFtIHtTdHJpbmd9IHN0ciBTdHJpbmcgdG8gZXNjYXBlLlxyXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBTdHJpbmcgd2l0aCByZWdleCBtZXRhY2hhcmFjdGVycyBlc2NhcGVkLlxyXG4gKiBAZXhhbXBsZVxyXG4gKlxyXG4gKiBYUmVnRXhwLmVzY2FwZSgnRXNjYXBlZD8gPC4+Jyk7XHJcbiAqIC8vIC0+ICdFc2NhcGVkXFw/XFwgPFxcLj4nXHJcbiAqL1xyXG4gICAgc2VsZi5lc2NhcGUgPSBmdW5jdGlvbiAoc3RyKSB7XHJcbiAgICAgICAgcmV0dXJuIG5hdGl2LnJlcGxhY2UuY2FsbChzdHIsIC9bLVtcXF17fSgpKis/LixcXFxcXiR8I1xcc10vZywgXCJcXFxcJCZcIik7XHJcbiAgICB9O1xyXG5cclxuLyoqXHJcbiAqIEV4ZWN1dGVzIGEgcmVnZXggc2VhcmNoIGluIGEgc3BlY2lmaWVkIHN0cmluZy4gUmV0dXJucyBhIG1hdGNoIGFycmF5IG9yIGBudWxsYC4gSWYgdGhlIHByb3ZpZGVkXHJcbiAqIHJlZ2V4IHVzZXMgbmFtZWQgY2FwdHVyZSwgbmFtZWQgYmFja3JlZmVyZW5jZSBwcm9wZXJ0aWVzIGFyZSBpbmNsdWRlZCBvbiB0aGUgbWF0Y2ggYXJyYXkuXHJcbiAqIE9wdGlvbmFsIGBwb3NgIGFuZCBgc3RpY2t5YCBhcmd1bWVudHMgc3BlY2lmeSB0aGUgc2VhcmNoIHN0YXJ0IHBvc2l0aW9uLCBhbmQgd2hldGhlciB0aGUgbWF0Y2hcclxuICogbXVzdCBzdGFydCBhdCB0aGUgc3BlY2lmaWVkIHBvc2l0aW9uIG9ubHkuIFRoZSBgbGFzdEluZGV4YCBwcm9wZXJ0eSBvZiB0aGUgcHJvdmlkZWQgcmVnZXggaXMgbm90XHJcbiAqIHVzZWQsIGJ1dCBpcyB1cGRhdGVkIGZvciBjb21wYXRpYmlsaXR5LiBBbHNvIGZpeGVzIGJyb3dzZXIgYnVncyBjb21wYXJlZCB0byB0aGUgbmF0aXZlXHJcbiAqIGBSZWdFeHAucHJvdG90eXBlLmV4ZWNgIGFuZCBjYW4gYmUgdXNlZCByZWxpYWJseSBjcm9zcy1icm93c2VyLlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFN0cmluZyB0byBzZWFyY2guXHJcbiAqIEBwYXJhbSB7UmVnRXhwfSByZWdleCBSZWdleCB0byBzZWFyY2ggd2l0aC5cclxuICogQHBhcmFtIHtOdW1iZXJ9IFtwb3M9MF0gWmVyby1iYXNlZCBpbmRleCBhdCB3aGljaCB0byBzdGFydCB0aGUgc2VhcmNoLlxyXG4gKiBAcGFyYW0ge0Jvb2xlYW58U3RyaW5nfSBbc3RpY2t5PWZhbHNlXSBXaGV0aGVyIHRoZSBtYXRjaCBtdXN0IHN0YXJ0IGF0IHRoZSBzcGVjaWZpZWQgcG9zaXRpb25cclxuICogICBvbmx5LiBUaGUgc3RyaW5nIGAnc3RpY2t5J2AgaXMgYWNjZXB0ZWQgYXMgYW4gYWx0ZXJuYXRpdmUgdG8gYHRydWVgLlxyXG4gKiBAcmV0dXJucyB7QXJyYXl9IE1hdGNoIGFycmF5IHdpdGggbmFtZWQgYmFja3JlZmVyZW5jZSBwcm9wZXJ0aWVzLCBvciBudWxsLlxyXG4gKiBAZXhhbXBsZVxyXG4gKlxyXG4gKiAvLyBCYXNpYyB1c2UsIHdpdGggbmFtZWQgYmFja3JlZmVyZW5jZVxyXG4gKiB2YXIgbWF0Y2ggPSBYUmVnRXhwLmV4ZWMoJ1UrMjYyMCcsIFhSZWdFeHAoJ1VcXFxcKyg/PGhleD5bMC05QS1GXXs0fSknKSk7XHJcbiAqIG1hdGNoLmhleDsgLy8gLT4gJzI2MjAnXHJcbiAqXHJcbiAqIC8vIFdpdGggcG9zIGFuZCBzdGlja3ksIGluIGEgbG9vcFxyXG4gKiB2YXIgcG9zID0gMiwgcmVzdWx0ID0gW10sIG1hdGNoO1xyXG4gKiB3aGlsZSAobWF0Y2ggPSBYUmVnRXhwLmV4ZWMoJzwxPjwyPjwzPjw0PjU8Nj4nLCAvPChcXGQpPi8sIHBvcywgJ3N0aWNreScpKSB7XHJcbiAqICAgcmVzdWx0LnB1c2gobWF0Y2hbMV0pO1xyXG4gKiAgIHBvcyA9IG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoO1xyXG4gKiB9XHJcbiAqIC8vIHJlc3VsdCAtPiBbJzInLCAnMycsICc0J11cclxuICovXHJcbiAgICBzZWxmLmV4ZWMgPSBmdW5jdGlvbiAoc3RyLCByZWdleCwgcG9zLCBzdGlja3kpIHtcclxuICAgICAgICB2YXIgcjIgPSBjb3B5KHJlZ2V4LCBcImdcIiArIChzdGlja3kgJiYgaGFzTmF0aXZlWSA/IFwieVwiIDogXCJcIiksIChzdGlja3kgPT09IGZhbHNlID8gXCJ5XCIgOiBcIlwiKSksXHJcbiAgICAgICAgICAgIG1hdGNoO1xyXG4gICAgICAgIHIyLmxhc3RJbmRleCA9IHBvcyA9IHBvcyB8fCAwO1xyXG4gICAgICAgIG1hdGNoID0gZml4ZWQuZXhlYy5jYWxsKHIyLCBzdHIpOyAvLyBGaXhlZCBgZXhlY2AgcmVxdWlyZWQgZm9yIGBsYXN0SW5kZXhgIGZpeCwgZXRjLlxyXG4gICAgICAgIGlmIChzdGlja3kgJiYgbWF0Y2ggJiYgbWF0Y2guaW5kZXggIT09IHBvcykge1xyXG4gICAgICAgICAgICBtYXRjaCA9IG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChyZWdleC5nbG9iYWwpIHtcclxuICAgICAgICAgICAgcmVnZXgubGFzdEluZGV4ID0gbWF0Y2ggPyByMi5sYXN0SW5kZXggOiAwO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICB9O1xyXG5cclxuLyoqXHJcbiAqIEV4ZWN1dGVzIGEgcHJvdmlkZWQgZnVuY3Rpb24gb25jZSBwZXIgcmVnZXggbWF0Y2guXHJcbiAqIEBtZW1iZXJPZiBYUmVnRXhwXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgU3RyaW5nIHRvIHNlYXJjaC5cclxuICogQHBhcmFtIHtSZWdFeHB9IHJlZ2V4IFJlZ2V4IHRvIHNlYXJjaCB3aXRoLlxyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBGdW5jdGlvbiB0byBleGVjdXRlIGZvciBlYWNoIG1hdGNoLiBJbnZva2VkIHdpdGggZm91ciBhcmd1bWVudHM6XHJcbiAqICAgPGxpPlRoZSBtYXRjaCBhcnJheSwgd2l0aCBuYW1lZCBiYWNrcmVmZXJlbmNlIHByb3BlcnRpZXMuXHJcbiAqICAgPGxpPlRoZSB6ZXJvLWJhc2VkIG1hdGNoIGluZGV4LlxyXG4gKiAgIDxsaT5UaGUgc3RyaW5nIGJlaW5nIHRyYXZlcnNlZC5cclxuICogICA8bGk+VGhlIHJlZ2V4IG9iamVjdCBiZWluZyB1c2VkIHRvIHRyYXZlcnNlIHRoZSBzdHJpbmcuXHJcbiAqIEBwYXJhbSB7Kn0gW2NvbnRleHRdIE9iamVjdCB0byB1c2UgYXMgYHRoaXNgIHdoZW4gZXhlY3V0aW5nIGBjYWxsYmFja2AuXHJcbiAqIEByZXR1cm5zIHsqfSBQcm92aWRlZCBgY29udGV4dGAgb2JqZWN0LlxyXG4gKiBAZXhhbXBsZVxyXG4gKlxyXG4gKiAvLyBFeHRyYWN0cyBldmVyeSBvdGhlciBkaWdpdCBmcm9tIGEgc3RyaW5nXHJcbiAqIFhSZWdFeHAuZm9yRWFjaCgnMWEyMzQ1JywgL1xcZC8sIGZ1bmN0aW9uIChtYXRjaCwgaSkge1xyXG4gKiAgIGlmIChpICUgMikgdGhpcy5wdXNoKCttYXRjaFswXSk7XHJcbiAqIH0sIFtdKTtcclxuICogLy8gLT4gWzIsIDRdXHJcbiAqL1xyXG4gICAgc2VsZi5mb3JFYWNoID0gZnVuY3Rpb24gKHN0ciwgcmVnZXgsIGNhbGxiYWNrLCBjb250ZXh0KSB7XHJcbiAgICAgICAgdmFyIHBvcyA9IDAsXHJcbiAgICAgICAgICAgIGkgPSAtMSxcclxuICAgICAgICAgICAgbWF0Y2g7XHJcbiAgICAgICAgd2hpbGUgKChtYXRjaCA9IHNlbGYuZXhlYyhzdHIsIHJlZ2V4LCBwb3MpKSkge1xyXG4gICAgICAgICAgICBjYWxsYmFjay5jYWxsKGNvbnRleHQsIG1hdGNoLCArK2ksIHN0ciwgcmVnZXgpO1xyXG4gICAgICAgICAgICBwb3MgPSBtYXRjaC5pbmRleCArIChtYXRjaFswXS5sZW5ndGggfHwgMSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBjb250ZXh0O1xyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBDb3BpZXMgYSByZWdleCBvYmplY3QgYW5kIGFkZHMgZmxhZyBgZ2AuIFRoZSBjb3B5IG1haW50YWlucyBzcGVjaWFsIHByb3BlcnRpZXMgZm9yIG5hbWVkXHJcbiAqIGNhcHR1cmUsIGlzIGF1Z21lbnRlZCB3aXRoIGBYUmVnRXhwLnByb3RvdHlwZWAgbWV0aG9kcywgYW5kIGhhcyBhIGZyZXNoIGBsYXN0SW5kZXhgIHByb3BlcnR5XHJcbiAqIChzZXQgdG8gemVybykuIE5hdGl2ZSByZWdleGVzIGFyZSBub3QgcmVjb21waWxlZCB1c2luZyBYUmVnRXhwIHN5bnRheC5cclxuICogQG1lbWJlck9mIFhSZWdFeHBcclxuICogQHBhcmFtIHtSZWdFeHB9IHJlZ2V4IFJlZ2V4IHRvIGdsb2JhbGl6ZS5cclxuICogQHJldHVybnMge1JlZ0V4cH0gQ29weSBvZiB0aGUgcHJvdmlkZWQgcmVnZXggd2l0aCBmbGFnIGBnYCBhZGRlZC5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogdmFyIGdsb2JhbENvcHkgPSBYUmVnRXhwLmdsb2JhbGl6ZSgvcmVnZXgvKTtcclxuICogZ2xvYmFsQ29weS5nbG9iYWw7IC8vIC0+IHRydWVcclxuICovXHJcbiAgICBzZWxmLmdsb2JhbGl6ZSA9IGZ1bmN0aW9uIChyZWdleCkge1xyXG4gICAgICAgIHJldHVybiBjb3B5KHJlZ2V4LCBcImdcIik7XHJcbiAgICB9O1xyXG5cclxuLyoqXHJcbiAqIEluc3RhbGxzIG9wdGlvbmFsIGZlYXR1cmVzIGFjY29yZGluZyB0byB0aGUgc3BlY2lmaWVkIG9wdGlvbnMuXHJcbiAqIEBtZW1iZXJPZiBYUmVnRXhwXHJcbiAqIEBwYXJhbSB7T2JqZWN0fFN0cmluZ30gb3B0aW9ucyBPcHRpb25zIG9iamVjdCBvciBzdHJpbmcuXHJcbiAqIEBleGFtcGxlXHJcbiAqXHJcbiAqIC8vIFdpdGggYW4gb3B0aW9ucyBvYmplY3RcclxuICogWFJlZ0V4cC5pbnN0YWxsKHtcclxuICogICAvLyBPdmVycmlkZXMgbmF0aXZlIHJlZ2V4IG1ldGhvZHMgd2l0aCBmaXhlZC9leHRlbmRlZCB2ZXJzaW9ucyB0aGF0IHN1cHBvcnQgbmFtZWRcclxuICogICAvLyBiYWNrcmVmZXJlbmNlcyBhbmQgZml4IG51bWVyb3VzIGNyb3NzLWJyb3dzZXIgYnVnc1xyXG4gKiAgIG5hdGl2ZXM6IHRydWUsXHJcbiAqXHJcbiAqICAgLy8gRW5hYmxlcyBleHRlbnNpYmlsaXR5IG9mIFhSZWdFeHAgc3ludGF4IGFuZCBmbGFnc1xyXG4gKiAgIGV4dGVuc2liaWxpdHk6IHRydWVcclxuICogfSk7XHJcbiAqXHJcbiAqIC8vIFdpdGggYW4gb3B0aW9ucyBzdHJpbmdcclxuICogWFJlZ0V4cC5pbnN0YWxsKCduYXRpdmVzIGV4dGVuc2liaWxpdHknKTtcclxuICpcclxuICogLy8gVXNpbmcgYSBzaG9ydGN1dCB0byBpbnN0YWxsIGFsbCBvcHRpb25hbCBmZWF0dXJlc1xyXG4gKiBYUmVnRXhwLmluc3RhbGwoJ2FsbCcpO1xyXG4gKi9cclxuICAgIHNlbGYuaW5zdGFsbCA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XHJcbiAgICAgICAgb3B0aW9ucyA9IHByZXBhcmVPcHRpb25zKG9wdGlvbnMpO1xyXG4gICAgICAgIGlmICghZmVhdHVyZXMubmF0aXZlcyAmJiBvcHRpb25zLm5hdGl2ZXMpIHtcclxuICAgICAgICAgICAgc2V0TmF0aXZlcyh0cnVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKCFmZWF0dXJlcy5leHRlbnNpYmlsaXR5ICYmIG9wdGlvbnMuZXh0ZW5zaWJpbGl0eSkge1xyXG4gICAgICAgICAgICBzZXRFeHRlbnNpYmlsaXR5KHRydWUpO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG4vKipcclxuICogQ2hlY2tzIHdoZXRoZXIgYW4gaW5kaXZpZHVhbCBvcHRpb25hbCBmZWF0dXJlIGlzIGluc3RhbGxlZC5cclxuICogQG1lbWJlck9mIFhSZWdFeHBcclxuICogQHBhcmFtIHtTdHJpbmd9IGZlYXR1cmUgTmFtZSBvZiB0aGUgZmVhdHVyZSB0byBjaGVjay4gT25lIG9mOlxyXG4gKiAgIDxsaT5gbmF0aXZlc2BcclxuICogICA8bGk+YGV4dGVuc2liaWxpdHlgXHJcbiAqIEByZXR1cm5zIHtCb29sZWFufSBXaGV0aGVyIHRoZSBmZWF0dXJlIGlzIGluc3RhbGxlZC5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogWFJlZ0V4cC5pc0luc3RhbGxlZCgnbmF0aXZlcycpO1xyXG4gKi9cclxuICAgIHNlbGYuaXNJbnN0YWxsZWQgPSBmdW5jdGlvbiAoZmVhdHVyZSkge1xyXG4gICAgICAgIHJldHVybiAhIShmZWF0dXJlc1tmZWF0dXJlXSk7XHJcbiAgICB9O1xyXG5cclxuLyoqXHJcbiAqIFJldHVybnMgYHRydWVgIGlmIGFuIG9iamVjdCBpcyBhIHJlZ2V4OyBgZmFsc2VgIGlmIGl0IGlzbid0LiBUaGlzIHdvcmtzIGNvcnJlY3RseSBmb3IgcmVnZXhlc1xyXG4gKiBjcmVhdGVkIGluIGFub3RoZXIgZnJhbWUsIHdoZW4gYGluc3RhbmNlb2ZgIGFuZCBgY29uc3RydWN0b3JgIGNoZWNrcyB3b3VsZCBmYWlsLlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0geyp9IHZhbHVlIE9iamVjdCB0byBjaGVjay5cclxuICogQHJldHVybnMge0Jvb2xlYW59IFdoZXRoZXIgdGhlIG9iamVjdCBpcyBhIGBSZWdFeHBgIG9iamVjdC5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogWFJlZ0V4cC5pc1JlZ0V4cCgnc3RyaW5nJyk7IC8vIC0+IGZhbHNlXHJcbiAqIFhSZWdFeHAuaXNSZWdFeHAoL3JlZ2V4L2kpOyAvLyAtPiB0cnVlXHJcbiAqIFhSZWdFeHAuaXNSZWdFeHAoUmVnRXhwKCdeJywgJ20nKSk7IC8vIC0+IHRydWVcclxuICogWFJlZ0V4cC5pc1JlZ0V4cChYUmVnRXhwKCcoP3MpLicpKTsgLy8gLT4gdHJ1ZVxyXG4gKi9cclxuICAgIHNlbGYuaXNSZWdFeHAgPSBmdW5jdGlvbiAodmFsdWUpIHtcclxuICAgICAgICByZXR1cm4gaXNUeXBlKHZhbHVlLCBcInJlZ2V4cFwiKTtcclxuICAgIH07XHJcblxyXG4vKipcclxuICogUmV0cmlldmVzIHRoZSBtYXRjaGVzIGZyb20gc2VhcmNoaW5nIGEgc3RyaW5nIHVzaW5nIGEgY2hhaW4gb2YgcmVnZXhlcyB0aGF0IHN1Y2Nlc3NpdmVseSBzZWFyY2hcclxuICogd2l0aGluIHByZXZpb3VzIG1hdGNoZXMuIFRoZSBwcm92aWRlZCBgY2hhaW5gIGFycmF5IGNhbiBjb250YWluIHJlZ2V4ZXMgYW5kIG9iamVjdHMgd2l0aCBgcmVnZXhgXHJcbiAqIGFuZCBgYmFja3JlZmAgcHJvcGVydGllcy4gV2hlbiBhIGJhY2tyZWZlcmVuY2UgaXMgc3BlY2lmaWVkLCB0aGUgbmFtZWQgb3IgbnVtYmVyZWQgYmFja3JlZmVyZW5jZVxyXG4gKiBpcyBwYXNzZWQgZm9yd2FyZCB0byB0aGUgbmV4dCByZWdleCBvciByZXR1cm5lZC5cclxuICogQG1lbWJlck9mIFhSZWdFeHBcclxuICogQHBhcmFtIHtTdHJpbmd9IHN0ciBTdHJpbmcgdG8gc2VhcmNoLlxyXG4gKiBAcGFyYW0ge0FycmF5fSBjaGFpbiBSZWdleGVzIHRoYXQgZWFjaCBzZWFyY2ggZm9yIG1hdGNoZXMgd2l0aGluIHByZWNlZGluZyByZXN1bHRzLlxyXG4gKiBAcmV0dXJucyB7QXJyYXl9IE1hdGNoZXMgYnkgdGhlIGxhc3QgcmVnZXggaW4gdGhlIGNoYWluLCBvciBhbiBlbXB0eSBhcnJheS5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogLy8gQmFzaWMgdXNhZ2U7IG1hdGNoZXMgbnVtYmVycyB3aXRoaW4gPGI+IHRhZ3NcclxuICogWFJlZ0V4cC5tYXRjaENoYWluKCcxIDxiPjI8L2I+IDMgPGI+NCBhIDU2PC9iPicsIFtcclxuICogICBYUmVnRXhwKCcoP2lzKTxiPi4qPzwvYj4nKSxcclxuICogICAvXFxkKy9cclxuICogXSk7XHJcbiAqIC8vIC0+IFsnMicsICc0JywgJzU2J11cclxuICpcclxuICogLy8gUGFzc2luZyBmb3J3YXJkIGFuZCByZXR1cm5pbmcgc3BlY2lmaWMgYmFja3JlZmVyZW5jZXNcclxuICogaHRtbCA9ICc8YSBocmVmPVwiaHR0cDovL3hyZWdleHAuY29tL2FwaS9cIj5YUmVnRXhwPC9hPlxcXHJcbiAqICAgICAgICAgPGEgaHJlZj1cImh0dHA6Ly93d3cuZ29vZ2xlLmNvbS9cIj5Hb29nbGU8L2E+JztcclxuICogWFJlZ0V4cC5tYXRjaENoYWluKGh0bWwsIFtcclxuICogICB7cmVnZXg6IC88YSBocmVmPVwiKFteXCJdKylcIj4vaSwgYmFja3JlZjogMX0sXHJcbiAqICAge3JlZ2V4OiBYUmVnRXhwKCcoP2kpXmh0dHBzPzovLyg/PGRvbWFpbj5bXi8/I10rKScpLCBiYWNrcmVmOiAnZG9tYWluJ31cclxuICogXSk7XHJcbiAqIC8vIC0+IFsneHJlZ2V4cC5jb20nLCAnd3d3Lmdvb2dsZS5jb20nXVxyXG4gKi9cclxuICAgIHNlbGYubWF0Y2hDaGFpbiA9IGZ1bmN0aW9uIChzdHIsIGNoYWluKSB7XHJcbiAgICAgICAgcmV0dXJuIChmdW5jdGlvbiByZWN1cnNlQ2hhaW4odmFsdWVzLCBsZXZlbCkge1xyXG4gICAgICAgICAgICB2YXIgaXRlbSA9IGNoYWluW2xldmVsXS5yZWdleCA/IGNoYWluW2xldmVsXSA6IHtyZWdleDogY2hhaW5bbGV2ZWxdfSxcclxuICAgICAgICAgICAgICAgIG1hdGNoZXMgPSBbXSxcclxuICAgICAgICAgICAgICAgIGFkZE1hdGNoID0gZnVuY3Rpb24gKG1hdGNoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWF0Y2hlcy5wdXNoKGl0ZW0uYmFja3JlZiA/IChtYXRjaFtpdGVtLmJhY2tyZWZdIHx8IFwiXCIpIDogbWF0Y2hbMF0pO1xyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIGk7XHJcbiAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCB2YWx1ZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIHNlbGYuZm9yRWFjaCh2YWx1ZXNbaV0sIGl0ZW0ucmVnZXgsIGFkZE1hdGNoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gKChsZXZlbCA9PT0gY2hhaW4ubGVuZ3RoIC0gMSkgfHwgIW1hdGNoZXMubGVuZ3RoKSA/XHJcbiAgICAgICAgICAgICAgICAgICAgbWF0Y2hlcyA6XHJcbiAgICAgICAgICAgICAgICAgICAgcmVjdXJzZUNoYWluKG1hdGNoZXMsIGxldmVsICsgMSk7XHJcbiAgICAgICAgfShbc3RyXSwgMCkpO1xyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIGEgbmV3IHN0cmluZyB3aXRoIG9uZSBvciBhbGwgbWF0Y2hlcyBvZiBhIHBhdHRlcm4gcmVwbGFjZWQuIFRoZSBwYXR0ZXJuIGNhbiBiZSBhIHN0cmluZ1xyXG4gKiBvciByZWdleCwgYW5kIHRoZSByZXBsYWNlbWVudCBjYW4gYmUgYSBzdHJpbmcgb3IgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgZm9yIGVhY2ggbWF0Y2guIFRvXHJcbiAqIHBlcmZvcm0gYSBnbG9iYWwgc2VhcmNoIGFuZCByZXBsYWNlLCB1c2UgdGhlIG9wdGlvbmFsIGBzY29wZWAgYXJndW1lbnQgb3IgaW5jbHVkZSBmbGFnIGBnYCBpZlxyXG4gKiB1c2luZyBhIHJlZ2V4LiBSZXBsYWNlbWVudCBzdHJpbmdzIGNhbiB1c2UgYCR7bn1gIGZvciBuYW1lZCBhbmQgbnVtYmVyZWQgYmFja3JlZmVyZW5jZXMuXHJcbiAqIFJlcGxhY2VtZW50IGZ1bmN0aW9ucyBjYW4gdXNlIG5hbWVkIGJhY2tyZWZlcmVuY2VzIHZpYSBgYXJndW1lbnRzWzBdLm5hbWVgLiBBbHNvIGZpeGVzIGJyb3dzZXJcclxuICogYnVncyBjb21wYXJlZCB0byB0aGUgbmF0aXZlIGBTdHJpbmcucHJvdG90eXBlLnJlcGxhY2VgIGFuZCBjYW4gYmUgdXNlZCByZWxpYWJseSBjcm9zcy1icm93c2VyLlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFN0cmluZyB0byBzZWFyY2guXHJcbiAqIEBwYXJhbSB7UmVnRXhwfFN0cmluZ30gc2VhcmNoIFNlYXJjaCBwYXR0ZXJuIHRvIGJlIHJlcGxhY2VkLlxyXG4gKiBAcGFyYW0ge1N0cmluZ3xGdW5jdGlvbn0gcmVwbGFjZW1lbnQgUmVwbGFjZW1lbnQgc3RyaW5nIG9yIGEgZnVuY3Rpb24gaW52b2tlZCB0byBjcmVhdGUgaXQuXHJcbiAqICAgUmVwbGFjZW1lbnQgc3RyaW5ncyBjYW4gaW5jbHVkZSBzcGVjaWFsIHJlcGxhY2VtZW50IHN5bnRheDpcclxuICogICAgIDxsaT4kJCAtIEluc2VydHMgYSBsaXRlcmFsICckJy5cclxuICogICAgIDxsaT4kJiwgJDAgLSBJbnNlcnRzIHRoZSBtYXRjaGVkIHN1YnN0cmluZy5cclxuICogICAgIDxsaT4kYCAtIEluc2VydHMgdGhlIHN0cmluZyB0aGF0IHByZWNlZGVzIHRoZSBtYXRjaGVkIHN1YnN0cmluZyAobGVmdCBjb250ZXh0KS5cclxuICogICAgIDxsaT4kJyAtIEluc2VydHMgdGhlIHN0cmluZyB0aGF0IGZvbGxvd3MgdGhlIG1hdGNoZWQgc3Vic3RyaW5nIChyaWdodCBjb250ZXh0KS5cclxuICogICAgIDxsaT4kbiwgJG5uIC0gV2hlcmUgbi9ubiBhcmUgZGlnaXRzIHJlZmVyZW5jaW5nIGFuIGV4aXN0ZW50IGNhcHR1cmluZyBncm91cCwgaW5zZXJ0c1xyXG4gKiAgICAgICBiYWNrcmVmZXJlbmNlIG4vbm4uXHJcbiAqICAgICA8bGk+JHtufSAtIFdoZXJlIG4gaXMgYSBuYW1lIG9yIGFueSBudW1iZXIgb2YgZGlnaXRzIHRoYXQgcmVmZXJlbmNlIGFuIGV4aXN0ZW50IGNhcHR1cmluZ1xyXG4gKiAgICAgICBncm91cCwgaW5zZXJ0cyBiYWNrcmVmZXJlbmNlIG4uXHJcbiAqICAgUmVwbGFjZW1lbnQgZnVuY3Rpb25zIGFyZSBpbnZva2VkIHdpdGggdGhyZWUgb3IgbW9yZSBhcmd1bWVudHM6XHJcbiAqICAgICA8bGk+VGhlIG1hdGNoZWQgc3Vic3RyaW5nIChjb3JyZXNwb25kcyB0byAkJiBhYm92ZSkuIE5hbWVkIGJhY2tyZWZlcmVuY2VzIGFyZSBhY2Nlc3NpYmxlIGFzXHJcbiAqICAgICAgIHByb3BlcnRpZXMgb2YgdGhpcyBmaXJzdCBhcmd1bWVudC5cclxuICogICAgIDxsaT4wLi5uIGFyZ3VtZW50cywgb25lIGZvciBlYWNoIGJhY2tyZWZlcmVuY2UgKGNvcnJlc3BvbmRpbmcgdG8gJDEsICQyLCBldGMuIGFib3ZlKS5cclxuICogICAgIDxsaT5UaGUgemVyby1iYXNlZCBpbmRleCBvZiB0aGUgbWF0Y2ggd2l0aGluIHRoZSB0b3RhbCBzZWFyY2ggc3RyaW5nLlxyXG4gKiAgICAgPGxpPlRoZSB0b3RhbCBzdHJpbmcgYmVpbmcgc2VhcmNoZWQuXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBbc2NvcGU9J29uZSddIFVzZSAnb25lJyB0byByZXBsYWNlIHRoZSBmaXJzdCBtYXRjaCBvbmx5LCBvciAnYWxsJy4gSWYgbm90XHJcbiAqICAgZXhwbGljaXRseSBzcGVjaWZpZWQgYW5kIHVzaW5nIGEgcmVnZXggd2l0aCBmbGFnIGBnYCwgYHNjb3BlYCBpcyAnYWxsJy5cclxuICogQHJldHVybnMge1N0cmluZ30gTmV3IHN0cmluZyB3aXRoIG9uZSBvciBhbGwgbWF0Y2hlcyByZXBsYWNlZC5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogLy8gUmVnZXggc2VhcmNoLCB1c2luZyBuYW1lZCBiYWNrcmVmZXJlbmNlcyBpbiByZXBsYWNlbWVudCBzdHJpbmdcclxuICogdmFyIG5hbWUgPSBYUmVnRXhwKCcoPzxmaXJzdD5cXFxcdyspICg/PGxhc3Q+XFxcXHcrKScpO1xyXG4gKiBYUmVnRXhwLnJlcGxhY2UoJ0pvaG4gU21pdGgnLCBuYW1lLCAnJHtsYXN0fSwgJHtmaXJzdH0nKTtcclxuICogLy8gLT4gJ1NtaXRoLCBKb2huJ1xyXG4gKlxyXG4gKiAvLyBSZWdleCBzZWFyY2gsIHVzaW5nIG5hbWVkIGJhY2tyZWZlcmVuY2VzIGluIHJlcGxhY2VtZW50IGZ1bmN0aW9uXHJcbiAqIFhSZWdFeHAucmVwbGFjZSgnSm9obiBTbWl0aCcsIG5hbWUsIGZ1bmN0aW9uIChtYXRjaCkge1xyXG4gKiAgIHJldHVybiBtYXRjaC5sYXN0ICsgJywgJyArIG1hdGNoLmZpcnN0O1xyXG4gKiB9KTtcclxuICogLy8gLT4gJ1NtaXRoLCBKb2huJ1xyXG4gKlxyXG4gKiAvLyBHbG9iYWwgc3RyaW5nIHNlYXJjaC9yZXBsYWNlbWVudFxyXG4gKiBYUmVnRXhwLnJlcGxhY2UoJ1JlZ0V4cCBidWlsZHMgUmVnRXhwcycsICdSZWdFeHAnLCAnWFJlZ0V4cCcsICdhbGwnKTtcclxuICogLy8gLT4gJ1hSZWdFeHAgYnVpbGRzIFhSZWdFeHBzJ1xyXG4gKi9cclxuICAgIHNlbGYucmVwbGFjZSA9IGZ1bmN0aW9uIChzdHIsIHNlYXJjaCwgcmVwbGFjZW1lbnQsIHNjb3BlKSB7XHJcbiAgICAgICAgdmFyIGlzUmVnZXggPSBzZWxmLmlzUmVnRXhwKHNlYXJjaCksXHJcbiAgICAgICAgICAgIHNlYXJjaDIgPSBzZWFyY2gsXHJcbiAgICAgICAgICAgIHJlc3VsdDtcclxuICAgICAgICBpZiAoaXNSZWdleCkge1xyXG4gICAgICAgICAgICBpZiAoc2NvcGUgPT09IHVuZGVmICYmIHNlYXJjaC5nbG9iYWwpIHtcclxuICAgICAgICAgICAgICAgIHNjb3BlID0gXCJhbGxcIjsgLy8gRm9sbG93IGZsYWcgZyB3aGVuIGBzY29wZWAgaXNuJ3QgZXhwbGljaXRcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBOb3RlIHRoYXQgc2luY2UgYSBjb3B5IGlzIHVzZWQsIGBzZWFyY2hgJ3MgYGxhc3RJbmRleGAgaXNuJ3QgdXBkYXRlZCAqZHVyaW5nKiByZXBsYWNlbWVudCBpdGVyYXRpb25zXHJcbiAgICAgICAgICAgIHNlYXJjaDIgPSBjb3B5KHNlYXJjaCwgc2NvcGUgPT09IFwiYWxsXCIgPyBcImdcIiA6IFwiXCIsIHNjb3BlID09PSBcImFsbFwiID8gXCJcIiA6IFwiZ1wiKTtcclxuICAgICAgICB9IGVsc2UgaWYgKHNjb3BlID09PSBcImFsbFwiKSB7XHJcbiAgICAgICAgICAgIHNlYXJjaDIgPSBuZXcgUmVnRXhwKHNlbGYuZXNjYXBlKFN0cmluZyhzZWFyY2gpKSwgXCJnXCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXN1bHQgPSBmaXhlZC5yZXBsYWNlLmNhbGwoU3RyaW5nKHN0ciksIHNlYXJjaDIsIHJlcGxhY2VtZW50KTsgLy8gRml4ZWQgYHJlcGxhY2VgIHJlcXVpcmVkIGZvciBuYW1lZCBiYWNrcmVmZXJlbmNlcywgZXRjLlxyXG4gICAgICAgIGlmIChpc1JlZ2V4ICYmIHNlYXJjaC5nbG9iYWwpIHtcclxuICAgICAgICAgICAgc2VhcmNoLmxhc3RJbmRleCA9IDA7IC8vIEZpeGVzIElFLCBTYWZhcmkgYnVnIChsYXN0IHRlc3RlZCBJRSA5LCBTYWZhcmkgNS4xKVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBTcGxpdHMgYSBzdHJpbmcgaW50byBhbiBhcnJheSBvZiBzdHJpbmdzIHVzaW5nIGEgcmVnZXggb3Igc3RyaW5nIHNlcGFyYXRvci4gTWF0Y2hlcyBvZiB0aGVcclxuICogc2VwYXJhdG9yIGFyZSBub3QgaW5jbHVkZWQgaW4gdGhlIHJlc3VsdCBhcnJheS4gSG93ZXZlciwgaWYgYHNlcGFyYXRvcmAgaXMgYSByZWdleCB0aGF0IGNvbnRhaW5zXHJcbiAqIGNhcHR1cmluZyBncm91cHMsIGJhY2tyZWZlcmVuY2VzIGFyZSBzcGxpY2VkIGludG8gdGhlIHJlc3VsdCBlYWNoIHRpbWUgYHNlcGFyYXRvcmAgaXMgbWF0Y2hlZC5cclxuICogRml4ZXMgYnJvd3NlciBidWdzIGNvbXBhcmVkIHRvIHRoZSBuYXRpdmUgYFN0cmluZy5wcm90b3R5cGUuc3BsaXRgIGFuZCBjYW4gYmUgdXNlZCByZWxpYWJseVxyXG4gKiBjcm9zcy1icm93c2VyLlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFN0cmluZyB0byBzcGxpdC5cclxuICogQHBhcmFtIHtSZWdFeHB8U3RyaW5nfSBzZXBhcmF0b3IgUmVnZXggb3Igc3RyaW5nIHRvIHVzZSBmb3Igc2VwYXJhdGluZyB0aGUgc3RyaW5nLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gW2xpbWl0XSBNYXhpbXVtIG51bWJlciBvZiBpdGVtcyB0byBpbmNsdWRlIGluIHRoZSByZXN1bHQgYXJyYXkuXHJcbiAqIEByZXR1cm5zIHtBcnJheX0gQXJyYXkgb2Ygc3Vic3RyaW5ncy5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogLy8gQmFzaWMgdXNlXHJcbiAqIFhSZWdFeHAuc3BsaXQoJ2EgYiBjJywgJyAnKTtcclxuICogLy8gLT4gWydhJywgJ2InLCAnYyddXHJcbiAqXHJcbiAqIC8vIFdpdGggbGltaXRcclxuICogWFJlZ0V4cC5zcGxpdCgnYSBiIGMnLCAnICcsIDIpO1xyXG4gKiAvLyAtPiBbJ2EnLCAnYiddXHJcbiAqXHJcbiAqIC8vIEJhY2tyZWZlcmVuY2VzIGluIHJlc3VsdCBhcnJheVxyXG4gKiBYUmVnRXhwLnNwbGl0KCcuLndvcmQxLi4nLCAvKFthLXpdKykoXFxkKykvaSk7XHJcbiAqIC8vIC0+IFsnLi4nLCAnd29yZCcsICcxJywgJy4uJ11cclxuICovXHJcbiAgICBzZWxmLnNwbGl0ID0gZnVuY3Rpb24gKHN0ciwgc2VwYXJhdG9yLCBsaW1pdCkge1xyXG4gICAgICAgIHJldHVybiBmaXhlZC5zcGxpdC5jYWxsKHN0ciwgc2VwYXJhdG9yLCBsaW1pdCk7XHJcbiAgICB9O1xyXG5cclxuLyoqXHJcbiAqIEV4ZWN1dGVzIGEgcmVnZXggc2VhcmNoIGluIGEgc3BlY2lmaWVkIHN0cmluZy4gUmV0dXJucyBgdHJ1ZWAgb3IgYGZhbHNlYC4gT3B0aW9uYWwgYHBvc2AgYW5kXHJcbiAqIGBzdGlja3lgIGFyZ3VtZW50cyBzcGVjaWZ5IHRoZSBzZWFyY2ggc3RhcnQgcG9zaXRpb24sIGFuZCB3aGV0aGVyIHRoZSBtYXRjaCBtdXN0IHN0YXJ0IGF0IHRoZVxyXG4gKiBzcGVjaWZpZWQgcG9zaXRpb24gb25seS4gVGhlIGBsYXN0SW5kZXhgIHByb3BlcnR5IG9mIHRoZSBwcm92aWRlZCByZWdleCBpcyBub3QgdXNlZCwgYnV0IGlzXHJcbiAqIHVwZGF0ZWQgZm9yIGNvbXBhdGliaWxpdHkuIEFsc28gZml4ZXMgYnJvd3NlciBidWdzIGNvbXBhcmVkIHRvIHRoZSBuYXRpdmVcclxuICogYFJlZ0V4cC5wcm90b3R5cGUudGVzdGAgYW5kIGNhbiBiZSB1c2VkIHJlbGlhYmx5IGNyb3NzLWJyb3dzZXIuXHJcbiAqIEBtZW1iZXJPZiBYUmVnRXhwXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgU3RyaW5nIHRvIHNlYXJjaC5cclxuICogQHBhcmFtIHtSZWdFeHB9IHJlZ2V4IFJlZ2V4IHRvIHNlYXJjaCB3aXRoLlxyXG4gKiBAcGFyYW0ge051bWJlcn0gW3Bvcz0wXSBaZXJvLWJhc2VkIGluZGV4IGF0IHdoaWNoIHRvIHN0YXJ0IHRoZSBzZWFyY2guXHJcbiAqIEBwYXJhbSB7Qm9vbGVhbnxTdHJpbmd9IFtzdGlja3k9ZmFsc2VdIFdoZXRoZXIgdGhlIG1hdGNoIG11c3Qgc3RhcnQgYXQgdGhlIHNwZWNpZmllZCBwb3NpdGlvblxyXG4gKiAgIG9ubHkuIFRoZSBzdHJpbmcgYCdzdGlja3knYCBpcyBhY2NlcHRlZCBhcyBhbiBhbHRlcm5hdGl2ZSB0byBgdHJ1ZWAuXHJcbiAqIEByZXR1cm5zIHtCb29sZWFufSBXaGV0aGVyIHRoZSByZWdleCBtYXRjaGVkIHRoZSBwcm92aWRlZCB2YWx1ZS5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogLy8gQmFzaWMgdXNlXHJcbiAqIFhSZWdFeHAudGVzdCgnYWJjJywgL2MvKTsgLy8gLT4gdHJ1ZVxyXG4gKlxyXG4gKiAvLyBXaXRoIHBvcyBhbmQgc3RpY2t5XHJcbiAqIFhSZWdFeHAudGVzdCgnYWJjJywgL2MvLCAwLCAnc3RpY2t5Jyk7IC8vIC0+IGZhbHNlXHJcbiAqL1xyXG4gICAgc2VsZi50ZXN0ID0gZnVuY3Rpb24gKHN0ciwgcmVnZXgsIHBvcywgc3RpY2t5KSB7XHJcbiAgICAgICAgLy8gRG8gdGhpcyB0aGUgZWFzeSB3YXkgOi0pXHJcbiAgICAgICAgcmV0dXJuICEhc2VsZi5leGVjKHN0ciwgcmVnZXgsIHBvcywgc3RpY2t5KTtcclxuICAgIH07XHJcblxyXG4vKipcclxuICogVW5pbnN0YWxscyBvcHRpb25hbCBmZWF0dXJlcyBhY2NvcmRpbmcgdG8gdGhlIHNwZWNpZmllZCBvcHRpb25zLlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IG9wdGlvbnMgT3B0aW9ucyBvYmplY3Qgb3Igc3RyaW5nLlxyXG4gKiBAZXhhbXBsZVxyXG4gKlxyXG4gKiAvLyBXaXRoIGFuIG9wdGlvbnMgb2JqZWN0XHJcbiAqIFhSZWdFeHAudW5pbnN0YWxsKHtcclxuICogICAvLyBSZXN0b3JlcyBuYXRpdmUgcmVnZXggbWV0aG9kc1xyXG4gKiAgIG5hdGl2ZXM6IHRydWUsXHJcbiAqXHJcbiAqICAgLy8gRGlzYWJsZXMgYWRkaXRpb25hbCBzeW50YXggYW5kIGZsYWcgZXh0ZW5zaW9uc1xyXG4gKiAgIGV4dGVuc2liaWxpdHk6IHRydWVcclxuICogfSk7XHJcbiAqXHJcbiAqIC8vIFdpdGggYW4gb3B0aW9ucyBzdHJpbmdcclxuICogWFJlZ0V4cC51bmluc3RhbGwoJ25hdGl2ZXMgZXh0ZW5zaWJpbGl0eScpO1xyXG4gKlxyXG4gKiAvLyBVc2luZyBhIHNob3J0Y3V0IHRvIHVuaW5zdGFsbCBhbGwgb3B0aW9uYWwgZmVhdHVyZXNcclxuICogWFJlZ0V4cC51bmluc3RhbGwoJ2FsbCcpO1xyXG4gKi9cclxuICAgIHNlbGYudW5pbnN0YWxsID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcclxuICAgICAgICBvcHRpb25zID0gcHJlcGFyZU9wdGlvbnMob3B0aW9ucyk7XHJcbiAgICAgICAgaWYgKGZlYXR1cmVzLm5hdGl2ZXMgJiYgb3B0aW9ucy5uYXRpdmVzKSB7XHJcbiAgICAgICAgICAgIHNldE5hdGl2ZXMoZmFsc2UpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoZmVhdHVyZXMuZXh0ZW5zaWJpbGl0eSAmJiBvcHRpb25zLmV4dGVuc2liaWxpdHkpIHtcclxuICAgICAgICAgICAgc2V0RXh0ZW5zaWJpbGl0eShmYWxzZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIGFuIFhSZWdFeHAgb2JqZWN0IHRoYXQgaXMgdGhlIHVuaW9uIG9mIHRoZSBnaXZlbiBwYXR0ZXJucy4gUGF0dGVybnMgY2FuIGJlIHByb3ZpZGVkIGFzXHJcbiAqIHJlZ2V4IG9iamVjdHMgb3Igc3RyaW5ncy4gTWV0YWNoYXJhY3RlcnMgYXJlIGVzY2FwZWQgaW4gcGF0dGVybnMgcHJvdmlkZWQgYXMgc3RyaW5ncy5cclxuICogQmFja3JlZmVyZW5jZXMgaW4gcHJvdmlkZWQgcmVnZXggb2JqZWN0cyBhcmUgYXV0b21hdGljYWxseSByZW51bWJlcmVkIHRvIHdvcmsgY29ycmVjdGx5LiBOYXRpdmVcclxuICogZmxhZ3MgdXNlZCBieSBwcm92aWRlZCByZWdleGVzIGFyZSBpZ25vcmVkIGluIGZhdm9yIG9mIHRoZSBgZmxhZ3NgIGFyZ3VtZW50LlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge0FycmF5fSBwYXR0ZXJucyBSZWdleGVzIGFuZCBzdHJpbmdzIHRvIGNvbWJpbmUuXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBbZmxhZ3NdIEFueSBjb21iaW5hdGlvbiBvZiBYUmVnRXhwIGZsYWdzLlxyXG4gKiBAcmV0dXJucyB7UmVnRXhwfSBVbmlvbiBvZiB0aGUgcHJvdmlkZWQgcmVnZXhlcyBhbmQgc3RyaW5ncy5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogWFJlZ0V4cC51bmlvbihbJ2ErYipjJywgLyhkb2dzKVxcMS8sIC8oY2F0cylcXDEvXSwgJ2knKTtcclxuICogLy8gLT4gL2FcXCtiXFwqY3woZG9ncylcXDF8KGNhdHMpXFwyL2lcclxuICpcclxuICogWFJlZ0V4cC51bmlvbihbWFJlZ0V4cCgnKD88cGV0PmRvZ3MpXFxcXGs8cGV0PicpLCBYUmVnRXhwKCcoPzxwZXQ+Y2F0cylcXFxcazxwZXQ+JyldKTtcclxuICogLy8gLT4gWFJlZ0V4cCgnKD88cGV0PmRvZ3MpXFxcXGs8cGV0PnwoPzxwZXQ+Y2F0cylcXFxcazxwZXQ+JylcclxuICovXHJcbiAgICBzZWxmLnVuaW9uID0gZnVuY3Rpb24gKHBhdHRlcm5zLCBmbGFncykge1xyXG4gICAgICAgIHZhciBwYXJ0cyA9IC8oXFwoKSg/IVxcPyl8XFxcXChbMS05XVxcZCopfFxcXFxbXFxzXFxTXXxcXFsoPzpbXlxcXFxcXF1dfFxcXFxbXFxzXFxTXSkqXS9nLFxyXG4gICAgICAgICAgICBudW1DYXB0dXJlcyA9IDAsXHJcbiAgICAgICAgICAgIG51bVByaW9yQ2FwdHVyZXMsXHJcbiAgICAgICAgICAgIGNhcHR1cmVOYW1lcyxcclxuICAgICAgICAgICAgcmV3cml0ZSA9IGZ1bmN0aW9uIChtYXRjaCwgcGFyZW4sIGJhY2tyZWYpIHtcclxuICAgICAgICAgICAgICAgIHZhciBuYW1lID0gY2FwdHVyZU5hbWVzW251bUNhcHR1cmVzIC0gbnVtUHJpb3JDYXB0dXJlc107XHJcbiAgICAgICAgICAgICAgICBpZiAocGFyZW4pIHsgLy8gQ2FwdHVyaW5nIGdyb3VwXHJcbiAgICAgICAgICAgICAgICAgICAgKytudW1DYXB0dXJlcztcclxuICAgICAgICAgICAgICAgICAgICBpZiAobmFtZSkgeyAvLyBJZiB0aGUgY3VycmVudCBjYXB0dXJlIGhhcyBhIG5hbWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiKD88XCIgKyBuYW1lICsgXCI+XCI7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChiYWNrcmVmKSB7IC8vIEJhY2tyZWZlcmVuY2VcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gXCJcXFxcXCIgKyAoK2JhY2tyZWYgKyBudW1QcmlvckNhcHR1cmVzKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgb3V0cHV0ID0gW10sXHJcbiAgICAgICAgICAgIHBhdHRlcm4sXHJcbiAgICAgICAgICAgIGk7XHJcbiAgICAgICAgaWYgKCEoaXNUeXBlKHBhdHRlcm5zLCBcImFycmF5XCIpICYmIHBhdHRlcm5zLmxlbmd0aCkpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcInBhdHRlcm5zIG11c3QgYmUgYSBub25lbXB0eSBhcnJheVwiKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IHBhdHRlcm5zLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIHBhdHRlcm4gPSBwYXR0ZXJuc1tpXTtcclxuICAgICAgICAgICAgaWYgKHNlbGYuaXNSZWdFeHAocGF0dGVybikpIHtcclxuICAgICAgICAgICAgICAgIG51bVByaW9yQ2FwdHVyZXMgPSBudW1DYXB0dXJlcztcclxuICAgICAgICAgICAgICAgIGNhcHR1cmVOYW1lcyA9IChwYXR0ZXJuLnhyZWdleHAgJiYgcGF0dGVybi54cmVnZXhwLmNhcHR1cmVOYW1lcykgfHwgW107XHJcbiAgICAgICAgICAgICAgICAvLyBSZXdyaXRlIGJhY2tyZWZlcmVuY2VzLiBQYXNzaW5nIHRvIFhSZWdFeHAgZGllcyBvbiBvY3RhbHMgYW5kIGVuc3VyZXMgcGF0dGVybnNcclxuICAgICAgICAgICAgICAgIC8vIGFyZSBpbmRlcGVuZGVudGx5IHZhbGlkOyBoZWxwcyBrZWVwIHRoaXMgc2ltcGxlLiBOYW1lZCBjYXB0dXJlcyBhcmUgcHV0IGJhY2tcclxuICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKHNlbGYocGF0dGVybi5zb3VyY2UpLnNvdXJjZS5yZXBsYWNlKHBhcnRzLCByZXdyaXRlKSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBvdXRwdXQucHVzaChzZWxmLmVzY2FwZShwYXR0ZXJuKSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHNlbGYob3V0cHV0LmpvaW4oXCJ8XCIpLCBmbGFncyk7XHJcbiAgICB9O1xyXG5cclxuLyoqXHJcbiAqIFRoZSBYUmVnRXhwIHZlcnNpb24gbnVtYmVyLlxyXG4gKiBAc3RhdGljXHJcbiAqIEBtZW1iZXJPZiBYUmVnRXhwXHJcbiAqIEB0eXBlIFN0cmluZ1xyXG4gKi9cclxuICAgIHNlbGYudmVyc2lvbiA9IFwiMi4wLjBcIjtcclxuXHJcbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICogIEZpeGVkL2V4dGVuZGVkIG5hdGl2ZSBtZXRob2RzXHJcbiAqLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cclxuXHJcbi8qKlxyXG4gKiBBZGRzIG5hbWVkIGNhcHR1cmUgc3VwcG9ydCAod2l0aCBiYWNrcmVmZXJlbmNlcyByZXR1cm5lZCBhcyBgcmVzdWx0Lm5hbWVgKSwgYW5kIGZpeGVzIGJyb3dzZXJcclxuICogYnVncyBpbiB0aGUgbmF0aXZlIGBSZWdFeHAucHJvdG90eXBlLmV4ZWNgLiBDYWxsaW5nIGBYUmVnRXhwLmluc3RhbGwoJ25hdGl2ZXMnKWAgdXNlcyB0aGlzIHRvXHJcbiAqIG92ZXJyaWRlIHRoZSBuYXRpdmUgbWV0aG9kLiBVc2UgdmlhIGBYUmVnRXhwLmV4ZWNgIHdpdGhvdXQgb3ZlcnJpZGluZyBuYXRpdmVzLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFN0cmluZyB0byBzZWFyY2guXHJcbiAqIEByZXR1cm5zIHtBcnJheX0gTWF0Y2ggYXJyYXkgd2l0aCBuYW1lZCBiYWNrcmVmZXJlbmNlIHByb3BlcnRpZXMsIG9yIG51bGwuXHJcbiAqL1xyXG4gICAgZml4ZWQuZXhlYyA9IGZ1bmN0aW9uIChzdHIpIHtcclxuICAgICAgICB2YXIgbWF0Y2gsIG5hbWUsIHIyLCBvcmlnTGFzdEluZGV4LCBpO1xyXG4gICAgICAgIGlmICghdGhpcy5nbG9iYWwpIHtcclxuICAgICAgICAgICAgb3JpZ0xhc3RJbmRleCA9IHRoaXMubGFzdEluZGV4O1xyXG4gICAgICAgIH1cclxuICAgICAgICBtYXRjaCA9IG5hdGl2LmV4ZWMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICAgICAgICBpZiAobWF0Y2gpIHtcclxuICAgICAgICAgICAgLy8gRml4IGJyb3dzZXJzIHdob3NlIGBleGVjYCBtZXRob2RzIGRvbid0IGNvbnNpc3RlbnRseSByZXR1cm4gYHVuZGVmaW5lZGAgZm9yXHJcbiAgICAgICAgICAgIC8vIG5vbnBhcnRpY2lwYXRpbmcgY2FwdHVyaW5nIGdyb3Vwc1xyXG4gICAgICAgICAgICBpZiAoIWNvbXBsaWFudEV4ZWNOcGNnICYmIG1hdGNoLmxlbmd0aCA+IDEgJiYgbGFzdEluZGV4T2YobWF0Y2gsIFwiXCIpID4gLTEpIHtcclxuICAgICAgICAgICAgICAgIHIyID0gbmV3IFJlZ0V4cCh0aGlzLnNvdXJjZSwgbmF0aXYucmVwbGFjZS5jYWxsKGdldE5hdGl2ZUZsYWdzKHRoaXMpLCBcImdcIiwgXCJcIikpO1xyXG4gICAgICAgICAgICAgICAgLy8gVXNpbmcgYHN0ci5zbGljZShtYXRjaC5pbmRleClgIHJhdGhlciB0aGFuIGBtYXRjaFswXWAgaW4gY2FzZSBsb29rYWhlYWQgYWxsb3dlZFxyXG4gICAgICAgICAgICAgICAgLy8gbWF0Y2hpbmcgZHVlIHRvIGNoYXJhY3RlcnMgb3V0c2lkZSB0aGUgbWF0Y2hcclxuICAgICAgICAgICAgICAgIG5hdGl2LnJlcGxhY2UuY2FsbChTdHJpbmcoc3RyKS5zbGljZShtYXRjaC5pbmRleCksIHIyLCBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGk7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGggLSAyOyArK2kpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGFyZ3VtZW50c1tpXSA9PT0gdW5kZWYpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoW2ldID0gdW5kZWY7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBBdHRhY2ggbmFtZWQgY2FwdHVyZSBwcm9wZXJ0aWVzXHJcbiAgICAgICAgICAgIGlmICh0aGlzLnhyZWdleHAgJiYgdGhpcy54cmVnZXhwLmNhcHR1cmVOYW1lcykge1xyXG4gICAgICAgICAgICAgICAgZm9yIChpID0gMTsgaSA8IG1hdGNoLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbmFtZSA9IHRoaXMueHJlZ2V4cC5jYXB0dXJlTmFtZXNbaSAtIDFdO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChuYW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoW25hbWVdID0gbWF0Y2hbaV07XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIEZpeCBicm93c2VycyB0aGF0IGluY3JlbWVudCBgbGFzdEluZGV4YCBhZnRlciB6ZXJvLWxlbmd0aCBtYXRjaGVzXHJcbiAgICAgICAgICAgIGlmICh0aGlzLmdsb2JhbCAmJiAhbWF0Y2hbMF0ubGVuZ3RoICYmICh0aGlzLmxhc3RJbmRleCA+IG1hdGNoLmluZGV4KSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5sYXN0SW5kZXggPSBtYXRjaC5pbmRleDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoIXRoaXMuZ2xvYmFsKSB7XHJcbiAgICAgICAgICAgIHRoaXMubGFzdEluZGV4ID0gb3JpZ0xhc3RJbmRleDsgLy8gRml4ZXMgSUUsIE9wZXJhIGJ1ZyAobGFzdCB0ZXN0ZWQgSUUgOSwgT3BlcmEgMTEuNilcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBGaXhlcyBicm93c2VyIGJ1Z3MgaW4gdGhlIG5hdGl2ZSBgUmVnRXhwLnByb3RvdHlwZS50ZXN0YC4gQ2FsbGluZyBgWFJlZ0V4cC5pbnN0YWxsKCduYXRpdmVzJylgXHJcbiAqIHVzZXMgdGhpcyB0byBvdmVycmlkZSB0aGUgbmF0aXZlIG1ldGhvZC5cclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtTdHJpbmd9IHN0ciBTdHJpbmcgdG8gc2VhcmNoLlxyXG4gKiBAcmV0dXJucyB7Qm9vbGVhbn0gV2hldGhlciB0aGUgcmVnZXggbWF0Y2hlZCB0aGUgcHJvdmlkZWQgdmFsdWUuXHJcbiAqL1xyXG4gICAgZml4ZWQudGVzdCA9IGZ1bmN0aW9uIChzdHIpIHtcclxuICAgICAgICAvLyBEbyB0aGlzIHRoZSBlYXN5IHdheSA6LSlcclxuICAgICAgICByZXR1cm4gISFmaXhlZC5leGVjLmNhbGwodGhpcywgc3RyKTtcclxuICAgIH07XHJcblxyXG4vKipcclxuICogQWRkcyBuYW1lZCBjYXB0dXJlIHN1cHBvcnQgKHdpdGggYmFja3JlZmVyZW5jZXMgcmV0dXJuZWQgYXMgYHJlc3VsdC5uYW1lYCksIGFuZCBmaXhlcyBicm93c2VyXHJcbiAqIGJ1Z3MgaW4gdGhlIG5hdGl2ZSBgU3RyaW5nLnByb3RvdHlwZS5tYXRjaGAuIENhbGxpbmcgYFhSZWdFeHAuaW5zdGFsbCgnbmF0aXZlcycpYCB1c2VzIHRoaXMgdG9cclxuICogb3ZlcnJpZGUgdGhlIG5hdGl2ZSBtZXRob2QuXHJcbiAqIEBwcml2YXRlXHJcbiAqIEBwYXJhbSB7UmVnRXhwfSByZWdleCBSZWdleCB0byBzZWFyY2ggd2l0aC5cclxuICogQHJldHVybnMge0FycmF5fSBJZiBgcmVnZXhgIHVzZXMgZmxhZyBnLCBhbiBhcnJheSBvZiBtYXRjaCBzdHJpbmdzIG9yIG51bGwuIFdpdGhvdXQgZmxhZyBnLCB0aGVcclxuICogICByZXN1bHQgb2YgY2FsbGluZyBgcmVnZXguZXhlYyh0aGlzKWAuXHJcbiAqL1xyXG4gICAgZml4ZWQubWF0Y2ggPSBmdW5jdGlvbiAocmVnZXgpIHtcclxuICAgICAgICBpZiAoIXNlbGYuaXNSZWdFeHAocmVnZXgpKSB7XHJcbiAgICAgICAgICAgIHJlZ2V4ID0gbmV3IFJlZ0V4cChyZWdleCk7IC8vIFVzZSBuYXRpdmUgYFJlZ0V4cGBcclxuICAgICAgICB9IGVsc2UgaWYgKHJlZ2V4Lmdsb2JhbCkge1xyXG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gbmF0aXYubWF0Y2guYXBwbHkodGhpcywgYXJndW1lbnRzKTtcclxuICAgICAgICAgICAgcmVnZXgubGFzdEluZGV4ID0gMDsgLy8gRml4ZXMgSUUgYnVnXHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBmaXhlZC5leGVjLmNhbGwocmVnZXgsIHRoaXMpO1xyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBBZGRzIHN1cHBvcnQgZm9yIGAke259YCB0b2tlbnMgZm9yIG5hbWVkIGFuZCBudW1iZXJlZCBiYWNrcmVmZXJlbmNlcyBpbiByZXBsYWNlbWVudCB0ZXh0LCBhbmRcclxuICogcHJvdmlkZXMgbmFtZWQgYmFja3JlZmVyZW5jZXMgdG8gcmVwbGFjZW1lbnQgZnVuY3Rpb25zIGFzIGBhcmd1bWVudHNbMF0ubmFtZWAuIEFsc28gZml4ZXNcclxuICogYnJvd3NlciBidWdzIGluIHJlcGxhY2VtZW50IHRleHQgc3ludGF4IHdoZW4gcGVyZm9ybWluZyBhIHJlcGxhY2VtZW50IHVzaW5nIGEgbm9ucmVnZXggc2VhcmNoXHJcbiAqIHZhbHVlLCBhbmQgdGhlIHZhbHVlIG9mIGEgcmVwbGFjZW1lbnQgcmVnZXgncyBgbGFzdEluZGV4YCBwcm9wZXJ0eSBkdXJpbmcgcmVwbGFjZW1lbnQgaXRlcmF0aW9uc1xyXG4gKiBhbmQgdXBvbiBjb21wbGV0aW9uLiBOb3RlIHRoYXQgdGhpcyBkb2Vzbid0IHN1cHBvcnQgU3BpZGVyTW9ua2V5J3MgcHJvcHJpZXRhcnkgdGhpcmQgKGBmbGFnc2ApXHJcbiAqIGFyZ3VtZW50LiBDYWxsaW5nIGBYUmVnRXhwLmluc3RhbGwoJ25hdGl2ZXMnKWAgdXNlcyB0aGlzIHRvIG92ZXJyaWRlIHRoZSBuYXRpdmUgbWV0aG9kLiBVc2UgdmlhXHJcbiAqIGBYUmVnRXhwLnJlcGxhY2VgIHdpdGhvdXQgb3ZlcnJpZGluZyBuYXRpdmVzLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge1JlZ0V4cHxTdHJpbmd9IHNlYXJjaCBTZWFyY2ggcGF0dGVybiB0byBiZSByZXBsYWNlZC5cclxuICogQHBhcmFtIHtTdHJpbmd8RnVuY3Rpb259IHJlcGxhY2VtZW50IFJlcGxhY2VtZW50IHN0cmluZyBvciBhIGZ1bmN0aW9uIGludm9rZWQgdG8gY3JlYXRlIGl0LlxyXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBOZXcgc3RyaW5nIHdpdGggb25lIG9yIGFsbCBtYXRjaGVzIHJlcGxhY2VkLlxyXG4gKi9cclxuICAgIGZpeGVkLnJlcGxhY2UgPSBmdW5jdGlvbiAoc2VhcmNoLCByZXBsYWNlbWVudCkge1xyXG4gICAgICAgIHZhciBpc1JlZ2V4ID0gc2VsZi5pc1JlZ0V4cChzZWFyY2gpLCBjYXB0dXJlTmFtZXMsIHJlc3VsdCwgc3RyLCBvcmlnTGFzdEluZGV4O1xyXG4gICAgICAgIGlmIChpc1JlZ2V4KSB7XHJcbiAgICAgICAgICAgIGlmIChzZWFyY2gueHJlZ2V4cCkge1xyXG4gICAgICAgICAgICAgICAgY2FwdHVyZU5hbWVzID0gc2VhcmNoLnhyZWdleHAuY2FwdHVyZU5hbWVzO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghc2VhcmNoLmdsb2JhbCkge1xyXG4gICAgICAgICAgICAgICAgb3JpZ0xhc3RJbmRleCA9IHNlYXJjaC5sYXN0SW5kZXg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBzZWFyY2ggKz0gXCJcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGlzVHlwZShyZXBsYWNlbWVudCwgXCJmdW5jdGlvblwiKSkge1xyXG4gICAgICAgICAgICByZXN1bHQgPSBuYXRpdi5yZXBsYWNlLmNhbGwoU3RyaW5nKHRoaXMpLCBzZWFyY2gsIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzLCBpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGNhcHR1cmVOYW1lcykge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENoYW5nZSB0aGUgYGFyZ3VtZW50c1swXWAgc3RyaW5nIHByaW1pdGl2ZSB0byBhIGBTdHJpbmdgIG9iamVjdCB0aGF0IGNhbiBzdG9yZSBwcm9wZXJ0aWVzXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnc1swXSA9IG5ldyBTdHJpbmcoYXJnc1swXSk7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gU3RvcmUgbmFtZWQgYmFja3JlZmVyZW5jZXMgb24gdGhlIGZpcnN0IGFyZ3VtZW50XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IGNhcHR1cmVOYW1lcy5sZW5ndGg7ICsraSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY2FwdHVyZU5hbWVzW2ldKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcmdzWzBdW2NhcHR1cmVOYW1lc1tpXV0gPSBhcmdzW2kgKyAxXTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBgbGFzdEluZGV4YCBiZWZvcmUgY2FsbGluZyBgcmVwbGFjZW1lbnRgLlxyXG4gICAgICAgICAgICAgICAgLy8gRml4ZXMgSUUsIENocm9tZSwgRmlyZWZveCwgU2FmYXJpIGJ1ZyAobGFzdCB0ZXN0ZWQgSUUgOSwgQ2hyb21lIDE3LCBGaXJlZm94IDExLCBTYWZhcmkgNS4xKVxyXG4gICAgICAgICAgICAgICAgaWYgKGlzUmVnZXggJiYgc2VhcmNoLmdsb2JhbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHNlYXJjaC5sYXN0SW5kZXggPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMl0gKyBhcmdzWzBdLmxlbmd0aDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHJldHVybiByZXBsYWNlbWVudC5hcHBseShudWxsLCBhcmdzKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgc3RyID0gU3RyaW5nKHRoaXMpOyAvLyBFbnN1cmUgYGFyZ3NbYXJncy5sZW5ndGggLSAxXWAgd2lsbCBiZSBhIHN0cmluZyB3aGVuIGdpdmVuIG5vbnN0cmluZyBgdGhpc2BcclxuICAgICAgICAgICAgcmVzdWx0ID0gbmF0aXYucmVwbGFjZS5jYWxsKHN0ciwgc2VhcmNoLCBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50czsgLy8gS2VlcCB0aGlzIGZ1bmN0aW9uJ3MgYGFyZ3VtZW50c2AgYXZhaWxhYmxlIHRocm91Z2ggY2xvc3VyZVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5hdGl2LnJlcGxhY2UuY2FsbChTdHJpbmcocmVwbGFjZW1lbnQpLCByZXBsYWNlbWVudFRva2VuLCBmdW5jdGlvbiAoJDAsICQxLCAkMikge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBuO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIE5hbWVkIG9yIG51bWJlcmVkIGJhY2tyZWZlcmVuY2Ugd2l0aCBjdXJseSBicmFja2V0c1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgkMSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvKiBYUmVnRXhwIGJlaGF2aW9yIGZvciBgJHtufWA6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAqIDEuIEJhY2tyZWZlcmVuY2UgdG8gbnVtYmVyZWQgY2FwdHVyZSwgd2hlcmUgYG5gIGlzIDErIGRpZ2l0cy4gYDBgLCBgMDBgLCBldGMuIGlzIHRoZSBlbnRpcmUgbWF0Y2guXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAqIDIuIEJhY2tyZWZlcmVuY2UgdG8gbmFtZWQgY2FwdHVyZSBgbmAsIGlmIGl0IGV4aXN0cyBhbmQgaXMgbm90IGEgbnVtYmVyIG92ZXJyaWRkZW4gYnkgbnVtYmVyZWQgY2FwdHVyZS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgICogMy4gT3RoZXJ3aXNlLCBpdCdzIGFuIGVycm9yLlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgICAgICAgICAgICAgbiA9ICskMTsgLy8gVHlwZS1jb252ZXJ0OyBkcm9wIGxlYWRpbmcgemVyb3NcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG4gPD0gYXJncy5sZW5ndGggLSAzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYXJnc1tuXSB8fCBcIlwiO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG4gPSBjYXB0dXJlTmFtZXMgPyBsYXN0SW5kZXhPZihjYXB0dXJlTmFtZXMsICQxKSA6IC0xO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobiA8IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcImJhY2tyZWZlcmVuY2UgdG8gdW5kZWZpbmVkIGdyb3VwIFwiICsgJDApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBhcmdzW24gKyAxXSB8fCBcIlwiO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAvLyBFbHNlLCBzcGVjaWFsIHZhcmlhYmxlIG9yIG51bWJlcmVkIGJhY2tyZWZlcmVuY2UgKHdpdGhvdXQgY3VybHkgYnJhY2tldHMpXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCQyID09PSBcIiRcIikgcmV0dXJuIFwiJFwiO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgkMiA9PT0gXCImXCIgfHwgKyQyID09PSAwKSByZXR1cm4gYXJnc1swXTsgLy8gJCYsICQwIChub3QgZm9sbG93ZWQgYnkgMS05KSwgJDAwXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCQyID09PSBcImBcIikgcmV0dXJuIGFyZ3NbYXJncy5sZW5ndGggLSAxXS5zbGljZSgwLCBhcmdzW2FyZ3MubGVuZ3RoIC0gMl0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICgkMiA9PT0gXCInXCIpIHJldHVybiBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0uc2xpY2UoYXJnc1thcmdzLmxlbmd0aCAtIDJdICsgYXJnc1swXS5sZW5ndGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIEVsc2UsIG51bWJlcmVkIGJhY2tyZWZlcmVuY2UgKHdpdGhvdXQgY3VybHkgYnJhY2tldHMpXHJcbiAgICAgICAgICAgICAgICAgICAgJDIgPSArJDI7IC8vIFR5cGUtY29udmVydDsgZHJvcCBsZWFkaW5nIHplcm9cclxuICAgICAgICAgICAgICAgICAgICAvKiBYUmVnRXhwIGJlaGF2aW9yOlxyXG4gICAgICAgICAgICAgICAgICAgICAqIC0gQmFja3JlZmVyZW5jZXMgd2l0aG91dCBjdXJseSBicmFja2V0cyBlbmQgYWZ0ZXIgMSBvciAyIGRpZ2l0cy4gVXNlIGAkey4ufWAgZm9yIG1vcmUgZGlnaXRzLlxyXG4gICAgICAgICAgICAgICAgICAgICAqIC0gYCQxYCBpcyBhbiBlcnJvciBpZiB0aGVyZSBhcmUgbm8gY2FwdHVyaW5nIGdyb3Vwcy5cclxuICAgICAgICAgICAgICAgICAgICAgKiAtIGAkMTBgIGlzIGFuIGVycm9yIGlmIHRoZXJlIGFyZSBsZXNzIHRoYW4gMTAgY2FwdHVyaW5nIGdyb3Vwcy4gVXNlIGAkezF9MGAgaW5zdGVhZC5cclxuICAgICAgICAgICAgICAgICAgICAgKiAtIGAkMDFgIGlzIGVxdWl2YWxlbnQgdG8gYCQxYCBpZiBhIGNhcHR1cmluZyBncm91cCBleGlzdHMsIG90aGVyd2lzZSBpdCdzIGFuIGVycm9yLlxyXG4gICAgICAgICAgICAgICAgICAgICAqIC0gYCQwYCAobm90IGZvbGxvd2VkIGJ5IDEtOSksIGAkMDBgLCBhbmQgYCQmYCBhcmUgdGhlIGVudGlyZSBtYXRjaC5cclxuICAgICAgICAgICAgICAgICAgICAgKiBOYXRpdmUgYmVoYXZpb3IsIGZvciBjb21wYXJpc29uOlxyXG4gICAgICAgICAgICAgICAgICAgICAqIC0gQmFja3JlZmVyZW5jZXMgZW5kIGFmdGVyIDEgb3IgMiBkaWdpdHMuIENhbm5vdCB1c2UgYmFja3JlZmVyZW5jZSB0byBjYXB0dXJpbmcgZ3JvdXAgMTAwKy5cclxuICAgICAgICAgICAgICAgICAgICAgKiAtIGAkMWAgaXMgYSBsaXRlcmFsIGAkMWAgaWYgdGhlcmUgYXJlIG5vIGNhcHR1cmluZyBncm91cHMuXHJcbiAgICAgICAgICAgICAgICAgICAgICogLSBgJDEwYCBpcyBgJDFgIGZvbGxvd2VkIGJ5IGEgbGl0ZXJhbCBgMGAgaWYgdGhlcmUgYXJlIGxlc3MgdGhhbiAxMCBjYXB0dXJpbmcgZ3JvdXBzLlxyXG4gICAgICAgICAgICAgICAgICAgICAqIC0gYCQwMWAgaXMgZXF1aXZhbGVudCB0byBgJDFgIGlmIGEgY2FwdHVyaW5nIGdyb3VwIGV4aXN0cywgb3RoZXJ3aXNlIGl0J3MgYSBsaXRlcmFsIGAkMDFgLlxyXG4gICAgICAgICAgICAgICAgICAgICAqIC0gYCQwYCBpcyBhIGxpdGVyYWwgYCQwYC4gYCQmYCBpcyB0aGUgZW50aXJlIG1hdGNoLlxyXG4gICAgICAgICAgICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghaXNOYU4oJDIpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkMiA+IGFyZ3MubGVuZ3RoIC0gMykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiYmFja3JlZmVyZW5jZSB0byB1bmRlZmluZWQgZ3JvdXAgXCIgKyAkMCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFyZ3NbJDJdIHx8IFwiXCI7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcImludmFsaWQgdG9rZW4gXCIgKyAkMCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChpc1JlZ2V4KSB7XHJcbiAgICAgICAgICAgIGlmIChzZWFyY2guZ2xvYmFsKSB7XHJcbiAgICAgICAgICAgICAgICBzZWFyY2gubGFzdEluZGV4ID0gMDsgLy8gRml4ZXMgSUUsIFNhZmFyaSBidWcgKGxhc3QgdGVzdGVkIElFIDksIFNhZmFyaSA1LjEpXHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBzZWFyY2gubGFzdEluZGV4ID0gb3JpZ0xhc3RJbmRleDsgLy8gRml4ZXMgSUUsIE9wZXJhIGJ1ZyAobGFzdCB0ZXN0ZWQgSUUgOSwgT3BlcmEgMTEuNilcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfTtcclxuXHJcbi8qKlxyXG4gKiBGaXhlcyBicm93c2VyIGJ1Z3MgaW4gdGhlIG5hdGl2ZSBgU3RyaW5nLnByb3RvdHlwZS5zcGxpdGAuIENhbGxpbmcgYFhSZWdFeHAuaW5zdGFsbCgnbmF0aXZlcycpYFxyXG4gKiB1c2VzIHRoaXMgdG8gb3ZlcnJpZGUgdGhlIG5hdGl2ZSBtZXRob2QuIFVzZSB2aWEgYFhSZWdFeHAuc3BsaXRgIHdpdGhvdXQgb3ZlcnJpZGluZyBuYXRpdmVzLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge1JlZ0V4cHxTdHJpbmd9IHNlcGFyYXRvciBSZWdleCBvciBzdHJpbmcgdG8gdXNlIGZvciBzZXBhcmF0aW5nIHRoZSBzdHJpbmcuXHJcbiAqIEBwYXJhbSB7TnVtYmVyfSBbbGltaXRdIE1heGltdW0gbnVtYmVyIG9mIGl0ZW1zIHRvIGluY2x1ZGUgaW4gdGhlIHJlc3VsdCBhcnJheS5cclxuICogQHJldHVybnMge0FycmF5fSBBcnJheSBvZiBzdWJzdHJpbmdzLlxyXG4gKi9cclxuICAgIGZpeGVkLnNwbGl0ID0gZnVuY3Rpb24gKHNlcGFyYXRvciwgbGltaXQpIHtcclxuICAgICAgICBpZiAoIXNlbGYuaXNSZWdFeHAoc2VwYXJhdG9yKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gbmF0aXYuc3BsaXQuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgLy8gdXNlIGZhc3RlciBuYXRpdmUgbWV0aG9kXHJcbiAgICAgICAgfVxyXG4gICAgICAgIHZhciBzdHIgPSBTdHJpbmcodGhpcyksXHJcbiAgICAgICAgICAgIG9yaWdMYXN0SW5kZXggPSBzZXBhcmF0b3IubGFzdEluZGV4LFxyXG4gICAgICAgICAgICBvdXRwdXQgPSBbXSxcclxuICAgICAgICAgICAgbGFzdExhc3RJbmRleCA9IDAsXHJcbiAgICAgICAgICAgIGxhc3RMZW5ndGg7XHJcbiAgICAgICAgLyogVmFsdWVzIGZvciBgbGltaXRgLCBwZXIgdGhlIHNwZWM6XHJcbiAgICAgICAgICogSWYgdW5kZWZpbmVkOiBwb3coMiwzMikgLSAxXHJcbiAgICAgICAgICogSWYgMCwgSW5maW5pdHksIG9yIE5hTjogMFxyXG4gICAgICAgICAqIElmIHBvc2l0aXZlIG51bWJlcjogbGltaXQgPSBmbG9vcihsaW1pdCk7IGlmIChsaW1pdCA+PSBwb3coMiwzMikpIGxpbWl0IC09IHBvdygyLDMyKTtcclxuICAgICAgICAgKiBJZiBuZWdhdGl2ZSBudW1iZXI6IHBvdygyLDMyKSAtIGZsb29yKGFicyhsaW1pdCkpXHJcbiAgICAgICAgICogSWYgb3RoZXI6IFR5cGUtY29udmVydCwgdGhlbiB1c2UgdGhlIGFib3ZlIHJ1bGVzXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgbGltaXQgPSAobGltaXQgPT09IHVuZGVmID8gLTEgOiBsaW1pdCkgPj4+IDA7XHJcbiAgICAgICAgc2VsZi5mb3JFYWNoKHN0ciwgc2VwYXJhdG9yLCBmdW5jdGlvbiAobWF0Y2gpIHtcclxuICAgICAgICAgICAgaWYgKChtYXRjaC5pbmRleCArIG1hdGNoWzBdLmxlbmd0aCkgPiBsYXN0TGFzdEluZGV4KSB7IC8vICE9IGBpZiAobWF0Y2hbMF0ubGVuZ3RoKWBcclxuICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKHN0ci5zbGljZShsYXN0TGFzdEluZGV4LCBtYXRjaC5pbmRleCkpO1xyXG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoLmxlbmd0aCA+IDEgJiYgbWF0Y2guaW5kZXggPCBzdHIubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkob3V0cHV0LCBtYXRjaC5zbGljZSgxKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBsYXN0TGVuZ3RoID0gbWF0Y2hbMF0ubGVuZ3RoO1xyXG4gICAgICAgICAgICAgICAgbGFzdExhc3RJbmRleCA9IG1hdGNoLmluZGV4ICsgbGFzdExlbmd0aDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmIChsYXN0TGFzdEluZGV4ID09PSBzdHIubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgIGlmICghbmF0aXYudGVzdC5jYWxsKHNlcGFyYXRvciwgXCJcIikgfHwgbGFzdExlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgb3V0cHV0LnB1c2goXCJcIik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBvdXRwdXQucHVzaChzdHIuc2xpY2UobGFzdExhc3RJbmRleCkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBzZXBhcmF0b3IubGFzdEluZGV4ID0gb3JpZ0xhc3RJbmRleDtcclxuICAgICAgICByZXR1cm4gb3V0cHV0Lmxlbmd0aCA+IGxpbWl0ID8gb3V0cHV0LnNsaWNlKDAsIGxpbWl0KSA6IG91dHB1dDtcclxuICAgIH07XHJcblxyXG4vKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAqICBCdWlsdC1pbiB0b2tlbnNcclxuICotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xyXG5cclxuLy8gU2hvcnRjdXRcclxuICAgIGFkZCA9IGFkZFRva2VuLm9uO1xyXG5cclxuLyogTGV0dGVyIGlkZW50aXR5IGVzY2FwZXMgdGhhdCBuYXRpdmVseSBtYXRjaCBsaXRlcmFsIGNoYXJhY3RlcnM6IFxccCwgXFxQLCBldGMuXHJcbiAqIFNob3VsZCBiZSBTeW50YXhFcnJvcnMgYnV0IGFyZSBhbGxvd2VkIGluIHdlYiByZWFsaXR5LiBYUmVnRXhwIG1ha2VzIHRoZW0gZXJyb3JzIGZvciBjcm9zcy1cclxuICogYnJvd3NlciBjb25zaXN0ZW5jeSBhbmQgdG8gcmVzZXJ2ZSB0aGVpciBzeW50YXgsIGJ1dCBsZXRzIHRoZW0gYmUgc3VwZXJzZWRlZCBieSBYUmVnRXhwIGFkZG9ucy5cclxuICovXHJcbiAgICBhZGQoL1xcXFwoW0FCQ0UtUlRVVlhZWmFlZy1tb3BxeXpdfGMoPyFbQS1aYS16XSl8dSg/IVtcXGRBLUZhLWZdezR9KXx4KD8hW1xcZEEtRmEtZl17Mn0pKS8sXHJcbiAgICAgICAgZnVuY3Rpb24gKG1hdGNoLCBzY29wZSkge1xyXG4gICAgICAgICAgICAvLyBcXEIgaXMgYWxsb3dlZCBpbiBkZWZhdWx0IHNjb3BlIG9ubHlcclxuICAgICAgICAgICAgaWYgKG1hdGNoWzFdID09PSBcIkJcIiAmJiBzY29wZSA9PT0gZGVmYXVsdFNjb3BlKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbWF0Y2hbMF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiaW52YWxpZCBlc2NhcGUgXCIgKyBtYXRjaFswXSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICB7c2NvcGU6IFwiYWxsXCJ9KTtcclxuXHJcbi8qIEVtcHR5IGNoYXJhY3RlciBjbGFzczogW10gb3IgW15dXHJcbiAqIEZpeGVzIGEgY3JpdGljYWwgY3Jvc3MtYnJvd3NlciBzeW50YXggaW5jb25zaXN0ZW5jeS4gVW5sZXNzIHRoaXMgaXMgc3RhbmRhcmRpemVkIChwZXIgdGhlIHNwZWMpLFxyXG4gKiByZWdleCBzeW50YXggY2FuJ3QgYmUgYWNjdXJhdGVseSBwYXJzZWQgYmVjYXVzZSBjaGFyYWN0ZXIgY2xhc3MgZW5kaW5ncyBjYW4ndCBiZSBkZXRlcm1pbmVkLlxyXG4gKi9cclxuICAgIGFkZCgvXFxbKFxcXj8pXS8sXHJcbiAgICAgICAgZnVuY3Rpb24gKG1hdGNoKSB7XHJcbiAgICAgICAgICAgIC8vIEZvciBjcm9zcy1icm93c2VyIGNvbXBhdGliaWxpdHkgd2l0aCBFUzMsIGNvbnZlcnQgW10gdG8gXFxiXFxCIGFuZCBbXl0gdG8gW1xcc1xcU10uXHJcbiAgICAgICAgICAgIC8vICg/ISkgc2hvdWxkIHdvcmsgbGlrZSBcXGJcXEIsIGJ1dCBpcyB1bnJlbGlhYmxlIGluIEZpcmVmb3hcclxuICAgICAgICAgICAgcmV0dXJuIG1hdGNoWzFdID8gXCJbXFxcXHNcXFxcU11cIiA6IFwiXFxcXGJcXFxcQlwiO1xyXG4gICAgICAgIH0pO1xyXG5cclxuLyogQ29tbWVudCBwYXR0ZXJuOiAoPyMgKVxyXG4gKiBJbmxpbmUgY29tbWVudHMgYXJlIGFuIGFsdGVybmF0aXZlIHRvIHRoZSBsaW5lIGNvbW1lbnRzIGFsbG93ZWQgaW4gZnJlZS1zcGFjaW5nIG1vZGUgKGZsYWcgeCkuXHJcbiAqL1xyXG4gICAgYWRkKC8oPzpcXChcXD8jW14pXSpcXCkpKy8sXHJcbiAgICAgICAgZnVuY3Rpb24gKG1hdGNoKSB7XHJcbiAgICAgICAgICAgIC8vIEtlZXAgdG9rZW5zIHNlcGFyYXRlZCB1bmxlc3MgdGhlIGZvbGxvd2luZyB0b2tlbiBpcyBhIHF1YW50aWZpZXJcclxuICAgICAgICAgICAgcmV0dXJuIG5hdGl2LnRlc3QuY2FsbChxdWFudGlmaWVyLCBtYXRjaC5pbnB1dC5zbGljZShtYXRjaC5pbmRleCArIG1hdGNoWzBdLmxlbmd0aCkpID8gXCJcIiA6IFwiKD86KVwiO1xyXG4gICAgICAgIH0pO1xyXG5cclxuLyogTmFtZWQgYmFja3JlZmVyZW5jZTogXFxrPG5hbWU+XHJcbiAqIEJhY2tyZWZlcmVuY2UgbmFtZXMgY2FuIHVzZSB0aGUgY2hhcmFjdGVycyBBLVosIGEteiwgMC05LCBfLCBhbmQgJCBvbmx5LlxyXG4gKi9cclxuICAgIGFkZCgvXFxcXGs8KFtcXHckXSspPi8sXHJcbiAgICAgICAgZnVuY3Rpb24gKG1hdGNoKSB7XHJcbiAgICAgICAgICAgIHZhciBpbmRleCA9IGlzTmFOKG1hdGNoWzFdKSA/IChsYXN0SW5kZXhPZih0aGlzLmNhcHR1cmVOYW1lcywgbWF0Y2hbMV0pICsgMSkgOiArbWF0Y2hbMV0sXHJcbiAgICAgICAgICAgICAgICBlbmRJbmRleCA9IG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoO1xyXG4gICAgICAgICAgICBpZiAoIWluZGV4IHx8IGluZGV4ID4gdGhpcy5jYXB0dXJlTmFtZXMubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJiYWNrcmVmZXJlbmNlIHRvIHVuZGVmaW5lZCBncm91cCBcIiArIG1hdGNoWzBdKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBLZWVwIGJhY2tyZWZlcmVuY2VzIHNlcGFyYXRlIGZyb20gc3Vic2VxdWVudCBsaXRlcmFsIG51bWJlcnNcclxuICAgICAgICAgICAgcmV0dXJuIFwiXFxcXFwiICsgaW5kZXggKyAoXHJcbiAgICAgICAgICAgICAgICBlbmRJbmRleCA9PT0gbWF0Y2guaW5wdXQubGVuZ3RoIHx8IGlzTmFOKG1hdGNoLmlucHV0LmNoYXJBdChlbmRJbmRleCkpID8gXCJcIiA6IFwiKD86KVwiXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4vKiBXaGl0ZXNwYWNlIGFuZCBsaW5lIGNvbW1lbnRzLCBpbiBmcmVlLXNwYWNpbmcgbW9kZSAoYWthIGV4dGVuZGVkIG1vZGUsIGZsYWcgeCkgb25seS5cclxuICovXHJcbiAgICBhZGQoLyg/Olxccyt8Iy4qKSsvLFxyXG4gICAgICAgIGZ1bmN0aW9uIChtYXRjaCkge1xyXG4gICAgICAgICAgICAvLyBLZWVwIHRva2VucyBzZXBhcmF0ZWQgdW5sZXNzIHRoZSBmb2xsb3dpbmcgdG9rZW4gaXMgYSBxdWFudGlmaWVyXHJcbiAgICAgICAgICAgIHJldHVybiBuYXRpdi50ZXN0LmNhbGwocXVhbnRpZmllciwgbWF0Y2guaW5wdXQuc2xpY2UobWF0Y2guaW5kZXggKyBtYXRjaFswXS5sZW5ndGgpKSA/IFwiXCIgOiBcIig/OilcIjtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgdHJpZ2dlcjogZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFzRmxhZyhcInhcIik7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGN1c3RvbUZsYWdzOiBcInhcIlxyXG4gICAgICAgIH0pO1xyXG5cclxuLyogRG90LCBpbiBkb3RhbGwgbW9kZSAoYWthIHNpbmdsZWxpbmUgbW9kZSwgZmxhZyBzKSBvbmx5LlxyXG4gKi9cclxuICAgIGFkZCgvXFwuLyxcclxuICAgICAgICBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBcIltcXFxcc1xcXFxTXVwiO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICB0cmlnZ2VyOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5oYXNGbGFnKFwic1wiKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgY3VzdG9tRmxhZ3M6IFwic1wiXHJcbiAgICAgICAgfSk7XHJcblxyXG4vKiBOYW1lZCBjYXB0dXJpbmcgZ3JvdXA7IG1hdGNoIHRoZSBvcGVuaW5nIGRlbGltaXRlciBvbmx5OiAoPzxuYW1lPlxyXG4gKiBDYXB0dXJlIG5hbWVzIGNhbiB1c2UgdGhlIGNoYXJhY3RlcnMgQS1aLCBhLXosIDAtOSwgXywgYW5kICQgb25seS4gTmFtZXMgY2FuJ3QgYmUgaW50ZWdlcnMuXHJcbiAqIFN1cHBvcnRzIFB5dGhvbi1zdHlsZSAoP1A8bmFtZT4gYXMgYW4gYWx0ZXJuYXRlIHN5bnRheCB0byBhdm9pZCBpc3N1ZXMgaW4gcmVjZW50IE9wZXJhICh3aGljaFxyXG4gKiBuYXRpdmVseSBzdXBwb3J0cyB0aGUgUHl0aG9uLXN0eWxlIHN5bnRheCkuIE90aGVyd2lzZSwgWFJlZ0V4cCBtaWdodCB0cmVhdCBudW1iZXJlZFxyXG4gKiBiYWNrcmVmZXJlbmNlcyB0byBQeXRob24tc3R5bGUgbmFtZWQgY2FwdHVyZSBhcyBvY3RhbHMuXHJcbiAqL1xyXG4gICAgYWRkKC9cXChcXD9QPzwoW1xcdyRdKyk+LyxcclxuICAgICAgICBmdW5jdGlvbiAobWF0Y2gpIHtcclxuICAgICAgICAgICAgaWYgKCFpc05hTihtYXRjaFsxXSkpIHtcclxuICAgICAgICAgICAgICAgIC8vIEF2b2lkIGluY29ycmVjdCBsb29rdXBzLCBzaW5jZSBuYW1lZCBiYWNrcmVmZXJlbmNlcyBhcmUgYWRkZWQgdG8gbWF0Y2ggYXJyYXlzXHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJjYW4ndCB1c2UgaW50ZWdlciBhcyBjYXB0dXJlIG5hbWUgXCIgKyBtYXRjaFswXSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgdGhpcy5jYXB0dXJlTmFtZXMucHVzaChtYXRjaFsxXSk7XHJcbiAgICAgICAgICAgIHRoaXMuaGFzTmFtZWRDYXB0dXJlID0gdHJ1ZTtcclxuICAgICAgICAgICAgcmV0dXJuIFwiKFwiO1xyXG4gICAgICAgIH0pO1xyXG5cclxuLyogTnVtYmVyZWQgYmFja3JlZmVyZW5jZSBvciBvY3RhbCwgcGx1cyBhbnkgZm9sbG93aW5nIGRpZ2l0czogXFwwLCBcXDExLCBldGMuXHJcbiAqIE9jdGFscyBleGNlcHQgXFwwIG5vdCBmb2xsb3dlZCBieSAwLTkgYW5kIGJhY2tyZWZlcmVuY2VzIHRvIHVub3BlbmVkIGNhcHR1cmUgZ3JvdXBzIHRocm93IGFuXHJcbiAqIGVycm9yLiBPdGhlciBtYXRjaGVzIGFyZSByZXR1cm5lZCB1bmFsdGVyZWQuIElFIDw9IDggZG9lc24ndCBzdXBwb3J0IGJhY2tyZWZlcmVuY2VzIGdyZWF0ZXIgdGhhblxyXG4gKiBcXDk5IGluIHJlZ2V4IHN5bnRheC5cclxuICovXHJcbiAgICBhZGQoL1xcXFwoXFxkKykvLFxyXG4gICAgICAgIGZ1bmN0aW9uIChtYXRjaCwgc2NvcGUpIHtcclxuICAgICAgICAgICAgaWYgKCEoc2NvcGUgPT09IGRlZmF1bHRTY29wZSAmJiAvXlsxLTldLy50ZXN0KG1hdGNoWzFdKSAmJiArbWF0Y2hbMV0gPD0gdGhpcy5jYXB0dXJlTmFtZXMubGVuZ3RoKSAmJlxyXG4gICAgICAgICAgICAgICAgICAgIG1hdGNoWzFdICE9PSBcIjBcIikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiY2FuJ3QgdXNlIG9jdGFsIGVzY2FwZSBvciBiYWNrcmVmZXJlbmNlIHRvIHVuZGVmaW5lZCBncm91cCBcIiArIG1hdGNoWzBdKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gbWF0Y2hbMF07XHJcbiAgICAgICAgfSxcclxuICAgICAgICB7c2NvcGU6IFwiYWxsXCJ9KTtcclxuXHJcbi8qIENhcHR1cmluZyBncm91cDsgbWF0Y2ggdGhlIG9wZW5pbmcgcGFyZW50aGVzaXMgb25seS5cclxuICogUmVxdWlyZWQgZm9yIHN1cHBvcnQgb2YgbmFtZWQgY2FwdHVyaW5nIGdyb3Vwcy4gQWxzbyBhZGRzIGV4cGxpY2l0IGNhcHR1cmUgbW9kZSAoZmxhZyBuKS5cclxuICovXHJcbiAgICBhZGQoL1xcKCg/IVxcPykvLFxyXG4gICAgICAgIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgaWYgKHRoaXMuaGFzRmxhZyhcIm5cIikpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBcIig/OlwiO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMuY2FwdHVyZU5hbWVzLnB1c2gobnVsbCk7XHJcbiAgICAgICAgICAgIHJldHVybiBcIihcIjtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtjdXN0b21GbGFnczogXCJuXCJ9KTtcclxuXHJcbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICogIEV4cG9zZSBYUmVnRXhwXHJcbiAqLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cclxuXHJcbi8vIEZvciBDb21tb25KUyBlbnZpcm9tZW50c1xyXG4gICAgaWYgKHR5cGVvZiBleHBvcnRzICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgICAgZXhwb3J0cy5YUmVnRXhwID0gc2VsZjtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gc2VsZjtcclxuXHJcbn0oKSk7XHJcblxyXG5cbi8qKioqKiB1bmljb2RlLWJhc2UuanMgKioqKiovXG5cbi8qIVxyXG4gKiBYUmVnRXhwIFVuaWNvZGUgQmFzZSB2MS4wLjBcclxuICogKGMpIDIwMDgtMjAxMiBTdGV2ZW4gTGV2aXRoYW4gPGh0dHA6Ly94cmVnZXhwLmNvbS8+XHJcbiAqIE1JVCBMaWNlbnNlXHJcbiAqIFVzZXMgVW5pY29kZSA2LjEgPGh0dHA6Ly91bmljb2RlLm9yZy8+XHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIEFkZHMgc3VwcG9ydCBmb3IgdGhlIGBcXHB7TH1gIG9yIGBcXHB7TGV0dGVyfWAgVW5pY29kZSBjYXRlZ29yeS4gQWRkb24gcGFja2FnZXMgZm9yIG90aGVyIFVuaWNvZGVcclxuICogY2F0ZWdvcmllcywgc2NyaXB0cywgYmxvY2tzLCBhbmQgcHJvcGVydGllcyBhcmUgYXZhaWxhYmxlIHNlcGFyYXRlbHkuIEFsbCBVbmljb2RlIHRva2VucyBjYW4gYmVcclxuICogaW52ZXJ0ZWQgdXNpbmcgYFxcUHsuLn1gIG9yIGBcXHB7Xi4ufWAuIFRva2VuIG5hbWVzIGFyZSBjYXNlIGluc2Vuc2l0aXZlLCBhbmQgYW55IHNwYWNlcywgaHlwaGVucyxcclxuICogYW5kIHVuZGVyc2NvcmVzIGFyZSBpZ25vcmVkLlxyXG4gKiBAcmVxdWlyZXMgWFJlZ0V4cFxyXG4gKi9cclxuKGZ1bmN0aW9uIChYUmVnRXhwKSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICB2YXIgdW5pY29kZSA9IHt9O1xyXG5cclxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gKiAgUHJpdmF0ZSBoZWxwZXIgZnVuY3Rpb25zXHJcbiAqLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cclxuXHJcbi8vIEdlbmVyYXRlcyBhIHN0YW5kYXJkaXplZCB0b2tlbiBuYW1lIChsb3dlcmNhc2UsIHdpdGggaHlwaGVucywgc3BhY2VzLCBhbmQgdW5kZXJzY29yZXMgcmVtb3ZlZClcclxuICAgIGZ1bmN0aW9uIHNsdWcobmFtZSkge1xyXG4gICAgICAgIHJldHVybiBuYW1lLnJlcGxhY2UoL1stIF9dKy9nLCBcIlwiKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgfVxyXG5cclxuLy8gRXhwYW5kcyBhIGxpc3Qgb2YgVW5pY29kZSBjb2RlIHBvaW50cyBhbmQgcmFuZ2VzIHRvIGJlIHVzYWJsZSBpbiBhIHJlZ2V4IGNoYXJhY3RlciBjbGFzc1xyXG4gICAgZnVuY3Rpb24gZXhwYW5kKHN0cikge1xyXG4gICAgICAgIHJldHVybiBzdHIucmVwbGFjZSgvXFx3ezR9L2csIFwiXFxcXHUkJlwiKTtcclxuICAgIH1cclxuXHJcbi8vIEFkZHMgbGVhZGluZyB6ZXJvcyBpZiBzaG9ydGVyIHRoYW4gZm91ciBjaGFyYWN0ZXJzXHJcbiAgICBmdW5jdGlvbiBwYWQ0KHN0cikge1xyXG4gICAgICAgIHdoaWxlIChzdHIubGVuZ3RoIDwgNCkge1xyXG4gICAgICAgICAgICBzdHIgPSBcIjBcIiArIHN0cjtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHN0cjtcclxuICAgIH1cclxuXHJcbi8vIENvbnZlcnRzIGEgaGV4YWRlY2ltYWwgbnVtYmVyIHRvIGRlY2ltYWxcclxuICAgIGZ1bmN0aW9uIGRlYyhoZXgpIHtcclxuICAgICAgICByZXR1cm4gcGFyc2VJbnQoaGV4LCAxNik7XHJcbiAgICB9XHJcblxyXG4vLyBDb252ZXJ0cyBhIGRlY2ltYWwgbnVtYmVyIHRvIGhleGFkZWNpbWFsXHJcbiAgICBmdW5jdGlvbiBoZXgoZGVjKSB7XHJcbiAgICAgICAgcmV0dXJuIHBhcnNlSW50KGRlYywgMTApLnRvU3RyaW5nKDE2KTtcclxuICAgIH1cclxuXHJcbi8vIEludmVydHMgYSBsaXN0IG9mIFVuaWNvZGUgY29kZSBwb2ludHMgYW5kIHJhbmdlc1xyXG4gICAgZnVuY3Rpb24gaW52ZXJ0KHJhbmdlKSB7XHJcbiAgICAgICAgdmFyIG91dHB1dCA9IFtdLFxyXG4gICAgICAgICAgICBsYXN0RW5kID0gLTEsXHJcbiAgICAgICAgICAgIHN0YXJ0O1xyXG4gICAgICAgIFhSZWdFeHAuZm9yRWFjaChyYW5nZSwgL1xcXFx1KFxcd3s0fSkoPzotXFxcXHUoXFx3ezR9KSk/LywgZnVuY3Rpb24gKG0pIHtcclxuICAgICAgICAgICAgc3RhcnQgPSBkZWMobVsxXSk7XHJcbiAgICAgICAgICAgIGlmIChzdGFydCA+IChsYXN0RW5kICsgMSkpIHtcclxuICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKFwiXFxcXHVcIiArIHBhZDQoaGV4KGxhc3RFbmQgKyAxKSkpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHN0YXJ0ID4gKGxhc3RFbmQgKyAyKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKFwiLVxcXFx1XCIgKyBwYWQ0KGhleChzdGFydCAtIDEpKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbGFzdEVuZCA9IGRlYyhtWzJdIHx8IG1bMV0pO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmIChsYXN0RW5kIDwgMHhGRkZGKSB7XHJcbiAgICAgICAgICAgIG91dHB1dC5wdXNoKFwiXFxcXHVcIiArIHBhZDQoaGV4KGxhc3RFbmQgKyAxKSkpO1xyXG4gICAgICAgICAgICBpZiAobGFzdEVuZCA8IDB4RkZGRSkge1xyXG4gICAgICAgICAgICAgICAgb3V0cHV0LnB1c2goXCItXFxcXHVGRkZGXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBvdXRwdXQuam9pbihcIlwiKTtcclxuICAgIH1cclxuXHJcbi8vIEdlbmVyYXRlcyBhbiBpbnZlcnRlZCB0b2tlbiBvbiBmaXJzdCB1c2VcclxuICAgIGZ1bmN0aW9uIGNhY2hlSW52ZXJzaW9uKGl0ZW0pIHtcclxuICAgICAgICByZXR1cm4gdW5pY29kZVtcIl5cIiArIGl0ZW1dIHx8ICh1bmljb2RlW1wiXlwiICsgaXRlbV0gPSBpbnZlcnQodW5pY29kZVtpdGVtXSkpO1xyXG4gICAgfVxyXG5cclxuLyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gKiAgQ29yZSBmdW5jdGlvbmFsaXR5XHJcbiAqLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cclxuXHJcbiAgICBYUmVnRXhwLmluc3RhbGwoXCJleHRlbnNpYmlsaXR5XCIpO1xyXG5cclxuLyoqXHJcbiAqIEFkZHMgdG8gdGhlIGxpc3Qgb2YgVW5pY29kZSBwcm9wZXJ0aWVzIHRoYXQgWFJlZ0V4cCByZWdleGVzIGNhbiBtYXRjaCB2aWEgXFxwey4ufSBvciBcXFB7Li59LlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge09iamVjdH0gcGFjayBOYW1lZCBzZXRzIG9mIFVuaWNvZGUgY29kZSBwb2ludHMgYW5kIHJhbmdlcy5cclxuICogQHBhcmFtIHtPYmplY3R9IFthbGlhc2VzXSBBbGlhc2VzIGZvciB0aGUgcHJpbWFyeSB0b2tlbiBuYW1lcy5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogWFJlZ0V4cC5hZGRVbmljb2RlUGFja2FnZSh7XHJcbiAqICAgWERpZ2l0OiAnMDAzMC0wMDM5MDA0MS0wMDQ2MDA2MS0wMDY2JyAvLyAwLTlBLUZhLWZcclxuICogfSwge1xyXG4gKiAgIFhEaWdpdDogJ0hleGFkZWNpbWFsJ1xyXG4gKiB9KTtcclxuICovXHJcbiAgICBYUmVnRXhwLmFkZFVuaWNvZGVQYWNrYWdlID0gZnVuY3Rpb24gKHBhY2ssIGFsaWFzZXMpIHtcclxuICAgICAgICB2YXIgcDtcclxuICAgICAgICBpZiAoIVhSZWdFeHAuaXNJbnN0YWxsZWQoXCJleHRlbnNpYmlsaXR5XCIpKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImV4dGVuc2liaWxpdHkgbXVzdCBiZSBpbnN0YWxsZWQgYmVmb3JlIGFkZGluZyBVbmljb2RlIHBhY2thZ2VzXCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocGFjaykge1xyXG4gICAgICAgICAgICBmb3IgKHAgaW4gcGFjaykge1xyXG4gICAgICAgICAgICAgICAgaWYgKHBhY2suaGFzT3duUHJvcGVydHkocCkpIHtcclxuICAgICAgICAgICAgICAgICAgICB1bmljb2RlW3NsdWcocCldID0gZXhwYW5kKHBhY2tbcF0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChhbGlhc2VzKSB7XHJcbiAgICAgICAgICAgIGZvciAocCBpbiBhbGlhc2VzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoYWxpYXNlcy5oYXNPd25Qcm9wZXJ0eShwKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHVuaWNvZGVbc2x1ZyhhbGlhc2VzW3BdKV0gPSB1bmljb2RlW3NsdWcocCldO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbi8qIEFkZHMgZGF0YSBmb3IgdGhlIFVuaWNvZGUgYExldHRlcmAgY2F0ZWdvcnkuIEFkZG9uIHBhY2thZ2VzIGluY2x1ZGUgb3RoZXIgY2F0ZWdvcmllcywgc2NyaXB0cyxcclxuICogYmxvY2tzLCBhbmQgcHJvcGVydGllcy5cclxuICovXHJcbiAgICBYUmVnRXhwLmFkZFVuaWNvZGVQYWNrYWdlKHtcclxuICAgICAgICBMOiBcIjAwNDEtMDA1QTAwNjEtMDA3QTAwQUEwMEI1MDBCQTAwQzAtMDBENjAwRDgtMDBGNjAwRjgtMDJDMTAyQzYtMDJEMTAyRTAtMDJFNDAyRUMwMkVFMDM3MC0wMzc0MDM3NjAzNzcwMzdBLTAzN0QwMzg2MDM4OC0wMzhBMDM4QzAzOEUtMDNBMTAzQTMtMDNGNTAzRjctMDQ4MTA0OEEtMDUyNzA1MzEtMDU1NjA1NTkwNTYxLTA1ODcwNUQwLTA1RUEwNUYwLTA1RjIwNjIwLTA2NEEwNjZFMDY2RjA2NzEtMDZEMzA2RDUwNkU1MDZFNjA2RUUwNkVGMDZGQS0wNkZDMDZGRjA3MTAwNzEyLTA3MkYwNzRELTA3QTUwN0IxMDdDQS0wN0VBMDdGNDA3RjUwN0ZBMDgwMC0wODE1MDgxQTA4MjQwODI4MDg0MC0wODU4MDhBMDA4QTItMDhBQzA5MDQtMDkzOTA5M0QwOTUwMDk1OC0wOTYxMDk3MS0wOTc3MDk3OS0wOTdGMDk4NS0wOThDMDk4RjA5OTAwOTkzLTA5QTgwOUFBLTA5QjAwOUIyMDlCNi0wOUI5MDlCRDA5Q0UwOURDMDlERDA5REYtMDlFMTA5RjAwOUYxMEEwNS0wQTBBMEEwRjBBMTAwQTEzLTBBMjgwQTJBLTBBMzAwQTMyMEEzMzBBMzUwQTM2MEEzODBBMzkwQTU5LTBBNUMwQTVFMEE3Mi0wQTc0MEE4NS0wQThEMEE4Ri0wQTkxMEE5My0wQUE4MEFBQS0wQUIwMEFCMjBBQjMwQUI1LTBBQjkwQUJEMEFEMDBBRTAwQUUxMEIwNS0wQjBDMEIwRjBCMTAwQjEzLTBCMjgwQjJBLTBCMzAwQjMyMEIzMzBCMzUtMEIzOTBCM0QwQjVDMEI1RDBCNUYtMEI2MTBCNzEwQjgzMEI4NS0wQjhBMEI4RS0wQjkwMEI5Mi0wQjk1MEI5OTBCOUEwQjlDMEI5RTBCOUYwQkEzMEJBNDBCQTgtMEJBQTBCQUUtMEJCOTBCRDAwQzA1LTBDMEMwQzBFLTBDMTAwQzEyLTBDMjgwQzJBLTBDMzMwQzM1LTBDMzkwQzNEMEM1ODBDNTkwQzYwMEM2MTBDODUtMEM4QzBDOEUtMEM5MDBDOTItMENBODBDQUEtMENCMzBDQjUtMENCOTBDQkQwQ0RFMENFMDBDRTEwQ0YxMENGMjBEMDUtMEQwQzBEMEUtMEQxMDBEMTItMEQzQTBEM0QwRDRFMEQ2MDBENjEwRDdBLTBEN0YwRDg1LTBEOTYwRDlBLTBEQjEwREIzLTBEQkIwREJEMERDMC0wREM2MEUwMS0wRTMwMEUzMjBFMzMwRTQwLTBFNDYwRTgxMEU4MjBFODQwRTg3MEU4ODBFOEEwRThEMEU5NC0wRTk3MEU5OS0wRTlGMEVBMS0wRUEzMEVBNTBFQTcwRUFBMEVBQjBFQUQtMEVCMDBFQjIwRUIzMEVCRDBFQzAtMEVDNDBFQzYwRURDLTBFREYwRjAwMEY0MC0wRjQ3MEY0OS0wRjZDMEY4OC0wRjhDMTAwMC0xMDJBMTAzRjEwNTAtMTA1NTEwNUEtMTA1RDEwNjExMDY1MTA2NjEwNkUtMTA3MDEwNzUtMTA4MTEwOEUxMEEwLTEwQzUxMEM3MTBDRDEwRDAtMTBGQTEwRkMtMTI0ODEyNEEtMTI0RDEyNTAtMTI1NjEyNTgxMjVBLTEyNUQxMjYwLTEyODgxMjhBLTEyOEQxMjkwLTEyQjAxMkIyLTEyQjUxMkI4LTEyQkUxMkMwMTJDMi0xMkM1MTJDOC0xMkQ2MTJEOC0xMzEwMTMxMi0xMzE1MTMxOC0xMzVBMTM4MC0xMzhGMTNBMC0xM0Y0MTQwMS0xNjZDMTY2Ri0xNjdGMTY4MS0xNjlBMTZBMC0xNkVBMTcwMC0xNzBDMTcwRS0xNzExMTcyMC0xNzMxMTc0MC0xNzUxMTc2MC0xNzZDMTc2RS0xNzcwMTc4MC0xN0IzMTdENzE3REMxODIwLTE4NzcxODgwLTE4QTgxOEFBMThCMC0xOEY1MTkwMC0xOTFDMTk1MC0xOTZEMTk3MC0xOTc0MTk4MC0xOUFCMTlDMS0xOUM3MUEwMC0xQTE2MUEyMC0xQTU0MUFBNzFCMDUtMUIzMzFCNDUtMUI0QjFCODMtMUJBMDFCQUUxQkFGMUJCQS0xQkU1MUMwMC0xQzIzMUM0RC0xQzRGMUM1QS0xQzdEMUNFOS0xQ0VDMUNFRS0xQ0YxMUNGNTFDRjYxRDAwLTFEQkYxRTAwLTFGMTUxRjE4LTFGMUQxRjIwLTFGNDUxRjQ4LTFGNEQxRjUwLTFGNTcxRjU5MUY1QjFGNUQxRjVGLTFGN0QxRjgwLTFGQjQxRkI2LTFGQkMxRkJFMUZDMi0xRkM0MUZDNi0xRkNDMUZEMC0xRkQzMUZENi0xRkRCMUZFMC0xRkVDMUZGMi0xRkY0MUZGNi0xRkZDMjA3MTIwN0YyMDkwLTIwOUMyMTAyMjEwNzIxMEEtMjExMzIxMTUyMTE5LTIxMUQyMTI0MjEyNjIxMjgyMTJBLTIxMkQyMTJGLTIxMzkyMTNDLTIxM0YyMTQ1LTIxNDkyMTRFMjE4MzIxODQyQzAwLTJDMkUyQzMwLTJDNUUyQzYwLTJDRTQyQ0VCLTJDRUUyQ0YyMkNGMzJEMDAtMkQyNTJEMjcyRDJEMkQzMC0yRDY3MkQ2RjJEODAtMkQ5NjJEQTAtMkRBNjJEQTgtMkRBRTJEQjAtMkRCNjJEQjgtMkRCRTJEQzAtMkRDNjJEQzgtMkRDRTJERDAtMkRENjJERDgtMkRERTJFMkYzMDA1MzAwNjMwMzEtMzAzNTMwM0IzMDNDMzA0MS0zMDk2MzA5RC0zMDlGMzBBMS0zMEZBMzBGQy0zMEZGMzEwNS0zMTJEMzEzMS0zMThFMzFBMC0zMUJBMzFGMC0zMUZGMzQwMC00REI1NEUwMC05RkNDQTAwMC1BNDhDQTREMC1BNEZEQTUwMC1BNjBDQTYxMC1BNjFGQTYyQUE2MkJBNjQwLUE2NkVBNjdGLUE2OTdBNkEwLUE2RTVBNzE3LUE3MUZBNzIyLUE3ODhBNzhCLUE3OEVBNzkwLUE3OTNBN0EwLUE3QUFBN0Y4LUE4MDFBODAzLUE4MDVBODA3LUE4MEFBODBDLUE4MjJBODQwLUE4NzNBODgyLUE4QjNBOEYyLUE4RjdBOEZCQTkwQS1BOTI1QTkzMC1BOTQ2QTk2MC1BOTdDQTk4NC1BOUIyQTlDRkFBMDAtQUEyOEFBNDAtQUE0MkFBNDQtQUE0QkFBNjAtQUE3NkFBN0FBQTgwLUFBQUZBQUIxQUFCNUFBQjZBQUI5LUFBQkRBQUMwQUFDMkFBREItQUFEREFBRTAtQUFFQUFBRjItQUFGNEFCMDEtQUIwNkFCMDktQUIwRUFCMTEtQUIxNkFCMjAtQUIyNkFCMjgtQUIyRUFCQzAtQUJFMkFDMDAtRDdBM0Q3QjAtRDdDNkQ3Q0ItRDdGQkY5MDAtRkE2REZBNzAtRkFEOUZCMDAtRkIwNkZCMTMtRkIxN0ZCMURGQjFGLUZCMjhGQjJBLUZCMzZGQjM4LUZCM0NGQjNFRkI0MEZCNDFGQjQzRkI0NEZCNDYtRkJCMUZCRDMtRkQzREZENTAtRkQ4RkZEOTItRkRDN0ZERjAtRkRGQkZFNzAtRkU3NEZFNzYtRkVGQ0ZGMjEtRkYzQUZGNDEtRkY1QUZGNjYtRkZCRUZGQzItRkZDN0ZGQ0EtRkZDRkZGRDItRkZEN0ZGREEtRkZEQ1wiXHJcbiAgICB9LCB7XHJcbiAgICAgICAgTDogXCJMZXR0ZXJcIlxyXG4gICAgfSk7XHJcblxyXG4vKiBBZGRzIFVuaWNvZGUgcHJvcGVydHkgc3ludGF4IHRvIFhSZWdFeHA6IFxccHsuLn0sIFxcUHsuLn0sIFxccHteLi59XHJcbiAqL1xyXG4gICAgWFJlZ0V4cC5hZGRUb2tlbihcclxuICAgICAgICAvXFxcXChbcFBdKXsoXFxePykoW159XSopfS8sXHJcbiAgICAgICAgZnVuY3Rpb24gKG1hdGNoLCBzY29wZSkge1xyXG4gICAgICAgICAgICB2YXIgaW52ID0gKG1hdGNoWzFdID09PSBcIlBcIiB8fCBtYXRjaFsyXSkgPyBcIl5cIiA6IFwiXCIsXHJcbiAgICAgICAgICAgICAgICBpdGVtID0gc2x1ZyhtYXRjaFszXSk7XHJcbiAgICAgICAgICAgIC8vIFRoZSBkb3VibGUgbmVnYXRpdmUgXFxQe14uLn0gaXMgaW52YWxpZFxyXG4gICAgICAgICAgICBpZiAobWF0Y2hbMV0gPT09IFwiUFwiICYmIG1hdGNoWzJdKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJpbnZhbGlkIGRvdWJsZSBuZWdhdGlvbiBcXFxcUHteXCIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICghdW5pY29kZS5oYXNPd25Qcm9wZXJ0eShpdGVtKSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiaW52YWxpZCBvciB1bmtub3duIFVuaWNvZGUgcHJvcGVydHkgXCIgKyBtYXRjaFswXSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHNjb3BlID09PSBcImNsYXNzXCIgP1xyXG4gICAgICAgICAgICAgICAgICAgIChpbnYgPyBjYWNoZUludmVyc2lvbihpdGVtKSA6IHVuaWNvZGVbaXRlbV0pIDpcclxuICAgICAgICAgICAgICAgICAgICBcIltcIiArIGludiArIHVuaWNvZGVbaXRlbV0gKyBcIl1cIjtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtzY29wZTogXCJhbGxcIn1cclxuICAgICk7XHJcblxyXG59KFhSZWdFeHApKTtcclxuXHJcblxuLyoqKioqIHVuaWNvZGUtY2F0ZWdvcmllcy5qcyAqKioqKi9cblxuLyohXHJcbiAqIFhSZWdFeHAgVW5pY29kZSBDYXRlZ29yaWVzIHYxLjIuMFxyXG4gKiAoYykgMjAxMC0yMDEyIFN0ZXZlbiBMZXZpdGhhbiA8aHR0cDovL3hyZWdleHAuY29tLz5cclxuICogTUlUIExpY2Vuc2VcclxuICogVXNlcyBVbmljb2RlIDYuMSA8aHR0cDovL3VuaWNvZGUub3JnLz5cclxuICovXHJcblxyXG4vKipcclxuICogQWRkcyBzdXBwb3J0IGZvciBhbGwgVW5pY29kZSBjYXRlZ29yaWVzIChha2EgcHJvcGVydGllcykgRS5nLiwgYFxccHtMdX1gIG9yXHJcbiAqIGBcXHB7VXBwZXJjYXNlIExldHRlcn1gLiBUb2tlbiBuYW1lcyBhcmUgY2FzZSBpbnNlbnNpdGl2ZSwgYW5kIGFueSBzcGFjZXMsIGh5cGhlbnMsIGFuZFxyXG4gKiB1bmRlcnNjb3JlcyBhcmUgaWdub3JlZC5cclxuICogQHJlcXVpcmVzIFhSZWdFeHAsIFhSZWdFeHAgVW5pY29kZSBCYXNlXHJcbiAqL1xyXG4oZnVuY3Rpb24gKFhSZWdFeHApIHtcclxuICAgIFwidXNlIHN0cmljdFwiO1xyXG5cclxuICAgIGlmICghWFJlZ0V4cC5hZGRVbmljb2RlUGFja2FnZSkge1xyXG4gICAgICAgIHRocm93IG5ldyBSZWZlcmVuY2VFcnJvcihcIlVuaWNvZGUgQmFzZSBtdXN0IGJlIGxvYWRlZCBiZWZvcmUgVW5pY29kZSBDYXRlZ29yaWVzXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIFhSZWdFeHAuaW5zdGFsbChcImV4dGVuc2liaWxpdHlcIik7XHJcblxyXG4gICAgWFJlZ0V4cC5hZGRVbmljb2RlUGFja2FnZSh7XHJcbiAgICAgICAgLy9MOiBcIlwiLCAvLyBJbmNsdWRlZCBpbiB0aGUgVW5pY29kZSBCYXNlIGFkZG9uXHJcbiAgICAgICAgTGw6IFwiMDA2MS0wMDdBMDBCNTAwREYtMDBGNjAwRjgtMDBGRjAxMDEwMTAzMDEwNTAxMDcwMTA5MDEwQjAxMEQwMTBGMDExMTAxMTMwMTE1MDExNzAxMTkwMTFCMDExRDAxMUYwMTIxMDEyMzAxMjUwMTI3MDEyOTAxMkIwMTJEMDEyRjAxMzEwMTMzMDEzNTAxMzcwMTM4MDEzQTAxM0MwMTNFMDE0MDAxNDIwMTQ0MDE0NjAxNDgwMTQ5MDE0QjAxNEQwMTRGMDE1MTAxNTMwMTU1MDE1NzAxNTkwMTVCMDE1RDAxNUYwMTYxMDE2MzAxNjUwMTY3MDE2OTAxNkIwMTZEMDE2RjAxNzEwMTczMDE3NTAxNzcwMTdBMDE3QzAxN0UtMDE4MDAxODMwMTg1MDE4ODAxOEMwMThEMDE5MjAxOTUwMTk5LTAxOUIwMTlFMDFBMTAxQTMwMUE1MDFBODAxQUEwMUFCMDFBRDAxQjAwMUI0MDFCNjAxQjkwMUJBMDFCRC0wMUJGMDFDNjAxQzkwMUNDMDFDRTAxRDAwMUQyMDFENDAxRDYwMUQ4MDFEQTAxREMwMUREMDFERjAxRTEwMUUzMDFFNTAxRTcwMUU5MDFFQjAxRUQwMUVGMDFGMDAxRjMwMUY1MDFGOTAxRkIwMUZEMDFGRjAyMDEwMjAzMDIwNTAyMDcwMjA5MDIwQjAyMEQwMjBGMDIxMTAyMTMwMjE1MDIxNzAyMTkwMjFCMDIxRDAyMUYwMjIxMDIyMzAyMjUwMjI3MDIyOTAyMkIwMjJEMDIyRjAyMzEwMjMzLTAyMzkwMjNDMDIzRjAyNDAwMjQyMDI0NzAyNDkwMjRCMDI0RDAyNEYtMDI5MzAyOTUtMDJBRjAzNzEwMzczMDM3NzAzN0ItMDM3RDAzOTAwM0FDLTAzQ0UwM0QwMDNEMTAzRDUtMDNENzAzRDkwM0RCMDNERDAzREYwM0UxMDNFMzAzRTUwM0U3MDNFOTAzRUIwM0VEMDNFRi0wM0YzMDNGNTAzRjgwM0ZCMDNGQzA0MzAtMDQ1RjA0NjEwNDYzMDQ2NTA0NjcwNDY5MDQ2QjA0NkQwNDZGMDQ3MTA0NzMwNDc1MDQ3NzA0NzkwNDdCMDQ3RDA0N0YwNDgxMDQ4QjA0OEQwNDhGMDQ5MTA0OTMwNDk1MDQ5NzA0OTkwNDlCMDQ5RDA0OUYwNEExMDRBMzA0QTUwNEE3MDRBOTA0QUIwNEFEMDRBRjA0QjEwNEIzMDRCNTA0QjcwNEI5MDRCQjA0QkQwNEJGMDRDMjA0QzQwNEM2MDRDODA0Q0EwNENDMDRDRTA0Q0YwNEQxMDREMzA0RDUwNEQ3MDREOTA0REIwNEREMDRERjA0RTEwNEUzMDRFNTA0RTcwNEU5MDRFQjA0RUQwNEVGMDRGMTA0RjMwNEY1MDRGNzA0RjkwNEZCMDRGRDA0RkYwNTAxMDUwMzA1MDUwNTA3MDUwOTA1MEIwNTBEMDUwRjA1MTEwNTEzMDUxNTA1MTcwNTE5MDUxQjA1MUQwNTFGMDUyMTA1MjMwNTI1MDUyNzA1NjEtMDU4NzFEMDAtMUQyQjFENkItMUQ3NzFENzktMUQ5QTFFMDExRTAzMUUwNTFFMDcxRTA5MUUwQjFFMEQxRTBGMUUxMTFFMTMxRTE1MUUxNzFFMTkxRTFCMUUxRDFFMUYxRTIxMUUyMzFFMjUxRTI3MUUyOTFFMkIxRTJEMUUyRjFFMzExRTMzMUUzNTFFMzcxRTM5MUUzQjFFM0QxRTNGMUU0MTFFNDMxRTQ1MUU0NzFFNDkxRTRCMUU0RDFFNEYxRTUxMUU1MzFFNTUxRTU3MUU1OTFFNUIxRTVEMUU1RjFFNjExRTYzMUU2NTFFNjcxRTY5MUU2QjFFNkQxRTZGMUU3MTFFNzMxRTc1MUU3NzFFNzkxRTdCMUU3RDFFN0YxRTgxMUU4MzFFODUxRTg3MUU4OTFFOEIxRThEMUU4RjFFOTExRTkzMUU5NS0xRTlEMUU5RjFFQTExRUEzMUVBNTFFQTcxRUE5MUVBQjFFQUQxRUFGMUVCMTFFQjMxRUI1MUVCNzFFQjkxRUJCMUVCRDFFQkYxRUMxMUVDMzFFQzUxRUM3MUVDOTFFQ0IxRUNEMUVDRjFFRDExRUQzMUVENTFFRDcxRUQ5MUVEQjFFREQxRURGMUVFMTFFRTMxRUU1MUVFNzFFRTkxRUVCMUVFRDFFRUYxRUYxMUVGMzFFRjUxRUY3MUVGOTFFRkIxRUZEMUVGRi0xRjA3MUYxMC0xRjE1MUYyMC0xRjI3MUYzMC0xRjM3MUY0MC0xRjQ1MUY1MC0xRjU3MUY2MC0xRjY3MUY3MC0xRjdEMUY4MC0xRjg3MUY5MC0xRjk3MUZBMC0xRkE3MUZCMC0xRkI0MUZCNjFGQjcxRkJFMUZDMi0xRkM0MUZDNjFGQzcxRkQwLTFGRDMxRkQ2MUZENzFGRTAtMUZFNzFGRjItMUZGNDFGRjYxRkY3MjEwQTIxMEUyMTBGMjExMzIxMkYyMTM0MjEzOTIxM0MyMTNEMjE0Ni0yMTQ5MjE0RTIxODQyQzMwLTJDNUUyQzYxMkM2NTJDNjYyQzY4MkM2QTJDNkMyQzcxMkM3MzJDNzQyQzc2LTJDN0IyQzgxMkM4MzJDODUyQzg3MkM4OTJDOEIyQzhEMkM4RjJDOTEyQzkzMkM5NTJDOTcyQzk5MkM5QjJDOUQyQzlGMkNBMTJDQTMyQ0E1MkNBNzJDQTkyQ0FCMkNBRDJDQUYyQ0IxMkNCMzJDQjUyQ0I3MkNCOTJDQkIyQ0JEMkNCRjJDQzEyQ0MzMkNDNTJDQzcyQ0M5MkNDQjJDQ0QyQ0NGMkNEMTJDRDMyQ0Q1MkNENzJDRDkyQ0RCMkNERDJDREYyQ0UxMkNFMzJDRTQyQ0VDMkNFRTJDRjMyRDAwLTJEMjUyRDI3MkQyREE2NDFBNjQzQTY0NUE2NDdBNjQ5QTY0QkE2NERBNjRGQTY1MUE2NTNBNjU1QTY1N0E2NTlBNjVCQTY1REE2NUZBNjYxQTY2M0E2NjVBNjY3QTY2OUE2NkJBNjZEQTY4MUE2ODNBNjg1QTY4N0E2ODlBNjhCQTY4REE2OEZBNjkxQTY5M0E2OTVBNjk3QTcyM0E3MjVBNzI3QTcyOUE3MkJBNzJEQTcyRi1BNzMxQTczM0E3MzVBNzM3QTczOUE3M0JBNzNEQTczRkE3NDFBNzQzQTc0NUE3NDdBNzQ5QTc0QkE3NERBNzRGQTc1MUE3NTNBNzU1QTc1N0E3NTlBNzVCQTc1REE3NUZBNzYxQTc2M0E3NjVBNzY3QTc2OUE3NkJBNzZEQTc2RkE3NzEtQTc3OEE3N0FBNzdDQTc3RkE3ODFBNzgzQTc4NUE3ODdBNzhDQTc4RUE3OTFBNzkzQTdBMUE3QTNBN0E1QTdBN0E3QTlBN0ZBRkIwMC1GQjA2RkIxMy1GQjE3RkY0MS1GRjVBXCIsXHJcbiAgICAgICAgTHU6IFwiMDA0MS0wMDVBMDBDMC0wMEQ2MDBEOC0wMERFMDEwMDAxMDIwMTA0MDEwNjAxMDgwMTBBMDEwQzAxMEUwMTEwMDExMjAxMTQwMTE2MDExODAxMUEwMTFDMDExRTAxMjAwMTIyMDEyNDAxMjYwMTI4MDEyQTAxMkMwMTJFMDEzMDAxMzIwMTM0MDEzNjAxMzkwMTNCMDEzRDAxM0YwMTQxMDE0MzAxNDUwMTQ3MDE0QTAxNEMwMTRFMDE1MDAxNTIwMTU0MDE1NjAxNTgwMTVBMDE1QzAxNUUwMTYwMDE2MjAxNjQwMTY2MDE2ODAxNkEwMTZDMDE2RTAxNzAwMTcyMDE3NDAxNzYwMTc4MDE3OTAxN0IwMTdEMDE4MTAxODIwMTg0MDE4NjAxODcwMTg5LTAxOEIwMThFLTAxOTEwMTkzMDE5NDAxOTYtMDE5ODAxOUMwMTlEMDE5RjAxQTAwMUEyMDFBNDAxQTYwMUE3MDFBOTAxQUMwMUFFMDFBRjAxQjEtMDFCMzAxQjUwMUI3MDFCODAxQkMwMUM0MDFDNzAxQ0EwMUNEMDFDRjAxRDEwMUQzMDFENTAxRDcwMUQ5MDFEQjAxREUwMUUwMDFFMjAxRTQwMUU2MDFFODAxRUEwMUVDMDFFRTAxRjEwMUY0MDFGNi0wMUY4MDFGQTAxRkMwMUZFMDIwMDAyMDIwMjA0MDIwNjAyMDgwMjBBMDIwQzAyMEUwMjEwMDIxMjAyMTQwMjE2MDIxODAyMUEwMjFDMDIxRTAyMjAwMjIyMDIyNDAyMjYwMjI4MDIyQTAyMkMwMjJFMDIzMDAyMzIwMjNBMDIzQjAyM0QwMjNFMDI0MTAyNDMtMDI0NjAyNDgwMjRBMDI0QzAyNEUwMzcwMDM3MjAzNzYwMzg2MDM4OC0wMzhBMDM4QzAzOEUwMzhGMDM5MS0wM0ExMDNBMy0wM0FCMDNDRjAzRDItMDNENDAzRDgwM0RBMDNEQzAzREUwM0UwMDNFMjAzRTQwM0U2MDNFODAzRUEwM0VDMDNFRTAzRjQwM0Y3MDNGOTAzRkEwM0ZELTA0MkYwNDYwMDQ2MjA0NjQwNDY2MDQ2ODA0NkEwNDZDMDQ2RTA0NzAwNDcyMDQ3NDA0NzYwNDc4MDQ3QTA0N0MwNDdFMDQ4MDA0OEEwNDhDMDQ4RTA0OTAwNDkyMDQ5NDA0OTYwNDk4MDQ5QTA0OUMwNDlFMDRBMDA0QTIwNEE0MDRBNjA0QTgwNEFBMDRBQzA0QUUwNEIwMDRCMjA0QjQwNEI2MDRCODA0QkEwNEJDMDRCRTA0QzAwNEMxMDRDMzA0QzUwNEM3MDRDOTA0Q0IwNENEMDREMDA0RDIwNEQ0MDRENjA0RDgwNERBMDREQzA0REUwNEUwMDRFMjA0RTQwNEU2MDRFODA0RUEwNEVDMDRFRTA0RjAwNEYyMDRGNDA0RjYwNEY4MDRGQTA0RkMwNEZFMDUwMDA1MDIwNTA0MDUwNjA1MDgwNTBBMDUwQzA1MEUwNTEwMDUxMjA1MTQwNTE2MDUxODA1MUEwNTFDMDUxRTA1MjAwNTIyMDUyNDA1MjYwNTMxLTA1NTYxMEEwLTEwQzUxMEM3MTBDRDFFMDAxRTAyMUUwNDFFMDYxRTA4MUUwQTFFMEMxRTBFMUUxMDFFMTIxRTE0MUUxNjFFMTgxRTFBMUUxQzFFMUUxRTIwMUUyMjFFMjQxRTI2MUUyODFFMkExRTJDMUUyRTFFMzAxRTMyMUUzNDFFMzYxRTM4MUUzQTFFM0MxRTNFMUU0MDFFNDIxRTQ0MUU0NjFFNDgxRTRBMUU0QzFFNEUxRTUwMUU1MjFFNTQxRTU2MUU1ODFFNUExRTVDMUU1RTFFNjAxRTYyMUU2NDFFNjYxRTY4MUU2QTFFNkMxRTZFMUU3MDFFNzIxRTc0MUU3NjFFNzgxRTdBMUU3QzFFN0UxRTgwMUU4MjFFODQxRTg2MUU4ODFFOEExRThDMUU4RTFFOTAxRTkyMUU5NDFFOUUxRUEwMUVBMjFFQTQxRUE2MUVBODFFQUExRUFDMUVBRTFFQjAxRUIyMUVCNDFFQjYxRUI4MUVCQTFFQkMxRUJFMUVDMDFFQzIxRUM0MUVDNjFFQzgxRUNBMUVDQzFFQ0UxRUQwMUVEMjFFRDQxRUQ2MUVEODFFREExRURDMUVERTFFRTAxRUUyMUVFNDFFRTYxRUU4MUVFQTFFRUMxRUVFMUVGMDFFRjIxRUY0MUVGNjFFRjgxRUZBMUVGQzFFRkUxRjA4LTFGMEYxRjE4LTFGMUQxRjI4LTFGMkYxRjM4LTFGM0YxRjQ4LTFGNEQxRjU5MUY1QjFGNUQxRjVGMUY2OC0xRjZGMUZCOC0xRkJCMUZDOC0xRkNCMUZEOC0xRkRCMUZFOC0xRkVDMUZGOC0xRkZCMjEwMjIxMDcyMTBCLTIxMEQyMTEwLTIxMTIyMTE1MjExOS0yMTFEMjEyNDIxMjYyMTI4MjEyQS0yMTJEMjEzMC0yMTMzMjEzRTIxM0YyMTQ1MjE4MzJDMDAtMkMyRTJDNjAyQzYyLTJDNjQyQzY3MkM2OTJDNkIyQzZELTJDNzAyQzcyMkM3NTJDN0UtMkM4MDJDODIyQzg0MkM4NjJDODgyQzhBMkM4QzJDOEUyQzkwMkM5MjJDOTQyQzk2MkM5ODJDOUEyQzlDMkM5RTJDQTAyQ0EyMkNBNDJDQTYyQ0E4MkNBQTJDQUMyQ0FFMkNCMDJDQjIyQ0I0MkNCNjJDQjgyQ0JBMkNCQzJDQkUyQ0MwMkNDMjJDQzQyQ0M2MkNDODJDQ0EyQ0NDMkNDRTJDRDAyQ0QyMkNENDJDRDYyQ0Q4MkNEQTJDREMyQ0RFMkNFMDJDRTIyQ0VCMkNFRDJDRjJBNjQwQTY0MkE2NDRBNjQ2QTY0OEE2NEFBNjRDQTY0RUE2NTBBNjUyQTY1NEE2NTZBNjU4QTY1QUE2NUNBNjVFQTY2MEE2NjJBNjY0QTY2NkE2NjhBNjZBQTY2Q0E2ODBBNjgyQTY4NEE2ODZBNjg4QTY4QUE2OENBNjhFQTY5MEE2OTJBNjk0QTY5NkE3MjJBNzI0QTcyNkE3MjhBNzJBQTcyQ0E3MkVBNzMyQTczNEE3MzZBNzM4QTczQUE3M0NBNzNFQTc0MEE3NDJBNzQ0QTc0NkE3NDhBNzRBQTc0Q0E3NEVBNzUwQTc1MkE3NTRBNzU2QTc1OEE3NUFBNzVDQTc1RUE3NjBBNzYyQTc2NEE3NjZBNzY4QTc2QUE3NkNBNzZFQTc3OUE3N0JBNzdEQTc3RUE3ODBBNzgyQTc4NEE3ODZBNzhCQTc4REE3OTBBNzkyQTdBMEE3QTJBN0E0QTdBNkE3QThBN0FBRkYyMS1GRjNBXCIsXHJcbiAgICAgICAgTHQ6IFwiMDFDNTAxQzgwMUNCMDFGMjFGODgtMUY4RjFGOTgtMUY5RjFGQTgtMUZBRjFGQkMxRkNDMUZGQ1wiLFxyXG4gICAgICAgIExtOiBcIjAyQjAtMDJDMTAyQzYtMDJEMTAyRTAtMDJFNDAyRUMwMkVFMDM3NDAzN0EwNTU5MDY0MDA2RTUwNkU2MDdGNDA3RjUwN0ZBMDgxQTA4MjQwODI4MDk3MTBFNDYwRUM2MTBGQzE3RDcxODQzMUFBNzFDNzgtMUM3RDFEMkMtMUQ2QTFENzgxRDlCLTFEQkYyMDcxMjA3RjIwOTAtMjA5QzJDN0MyQzdEMkQ2RjJFMkYzMDA1MzAzMS0zMDM1MzAzQjMwOUQzMDlFMzBGQy0zMEZFQTAxNUE0RjgtQTRGREE2MENBNjdGQTcxNy1BNzFGQTc3MEE3ODhBN0Y4QTdGOUE5Q0ZBQTcwQUFEREFBRjNBQUY0RkY3MEZGOUVGRjlGXCIsXHJcbiAgICAgICAgTG86IFwiMDBBQTAwQkEwMUJCMDFDMC0wMUMzMDI5NDA1RDAtMDVFQTA1RjAtMDVGMjA2MjAtMDYzRjA2NDEtMDY0QTA2NkUwNjZGMDY3MS0wNkQzMDZENTA2RUUwNkVGMDZGQS0wNkZDMDZGRjA3MTAwNzEyLTA3MkYwNzRELTA3QTUwN0IxMDdDQS0wN0VBMDgwMC0wODE1MDg0MC0wODU4MDhBMDA4QTItMDhBQzA5MDQtMDkzOTA5M0QwOTUwMDk1OC0wOTYxMDk3Mi0wOTc3MDk3OS0wOTdGMDk4NS0wOThDMDk4RjA5OTAwOTkzLTA5QTgwOUFBLTA5QjAwOUIyMDlCNi0wOUI5MDlCRDA5Q0UwOURDMDlERDA5REYtMDlFMTA5RjAwOUYxMEEwNS0wQTBBMEEwRjBBMTAwQTEzLTBBMjgwQTJBLTBBMzAwQTMyMEEzMzBBMzUwQTM2MEEzODBBMzkwQTU5LTBBNUMwQTVFMEE3Mi0wQTc0MEE4NS0wQThEMEE4Ri0wQTkxMEE5My0wQUE4MEFBQS0wQUIwMEFCMjBBQjMwQUI1LTBBQjkwQUJEMEFEMDBBRTAwQUUxMEIwNS0wQjBDMEIwRjBCMTAwQjEzLTBCMjgwQjJBLTBCMzAwQjMyMEIzMzBCMzUtMEIzOTBCM0QwQjVDMEI1RDBCNUYtMEI2MTBCNzEwQjgzMEI4NS0wQjhBMEI4RS0wQjkwMEI5Mi0wQjk1MEI5OTBCOUEwQjlDMEI5RTBCOUYwQkEzMEJBNDBCQTgtMEJBQTBCQUUtMEJCOTBCRDAwQzA1LTBDMEMwQzBFLTBDMTAwQzEyLTBDMjgwQzJBLTBDMzMwQzM1LTBDMzkwQzNEMEM1ODBDNTkwQzYwMEM2MTBDODUtMEM4QzBDOEUtMEM5MDBDOTItMENBODBDQUEtMENCMzBDQjUtMENCOTBDQkQwQ0RFMENFMDBDRTEwQ0YxMENGMjBEMDUtMEQwQzBEMEUtMEQxMDBEMTItMEQzQTBEM0QwRDRFMEQ2MDBENjEwRDdBLTBEN0YwRDg1LTBEOTYwRDlBLTBEQjEwREIzLTBEQkIwREJEMERDMC0wREM2MEUwMS0wRTMwMEUzMjBFMzMwRTQwLTBFNDUwRTgxMEU4MjBFODQwRTg3MEU4ODBFOEEwRThEMEU5NC0wRTk3MEU5OS0wRTlGMEVBMS0wRUEzMEVBNTBFQTcwRUFBMEVBQjBFQUQtMEVCMDBFQjIwRUIzMEVCRDBFQzAtMEVDNDBFREMtMEVERjBGMDAwRjQwLTBGNDcwRjQ5LTBGNkMwRjg4LTBGOEMxMDAwLTEwMkExMDNGMTA1MC0xMDU1MTA1QS0xMDVEMTA2MTEwNjUxMDY2MTA2RS0xMDcwMTA3NS0xMDgxMTA4RTEwRDAtMTBGQTEwRkQtMTI0ODEyNEEtMTI0RDEyNTAtMTI1NjEyNTgxMjVBLTEyNUQxMjYwLTEyODgxMjhBLTEyOEQxMjkwLTEyQjAxMkIyLTEyQjUxMkI4LTEyQkUxMkMwMTJDMi0xMkM1MTJDOC0xMkQ2MTJEOC0xMzEwMTMxMi0xMzE1MTMxOC0xMzVBMTM4MC0xMzhGMTNBMC0xM0Y0MTQwMS0xNjZDMTY2Ri0xNjdGMTY4MS0xNjlBMTZBMC0xNkVBMTcwMC0xNzBDMTcwRS0xNzExMTcyMC0xNzMxMTc0MC0xNzUxMTc2MC0xNzZDMTc2RS0xNzcwMTc4MC0xN0IzMTdEQzE4MjAtMTg0MjE4NDQtMTg3NzE4ODAtMThBODE4QUExOEIwLTE4RjUxOTAwLTE5MUMxOTUwLTE5NkQxOTcwLTE5NzQxOTgwLTE5QUIxOUMxLTE5QzcxQTAwLTFBMTYxQTIwLTFBNTQxQjA1LTFCMzMxQjQ1LTFCNEIxQjgzLTFCQTAxQkFFMUJBRjFCQkEtMUJFNTFDMDAtMUMyMzFDNEQtMUM0RjFDNUEtMUM3NzFDRTktMUNFQzFDRUUtMUNGMTFDRjUxQ0Y2MjEzNS0yMTM4MkQzMC0yRDY3MkQ4MC0yRDk2MkRBMC0yREE2MkRBOC0yREFFMkRCMC0yREI2MkRCOC0yREJFMkRDMC0yREM2MkRDOC0yRENFMkREMC0yREQ2MkREOC0yRERFMzAwNjMwM0MzMDQxLTMwOTYzMDlGMzBBMS0zMEZBMzBGRjMxMDUtMzEyRDMxMzEtMzE4RTMxQTAtMzFCQTMxRjAtMzFGRjM0MDAtNERCNTRFMDAtOUZDQ0EwMDAtQTAxNEEwMTYtQTQ4Q0E0RDAtQTRGN0E1MDAtQTYwQkE2MTAtQTYxRkE2MkFBNjJCQTY2RUE2QTAtQTZFNUE3RkItQTgwMUE4MDMtQTgwNUE4MDctQTgwQUE4MEMtQTgyMkE4NDAtQTg3M0E4ODItQThCM0E4RjItQThGN0E4RkJBOTBBLUE5MjVBOTMwLUE5NDZBOTYwLUE5N0NBOTg0LUE5QjJBQTAwLUFBMjhBQTQwLUFBNDJBQTQ0LUFBNEJBQTYwLUFBNkZBQTcxLUFBNzZBQTdBQUE4MC1BQUFGQUFCMUFBQjVBQUI2QUFCOS1BQUJEQUFDMEFBQzJBQURCQUFEQ0FBRTAtQUFFQUFBRjJBQjAxLUFCMDZBQjA5LUFCMEVBQjExLUFCMTZBQjIwLUFCMjZBQjI4LUFCMkVBQkMwLUFCRTJBQzAwLUQ3QTNEN0IwLUQ3QzZEN0NCLUQ3RkJGOTAwLUZBNkRGQTcwLUZBRDlGQjFERkIxRi1GQjI4RkIyQS1GQjM2RkIzOC1GQjNDRkIzRUZCNDBGQjQxRkI0M0ZCNDRGQjQ2LUZCQjFGQkQzLUZEM0RGRDUwLUZEOEZGRDkyLUZEQzdGREYwLUZERkJGRTcwLUZFNzRGRTc2LUZFRkNGRjY2LUZGNkZGRjcxLUZGOURGRkEwLUZGQkVGRkMyLUZGQzdGRkNBLUZGQ0ZGRkQyLUZGRDdGRkRBLUZGRENcIixcclxuICAgICAgICBNOiBcIjAzMDAtMDM2RjA0ODMtMDQ4OTA1OTEtMDVCRDA1QkYwNUMxMDVDMjA1QzQwNUM1MDVDNzA2MTAtMDYxQTA2NEItMDY1RjA2NzAwNkQ2LTA2REMwNkRGLTA2RTQwNkU3MDZFODA2RUEtMDZFRDA3MTEwNzMwLTA3NEEwN0E2LTA3QjAwN0VCLTA3RjMwODE2LTA4MTkwODFCLTA4MjMwODI1LTA4MjcwODI5LTA4MkQwODU5LTA4NUIwOEU0LTA4RkUwOTAwLTA5MDMwOTNBLTA5M0MwOTNFLTA5NEYwOTUxLTA5NTcwOTYyMDk2MzA5ODEtMDk4MzA5QkMwOUJFLTA5QzQwOUM3MDlDODA5Q0ItMDlDRDA5RDcwOUUyMDlFMzBBMDEtMEEwMzBBM0MwQTNFLTBBNDIwQTQ3MEE0ODBBNEItMEE0RDBBNTEwQTcwMEE3MTBBNzUwQTgxLTBBODMwQUJDMEFCRS0wQUM1MEFDNy0wQUM5MEFDQi0wQUNEMEFFMjBBRTMwQjAxLTBCMDMwQjNDMEIzRS0wQjQ0MEI0NzBCNDgwQjRCLTBCNEQwQjU2MEI1NzBCNjIwQjYzMEI4MjBCQkUtMEJDMjBCQzYtMEJDODBCQ0EtMEJDRDBCRDcwQzAxLTBDMDMwQzNFLTBDNDQwQzQ2LTBDNDgwQzRBLTBDNEQwQzU1MEM1NjBDNjIwQzYzMEM4MjBDODMwQ0JDMENCRS0wQ0M0MENDNi0wQ0M4MENDQS0wQ0NEMENENTBDRDYwQ0UyMENFMzBEMDIwRDAzMEQzRS0wRDQ0MEQ0Ni0wRDQ4MEQ0QS0wRDREMEQ1NzBENjIwRDYzMEQ4MjBEODMwRENBMERDRi0wREQ0MERENjBERDgtMERERjBERjIwREYzMEUzMTBFMzQtMEUzQTBFNDctMEU0RTBFQjEwRUI0LTBFQjkwRUJCMEVCQzBFQzgtMEVDRDBGMTgwRjE5MEYzNTBGMzcwRjM5MEYzRTBGM0YwRjcxLTBGODQwRjg2MEY4NzBGOEQtMEY5NzBGOTktMEZCQzBGQzYxMDJCLTEwM0UxMDU2LTEwNTkxMDVFLTEwNjAxMDYyLTEwNjQxMDY3LTEwNkQxMDcxLTEwNzQxMDgyLTEwOEQxMDhGMTA5QS0xMDlEMTM1RC0xMzVGMTcxMi0xNzE0MTczMi0xNzM0MTc1MjE3NTMxNzcyMTc3MzE3QjQtMTdEMzE3REQxODBCLTE4MEQxOEE5MTkyMC0xOTJCMTkzMC0xOTNCMTlCMC0xOUMwMTlDODE5QzkxQTE3LTFBMUIxQTU1LTFBNUUxQTYwLTFBN0MxQTdGMUIwMC0xQjA0MUIzNC0xQjQ0MUI2Qi0xQjczMUI4MC0xQjgyMUJBMS0xQkFEMUJFNi0xQkYzMUMyNC0xQzM3MUNEMC0xQ0QyMUNENC0xQ0U4MUNFRDFDRjItMUNGNDFEQzAtMURFNjFERkMtMURGRjIwRDAtMjBGMDJDRUYtMkNGMTJEN0YyREUwLTJERkYzMDJBLTMwMkYzMDk5MzA5QUE2NkYtQTY3MkE2NzQtQTY3REE2OUZBNkYwQTZGMUE4MDJBODA2QTgwQkE4MjMtQTgyN0E4ODBBODgxQThCNC1BOEM0QThFMC1BOEYxQTkyNi1BOTJEQTk0Ny1BOTUzQTk4MC1BOTgzQTlCMy1BOUMwQUEyOS1BQTM2QUE0M0FBNENBQTREQUE3QkFBQjBBQUIyLUFBQjRBQUI3QUFCOEFBQkVBQUJGQUFDMUFBRUItQUFFRkFBRjVBQUY2QUJFMy1BQkVBQUJFQ0FCRURGQjFFRkUwMC1GRTBGRkUyMC1GRTI2XCIsXHJcbiAgICAgICAgTW46IFwiMDMwMC0wMzZGMDQ4My0wNDg3MDU5MS0wNUJEMDVCRjA1QzEwNUMyMDVDNDA1QzUwNUM3MDYxMC0wNjFBMDY0Qi0wNjVGMDY3MDA2RDYtMDZEQzA2REYtMDZFNDA2RTcwNkU4MDZFQS0wNkVEMDcxMTA3MzAtMDc0QTA3QTYtMDdCMDA3RUItMDdGMzA4MTYtMDgxOTA4MUItMDgyMzA4MjUtMDgyNzA4MjktMDgyRDA4NTktMDg1QjA4RTQtMDhGRTA5MDAtMDkwMjA5M0EwOTNDMDk0MS0wOTQ4MDk0RDA5NTEtMDk1NzA5NjIwOTYzMDk4MTA5QkMwOUMxLTA5QzQwOUNEMDlFMjA5RTMwQTAxMEEwMjBBM0MwQTQxMEE0MjBBNDcwQTQ4MEE0Qi0wQTREMEE1MTBBNzAwQTcxMEE3NTBBODEwQTgyMEFCQzBBQzEtMEFDNTBBQzcwQUM4MEFDRDBBRTIwQUUzMEIwMTBCM0MwQjNGMEI0MS0wQjQ0MEI0RDBCNTYwQjYyMEI2MzBCODIwQkMwMEJDRDBDM0UtMEM0MDBDNDYtMEM0ODBDNEEtMEM0RDBDNTUwQzU2MEM2MjBDNjMwQ0JDMENCRjBDQzYwQ0NDMENDRDBDRTIwQ0UzMEQ0MS0wRDQ0MEQ0RDBENjIwRDYzMERDQTBERDItMERENDBERDYwRTMxMEUzNC0wRTNBMEU0Ny0wRTRFMEVCMTBFQjQtMEVCOTBFQkIwRUJDMEVDOC0wRUNEMEYxODBGMTkwRjM1MEYzNzBGMzkwRjcxLTBGN0UwRjgwLTBGODQwRjg2MEY4NzBGOEQtMEY5NzBGOTktMEZCQzBGQzYxMDJELTEwMzAxMDMyLTEwMzcxMDM5MTAzQTEwM0QxMDNFMTA1ODEwNTkxMDVFLTEwNjAxMDcxLTEwNzQxMDgyMTA4NTEwODYxMDhEMTA5RDEzNUQtMTM1RjE3MTItMTcxNDE3MzItMTczNDE3NTIxNzUzMTc3MjE3NzMxN0I0MTdCNTE3QjctMTdCRDE3QzYxN0M5LTE3RDMxN0REMTgwQi0xODBEMThBOTE5MjAtMTkyMjE5MjcxOTI4MTkzMjE5MzktMTkzQjFBMTcxQTE4MUE1NjFBNTgtMUE1RTFBNjAxQTYyMUE2NS0xQTZDMUE3My0xQTdDMUE3RjFCMDAtMUIwMzFCMzQxQjM2LTFCM0ExQjNDMUI0MjFCNkItMUI3MzFCODAxQjgxMUJBMi0xQkE1MUJBODFCQTkxQkFCMUJFNjFCRTgxQkU5MUJFRDFCRUYtMUJGMTFDMkMtMUMzMzFDMzYxQzM3MUNEMC0xQ0QyMUNENC0xQ0UwMUNFMi0xQ0U4MUNFRDFDRjQxREMwLTFERTYxREZDLTFERkYyMEQwLTIwREMyMEUxMjBFNS0yMEYwMkNFRi0yQ0YxMkQ3RjJERTAtMkRGRjMwMkEtMzAyRDMwOTkzMDlBQTY2RkE2NzQtQTY3REE2OUZBNkYwQTZGMUE4MDJBODA2QTgwQkE4MjVBODI2QThDNEE4RTAtQThGMUE5MjYtQTkyREE5NDctQTk1MUE5ODAtQTk4MkE5QjNBOUI2LUE5QjlBOUJDQUEyOS1BQTJFQUEzMUFBMzJBQTM1QUEzNkFBNDNBQTRDQUFCMEFBQjItQUFCNEFBQjdBQUI4QUFCRUFBQkZBQUMxQUFFQ0FBRURBQUY2QUJFNUFCRThBQkVERkIxRUZFMDAtRkUwRkZFMjAtRkUyNlwiLFxyXG4gICAgICAgIE1jOiBcIjA5MDMwOTNCMDkzRS0wOTQwMDk0OS0wOTRDMDk0RTA5NEYwOTgyMDk4MzA5QkUtMDlDMDA5QzcwOUM4MDlDQjA5Q0MwOUQ3MEEwMzBBM0UtMEE0MDBBODMwQUJFLTBBQzAwQUM5MEFDQjBBQ0MwQjAyMEIwMzBCM0UwQjQwMEI0NzBCNDgwQjRCMEI0QzBCNTcwQkJFMEJCRjBCQzEwQkMyMEJDNi0wQkM4MEJDQS0wQkNDMEJENzBDMDEtMEMwMzBDNDEtMEM0NDBDODIwQzgzMENCRTBDQzAtMENDNDBDQzcwQ0M4MENDQTBDQ0IwQ0Q1MENENjBEMDIwRDAzMEQzRS0wRDQwMEQ0Ni0wRDQ4MEQ0QS0wRDRDMEQ1NzBEODIwRDgzMERDRi0wREQxMEREOC0wRERGMERGMjBERjMwRjNFMEYzRjBGN0YxMDJCMTAyQzEwMzExMDM4MTAzQjEwM0MxMDU2MTA1NzEwNjItMTA2NDEwNjctMTA2RDEwODMxMDg0MTA4Ny0xMDhDMTA4RjEwOUEtMTA5QzE3QjYxN0JFLTE3QzUxN0M3MTdDODE5MjMtMTkyNjE5MjktMTkyQjE5MzAxOTMxMTkzMy0xOTM4MTlCMC0xOUMwMTlDODE5QzkxQTE5LTFBMUIxQTU1MUE1NzFBNjExQTYzMUE2NDFBNkQtMUE3MjFCMDQxQjM1MUIzQjFCM0QtMUI0MTFCNDMxQjQ0MUI4MjFCQTExQkE2MUJBNzFCQUExQkFDMUJBRDFCRTcxQkVBLTFCRUMxQkVFMUJGMjFCRjMxQzI0LTFDMkIxQzM0MUMzNTFDRTExQ0YyMUNGMzMwMkUzMDJGQTgyM0E4MjRBODI3QTg4MEE4ODFBOEI0LUE4QzNBOTUyQTk1M0E5ODNBOUI0QTlCNUE5QkFBOUJCQTlCRC1BOUMwQUEyRkFBMzBBQTMzQUEzNEFBNERBQTdCQUFFQkFBRUVBQUVGQUFGNUFCRTNBQkU0QUJFNkFCRTdBQkU5QUJFQUFCRUNcIixcclxuICAgICAgICBNZTogXCIwNDg4MDQ4OTIwREQtMjBFMDIwRTItMjBFNEE2NzAtQTY3MlwiLFxyXG4gICAgICAgIE46IFwiMDAzMC0wMDM5MDBCMjAwQjMwMEI5MDBCQy0wMEJFMDY2MC0wNjY5MDZGMC0wNkY5MDdDMC0wN0M5MDk2Ni0wOTZGMDlFNi0wOUVGMDlGNC0wOUY5MEE2Ni0wQTZGMEFFNi0wQUVGMEI2Ni0wQjZGMEI3Mi0wQjc3MEJFNi0wQkYyMEM2Ni0wQzZGMEM3OC0wQzdFMENFNi0wQ0VGMEQ2Ni0wRDc1MEU1MC0wRTU5MEVEMC0wRUQ5MEYyMC0wRjMzMTA0MC0xMDQ5MTA5MC0xMDk5MTM2OS0xMzdDMTZFRS0xNkYwMTdFMC0xN0U5MTdGMC0xN0Y5MTgxMC0xODE5MTk0Ni0xOTRGMTlEMC0xOURBMUE4MC0xQTg5MUE5MC0xQTk5MUI1MC0xQjU5MUJCMC0xQkI5MUM0MC0xQzQ5MUM1MC0xQzU5MjA3MDIwNzQtMjA3OTIwODAtMjA4OTIxNTAtMjE4MjIxODUtMjE4OTI0NjAtMjQ5QjI0RUEtMjRGRjI3NzYtMjc5MzJDRkQzMDA3MzAyMS0zMDI5MzAzOC0zMDNBMzE5Mi0zMTk1MzIyMC0zMjI5MzI0OC0zMjRGMzI1MS0zMjVGMzI4MC0zMjg5MzJCMS0zMkJGQTYyMC1BNjI5QTZFNi1BNkVGQTgzMC1BODM1QThEMC1BOEQ5QTkwMC1BOTA5QTlEMC1BOUQ5QUE1MC1BQTU5QUJGMC1BQkY5RkYxMC1GRjE5XCIsXHJcbiAgICAgICAgTmQ6IFwiMDAzMC0wMDM5MDY2MC0wNjY5MDZGMC0wNkY5MDdDMC0wN0M5MDk2Ni0wOTZGMDlFNi0wOUVGMEE2Ni0wQTZGMEFFNi0wQUVGMEI2Ni0wQjZGMEJFNi0wQkVGMEM2Ni0wQzZGMENFNi0wQ0VGMEQ2Ni0wRDZGMEU1MC0wRTU5MEVEMC0wRUQ5MEYyMC0wRjI5MTA0MC0xMDQ5MTA5MC0xMDk5MTdFMC0xN0U5MTgxMC0xODE5MTk0Ni0xOTRGMTlEMC0xOUQ5MUE4MC0xQTg5MUE5MC0xQTk5MUI1MC0xQjU5MUJCMC0xQkI5MUM0MC0xQzQ5MUM1MC0xQzU5QTYyMC1BNjI5QThEMC1BOEQ5QTkwMC1BOTA5QTlEMC1BOUQ5QUE1MC1BQTU5QUJGMC1BQkY5RkYxMC1GRjE5XCIsXHJcbiAgICAgICAgTmw6IFwiMTZFRS0xNkYwMjE2MC0yMTgyMjE4NS0yMTg4MzAwNzMwMjEtMzAyOTMwMzgtMzAzQUE2RTYtQTZFRlwiLFxyXG4gICAgICAgIE5vOiBcIjAwQjIwMEIzMDBCOTAwQkMtMDBCRTA5RjQtMDlGOTBCNzItMEI3NzBCRjAtMEJGMjBDNzgtMEM3RTBENzAtMEQ3NTBGMkEtMEYzMzEzNjktMTM3QzE3RjAtMTdGOTE5REEyMDcwMjA3NC0yMDc5MjA4MC0yMDg5MjE1MC0yMTVGMjE4OTI0NjAtMjQ5QjI0RUEtMjRGRjI3NzYtMjc5MzJDRkQzMTkyLTMxOTUzMjIwLTMyMjkzMjQ4LTMyNEYzMjUxLTMyNUYzMjgwLTMyODkzMkIxLTMyQkZBODMwLUE4MzVcIixcclxuICAgICAgICBQOiBcIjAwMjEtMDAyMzAwMjUtMDAyQTAwMkMtMDAyRjAwM0EwMDNCMDAzRjAwNDAwMDVCLTAwNUQwMDVGMDA3QjAwN0QwMEExMDBBNzAwQUIwMEI2MDBCNzAwQkIwMEJGMDM3RTAzODcwNTVBLTA1NUYwNTg5MDU4QTA1QkUwNUMwMDVDMzA1QzYwNUYzMDVGNDA2MDkwNjBBMDYwQzA2MEQwNjFCMDYxRTA2MUYwNjZBLTA2NkQwNkQ0MDcwMC0wNzBEMDdGNy0wN0Y5MDgzMC0wODNFMDg1RTA5NjQwOTY1MDk3MDBBRjAwREY0MEU0RjBFNUEwRTVCMEYwNC0wRjEyMEYxNDBGM0EtMEYzRDBGODUwRkQwLTBGRDQwRkQ5MEZEQTEwNEEtMTA0RjEwRkIxMzYwLTEzNjgxNDAwMTY2RDE2NkUxNjlCMTY5QzE2RUItMTZFRDE3MzUxNzM2MTdENC0xN0Q2MTdEOC0xN0RBMTgwMC0xODBBMTk0NDE5NDUxQTFFMUExRjFBQTAtMUFBNjFBQTgtMUFBRDFCNUEtMUI2MDFCRkMtMUJGRjFDM0ItMUMzRjFDN0UxQzdGMUNDMC0xQ0M3MUNEMzIwMTAtMjAyNzIwMzAtMjA0MzIwNDUtMjA1MTIwNTMtMjA1RTIwN0QyMDdFMjA4RDIwOEUyMzI5MjMyQTI3NjgtMjc3NTI3QzUyN0M2MjdFNi0yN0VGMjk4My0yOTk4MjlEOC0yOURCMjlGQzI5RkQyQ0Y5LTJDRkMyQ0ZFMkNGRjJENzAyRTAwLTJFMkUyRTMwLTJFM0IzMDAxLTMwMDMzMDA4LTMwMTEzMDE0LTMwMUYzMDMwMzAzRDMwQTAzMEZCQTRGRUE0RkZBNjBELUE2MEZBNjczQTY3RUE2RjItQTZGN0E4NzQtQTg3N0E4Q0VBOENGQThGOC1BOEZBQTkyRUE5MkZBOTVGQTlDMS1BOUNEQTlERUE5REZBQTVDLUFBNUZBQURFQUFERkFBRjBBQUYxQUJFQkZEM0VGRDNGRkUxMC1GRTE5RkUzMC1GRTUyRkU1NC1GRTYxRkU2M0ZFNjhGRTZBRkU2QkZGMDEtRkYwM0ZGMDUtRkYwQUZGMEMtRkYwRkZGMUFGRjFCRkYxRkZGMjBGRjNCLUZGM0RGRjNGRkY1QkZGNURGRjVGLUZGNjVcIixcclxuICAgICAgICBQZDogXCIwMDJEMDU4QTA1QkUxNDAwMTgwNjIwMTAtMjAxNTJFMTcyRTFBMkUzQTJFM0IzMDFDMzAzMDMwQTBGRTMxRkUzMkZFNThGRTYzRkYwRFwiLFxyXG4gICAgICAgIFBzOiBcIjAwMjgwMDVCMDA3QjBGM0EwRjNDMTY5QjIwMUEyMDFFMjA0NTIwN0QyMDhEMjMyOTI3NjgyNzZBMjc2QzI3NkUyNzcwMjc3MjI3NzQyN0M1MjdFNjI3RTgyN0VBMjdFQzI3RUUyOTgzMjk4NTI5ODcyOTg5Mjk4QjI5OEQyOThGMjk5MTI5OTMyOTk1Mjk5NzI5RDgyOURBMjlGQzJFMjIyRTI0MkUyNjJFMjgzMDA4MzAwQTMwMEMzMDBFMzAxMDMwMTQzMDE2MzAxODMwMUEzMDFERkQzRUZFMTdGRTM1RkUzN0ZFMzlGRTNCRkUzREZFM0ZGRTQxRkU0M0ZFNDdGRTU5RkU1QkZFNURGRjA4RkYzQkZGNUJGRjVGRkY2MlwiLFxyXG4gICAgICAgIFBlOiBcIjAwMjkwMDVEMDA3RDBGM0IwRjNEMTY5QzIwNDYyMDdFMjA4RTIzMkEyNzY5Mjc2QjI3NkQyNzZGMjc3MTI3NzMyNzc1MjdDNjI3RTcyN0U5MjdFQjI3RUQyN0VGMjk4NDI5ODYyOTg4Mjk4QTI5OEMyOThFMjk5MDI5OTIyOTk0Mjk5NjI5OTgyOUQ5MjlEQjI5RkQyRTIzMkUyNTJFMjcyRTI5MzAwOTMwMEIzMDBEMzAwRjMwMTEzMDE1MzAxNzMwMTkzMDFCMzAxRTMwMUZGRDNGRkUxOEZFMzZGRTM4RkUzQUZFM0NGRTNFRkU0MEZFNDJGRTQ0RkU0OEZFNUFGRTVDRkU1RUZGMDlGRjNERkY1REZGNjBGRjYzXCIsXHJcbiAgICAgICAgUGk6IFwiMDBBQjIwMTgyMDFCMjAxQzIwMUYyMDM5MkUwMjJFMDQyRTA5MkUwQzJFMUMyRTIwXCIsXHJcbiAgICAgICAgUGY6IFwiMDBCQjIwMTkyMDFEMjAzQTJFMDMyRTA1MkUwQTJFMEQyRTFEMkUyMVwiLFxyXG4gICAgICAgIFBjOiBcIjAwNUYyMDNGMjA0MDIwNTRGRTMzRkUzNEZFNEQtRkU0RkZGM0ZcIixcclxuICAgICAgICBQbzogXCIwMDIxLTAwMjMwMDI1LTAwMjcwMDJBMDAyQzAwMkUwMDJGMDAzQTAwM0IwMDNGMDA0MDAwNUMwMEExMDBBNzAwQjYwMEI3MDBCRjAzN0UwMzg3MDU1QS0wNTVGMDU4OTA1QzAwNUMzMDVDNjA1RjMwNUY0MDYwOTA2MEEwNjBDMDYwRDA2MUIwNjFFMDYxRjA2NkEtMDY2RDA2RDQwNzAwLTA3MEQwN0Y3LTA3RjkwODMwLTA4M0UwODVFMDk2NDA5NjUwOTcwMEFGMDBERjQwRTRGMEU1QTBFNUIwRjA0LTBGMTIwRjE0MEY4NTBGRDAtMEZENDBGRDkwRkRBMTA0QS0xMDRGMTBGQjEzNjAtMTM2ODE2NkQxNjZFMTZFQi0xNkVEMTczNTE3MzYxN0Q0LTE3RDYxN0Q4LTE3REExODAwLTE4MDUxODA3LTE4MEExOTQ0MTk0NTFBMUUxQTFGMUFBMC0xQUE2MUFBOC0xQUFEMUI1QS0xQjYwMUJGQy0xQkZGMUMzQi0xQzNGMUM3RTFDN0YxQ0MwLTFDQzcxQ0QzMjAxNjIwMTcyMDIwLTIwMjcyMDMwLTIwMzgyMDNCLTIwM0UyMDQxLTIwNDMyMDQ3LTIwNTEyMDUzMjA1NS0yMDVFMkNGOS0yQ0ZDMkNGRTJDRkYyRDcwMkUwMDJFMDEyRTA2LTJFMDgyRTBCMkUwRS0yRTE2MkUxODJFMTkyRTFCMkUxRTJFMUYyRTJBLTJFMkUyRTMwLTJFMzkzMDAxLTMwMDMzMDNEMzBGQkE0RkVBNEZGQTYwRC1BNjBGQTY3M0E2N0VBNkYyLUE2RjdBODc0LUE4NzdBOENFQThDRkE4RjgtQThGQUE5MkVBOTJGQTk1RkE5QzEtQTlDREE5REVBOURGQUE1Qy1BQTVGQUFERUFBREZBQUYwQUFGMUFCRUJGRTEwLUZFMTZGRTE5RkUzMEZFNDVGRTQ2RkU0OS1GRTRDRkU1MC1GRTUyRkU1NC1GRTU3RkU1Ri1GRTYxRkU2OEZFNkFGRTZCRkYwMS1GRjAzRkYwNS1GRjA3RkYwQUZGMENGRjBFRkYwRkZGMUFGRjFCRkYxRkZGMjBGRjNDRkY2MUZGNjRGRjY1XCIsXHJcbiAgICAgICAgUzogXCIwMDI0MDAyQjAwM0MtMDAzRTAwNUUwMDYwMDA3QzAwN0UwMEEyLTAwQTYwMEE4MDBBOTAwQUMwMEFFLTAwQjEwMEI0MDBCODAwRDcwMEY3MDJDMi0wMkM1MDJEMi0wMkRGMDJFNS0wMkVCMDJFRDAyRUYtMDJGRjAzNzUwMzg0MDM4NTAzRjYwNDgyMDU4RjA2MDYtMDYwODA2MEIwNjBFMDYwRjA2REUwNkU5MDZGRDA2RkUwN0Y2MDlGMjA5RjMwOUZBMDlGQjBBRjEwQjcwMEJGMy0wQkZBMEM3RjBENzkwRTNGMEYwMS0wRjAzMEYxMzBGMTUtMEYxNzBGMUEtMEYxRjBGMzQwRjM2MEYzODBGQkUtMEZDNTBGQzctMEZDQzBGQ0UwRkNGMEZENS0wRkQ4MTA5RTEwOUYxMzkwLTEzOTkxN0RCMTk0MDE5REUtMTlGRjFCNjEtMUI2QTFCNzQtMUI3QzFGQkQxRkJGLTFGQzExRkNELTFGQ0YxRkRELTFGREYxRkVELTFGRUYxRkZEMUZGRTIwNDQyMDUyMjA3QS0yMDdDMjA4QS0yMDhDMjBBMC0yMEI5MjEwMDIxMDEyMTAzLTIxMDYyMTA4MjEwOTIxMTQyMTE2LTIxMTgyMTFFLTIxMjMyMTI1MjEyNzIxMjkyMTJFMjEzQTIxM0IyMTQwLTIxNDQyMTRBLTIxNEQyMTRGMjE5MC0yMzI4MjMyQi0yM0YzMjQwMC0yNDI2MjQ0MC0yNDRBMjQ5Qy0yNEU5MjUwMC0yNkZGMjcwMS0yNzY3Mjc5NC0yN0M0MjdDNy0yN0U1MjdGMC0yOTgyMjk5OS0yOUQ3MjlEQy0yOUZCMjlGRS0yQjRDMkI1MC0yQjU5MkNFNS0yQ0VBMkU4MC0yRTk5MkU5Qi0yRUYzMkYwMC0yRkQ1MkZGMC0yRkZCMzAwNDMwMTIzMDEzMzAyMDMwMzYzMDM3MzAzRTMwM0YzMDlCMzA5QzMxOTAzMTkxMzE5Ni0zMTlGMzFDMC0zMUUzMzIwMC0zMjFFMzIyQS0zMjQ3MzI1MDMyNjAtMzI3RjMyOEEtMzJCMDMyQzAtMzJGRTMzMDAtMzNGRjREQzAtNERGRkE0OTAtQTRDNkE3MDAtQTcxNkE3MjBBNzIxQTc4OUE3OEFBODI4LUE4MkJBODM2LUE4MzlBQTc3LUFBNzlGQjI5RkJCMi1GQkMxRkRGQ0ZERkRGRTYyRkU2NC1GRTY2RkU2OUZGMDRGRjBCRkYxQy1GRjFFRkYzRUZGNDBGRjVDRkY1RUZGRTAtRkZFNkZGRTgtRkZFRUZGRkNGRkZEXCIsXHJcbiAgICAgICAgU206IFwiMDAyQjAwM0MtMDAzRTAwN0MwMDdFMDBBQzAwQjEwMEQ3MDBGNzAzRjYwNjA2LTA2MDgyMDQ0MjA1MjIwN0EtMjA3QzIwOEEtMjA4QzIxMTgyMTQwLTIxNDQyMTRCMjE5MC0yMTk0MjE5QTIxOUIyMUEwMjFBMzIxQTYyMUFFMjFDRTIxQ0YyMUQyMjFENDIxRjQtMjJGRjIzMDgtMjMwQjIzMjAyMzIxMjM3QzIzOUItMjNCMzIzREMtMjNFMTI1QjcyNUMxMjVGOC0yNUZGMjY2RjI3QzAtMjdDNDI3QzctMjdFNTI3RjAtMjdGRjI5MDAtMjk4MjI5OTktMjlENzI5REMtMjlGQjI5RkUtMkFGRjJCMzAtMkI0NDJCNDctMkI0Q0ZCMjlGRTYyRkU2NC1GRTY2RkYwQkZGMUMtRkYxRUZGNUNGRjVFRkZFMkZGRTktRkZFQ1wiLFxyXG4gICAgICAgIFNjOiBcIjAwMjQwMEEyLTAwQTUwNThGMDYwQjA5RjIwOUYzMDlGQjBBRjEwQkY5MEUzRjE3REIyMEEwLTIwQjlBODM4RkRGQ0ZFNjlGRjA0RkZFMEZGRTFGRkU1RkZFNlwiLFxyXG4gICAgICAgIFNrOiBcIjAwNUUwMDYwMDBBODAwQUYwMEI0MDBCODAyQzItMDJDNTAyRDItMDJERjAyRTUtMDJFQjAyRUQwMkVGLTAyRkYwMzc1MDM4NDAzODUxRkJEMUZCRi0xRkMxMUZDRC0xRkNGMUZERC0xRkRGMUZFRC0xRkVGMUZGRDFGRkUzMDlCMzA5Q0E3MDAtQTcxNkE3MjBBNzIxQTc4OUE3OEFGQkIyLUZCQzFGRjNFRkY0MEZGRTNcIixcclxuICAgICAgICBTbzogXCIwMEE2MDBBOTAwQUUwMEIwMDQ4MjA2MEUwNjBGMDZERTA2RTkwNkZEMDZGRTA3RjYwOUZBMEI3MDBCRjMtMEJGODBCRkEwQzdGMEQ3OTBGMDEtMEYwMzBGMTMwRjE1LTBGMTcwRjFBLTBGMUYwRjM0MEYzNjBGMzgwRkJFLTBGQzUwRkM3LTBGQ0MwRkNFMEZDRjBGRDUtMEZEODEwOUUxMDlGMTM5MC0xMzk5MTk0MDE5REUtMTlGRjFCNjEtMUI2QTFCNzQtMUI3QzIxMDAyMTAxMjEwMy0yMTA2MjEwODIxMDkyMTE0MjExNjIxMTcyMTFFLTIxMjMyMTI1MjEyNzIxMjkyMTJFMjEzQTIxM0IyMTRBMjE0QzIxNEQyMTRGMjE5NS0yMTk5MjE5Qy0yMTlGMjFBMTIxQTIyMUE0MjFBNTIxQTctMjFBRDIxQUYtMjFDRDIxRDAyMUQxMjFEMzIxRDUtMjFGMzIzMDAtMjMwNzIzMEMtMjMxRjIzMjItMjMyODIzMkItMjM3QjIzN0QtMjM5QTIzQjQtMjNEQjIzRTItMjNGMzI0MDAtMjQyNjI0NDAtMjQ0QTI0OUMtMjRFOTI1MDAtMjVCNjI1QjgtMjVDMDI1QzItMjVGNzI2MDAtMjY2RTI2NzAtMjZGRjI3MDEtMjc2NzI3OTQtMjdCRjI4MDAtMjhGRjJCMDAtMkIyRjJCNDUyQjQ2MkI1MC0yQjU5MkNFNS0yQ0VBMkU4MC0yRTk5MkU5Qi0yRUYzMkYwMC0yRkQ1MkZGMC0yRkZCMzAwNDMwMTIzMDEzMzAyMDMwMzYzMDM3MzAzRTMwM0YzMTkwMzE5MTMxOTYtMzE5RjMxQzAtMzFFMzMyMDAtMzIxRTMyMkEtMzI0NzMyNTAzMjYwLTMyN0YzMjhBLTMyQjAzMkMwLTMyRkUzMzAwLTMzRkY0REMwLTRERkZBNDkwLUE0QzZBODI4LUE4MkJBODM2QTgzN0E4MzlBQTc3LUFBNzlGREZERkZFNEZGRThGRkVERkZFRUZGRkNGRkZEXCIsXHJcbiAgICAgICAgWjogXCIwMDIwMDBBMDE2ODAxODBFMjAwMC0yMDBBMjAyODIwMjkyMDJGMjA1RjMwMDBcIixcclxuICAgICAgICBaczogXCIwMDIwMDBBMDE2ODAxODBFMjAwMC0yMDBBMjAyRjIwNUYzMDAwXCIsXHJcbiAgICAgICAgWmw6IFwiMjAyOFwiLFxyXG4gICAgICAgIFpwOiBcIjIwMjlcIixcclxuICAgICAgICBDOiBcIjAwMDAtMDAxRjAwN0YtMDA5RjAwQUQwMzc4MDM3OTAzN0YtMDM4MzAzOEIwMzhEMDNBMjA1MjgtMDUzMDA1NTcwNTU4MDU2MDA1ODgwNThCLTA1OEUwNTkwMDVDOC0wNUNGMDVFQi0wNUVGMDVGNS0wNjA1MDYxQzA2MUQwNkREMDcwRTA3MEYwNzRCMDc0QzA3QjItMDdCRjA3RkItMDdGRjA4MkUwODJGMDgzRjA4NUMwODVEMDg1Ri0wODlGMDhBMTA4QUQtMDhFMzA4RkYwOTc4MDk4MDA5ODQwOThEMDk4RTA5OTEwOTkyMDlBOTA5QjEwOUIzLTA5QjUwOUJBMDlCQjA5QzUwOUM2MDlDOTA5Q0EwOUNGLTA5RDYwOUQ4LTA5REIwOURFMDlFNDA5RTUwOUZDLTBBMDAwQTA0MEEwQi0wQTBFMEExMTBBMTIwQTI5MEEzMTBBMzQwQTM3MEEzQTBBM0IwQTNEMEE0My0wQTQ2MEE0OTBBNEEwQTRFLTBBNTAwQTUyLTBBNTgwQTVEMEE1Ri0wQTY1MEE3Ni0wQTgwMEE4NDBBOEUwQTkyMEFBOTBBQjEwQUI0MEFCQTBBQkIwQUM2MEFDQTBBQ0UwQUNGMEFEMS0wQURGMEFFNDBBRTUwQUYyLTBCMDAwQjA0MEIwRDBCMEUwQjExMEIxMjBCMjkwQjMxMEIzNDBCM0EwQjNCMEI0NTBCNDYwQjQ5MEI0QTBCNEUtMEI1NTBCNTgtMEI1QjBCNUUwQjY0MEI2NTBCNzgtMEI4MTBCODQwQjhCLTBCOEQwQjkxMEI5Ni0wQjk4MEI5QjBCOUQwQkEwLTBCQTIwQkE1LTBCQTcwQkFCLTBCQUQwQkJBLTBCQkQwQkMzLTBCQzUwQkM5MEJDRTBCQ0YwQkQxLTBCRDYwQkQ4LTBCRTUwQkZCLTBDMDAwQzA0MEMwRDBDMTEwQzI5MEMzNDBDM0EtMEMzQzBDNDUwQzQ5MEM0RS0wQzU0MEM1NzBDNUEtMEM1RjBDNjQwQzY1MEM3MC0wQzc3MEM4MDBDODEwQzg0MEM4RDBDOTEwQ0E5MENCNDBDQkEwQ0JCMENDNTBDQzkwQ0NFLTBDRDQwQ0Q3LTBDREQwQ0RGMENFNDBDRTUwQ0YwMENGMy0wRDAxMEQwNDBEMEQwRDExMEQzQjBEM0MwRDQ1MEQ0OTBENEYtMEQ1NjBENTgtMEQ1RjBENjQwRDY1MEQ3Ni0wRDc4MEQ4MDBEODEwRDg0MEQ5Ny0wRDk5MERCMjBEQkMwREJFMERCRjBEQzctMERDOTBEQ0ItMERDRTBERDUwREQ3MERFMC0wREYxMERGNS0wRTAwMEUzQi0wRTNFMEU1Qy0wRTgwMEU4MzBFODUwRTg2MEU4OTBFOEIwRThDMEU4RS0wRTkzMEU5ODBFQTAwRUE0MEVBNjBFQTgwRUE5MEVBQzBFQkEwRUJFMEVCRjBFQzUwRUM3MEVDRTBFQ0YwRURBMEVEQjBFRTAtMEVGRjBGNDgwRjZELTBGNzAwRjk4MEZCRDBGQ0QwRkRCLTBGRkYxMEM2MTBDOC0xMENDMTBDRTEwQ0YxMjQ5MTI0RTEyNEYxMjU3MTI1OTEyNUUxMjVGMTI4OTEyOEUxMjhGMTJCMTEyQjYxMkI3MTJCRjEyQzExMkM2MTJDNzEyRDcxMzExMTMxNjEzMTcxMzVCMTM1QzEzN0QtMTM3RjEzOUEtMTM5RjEzRjUtMTNGRjE2OUQtMTY5RjE2RjEtMTZGRjE3MEQxNzE1LTE3MUYxNzM3LTE3M0YxNzU0LTE3NUYxNzZEMTc3MTE3NzQtMTc3RjE3REUxN0RGMTdFQS0xN0VGMTdGQS0xN0ZGMTgwRjE4MUEtMTgxRjE4NzgtMTg3RjE4QUItMThBRjE4RjYtMThGRjE5MUQtMTkxRjE5MkMtMTkyRjE5M0MtMTkzRjE5NDEtMTk0MzE5NkUxOTZGMTk3NS0xOTdGMTlBQy0xOUFGMTlDQS0xOUNGMTlEQi0xOUREMUExQzFBMUQxQTVGMUE3RDFBN0UxQThBLTFBOEYxQTlBLTFBOUYxQUFFLTFBRkYxQjRDLTFCNEYxQjdELTFCN0YxQkY0LTFCRkIxQzM4LTFDM0ExQzRBLTFDNEMxQzgwLTFDQkYxQ0M4LTFDQ0YxQ0Y3LTFDRkYxREU3LTFERkIxRjE2MUYxNzFGMUUxRjFGMUY0NjFGNDcxRjRFMUY0RjFGNTgxRjVBMUY1QzFGNUUxRjdFMUY3RjFGQjUxRkM1MUZENDFGRDUxRkRDMUZGMDFGRjExRkY1MUZGRjIwMEItMjAwRjIwMkEtMjAyRTIwNjAtMjA2RjIwNzIyMDczMjA4RjIwOUQtMjA5RjIwQkEtMjBDRjIwRjEtMjBGRjIxOEEtMjE4RjIzRjQtMjNGRjI0MjctMjQzRjI0NEItMjQ1RjI3MDAyQjRELTJCNEYyQjVBLTJCRkYyQzJGMkM1RjJDRjQtMkNGODJEMjYyRDI4LTJEMkMyRDJFMkQyRjJENjgtMkQ2RTJENzEtMkQ3RTJEOTctMkQ5RjJEQTcyREFGMkRCNzJEQkYyREM3MkRDRjJERDcyRERGMkUzQy0yRTdGMkU5QTJFRjQtMkVGRjJGRDYtMkZFRjJGRkMtMkZGRjMwNDAzMDk3MzA5ODMxMDAtMzEwNDMxMkUtMzEzMDMxOEYzMUJCLTMxQkYzMUU0LTMxRUYzMjFGMzJGRjREQjYtNERCRjlGQ0QtOUZGRkE0OEQtQTQ4RkE0QzctQTRDRkE2MkMtQTYzRkE2OTgtQTY5RUE2RjgtQTZGRkE3OEZBNzk0LUE3OUZBN0FCLUE3RjdBODJDLUE4MkZBODNBLUE4M0ZBODc4LUE4N0ZBOEM1LUE4Q0RBOERBLUE4REZBOEZDLUE4RkZBOTU0LUE5NUVBOTdELUE5N0ZBOUNFQTlEQS1BOUREQTlFMC1BOUZGQUEzNy1BQTNGQUE0RUFBNEZBQTVBQUE1QkFBN0MtQUE3RkFBQzMtQUFEQUFBRjctQUIwMEFCMDdBQjA4QUIwRkFCMTBBQjE3LUFCMUZBQjI3QUIyRi1BQkJGQUJFRUFCRUZBQkZBLUFCRkZEN0E0LUQ3QUZEN0M3LUQ3Q0FEN0ZDLUY4RkZGQTZFRkE2RkZBREEtRkFGRkZCMDctRkIxMkZCMTgtRkIxQ0ZCMzdGQjNERkIzRkZCNDJGQjQ1RkJDMi1GQkQyRkQ0MC1GRDRGRkQ5MEZEOTFGREM4LUZERUZGREZFRkRGRkZFMUEtRkUxRkZFMjctRkUyRkZFNTNGRTY3RkU2Qy1GRTZGRkU3NUZFRkQtRkYwMEZGQkYtRkZDMUZGQzhGRkM5RkZEMEZGRDFGRkQ4RkZEOUZGREQtRkZERkZGRTdGRkVGLUZGRkJGRkZFRkZGRlwiLFxyXG4gICAgICAgIENjOiBcIjAwMDAtMDAxRjAwN0YtMDA5RlwiLFxyXG4gICAgICAgIENmOiBcIjAwQUQwNjAwLTA2MDQwNkREMDcwRjIwMEItMjAwRjIwMkEtMjAyRTIwNjAtMjA2NDIwNkEtMjA2RkZFRkZGRkY5LUZGRkJcIixcclxuICAgICAgICBDbzogXCJFMDAwLUY4RkZcIixcclxuICAgICAgICBDczogXCJEODAwLURGRkZcIixcclxuICAgICAgICBDbjogXCIwMzc4MDM3OTAzN0YtMDM4MzAzOEIwMzhEMDNBMjA1MjgtMDUzMDA1NTcwNTU4MDU2MDA1ODgwNThCLTA1OEUwNTkwMDVDOC0wNUNGMDVFQi0wNUVGMDVGNS0wNUZGMDYwNTA2MUMwNjFEMDcwRTA3NEIwNzRDMDdCMi0wN0JGMDdGQi0wN0ZGMDgyRTA4MkYwODNGMDg1QzA4NUQwODVGLTA4OUYwOEExMDhBRC0wOEUzMDhGRjA5NzgwOTgwMDk4NDA5OEQwOThFMDk5MTA5OTIwOUE5MDlCMTA5QjMtMDlCNTA5QkEwOUJCMDlDNTA5QzYwOUM5MDlDQTA5Q0YtMDlENjA5RDgtMDlEQjA5REUwOUU0MDlFNTA5RkMtMEEwMDBBMDQwQTBCLTBBMEUwQTExMEExMjBBMjkwQTMxMEEzNDBBMzcwQTNBMEEzQjBBM0QwQTQzLTBBNDYwQTQ5MEE0QTBBNEUtMEE1MDBBNTItMEE1ODBBNUQwQTVGLTBBNjUwQTc2LTBBODAwQTg0MEE4RTBBOTIwQUE5MEFCMTBBQjQwQUJBMEFCQjBBQzYwQUNBMEFDRTBBQ0YwQUQxLTBBREYwQUU0MEFFNTBBRjItMEIwMDBCMDQwQjBEMEIwRTBCMTEwQjEyMEIyOTBCMzEwQjM0MEIzQTBCM0IwQjQ1MEI0NjBCNDkwQjRBMEI0RS0wQjU1MEI1OC0wQjVCMEI1RTBCNjQwQjY1MEI3OC0wQjgxMEI4NDBCOEItMEI4RDBCOTEwQjk2LTBCOTgwQjlCMEI5RDBCQTAtMEJBMjBCQTUtMEJBNzBCQUItMEJBRDBCQkEtMEJCRDBCQzMtMEJDNTBCQzkwQkNFMEJDRjBCRDEtMEJENjBCRDgtMEJFNTBCRkItMEMwMDBDMDQwQzBEMEMxMTBDMjkwQzM0MEMzQS0wQzNDMEM0NTBDNDkwQzRFLTBDNTQwQzU3MEM1QS0wQzVGMEM2NDBDNjUwQzcwLTBDNzcwQzgwMEM4MTBDODQwQzhEMEM5MTBDQTkwQ0I0MENCQTBDQkIwQ0M1MENDOTBDQ0UtMENENDBDRDctMENERDBDREYwQ0U0MENFNTBDRjAwQ0YzLTBEMDEwRDA0MEQwRDBEMTEwRDNCMEQzQzBENDUwRDQ5MEQ0Ri0wRDU2MEQ1OC0wRDVGMEQ2NDBENjUwRDc2LTBENzgwRDgwMEQ4MTBEODQwRDk3LTBEOTkwREIyMERCQzBEQkUwREJGMERDNy0wREM5MERDQi0wRENFMERENTBERDcwREUwLTBERjEwREY1LTBFMDAwRTNCLTBFM0UwRTVDLTBFODAwRTgzMEU4NTBFODYwRTg5MEU4QjBFOEMwRThFLTBFOTMwRTk4MEVBMDBFQTQwRUE2MEVBODBFQTkwRUFDMEVCQTBFQkUwRUJGMEVDNTBFQzcwRUNFMEVDRjBFREEwRURCMEVFMC0wRUZGMEY0ODBGNkQtMEY3MDBGOTgwRkJEMEZDRDBGREItMEZGRjEwQzYxMEM4LTEwQ0MxMENFMTBDRjEyNDkxMjRFMTI0RjEyNTcxMjU5MTI1RTEyNUYxMjg5MTI4RTEyOEYxMkIxMTJCNjEyQjcxMkJGMTJDMTEyQzYxMkM3MTJENzEzMTExMzE2MTMxNzEzNUIxMzVDMTM3RC0xMzdGMTM5QS0xMzlGMTNGNS0xM0ZGMTY5RC0xNjlGMTZGMS0xNkZGMTcwRDE3MTUtMTcxRjE3MzctMTczRjE3NTQtMTc1RjE3NkQxNzcxMTc3NC0xNzdGMTdERTE3REYxN0VBLTE3RUYxN0ZBLTE3RkYxODBGMTgxQS0xODFGMTg3OC0xODdGMThBQi0xOEFGMThGNi0xOEZGMTkxRC0xOTFGMTkyQy0xOTJGMTkzQy0xOTNGMTk0MS0xOTQzMTk2RTE5NkYxOTc1LTE5N0YxOUFDLTE5QUYxOUNBLTE5Q0YxOURCLTE5REQxQTFDMUExRDFBNUYxQTdEMUE3RTFBOEEtMUE4RjFBOUEtMUE5RjFBQUUtMUFGRjFCNEMtMUI0RjFCN0QtMUI3RjFCRjQtMUJGQjFDMzgtMUMzQTFDNEEtMUM0QzFDODAtMUNCRjFDQzgtMUNDRjFDRjctMUNGRjFERTctMURGQjFGMTYxRjE3MUYxRTFGMUYxRjQ2MUY0NzFGNEUxRjRGMUY1ODFGNUExRjVDMUY1RTFGN0UxRjdGMUZCNTFGQzUxRkQ0MUZENTFGREMxRkYwMUZGMTFGRjUxRkZGMjA2NS0yMDY5MjA3MjIwNzMyMDhGMjA5RC0yMDlGMjBCQS0yMENGMjBGMS0yMEZGMjE4QS0yMThGMjNGNC0yM0ZGMjQyNy0yNDNGMjQ0Qi0yNDVGMjcwMDJCNEQtMkI0RjJCNUEtMkJGRjJDMkYyQzVGMkNGNC0yQ0Y4MkQyNjJEMjgtMkQyQzJEMkUyRDJGMkQ2OC0yRDZFMkQ3MS0yRDdFMkQ5Ny0yRDlGMkRBNzJEQUYyREI3MkRCRjJEQzcyRENGMkRENzJEREYyRTNDLTJFN0YyRTlBMkVGNC0yRUZGMkZENi0yRkVGMkZGQy0yRkZGMzA0MDMwOTczMDk4MzEwMC0zMTA0MzEyRS0zMTMwMzE4RjMxQkItMzFCRjMxRTQtMzFFRjMyMUYzMkZGNERCNi00REJGOUZDRC05RkZGQTQ4RC1BNDhGQTRDNy1BNENGQTYyQy1BNjNGQTY5OC1BNjlFQTZGOC1BNkZGQTc4RkE3OTQtQTc5RkE3QUItQTdGN0E4MkMtQTgyRkE4M0EtQTgzRkE4NzgtQTg3RkE4QzUtQThDREE4REEtQThERkE4RkMtQThGRkE5NTQtQTk1RUE5N0QtQTk3RkE5Q0VBOURBLUE5RERBOUUwLUE5RkZBQTM3LUFBM0ZBQTRFQUE0RkFBNUFBQTVCQUE3Qy1BQTdGQUFDMy1BQURBQUFGNy1BQjAwQUIwN0FCMDhBQjBGQUIxMEFCMTctQUIxRkFCMjdBQjJGLUFCQkZBQkVFQUJFRkFCRkEtQUJGRkQ3QTQtRDdBRkQ3QzctRDdDQUQ3RkMtRDdGRkZBNkVGQTZGRkFEQS1GQUZGRkIwNy1GQjEyRkIxOC1GQjFDRkIzN0ZCM0RGQjNGRkI0MkZCNDVGQkMyLUZCRDJGRDQwLUZENEZGRDkwRkQ5MUZEQzgtRkRFRkZERkVGREZGRkUxQS1GRTFGRkUyNy1GRTJGRkU1M0ZFNjdGRTZDLUZFNkZGRTc1RkVGREZFRkVGRjAwRkZCRi1GRkMxRkZDOEZGQzlGRkQwRkZEMUZGRDhGRkQ5RkZERC1GRkRGRkZFN0ZGRUYtRkZGOEZGRkVGRkZGXCJcclxuICAgIH0sIHtcclxuICAgICAgICAvL0w6IFwiTGV0dGVyXCIsIC8vIEluY2x1ZGVkIGluIHRoZSBVbmljb2RlIEJhc2UgYWRkb25cclxuICAgICAgICBMbDogXCJMb3dlcmNhc2VfTGV0dGVyXCIsXHJcbiAgICAgICAgTHU6IFwiVXBwZXJjYXNlX0xldHRlclwiLFxyXG4gICAgICAgIEx0OiBcIlRpdGxlY2FzZV9MZXR0ZXJcIixcclxuICAgICAgICBMbTogXCJNb2RpZmllcl9MZXR0ZXJcIixcclxuICAgICAgICBMbzogXCJPdGhlcl9MZXR0ZXJcIixcclxuICAgICAgICBNOiBcIk1hcmtcIixcclxuICAgICAgICBNbjogXCJOb25zcGFjaW5nX01hcmtcIixcclxuICAgICAgICBNYzogXCJTcGFjaW5nX01hcmtcIixcclxuICAgICAgICBNZTogXCJFbmNsb3NpbmdfTWFya1wiLFxyXG4gICAgICAgIE46IFwiTnVtYmVyXCIsXHJcbiAgICAgICAgTmQ6IFwiRGVjaW1hbF9OdW1iZXJcIixcclxuICAgICAgICBObDogXCJMZXR0ZXJfTnVtYmVyXCIsXHJcbiAgICAgICAgTm86IFwiT3RoZXJfTnVtYmVyXCIsXHJcbiAgICAgICAgUDogXCJQdW5jdHVhdGlvblwiLFxyXG4gICAgICAgIFBkOiBcIkRhc2hfUHVuY3R1YXRpb25cIixcclxuICAgICAgICBQczogXCJPcGVuX1B1bmN0dWF0aW9uXCIsXHJcbiAgICAgICAgUGU6IFwiQ2xvc2VfUHVuY3R1YXRpb25cIixcclxuICAgICAgICBQaTogXCJJbml0aWFsX1B1bmN0dWF0aW9uXCIsXHJcbiAgICAgICAgUGY6IFwiRmluYWxfUHVuY3R1YXRpb25cIixcclxuICAgICAgICBQYzogXCJDb25uZWN0b3JfUHVuY3R1YXRpb25cIixcclxuICAgICAgICBQbzogXCJPdGhlcl9QdW5jdHVhdGlvblwiLFxyXG4gICAgICAgIFM6IFwiU3ltYm9sXCIsXHJcbiAgICAgICAgU206IFwiTWF0aF9TeW1ib2xcIixcclxuICAgICAgICBTYzogXCJDdXJyZW5jeV9TeW1ib2xcIixcclxuICAgICAgICBTazogXCJNb2RpZmllcl9TeW1ib2xcIixcclxuICAgICAgICBTbzogXCJPdGhlcl9TeW1ib2xcIixcclxuICAgICAgICBaOiBcIlNlcGFyYXRvclwiLFxyXG4gICAgICAgIFpzOiBcIlNwYWNlX1NlcGFyYXRvclwiLFxyXG4gICAgICAgIFpsOiBcIkxpbmVfU2VwYXJhdG9yXCIsXHJcbiAgICAgICAgWnA6IFwiUGFyYWdyYXBoX1NlcGFyYXRvclwiLFxyXG4gICAgICAgIEM6IFwiT3RoZXJcIixcclxuICAgICAgICBDYzogXCJDb250cm9sXCIsXHJcbiAgICAgICAgQ2Y6IFwiRm9ybWF0XCIsXHJcbiAgICAgICAgQ286IFwiUHJpdmF0ZV9Vc2VcIixcclxuICAgICAgICBDczogXCJTdXJyb2dhdGVcIixcclxuICAgICAgICBDbjogXCJVbmFzc2lnbmVkXCJcclxuICAgIH0pO1xyXG5cclxufShYUmVnRXhwKSk7XHJcblxyXG5cbi8qKioqKiB1bmljb2RlLXNjcmlwdHMuanMgKioqKiovXG5cbi8qIVxyXG4gKiBYUmVnRXhwIFVuaWNvZGUgU2NyaXB0cyB2MS4yLjBcclxuICogKGMpIDIwMTAtMjAxMiBTdGV2ZW4gTGV2aXRoYW4gPGh0dHA6Ly94cmVnZXhwLmNvbS8+XHJcbiAqIE1JVCBMaWNlbnNlXHJcbiAqIFVzZXMgVW5pY29kZSA2LjEgPGh0dHA6Ly91bmljb2RlLm9yZy8+XHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIEFkZHMgc3VwcG9ydCBmb3IgYWxsIFVuaWNvZGUgc2NyaXB0cyBpbiB0aGUgQmFzaWMgTXVsdGlsaW5ndWFsIFBsYW5lIChVKzAwMDAtVStGRkZGKS5cclxuICogRS5nLiwgYFxccHtMYXRpbn1gLiBUb2tlbiBuYW1lcyBhcmUgY2FzZSBpbnNlbnNpdGl2ZSwgYW5kIGFueSBzcGFjZXMsIGh5cGhlbnMsIGFuZCB1bmRlcnNjb3Jlc1xyXG4gKiBhcmUgaWdub3JlZC5cclxuICogQHJlcXVpcmVzIFhSZWdFeHAsIFhSZWdFeHAgVW5pY29kZSBCYXNlXHJcbiAqL1xyXG4oZnVuY3Rpb24gKFhSZWdFeHApIHtcclxuICAgIFwidXNlIHN0cmljdFwiO1xyXG5cclxuICAgIGlmICghWFJlZ0V4cC5hZGRVbmljb2RlUGFja2FnZSkge1xyXG4gICAgICAgIHRocm93IG5ldyBSZWZlcmVuY2VFcnJvcihcIlVuaWNvZGUgQmFzZSBtdXN0IGJlIGxvYWRlZCBiZWZvcmUgVW5pY29kZSBTY3JpcHRzXCIpO1xyXG4gICAgfVxyXG5cclxuICAgIFhSZWdFeHAuaW5zdGFsbChcImV4dGVuc2liaWxpdHlcIik7XHJcblxyXG4gICAgWFJlZ0V4cC5hZGRVbmljb2RlUGFja2FnZSh7XHJcbiAgICAgICAgQXJhYmljOiBcIjA2MDAtMDYwNDA2MDYtMDYwQjA2MEQtMDYxQTA2MUUwNjIwLTA2M0YwNjQxLTA2NEEwNjU2LTA2NUUwNjZBLTA2NkYwNjcxLTA2REMwNkRFLTA2RkYwNzUwLTA3N0YwOEEwMDhBMi0wOEFDMDhFNC0wOEZFRkI1MC1GQkMxRkJEMy1GRDNERkQ1MC1GRDhGRkQ5Mi1GREM3RkRGMC1GREZDRkU3MC1GRTc0RkU3Ni1GRUZDXCIsXHJcbiAgICAgICAgQXJtZW5pYW46IFwiMDUzMS0wNTU2MDU1OS0wNTVGMDU2MS0wNTg3MDU4QTA1OEZGQjEzLUZCMTdcIixcclxuICAgICAgICBCYWxpbmVzZTogXCIxQjAwLTFCNEIxQjUwLTFCN0NcIixcclxuICAgICAgICBCYW11bTogXCJBNkEwLUE2RjdcIixcclxuICAgICAgICBCYXRhazogXCIxQkMwLTFCRjMxQkZDLTFCRkZcIixcclxuICAgICAgICBCZW5nYWxpOiBcIjA5ODEtMDk4MzA5ODUtMDk4QzA5OEYwOTkwMDk5My0wOUE4MDlBQS0wOUIwMDlCMjA5QjYtMDlCOTA5QkMtMDlDNDA5QzcwOUM4MDlDQi0wOUNFMDlENzA5REMwOUREMDlERi0wOUUzMDlFNi0wOUZCXCIsXHJcbiAgICAgICAgQm9wb21vZm86IFwiMDJFQTAyRUIzMTA1LTMxMkQzMUEwLTMxQkFcIixcclxuICAgICAgICBCcmFpbGxlOiBcIjI4MDAtMjhGRlwiLFxyXG4gICAgICAgIEJ1Z2luZXNlOiBcIjFBMDAtMUExQjFBMUUxQTFGXCIsXHJcbiAgICAgICAgQnVoaWQ6IFwiMTc0MC0xNzUzXCIsXHJcbiAgICAgICAgQ2FuYWRpYW5fQWJvcmlnaW5hbDogXCIxNDAwLTE2N0YxOEIwLTE4RjVcIixcclxuICAgICAgICBDaGFtOiBcIkFBMDAtQUEzNkFBNDAtQUE0REFBNTAtQUE1OUFBNUMtQUE1RlwiLFxyXG4gICAgICAgIENoZXJva2VlOiBcIjEzQTAtMTNGNFwiLFxyXG4gICAgICAgIENvbW1vbjogXCIwMDAwLTAwNDAwMDVCLTAwNjAwMDdCLTAwQTkwMEFCLTAwQjkwMEJCLTAwQkYwMEQ3MDBGNzAyQjktMDJERjAyRTUtMDJFOTAyRUMtMDJGRjAzNzQwMzdFMDM4NTAzODcwNTg5MDYwQzA2MUIwNjFGMDY0MDA2NjAtMDY2OTA2REQwOTY0MDk2NTBFM0YwRkQ1LTBGRDgxMEZCMTZFQi0xNkVEMTczNTE3MzYxODAyMTgwMzE4MDUxQ0QzMUNFMTFDRTktMUNFQzFDRUUtMUNGMzFDRjUxQ0Y2MjAwMC0yMDBCMjAwRS0yMDY0MjA2QS0yMDcwMjA3NC0yMDdFMjA4MC0yMDhFMjBBMC0yMEI5MjEwMC0yMTI1MjEyNy0yMTI5MjEyQy0yMTMxMjEzMy0yMTREMjE0Ri0yMTVGMjE4OTIxOTAtMjNGMzI0MDAtMjQyNjI0NDAtMjQ0QTI0NjAtMjZGRjI3MDEtMjdGRjI5MDAtMkI0QzJCNTAtMkI1OTJFMDAtMkUzQjJGRjAtMkZGQjMwMDAtMzAwNDMwMDYzMDA4LTMwMjAzMDMwLTMwMzczMDNDLTMwM0YzMDlCMzA5QzMwQTAzMEZCMzBGQzMxOTAtMzE5RjMxQzAtMzFFMzMyMjAtMzI1RjMyN0YtMzJDRjMzNTgtMzNGRjREQzAtNERGRkE3MDAtQTcyMUE3ODgtQTc4QUE4MzAtQTgzOUZEM0VGRDNGRkRGREZFMTAtRkUxOUZFMzAtRkU1MkZFNTQtRkU2NkZFNjgtRkU2QkZFRkZGRjAxLUZGMjBGRjNCLUZGNDBGRjVCLUZGNjVGRjcwRkY5RUZGOUZGRkUwLUZGRTZGRkU4LUZGRUVGRkY5LUZGRkRcIixcclxuICAgICAgICBDb3B0aWM6IFwiMDNFMi0wM0VGMkM4MC0yQ0YzMkNGOS0yQ0ZGXCIsXHJcbiAgICAgICAgQ3lyaWxsaWM6IFwiMDQwMC0wNDg0MDQ4Ny0wNTI3MUQyQjFENzgyREUwLTJERkZBNjQwLUE2OTdBNjlGXCIsXHJcbiAgICAgICAgRGV2YW5hZ2FyaTogXCIwOTAwLTA5NTAwOTUzLTA5NjMwOTY2LTA5NzcwOTc5LTA5N0ZBOEUwLUE4RkJcIixcclxuICAgICAgICBFdGhpb3BpYzogXCIxMjAwLTEyNDgxMjRBLTEyNEQxMjUwLTEyNTYxMjU4MTI1QS0xMjVEMTI2MC0xMjg4MTI4QS0xMjhEMTI5MC0xMkIwMTJCMi0xMkI1MTJCOC0xMkJFMTJDMDEyQzItMTJDNTEyQzgtMTJENjEyRDgtMTMxMDEzMTItMTMxNTEzMTgtMTM1QTEzNUQtMTM3QzEzODAtMTM5OTJEODAtMkQ5NjJEQTAtMkRBNjJEQTgtMkRBRTJEQjAtMkRCNjJEQjgtMkRCRTJEQzAtMkRDNjJEQzgtMkRDRTJERDAtMkRENjJERDgtMkRERUFCMDEtQUIwNkFCMDktQUIwRUFCMTEtQUIxNkFCMjAtQUIyNkFCMjgtQUIyRVwiLFxyXG4gICAgICAgIEdlb3JnaWFuOiBcIjEwQTAtMTBDNTEwQzcxMENEMTBEMC0xMEZBMTBGQy0xMEZGMkQwMC0yRDI1MkQyNzJEMkRcIixcclxuICAgICAgICBHbGFnb2xpdGljOiBcIjJDMDAtMkMyRTJDMzAtMkM1RVwiLFxyXG4gICAgICAgIEdyZWVrOiBcIjAzNzAtMDM3MzAzNzUtMDM3NzAzN0EtMDM3RDAzODQwMzg2MDM4OC0wMzhBMDM4QzAzOEUtMDNBMTAzQTMtMDNFMTAzRjAtMDNGRjFEMjYtMUQyQTFENUQtMUQ2MTFENjYtMUQ2QTFEQkYxRjAwLTFGMTUxRjE4LTFGMUQxRjIwLTFGNDUxRjQ4LTFGNEQxRjUwLTFGNTcxRjU5MUY1QjFGNUQxRjVGLTFGN0QxRjgwLTFGQjQxRkI2LTFGQzQxRkM2LTFGRDMxRkQ2LTFGREIxRkRELTFGRUYxRkYyLTFGRjQxRkY2LTFGRkUyMTI2XCIsXHJcbiAgICAgICAgR3VqYXJhdGk6IFwiMEE4MS0wQTgzMEE4NS0wQThEMEE4Ri0wQTkxMEE5My0wQUE4MEFBQS0wQUIwMEFCMjBBQjMwQUI1LTBBQjkwQUJDLTBBQzUwQUM3LTBBQzkwQUNCLTBBQ0QwQUQwMEFFMC0wQUUzMEFFNi0wQUYxXCIsXHJcbiAgICAgICAgR3VybXVraGk6IFwiMEEwMS0wQTAzMEEwNS0wQTBBMEEwRjBBMTAwQTEzLTBBMjgwQTJBLTBBMzAwQTMyMEEzMzBBMzUwQTM2MEEzODBBMzkwQTNDMEEzRS0wQTQyMEE0NzBBNDgwQTRCLTBBNEQwQTUxMEE1OS0wQTVDMEE1RTBBNjYtMEE3NVwiLFxyXG4gICAgICAgIEhhbjogXCIyRTgwLTJFOTkyRTlCLTJFRjMyRjAwLTJGRDUzMDA1MzAwNzMwMjEtMzAyOTMwMzgtMzAzQjM0MDAtNERCNTRFMDAtOUZDQ0Y5MDAtRkE2REZBNzAtRkFEOVwiLFxyXG4gICAgICAgIEhhbmd1bDogXCIxMTAwLTExRkYzMDJFMzAyRjMxMzEtMzE4RTMyMDAtMzIxRTMyNjAtMzI3RUE5NjAtQTk3Q0FDMDAtRDdBM0Q3QjAtRDdDNkQ3Q0ItRDdGQkZGQTAtRkZCRUZGQzItRkZDN0ZGQ0EtRkZDRkZGRDItRkZEN0ZGREEtRkZEQ1wiLFxyXG4gICAgICAgIEhhbnVub286IFwiMTcyMC0xNzM0XCIsXHJcbiAgICAgICAgSGVicmV3OiBcIjA1OTEtMDVDNzA1RDAtMDVFQTA1RjAtMDVGNEZCMUQtRkIzNkZCMzgtRkIzQ0ZCM0VGQjQwRkI0MUZCNDNGQjQ0RkI0Ni1GQjRGXCIsXHJcbiAgICAgICAgSGlyYWdhbmE6IFwiMzA0MS0zMDk2MzA5RC0zMDlGXCIsXHJcbiAgICAgICAgSW5oZXJpdGVkOiBcIjAzMDAtMDM2RjA0ODUwNDg2MDY0Qi0wNjU1MDY1RjA2NzAwOTUxMDk1MjFDRDAtMUNEMjFDRDQtMUNFMDFDRTItMUNFODFDRUQxQ0Y0MURDMC0xREU2MURGQy0xREZGMjAwQzIwMEQyMEQwLTIwRjAzMDJBLTMwMkQzMDk5MzA5QUZFMDAtRkUwRkZFMjAtRkUyNlwiLFxyXG4gICAgICAgIEphdmFuZXNlOiBcIkE5ODAtQTlDREE5Q0YtQTlEOUE5REVBOURGXCIsXHJcbiAgICAgICAgS2FubmFkYTogXCIwQzgyMEM4MzBDODUtMEM4QzBDOEUtMEM5MDBDOTItMENBODBDQUEtMENCMzBDQjUtMENCOTBDQkMtMENDNDBDQzYtMENDODBDQ0EtMENDRDBDRDUwQ0Q2MENERTBDRTAtMENFMzBDRTYtMENFRjBDRjEwQ0YyXCIsXHJcbiAgICAgICAgS2F0YWthbmE6IFwiMzBBMS0zMEZBMzBGRC0zMEZGMzFGMC0zMUZGMzJEMC0zMkZFMzMwMC0zMzU3RkY2Ni1GRjZGRkY3MS1GRjlEXCIsXHJcbiAgICAgICAgS2F5YWhfTGk6IFwiQTkwMC1BOTJGXCIsXHJcbiAgICAgICAgS2htZXI6IFwiMTc4MC0xN0REMTdFMC0xN0U5MTdGMC0xN0Y5MTlFMC0xOUZGXCIsXHJcbiAgICAgICAgTGFvOiBcIjBFODEwRTgyMEU4NDBFODcwRTg4MEU4QTBFOEQwRTk0LTBFOTcwRTk5LTBFOUYwRUExLTBFQTMwRUE1MEVBNzBFQUEwRUFCMEVBRC0wRUI5MEVCQi0wRUJEMEVDMC0wRUM0MEVDNjBFQzgtMEVDRDBFRDAtMEVEOTBFREMtMEVERlwiLFxyXG4gICAgICAgIExhdGluOiBcIjAwNDEtMDA1QTAwNjEtMDA3QTAwQUEwMEJBMDBDMC0wMEQ2MDBEOC0wMEY2MDBGOC0wMkI4MDJFMC0wMkU0MUQwMC0xRDI1MUQyQy0xRDVDMUQ2Mi0xRDY1MUQ2Qi0xRDc3MUQ3OS0xREJFMUUwMC0xRUZGMjA3MTIwN0YyMDkwLTIwOUMyMTJBMjEyQjIxMzIyMTRFMjE2MC0yMTg4MkM2MC0yQzdGQTcyMi1BNzg3QTc4Qi1BNzhFQTc5MC1BNzkzQTdBMC1BN0FBQTdGOC1BN0ZGRkIwMC1GQjA2RkYyMS1GRjNBRkY0MS1GRjVBXCIsXHJcbiAgICAgICAgTGVwY2hhOiBcIjFDMDAtMUMzNzFDM0ItMUM0OTFDNEQtMUM0RlwiLFxyXG4gICAgICAgIExpbWJ1OiBcIjE5MDAtMTkxQzE5MjAtMTkyQjE5MzAtMTkzQjE5NDAxOTQ0LTE5NEZcIixcclxuICAgICAgICBMaXN1OiBcIkE0RDAtQTRGRlwiLFxyXG4gICAgICAgIE1hbGF5YWxhbTogXCIwRDAyMEQwMzBEMDUtMEQwQzBEMEUtMEQxMDBEMTItMEQzQTBEM0QtMEQ0NDBENDYtMEQ0ODBENEEtMEQ0RTBENTcwRDYwLTBENjMwRDY2LTBENzUwRDc5LTBEN0ZcIixcclxuICAgICAgICBNYW5kYWljOiBcIjA4NDAtMDg1QjA4NUVcIixcclxuICAgICAgICBNZWV0ZWlfTWF5ZWs6IFwiQUFFMC1BQUY2QUJDMC1BQkVEQUJGMC1BQkY5XCIsXHJcbiAgICAgICAgTW9uZ29saWFuOiBcIjE4MDAxODAxMTgwNDE4MDYtMTgwRTE4MTAtMTgxOTE4MjAtMTg3NzE4ODAtMThBQVwiLFxyXG4gICAgICAgIE15YW5tYXI6IFwiMTAwMC0xMDlGQUE2MC1BQTdCXCIsXHJcbiAgICAgICAgTmV3X1RhaV9MdWU6IFwiMTk4MC0xOUFCMTlCMC0xOUM5MTlEMC0xOURBMTlERTE5REZcIixcclxuICAgICAgICBOa286IFwiMDdDMC0wN0ZBXCIsXHJcbiAgICAgICAgT2doYW06IFwiMTY4MC0xNjlDXCIsXHJcbiAgICAgICAgT2xfQ2hpa2k6IFwiMUM1MC0xQzdGXCIsXHJcbiAgICAgICAgT3JpeWE6IFwiMEIwMS0wQjAzMEIwNS0wQjBDMEIwRjBCMTAwQjEzLTBCMjgwQjJBLTBCMzAwQjMyMEIzMzBCMzUtMEIzOTBCM0MtMEI0NDBCNDcwQjQ4MEI0Qi0wQjREMEI1NjBCNTcwQjVDMEI1RDBCNUYtMEI2MzBCNjYtMEI3N1wiLFxyXG4gICAgICAgIFBoYWdzX1BhOiBcIkE4NDAtQTg3N1wiLFxyXG4gICAgICAgIFJlamFuZzogXCJBOTMwLUE5NTNBOTVGXCIsXHJcbiAgICAgICAgUnVuaWM6IFwiMTZBMC0xNkVBMTZFRS0xNkYwXCIsXHJcbiAgICAgICAgU2FtYXJpdGFuOiBcIjA4MDAtMDgyRDA4MzAtMDgzRVwiLFxyXG4gICAgICAgIFNhdXJhc2h0cmE6IFwiQTg4MC1BOEM0QThDRS1BOEQ5XCIsXHJcbiAgICAgICAgU2luaGFsYTogXCIwRDgyMEQ4MzBEODUtMEQ5NjBEOUEtMERCMTBEQjMtMERCQjBEQkQwREMwLTBEQzYwRENBMERDRi0wREQ0MERENjBERDgtMERERjBERjItMERGNFwiLFxyXG4gICAgICAgIFN1bmRhbmVzZTogXCIxQjgwLTFCQkYxQ0MwLTFDQzdcIixcclxuICAgICAgICBTeWxvdGlfTmFncmk6IFwiQTgwMC1BODJCXCIsXHJcbiAgICAgICAgU3lyaWFjOiBcIjA3MDAtMDcwRDA3MEYtMDc0QTA3NEQtMDc0RlwiLFxyXG4gICAgICAgIFRhZ2Fsb2c6IFwiMTcwMC0xNzBDMTcwRS0xNzE0XCIsXHJcbiAgICAgICAgVGFnYmFud2E6IFwiMTc2MC0xNzZDMTc2RS0xNzcwMTc3MjE3NzNcIixcclxuICAgICAgICBUYWlfTGU6IFwiMTk1MC0xOTZEMTk3MC0xOTc0XCIsXHJcbiAgICAgICAgVGFpX1RoYW06IFwiMUEyMC0xQTVFMUE2MC0xQTdDMUE3Ri0xQTg5MUE5MC0xQTk5MUFBMC0xQUFEXCIsXHJcbiAgICAgICAgVGFpX1ZpZXQ6IFwiQUE4MC1BQUMyQUFEQi1BQURGXCIsXHJcbiAgICAgICAgVGFtaWw6IFwiMEI4MjBCODMwQjg1LTBCOEEwQjhFLTBCOTAwQjkyLTBCOTUwQjk5MEI5QTBCOUMwQjlFMEI5RjBCQTMwQkE0MEJBOC0wQkFBMEJBRS0wQkI5MEJCRS0wQkMyMEJDNi0wQkM4MEJDQS0wQkNEMEJEMDBCRDcwQkU2LTBCRkFcIixcclxuICAgICAgICBUZWx1Z3U6IFwiMEMwMS0wQzAzMEMwNS0wQzBDMEMwRS0wQzEwMEMxMi0wQzI4MEMyQS0wQzMzMEMzNS0wQzM5MEMzRC0wQzQ0MEM0Ni0wQzQ4MEM0QS0wQzREMEM1NTBDNTYwQzU4MEM1OTBDNjAtMEM2MzBDNjYtMEM2RjBDNzgtMEM3RlwiLFxyXG4gICAgICAgIFRoYWFuYTogXCIwNzgwLTA3QjFcIixcclxuICAgICAgICBUaGFpOiBcIjBFMDEtMEUzQTBFNDAtMEU1QlwiLFxyXG4gICAgICAgIFRpYmV0YW46IFwiMEYwMC0wRjQ3MEY0OS0wRjZDMEY3MS0wRjk3MEY5OS0wRkJDMEZCRS0wRkNDMEZDRS0wRkQ0MEZEOTBGREFcIixcclxuICAgICAgICBUaWZpbmFnaDogXCIyRDMwLTJENjcyRDZGMkQ3MDJEN0ZcIixcclxuICAgICAgICBWYWk6IFwiQTUwMC1BNjJCXCIsXHJcbiAgICAgICAgWWk6IFwiQTAwMC1BNDhDQTQ5MC1BNEM2XCJcclxuICAgIH0pO1xyXG5cclxufShYUmVnRXhwKSk7XHJcblxyXG5cbi8qKioqKiB1bmljb2RlLWJsb2Nrcy5qcyAqKioqKi9cblxuLyohXHJcbiAqIFhSZWdFeHAgVW5pY29kZSBCbG9ja3MgdjEuMi4wXHJcbiAqIChjKSAyMDEwLTIwMTIgU3RldmVuIExldml0aGFuIDxodHRwOi8veHJlZ2V4cC5jb20vPlxyXG4gKiBNSVQgTGljZW5zZVxyXG4gKiBVc2VzIFVuaWNvZGUgNi4xIDxodHRwOi8vdW5pY29kZS5vcmcvPlxyXG4gKi9cclxuXHJcbi8qKlxyXG4gKiBBZGRzIHN1cHBvcnQgZm9yIGFsbCBVbmljb2RlIGJsb2NrcyBpbiB0aGUgQmFzaWMgTXVsdGlsaW5ndWFsIFBsYW5lIChVKzAwMDAtVStGRkZGKS4gVW5pY29kZVxyXG4gKiBibG9ja3MgdXNlIHRoZSBwcmVmaXggXCJJblwiLiBFLmcuLCBgXFxwe0luQmFzaWNMYXRpbn1gLiBUb2tlbiBuYW1lcyBhcmUgY2FzZSBpbnNlbnNpdGl2ZSwgYW5kIGFueVxyXG4gKiBzcGFjZXMsIGh5cGhlbnMsIGFuZCB1bmRlcnNjb3JlcyBhcmUgaWdub3JlZC5cclxuICogQHJlcXVpcmVzIFhSZWdFeHAsIFhSZWdFeHAgVW5pY29kZSBCYXNlXHJcbiAqL1xyXG4oZnVuY3Rpb24gKFhSZWdFeHApIHtcclxuICAgIFwidXNlIHN0cmljdFwiO1xyXG5cclxuICAgIGlmICghWFJlZ0V4cC5hZGRVbmljb2RlUGFja2FnZSkge1xyXG4gICAgICAgIHRocm93IG5ldyBSZWZlcmVuY2VFcnJvcihcIlVuaWNvZGUgQmFzZSBtdXN0IGJlIGxvYWRlZCBiZWZvcmUgVW5pY29kZSBCbG9ja3NcIik7XHJcbiAgICB9XHJcblxyXG4gICAgWFJlZ0V4cC5pbnN0YWxsKFwiZXh0ZW5zaWJpbGl0eVwiKTtcclxuXHJcbiAgICBYUmVnRXhwLmFkZFVuaWNvZGVQYWNrYWdlKHtcclxuICAgICAgICBJbkJhc2ljX0xhdGluOiBcIjAwMDAtMDA3RlwiLFxyXG4gICAgICAgIEluTGF0aW5fMV9TdXBwbGVtZW50OiBcIjAwODAtMDBGRlwiLFxyXG4gICAgICAgIEluTGF0aW5fRXh0ZW5kZWRfQTogXCIwMTAwLTAxN0ZcIixcclxuICAgICAgICBJbkxhdGluX0V4dGVuZGVkX0I6IFwiMDE4MC0wMjRGXCIsXHJcbiAgICAgICAgSW5JUEFfRXh0ZW5zaW9uczogXCIwMjUwLTAyQUZcIixcclxuICAgICAgICBJblNwYWNpbmdfTW9kaWZpZXJfTGV0dGVyczogXCIwMkIwLTAyRkZcIixcclxuICAgICAgICBJbkNvbWJpbmluZ19EaWFjcml0aWNhbF9NYXJrczogXCIwMzAwLTAzNkZcIixcclxuICAgICAgICBJbkdyZWVrX2FuZF9Db3B0aWM6IFwiMDM3MC0wM0ZGXCIsXHJcbiAgICAgICAgSW5DeXJpbGxpYzogXCIwNDAwLTA0RkZcIixcclxuICAgICAgICBJbkN5cmlsbGljX1N1cHBsZW1lbnQ6IFwiMDUwMC0wNTJGXCIsXHJcbiAgICAgICAgSW5Bcm1lbmlhbjogXCIwNTMwLTA1OEZcIixcclxuICAgICAgICBJbkhlYnJldzogXCIwNTkwLTA1RkZcIixcclxuICAgICAgICBJbkFyYWJpYzogXCIwNjAwLTA2RkZcIixcclxuICAgICAgICBJblN5cmlhYzogXCIwNzAwLTA3NEZcIixcclxuICAgICAgICBJbkFyYWJpY19TdXBwbGVtZW50OiBcIjA3NTAtMDc3RlwiLFxyXG4gICAgICAgIEluVGhhYW5hOiBcIjA3ODAtMDdCRlwiLFxyXG4gICAgICAgIEluTktvOiBcIjA3QzAtMDdGRlwiLFxyXG4gICAgICAgIEluU2FtYXJpdGFuOiBcIjA4MDAtMDgzRlwiLFxyXG4gICAgICAgIEluTWFuZGFpYzogXCIwODQwLTA4NUZcIixcclxuICAgICAgICBJbkFyYWJpY19FeHRlbmRlZF9BOiBcIjA4QTAtMDhGRlwiLFxyXG4gICAgICAgIEluRGV2YW5hZ2FyaTogXCIwOTAwLTA5N0ZcIixcclxuICAgICAgICBJbkJlbmdhbGk6IFwiMDk4MC0wOUZGXCIsXHJcbiAgICAgICAgSW5HdXJtdWtoaTogXCIwQTAwLTBBN0ZcIixcclxuICAgICAgICBJbkd1amFyYXRpOiBcIjBBODAtMEFGRlwiLFxyXG4gICAgICAgIEluT3JpeWE6IFwiMEIwMC0wQjdGXCIsXHJcbiAgICAgICAgSW5UYW1pbDogXCIwQjgwLTBCRkZcIixcclxuICAgICAgICBJblRlbHVndTogXCIwQzAwLTBDN0ZcIixcclxuICAgICAgICBJbkthbm5hZGE6IFwiMEM4MC0wQ0ZGXCIsXHJcbiAgICAgICAgSW5NYWxheWFsYW06IFwiMEQwMC0wRDdGXCIsXHJcbiAgICAgICAgSW5TaW5oYWxhOiBcIjBEODAtMERGRlwiLFxyXG4gICAgICAgIEluVGhhaTogXCIwRTAwLTBFN0ZcIixcclxuICAgICAgICBJbkxhbzogXCIwRTgwLTBFRkZcIixcclxuICAgICAgICBJblRpYmV0YW46IFwiMEYwMC0wRkZGXCIsXHJcbiAgICAgICAgSW5NeWFubWFyOiBcIjEwMDAtMTA5RlwiLFxyXG4gICAgICAgIEluR2VvcmdpYW46IFwiMTBBMC0xMEZGXCIsXHJcbiAgICAgICAgSW5IYW5ndWxfSmFtbzogXCIxMTAwLTExRkZcIixcclxuICAgICAgICBJbkV0aGlvcGljOiBcIjEyMDAtMTM3RlwiLFxyXG4gICAgICAgIEluRXRoaW9waWNfU3VwcGxlbWVudDogXCIxMzgwLTEzOUZcIixcclxuICAgICAgICBJbkNoZXJva2VlOiBcIjEzQTAtMTNGRlwiLFxyXG4gICAgICAgIEluVW5pZmllZF9DYW5hZGlhbl9BYm9yaWdpbmFsX1N5bGxhYmljczogXCIxNDAwLTE2N0ZcIixcclxuICAgICAgICBJbk9naGFtOiBcIjE2ODAtMTY5RlwiLFxyXG4gICAgICAgIEluUnVuaWM6IFwiMTZBMC0xNkZGXCIsXHJcbiAgICAgICAgSW5UYWdhbG9nOiBcIjE3MDAtMTcxRlwiLFxyXG4gICAgICAgIEluSGFudW5vbzogXCIxNzIwLTE3M0ZcIixcclxuICAgICAgICBJbkJ1aGlkOiBcIjE3NDAtMTc1RlwiLFxyXG4gICAgICAgIEluVGFnYmFud2E6IFwiMTc2MC0xNzdGXCIsXHJcbiAgICAgICAgSW5LaG1lcjogXCIxNzgwLTE3RkZcIixcclxuICAgICAgICBJbk1vbmdvbGlhbjogXCIxODAwLTE4QUZcIixcclxuICAgICAgICBJblVuaWZpZWRfQ2FuYWRpYW5fQWJvcmlnaW5hbF9TeWxsYWJpY3NfRXh0ZW5kZWQ6IFwiMThCMC0xOEZGXCIsXHJcbiAgICAgICAgSW5MaW1idTogXCIxOTAwLTE5NEZcIixcclxuICAgICAgICBJblRhaV9MZTogXCIxOTUwLTE5N0ZcIixcclxuICAgICAgICBJbk5ld19UYWlfTHVlOiBcIjE5ODAtMTlERlwiLFxyXG4gICAgICAgIEluS2htZXJfU3ltYm9sczogXCIxOUUwLTE5RkZcIixcclxuICAgICAgICBJbkJ1Z2luZXNlOiBcIjFBMDAtMUExRlwiLFxyXG4gICAgICAgIEluVGFpX1RoYW06IFwiMUEyMC0xQUFGXCIsXHJcbiAgICAgICAgSW5CYWxpbmVzZTogXCIxQjAwLTFCN0ZcIixcclxuICAgICAgICBJblN1bmRhbmVzZTogXCIxQjgwLTFCQkZcIixcclxuICAgICAgICBJbkJhdGFrOiBcIjFCQzAtMUJGRlwiLFxyXG4gICAgICAgIEluTGVwY2hhOiBcIjFDMDAtMUM0RlwiLFxyXG4gICAgICAgIEluT2xfQ2hpa2k6IFwiMUM1MC0xQzdGXCIsXHJcbiAgICAgICAgSW5TdW5kYW5lc2VfU3VwcGxlbWVudDogXCIxQ0MwLTFDQ0ZcIixcclxuICAgICAgICBJblZlZGljX0V4dGVuc2lvbnM6IFwiMUNEMC0xQ0ZGXCIsXHJcbiAgICAgICAgSW5QaG9uZXRpY19FeHRlbnNpb25zOiBcIjFEMDAtMUQ3RlwiLFxyXG4gICAgICAgIEluUGhvbmV0aWNfRXh0ZW5zaW9uc19TdXBwbGVtZW50OiBcIjFEODAtMURCRlwiLFxyXG4gICAgICAgIEluQ29tYmluaW5nX0RpYWNyaXRpY2FsX01hcmtzX1N1cHBsZW1lbnQ6IFwiMURDMC0xREZGXCIsXHJcbiAgICAgICAgSW5MYXRpbl9FeHRlbmRlZF9BZGRpdGlvbmFsOiBcIjFFMDAtMUVGRlwiLFxyXG4gICAgICAgIEluR3JlZWtfRXh0ZW5kZWQ6IFwiMUYwMC0xRkZGXCIsXHJcbiAgICAgICAgSW5HZW5lcmFsX1B1bmN0dWF0aW9uOiBcIjIwMDAtMjA2RlwiLFxyXG4gICAgICAgIEluU3VwZXJzY3JpcHRzX2FuZF9TdWJzY3JpcHRzOiBcIjIwNzAtMjA5RlwiLFxyXG4gICAgICAgIEluQ3VycmVuY3lfU3ltYm9sczogXCIyMEEwLTIwQ0ZcIixcclxuICAgICAgICBJbkNvbWJpbmluZ19EaWFjcml0aWNhbF9NYXJrc19mb3JfU3ltYm9sczogXCIyMEQwLTIwRkZcIixcclxuICAgICAgICBJbkxldHRlcmxpa2VfU3ltYm9sczogXCIyMTAwLTIxNEZcIixcclxuICAgICAgICBJbk51bWJlcl9Gb3JtczogXCIyMTUwLTIxOEZcIixcclxuICAgICAgICBJbkFycm93czogXCIyMTkwLTIxRkZcIixcclxuICAgICAgICBJbk1hdGhlbWF0aWNhbF9PcGVyYXRvcnM6IFwiMjIwMC0yMkZGXCIsXHJcbiAgICAgICAgSW5NaXNjZWxsYW5lb3VzX1RlY2huaWNhbDogXCIyMzAwLTIzRkZcIixcclxuICAgICAgICBJbkNvbnRyb2xfUGljdHVyZXM6IFwiMjQwMC0yNDNGXCIsXHJcbiAgICAgICAgSW5PcHRpY2FsX0NoYXJhY3Rlcl9SZWNvZ25pdGlvbjogXCIyNDQwLTI0NUZcIixcclxuICAgICAgICBJbkVuY2xvc2VkX0FscGhhbnVtZXJpY3M6IFwiMjQ2MC0yNEZGXCIsXHJcbiAgICAgICAgSW5Cb3hfRHJhd2luZzogXCIyNTAwLTI1N0ZcIixcclxuICAgICAgICBJbkJsb2NrX0VsZW1lbnRzOiBcIjI1ODAtMjU5RlwiLFxyXG4gICAgICAgIEluR2VvbWV0cmljX1NoYXBlczogXCIyNUEwLTI1RkZcIixcclxuICAgICAgICBJbk1pc2NlbGxhbmVvdXNfU3ltYm9sczogXCIyNjAwLTI2RkZcIixcclxuICAgICAgICBJbkRpbmdiYXRzOiBcIjI3MDAtMjdCRlwiLFxyXG4gICAgICAgIEluTWlzY2VsbGFuZW91c19NYXRoZW1hdGljYWxfU3ltYm9sc19BOiBcIjI3QzAtMjdFRlwiLFxyXG4gICAgICAgIEluU3VwcGxlbWVudGFsX0Fycm93c19BOiBcIjI3RjAtMjdGRlwiLFxyXG4gICAgICAgIEluQnJhaWxsZV9QYXR0ZXJuczogXCIyODAwLTI4RkZcIixcclxuICAgICAgICBJblN1cHBsZW1lbnRhbF9BcnJvd3NfQjogXCIyOTAwLTI5N0ZcIixcclxuICAgICAgICBJbk1pc2NlbGxhbmVvdXNfTWF0aGVtYXRpY2FsX1N5bWJvbHNfQjogXCIyOTgwLTI5RkZcIixcclxuICAgICAgICBJblN1cHBsZW1lbnRhbF9NYXRoZW1hdGljYWxfT3BlcmF0b3JzOiBcIjJBMDAtMkFGRlwiLFxyXG4gICAgICAgIEluTWlzY2VsbGFuZW91c19TeW1ib2xzX2FuZF9BcnJvd3M6IFwiMkIwMC0yQkZGXCIsXHJcbiAgICAgICAgSW5HbGFnb2xpdGljOiBcIjJDMDAtMkM1RlwiLFxyXG4gICAgICAgIEluTGF0aW5fRXh0ZW5kZWRfQzogXCIyQzYwLTJDN0ZcIixcclxuICAgICAgICBJbkNvcHRpYzogXCIyQzgwLTJDRkZcIixcclxuICAgICAgICBJbkdlb3JnaWFuX1N1cHBsZW1lbnQ6IFwiMkQwMC0yRDJGXCIsXHJcbiAgICAgICAgSW5UaWZpbmFnaDogXCIyRDMwLTJEN0ZcIixcclxuICAgICAgICBJbkV0aGlvcGljX0V4dGVuZGVkOiBcIjJEODAtMkRERlwiLFxyXG4gICAgICAgIEluQ3lyaWxsaWNfRXh0ZW5kZWRfQTogXCIyREUwLTJERkZcIixcclxuICAgICAgICBJblN1cHBsZW1lbnRhbF9QdW5jdHVhdGlvbjogXCIyRTAwLTJFN0ZcIixcclxuICAgICAgICBJbkNKS19SYWRpY2Fsc19TdXBwbGVtZW50OiBcIjJFODAtMkVGRlwiLFxyXG4gICAgICAgIEluS2FuZ3hpX1JhZGljYWxzOiBcIjJGMDAtMkZERlwiLFxyXG4gICAgICAgIEluSWRlb2dyYXBoaWNfRGVzY3JpcHRpb25fQ2hhcmFjdGVyczogXCIyRkYwLTJGRkZcIixcclxuICAgICAgICBJbkNKS19TeW1ib2xzX2FuZF9QdW5jdHVhdGlvbjogXCIzMDAwLTMwM0ZcIixcclxuICAgICAgICBJbkhpcmFnYW5hOiBcIjMwNDAtMzA5RlwiLFxyXG4gICAgICAgIEluS2F0YWthbmE6IFwiMzBBMC0zMEZGXCIsXHJcbiAgICAgICAgSW5Cb3BvbW9mbzogXCIzMTAwLTMxMkZcIixcclxuICAgICAgICBJbkhhbmd1bF9Db21wYXRpYmlsaXR5X0phbW86IFwiMzEzMC0zMThGXCIsXHJcbiAgICAgICAgSW5LYW5idW46IFwiMzE5MC0zMTlGXCIsXHJcbiAgICAgICAgSW5Cb3BvbW9mb19FeHRlbmRlZDogXCIzMUEwLTMxQkZcIixcclxuICAgICAgICBJbkNKS19TdHJva2VzOiBcIjMxQzAtMzFFRlwiLFxyXG4gICAgICAgIEluS2F0YWthbmFfUGhvbmV0aWNfRXh0ZW5zaW9uczogXCIzMUYwLTMxRkZcIixcclxuICAgICAgICBJbkVuY2xvc2VkX0NKS19MZXR0ZXJzX2FuZF9Nb250aHM6IFwiMzIwMC0zMkZGXCIsXHJcbiAgICAgICAgSW5DSktfQ29tcGF0aWJpbGl0eTogXCIzMzAwLTMzRkZcIixcclxuICAgICAgICBJbkNKS19VbmlmaWVkX0lkZW9ncmFwaHNfRXh0ZW5zaW9uX0E6IFwiMzQwMC00REJGXCIsXHJcbiAgICAgICAgSW5ZaWppbmdfSGV4YWdyYW1fU3ltYm9sczogXCI0REMwLTRERkZcIixcclxuICAgICAgICBJbkNKS19VbmlmaWVkX0lkZW9ncmFwaHM6IFwiNEUwMC05RkZGXCIsXHJcbiAgICAgICAgSW5ZaV9TeWxsYWJsZXM6IFwiQTAwMC1BNDhGXCIsXHJcbiAgICAgICAgSW5ZaV9SYWRpY2FsczogXCJBNDkwLUE0Q0ZcIixcclxuICAgICAgICBJbkxpc3U6IFwiQTREMC1BNEZGXCIsXHJcbiAgICAgICAgSW5WYWk6IFwiQTUwMC1BNjNGXCIsXHJcbiAgICAgICAgSW5DeXJpbGxpY19FeHRlbmRlZF9COiBcIkE2NDAtQTY5RlwiLFxyXG4gICAgICAgIEluQmFtdW06IFwiQTZBMC1BNkZGXCIsXHJcbiAgICAgICAgSW5Nb2RpZmllcl9Ub25lX0xldHRlcnM6IFwiQTcwMC1BNzFGXCIsXHJcbiAgICAgICAgSW5MYXRpbl9FeHRlbmRlZF9EOiBcIkE3MjAtQTdGRlwiLFxyXG4gICAgICAgIEluU3lsb3RpX05hZ3JpOiBcIkE4MDAtQTgyRlwiLFxyXG4gICAgICAgIEluQ29tbW9uX0luZGljX051bWJlcl9Gb3JtczogXCJBODMwLUE4M0ZcIixcclxuICAgICAgICBJblBoYWdzX3BhOiBcIkE4NDAtQTg3RlwiLFxyXG4gICAgICAgIEluU2F1cmFzaHRyYTogXCJBODgwLUE4REZcIixcclxuICAgICAgICBJbkRldmFuYWdhcmlfRXh0ZW5kZWQ6IFwiQThFMC1BOEZGXCIsXHJcbiAgICAgICAgSW5LYXlhaF9MaTogXCJBOTAwLUE5MkZcIixcclxuICAgICAgICBJblJlamFuZzogXCJBOTMwLUE5NUZcIixcclxuICAgICAgICBJbkhhbmd1bF9KYW1vX0V4dGVuZGVkX0E6IFwiQTk2MC1BOTdGXCIsXHJcbiAgICAgICAgSW5KYXZhbmVzZTogXCJBOTgwLUE5REZcIixcclxuICAgICAgICBJbkNoYW06IFwiQUEwMC1BQTVGXCIsXHJcbiAgICAgICAgSW5NeWFubWFyX0V4dGVuZGVkX0E6IFwiQUE2MC1BQTdGXCIsXHJcbiAgICAgICAgSW5UYWlfVmlldDogXCJBQTgwLUFBREZcIixcclxuICAgICAgICBJbk1lZXRlaV9NYXlla19FeHRlbnNpb25zOiBcIkFBRTAtQUFGRlwiLFxyXG4gICAgICAgIEluRXRoaW9waWNfRXh0ZW5kZWRfQTogXCJBQjAwLUFCMkZcIixcclxuICAgICAgICBJbk1lZXRlaV9NYXllazogXCJBQkMwLUFCRkZcIixcclxuICAgICAgICBJbkhhbmd1bF9TeWxsYWJsZXM6IFwiQUMwMC1EN0FGXCIsXHJcbiAgICAgICAgSW5IYW5ndWxfSmFtb19FeHRlbmRlZF9COiBcIkQ3QjAtRDdGRlwiLFxyXG4gICAgICAgIEluSGlnaF9TdXJyb2dhdGVzOiBcIkQ4MDAtREI3RlwiLFxyXG4gICAgICAgIEluSGlnaF9Qcml2YXRlX1VzZV9TdXJyb2dhdGVzOiBcIkRCODAtREJGRlwiLFxyXG4gICAgICAgIEluTG93X1N1cnJvZ2F0ZXM6IFwiREMwMC1ERkZGXCIsXHJcbiAgICAgICAgSW5Qcml2YXRlX1VzZV9BcmVhOiBcIkUwMDAtRjhGRlwiLFxyXG4gICAgICAgIEluQ0pLX0NvbXBhdGliaWxpdHlfSWRlb2dyYXBoczogXCJGOTAwLUZBRkZcIixcclxuICAgICAgICBJbkFscGhhYmV0aWNfUHJlc2VudGF0aW9uX0Zvcm1zOiBcIkZCMDAtRkI0RlwiLFxyXG4gICAgICAgIEluQXJhYmljX1ByZXNlbnRhdGlvbl9Gb3Jtc19BOiBcIkZCNTAtRkRGRlwiLFxyXG4gICAgICAgIEluVmFyaWF0aW9uX1NlbGVjdG9yczogXCJGRTAwLUZFMEZcIixcclxuICAgICAgICBJblZlcnRpY2FsX0Zvcm1zOiBcIkZFMTAtRkUxRlwiLFxyXG4gICAgICAgIEluQ29tYmluaW5nX0hhbGZfTWFya3M6IFwiRkUyMC1GRTJGXCIsXHJcbiAgICAgICAgSW5DSktfQ29tcGF0aWJpbGl0eV9Gb3JtczogXCJGRTMwLUZFNEZcIixcclxuICAgICAgICBJblNtYWxsX0Zvcm1fVmFyaWFudHM6IFwiRkU1MC1GRTZGXCIsXHJcbiAgICAgICAgSW5BcmFiaWNfUHJlc2VudGF0aW9uX0Zvcm1zX0I6IFwiRkU3MC1GRUZGXCIsXHJcbiAgICAgICAgSW5IYWxmd2lkdGhfYW5kX0Z1bGx3aWR0aF9Gb3JtczogXCJGRjAwLUZGRUZcIixcclxuICAgICAgICBJblNwZWNpYWxzOiBcIkZGRjAtRkZGRlwiXHJcbiAgICB9KTtcclxuXHJcbn0oWFJlZ0V4cCkpO1xyXG5cclxuXG4vKioqKiogdW5pY29kZS1wcm9wZXJ0aWVzLmpzICoqKioqL1xuXG4vKiFcclxuICogWFJlZ0V4cCBVbmljb2RlIFByb3BlcnRpZXMgdjEuMC4wXHJcbiAqIChjKSAyMDEyIFN0ZXZlbiBMZXZpdGhhbiA8aHR0cDovL3hyZWdleHAuY29tLz5cclxuICogTUlUIExpY2Vuc2VcclxuICogVXNlcyBVbmljb2RlIDYuMSA8aHR0cDovL3VuaWNvZGUub3JnLz5cclxuICovXHJcblxyXG4vKipcclxuICogQWRkcyBVbmljb2RlIHByb3BlcnRpZXMgbmVjZXNzYXJ5IHRvIG1lZXQgTGV2ZWwgMSBVbmljb2RlIHN1cHBvcnQgKGRldGFpbGVkIGluIFVUUyMxOCBSTDEuMikuXHJcbiAqIEluY2x1ZGVzIGNvZGUgcG9pbnRzIGZyb20gdGhlIEJhc2ljIE11bHRpbGluZ3VhbCBQbGFuZSAoVSswMDAwLVUrRkZGRikgb25seS4gVG9rZW4gbmFtZXMgYXJlXHJcbiAqIGNhc2UgaW5zZW5zaXRpdmUsIGFuZCBhbnkgc3BhY2VzLCBoeXBoZW5zLCBhbmQgdW5kZXJzY29yZXMgYXJlIGlnbm9yZWQuXHJcbiAqIEByZXF1aXJlcyBYUmVnRXhwLCBYUmVnRXhwIFVuaWNvZGUgQmFzZVxyXG4gKi9cclxuKGZ1bmN0aW9uIChYUmVnRXhwKSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICBpZiAoIVhSZWdFeHAuYWRkVW5pY29kZVBhY2thZ2UpIHtcclxuICAgICAgICB0aHJvdyBuZXcgUmVmZXJlbmNlRXJyb3IoXCJVbmljb2RlIEJhc2UgbXVzdCBiZSBsb2FkZWQgYmVmb3JlIFVuaWNvZGUgUHJvcGVydGllc1wiKTtcclxuICAgIH1cclxuXHJcbiAgICBYUmVnRXhwLmluc3RhbGwoXCJleHRlbnNpYmlsaXR5XCIpO1xyXG5cclxuICAgIFhSZWdFeHAuYWRkVW5pY29kZVBhY2thZ2Uoe1xyXG4gICAgICAgIEFscGhhYmV0aWM6IFwiMDA0MS0wMDVBMDA2MS0wMDdBMDBBQTAwQjUwMEJBMDBDMC0wMEQ2MDBEOC0wMEY2MDBGOC0wMkMxMDJDNi0wMkQxMDJFMC0wMkU0MDJFQzAyRUUwMzQ1MDM3MC0wMzc0MDM3NjAzNzcwMzdBLTAzN0QwMzg2MDM4OC0wMzhBMDM4QzAzOEUtMDNBMTAzQTMtMDNGNTAzRjctMDQ4MTA0OEEtMDUyNzA1MzEtMDU1NjA1NTkwNTYxLTA1ODcwNUIwLTA1QkQwNUJGMDVDMTA1QzIwNUM0MDVDNTA1QzcwNUQwLTA1RUEwNUYwLTA1RjIwNjEwLTA2MUEwNjIwLTA2NTcwNjU5LTA2NUYwNjZFLTA2RDMwNkQ1LTA2REMwNkUxLTA2RTgwNkVELTA2RUYwNkZBLTA2RkMwNkZGMDcxMC0wNzNGMDc0RC0wN0IxMDdDQS0wN0VBMDdGNDA3RjUwN0ZBMDgwMC0wODE3MDgxQS0wODJDMDg0MC0wODU4MDhBMDA4QTItMDhBQzA4RTQtMDhFOTA4RjAtMDhGRTA5MDAtMDkzQjA5M0QtMDk0QzA5NEUtMDk1MDA5NTUtMDk2MzA5NzEtMDk3NzA5NzktMDk3RjA5ODEtMDk4MzA5ODUtMDk4QzA5OEYwOTkwMDk5My0wOUE4MDlBQS0wOUIwMDlCMjA5QjYtMDlCOTA5QkQtMDlDNDA5QzcwOUM4MDlDQjA5Q0MwOUNFMDlENzA5REMwOUREMDlERi0wOUUzMDlGMDA5RjEwQTAxLTBBMDMwQTA1LTBBMEEwQTBGMEExMDBBMTMtMEEyODBBMkEtMEEzMDBBMzIwQTMzMEEzNTBBMzYwQTM4MEEzOTBBM0UtMEE0MjBBNDcwQTQ4MEE0QjBBNEMwQTUxMEE1OS0wQTVDMEE1RTBBNzAtMEE3NTBBODEtMEE4MzBBODUtMEE4RDBBOEYtMEE5MTBBOTMtMEFBODBBQUEtMEFCMDBBQjIwQUIzMEFCNS0wQUI5MEFCRC0wQUM1MEFDNy0wQUM5MEFDQjBBQ0MwQUQwMEFFMC0wQUUzMEIwMS0wQjAzMEIwNS0wQjBDMEIwRjBCMTAwQjEzLTBCMjgwQjJBLTBCMzAwQjMyMEIzMzBCMzUtMEIzOTBCM0QtMEI0NDBCNDcwQjQ4MEI0QjBCNEMwQjU2MEI1NzBCNUMwQjVEMEI1Ri0wQjYzMEI3MTBCODIwQjgzMEI4NS0wQjhBMEI4RS0wQjkwMEI5Mi0wQjk1MEI5OTBCOUEwQjlDMEI5RTBCOUYwQkEzMEJBNDBCQTgtMEJBQTBCQUUtMEJCOTBCQkUtMEJDMjBCQzYtMEJDODBCQ0EtMEJDQzBCRDAwQkQ3MEMwMS0wQzAzMEMwNS0wQzBDMEMwRS0wQzEwMEMxMi0wQzI4MEMyQS0wQzMzMEMzNS0wQzM5MEMzRC0wQzQ0MEM0Ni0wQzQ4MEM0QS0wQzRDMEM1NTBDNTYwQzU4MEM1OTBDNjAtMEM2MzBDODIwQzgzMEM4NS0wQzhDMEM4RS0wQzkwMEM5Mi0wQ0E4MENBQS0wQ0IzMENCNS0wQ0I5MENCRC0wQ0M0MENDNi0wQ0M4MENDQS0wQ0NDMENENTBDRDYwQ0RFMENFMC0wQ0UzMENGMTBDRjIwRDAyMEQwMzBEMDUtMEQwQzBEMEUtMEQxMDBEMTItMEQzQTBEM0QtMEQ0NDBENDYtMEQ0ODBENEEtMEQ0QzBENEUwRDU3MEQ2MC0wRDYzMEQ3QS0wRDdGMEQ4MjBEODMwRDg1LTBEOTYwRDlBLTBEQjEwREIzLTBEQkIwREJEMERDMC0wREM2MERDRi0wREQ0MERENjBERDgtMERERjBERjIwREYzMEUwMS0wRTNBMEU0MC0wRTQ2MEU0RDBFODEwRTgyMEU4NDBFODcwRTg4MEU4QTBFOEQwRTk0LTBFOTcwRTk5LTBFOUYwRUExLTBFQTMwRUE1MEVBNzBFQUEwRUFCMEVBRC0wRUI5MEVCQi0wRUJEMEVDMC0wRUM0MEVDNjBFQ0QwRURDLTBFREYwRjAwMEY0MC0wRjQ3MEY0OS0wRjZDMEY3MS0wRjgxMEY4OC0wRjk3MEY5OS0wRkJDMTAwMC0xMDM2MTAzODEwM0ItMTAzRjEwNTAtMTA2MjEwNjUtMTA2ODEwNkUtMTA4NjEwOEUxMDlDMTA5RDEwQTAtMTBDNTEwQzcxMENEMTBEMC0xMEZBMTBGQy0xMjQ4MTI0QS0xMjREMTI1MC0xMjU2MTI1ODEyNUEtMTI1RDEyNjAtMTI4ODEyOEEtMTI4RDEyOTAtMTJCMDEyQjItMTJCNTEyQjgtMTJCRTEyQzAxMkMyLTEyQzUxMkM4LTEyRDYxMkQ4LTEzMTAxMzEyLTEzMTUxMzE4LTEzNUExMzVGMTM4MC0xMzhGMTNBMC0xM0Y0MTQwMS0xNjZDMTY2Ri0xNjdGMTY4MS0xNjlBMTZBMC0xNkVBMTZFRS0xNkYwMTcwMC0xNzBDMTcwRS0xNzEzMTcyMC0xNzMzMTc0MC0xNzUzMTc2MC0xNzZDMTc2RS0xNzcwMTc3MjE3NzMxNzgwLTE3QjMxN0I2LTE3QzgxN0Q3MTdEQzE4MjAtMTg3NzE4ODAtMThBQTE4QjAtMThGNTE5MDAtMTkxQzE5MjAtMTkyQjE5MzAtMTkzODE5NTAtMTk2RDE5NzAtMTk3NDE5ODAtMTlBQjE5QjAtMTlDOTFBMDAtMUExQjFBMjAtMUE1RTFBNjEtMUE3NDFBQTcxQjAwLTFCMzMxQjM1LTFCNDMxQjQ1LTFCNEIxQjgwLTFCQTkxQkFDLTFCQUYxQkJBLTFCRTUxQkU3LTFCRjExQzAwLTFDMzUxQzRELTFDNEYxQzVBLTFDN0QxQ0U5LTFDRUMxQ0VFLTFDRjMxQ0Y1MUNGNjFEMDAtMURCRjFFMDAtMUYxNTFGMTgtMUYxRDFGMjAtMUY0NTFGNDgtMUY0RDFGNTAtMUY1NzFGNTkxRjVCMUY1RDFGNUYtMUY3RDFGODAtMUZCNDFGQjYtMUZCQzFGQkUxRkMyLTFGQzQxRkM2LTFGQ0MxRkQwLTFGRDMxRkQ2LTFGREIxRkUwLTFGRUMxRkYyLTFGRjQxRkY2LTFGRkMyMDcxMjA3RjIwOTAtMjA5QzIxMDIyMTA3MjEwQS0yMTEzMjExNTIxMTktMjExRDIxMjQyMTI2MjEyODIxMkEtMjEyRDIxMkYtMjEzOTIxM0MtMjEzRjIxNDUtMjE0OTIxNEUyMTYwLTIxODgyNEI2LTI0RTkyQzAwLTJDMkUyQzMwLTJDNUUyQzYwLTJDRTQyQ0VCLTJDRUUyQ0YyMkNGMzJEMDAtMkQyNTJEMjcyRDJEMkQzMC0yRDY3MkQ2RjJEODAtMkQ5NjJEQTAtMkRBNjJEQTgtMkRBRTJEQjAtMkRCNjJEQjgtMkRCRTJEQzAtMkRDNjJEQzgtMkRDRTJERDAtMkRENjJERDgtMkRERTJERTAtMkRGRjJFMkYzMDA1LTMwMDczMDIxLTMwMjkzMDMxLTMwMzUzMDM4LTMwM0MzMDQxLTMwOTYzMDlELTMwOUYzMEExLTMwRkEzMEZDLTMwRkYzMTA1LTMxMkQzMTMxLTMxOEUzMUEwLTMxQkEzMUYwLTMxRkYzNDAwLTREQjU0RTAwLTlGQ0NBMDAwLUE0OENBNEQwLUE0RkRBNTAwLUE2MENBNjEwLUE2MUZBNjJBQTYyQkE2NDAtQTY2RUE2NzQtQTY3QkE2N0YtQTY5N0E2OUYtQTZFRkE3MTctQTcxRkE3MjItQTc4OEE3OEItQTc4RUE3OTAtQTc5M0E3QTAtQTdBQUE3RjgtQTgwMUE4MDMtQTgwNUE4MDctQTgwQUE4MEMtQTgyN0E4NDAtQTg3M0E4ODAtQThDM0E4RjItQThGN0E4RkJBOTBBLUE5MkFBOTMwLUE5NTJBOTYwLUE5N0NBOTgwLUE5QjJBOUI0LUE5QkZBOUNGQUEwMC1BQTM2QUE0MC1BQTREQUE2MC1BQTc2QUE3QUFBODAtQUFCRUFBQzBBQUMyQUFEQi1BQUREQUFFMC1BQUVGQUFGMi1BQUY1QUIwMS1BQjA2QUIwOS1BQjBFQUIxMS1BQjE2QUIyMC1BQjI2QUIyOC1BQjJFQUJDMC1BQkVBQUMwMC1EN0EzRDdCMC1EN0M2RDdDQi1EN0ZCRjkwMC1GQTZERkE3MC1GQUQ5RkIwMC1GQjA2RkIxMy1GQjE3RkIxRC1GQjI4RkIyQS1GQjM2RkIzOC1GQjNDRkIzRUZCNDBGQjQxRkI0M0ZCNDRGQjQ2LUZCQjFGQkQzLUZEM0RGRDUwLUZEOEZGRDkyLUZEQzdGREYwLUZERkJGRTcwLUZFNzRGRTc2LUZFRkNGRjIxLUZGM0FGRjQxLUZGNUFGRjY2LUZGQkVGRkMyLUZGQzdGRkNBLUZGQ0ZGRkQyLUZGRDdGRkRBLUZGRENcIixcclxuICAgICAgICBVcHBlcmNhc2U6IFwiMDA0MS0wMDVBMDBDMC0wMEQ2MDBEOC0wMERFMDEwMDAxMDIwMTA0MDEwNjAxMDgwMTBBMDEwQzAxMEUwMTEwMDExMjAxMTQwMTE2MDExODAxMUEwMTFDMDExRTAxMjAwMTIyMDEyNDAxMjYwMTI4MDEyQTAxMkMwMTJFMDEzMDAxMzIwMTM0MDEzNjAxMzkwMTNCMDEzRDAxM0YwMTQxMDE0MzAxNDUwMTQ3MDE0QTAxNEMwMTRFMDE1MDAxNTIwMTU0MDE1NjAxNTgwMTVBMDE1QzAxNUUwMTYwMDE2MjAxNjQwMTY2MDE2ODAxNkEwMTZDMDE2RTAxNzAwMTcyMDE3NDAxNzYwMTc4MDE3OTAxN0IwMTdEMDE4MTAxODIwMTg0MDE4NjAxODcwMTg5LTAxOEIwMThFLTAxOTEwMTkzMDE5NDAxOTYtMDE5ODAxOUMwMTlEMDE5RjAxQTAwMUEyMDFBNDAxQTYwMUE3MDFBOTAxQUMwMUFFMDFBRjAxQjEtMDFCMzAxQjUwMUI3MDFCODAxQkMwMUM0MDFDNzAxQ0EwMUNEMDFDRjAxRDEwMUQzMDFENTAxRDcwMUQ5MDFEQjAxREUwMUUwMDFFMjAxRTQwMUU2MDFFODAxRUEwMUVDMDFFRTAxRjEwMUY0MDFGNi0wMUY4MDFGQTAxRkMwMUZFMDIwMDAyMDIwMjA0MDIwNjAyMDgwMjBBMDIwQzAyMEUwMjEwMDIxMjAyMTQwMjE2MDIxODAyMUEwMjFDMDIxRTAyMjAwMjIyMDIyNDAyMjYwMjI4MDIyQTAyMkMwMjJFMDIzMDAyMzIwMjNBMDIzQjAyM0QwMjNFMDI0MTAyNDMtMDI0NjAyNDgwMjRBMDI0QzAyNEUwMzcwMDM3MjAzNzYwMzg2MDM4OC0wMzhBMDM4QzAzOEUwMzhGMDM5MS0wM0ExMDNBMy0wM0FCMDNDRjAzRDItMDNENDAzRDgwM0RBMDNEQzAzREUwM0UwMDNFMjAzRTQwM0U2MDNFODAzRUEwM0VDMDNFRTAzRjQwM0Y3MDNGOTAzRkEwM0ZELTA0MkYwNDYwMDQ2MjA0NjQwNDY2MDQ2ODA0NkEwNDZDMDQ2RTA0NzAwNDcyMDQ3NDA0NzYwNDc4MDQ3QTA0N0MwNDdFMDQ4MDA0OEEwNDhDMDQ4RTA0OTAwNDkyMDQ5NDA0OTYwNDk4MDQ5QTA0OUMwNDlFMDRBMDA0QTIwNEE0MDRBNjA0QTgwNEFBMDRBQzA0QUUwNEIwMDRCMjA0QjQwNEI2MDRCODA0QkEwNEJDMDRCRTA0QzAwNEMxMDRDMzA0QzUwNEM3MDRDOTA0Q0IwNENEMDREMDA0RDIwNEQ0MDRENjA0RDgwNERBMDREQzA0REUwNEUwMDRFMjA0RTQwNEU2MDRFODA0RUEwNEVDMDRFRTA0RjAwNEYyMDRGNDA0RjYwNEY4MDRGQTA0RkMwNEZFMDUwMDA1MDIwNTA0MDUwNjA1MDgwNTBBMDUwQzA1MEUwNTEwMDUxMjA1MTQwNTE2MDUxODA1MUEwNTFDMDUxRTA1MjAwNTIyMDUyNDA1MjYwNTMxLTA1NTYxMEEwLTEwQzUxMEM3MTBDRDFFMDAxRTAyMUUwNDFFMDYxRTA4MUUwQTFFMEMxRTBFMUUxMDFFMTIxRTE0MUUxNjFFMTgxRTFBMUUxQzFFMUUxRTIwMUUyMjFFMjQxRTI2MUUyODFFMkExRTJDMUUyRTFFMzAxRTMyMUUzNDFFMzYxRTM4MUUzQTFFM0MxRTNFMUU0MDFFNDIxRTQ0MUU0NjFFNDgxRTRBMUU0QzFFNEUxRTUwMUU1MjFFNTQxRTU2MUU1ODFFNUExRTVDMUU1RTFFNjAxRTYyMUU2NDFFNjYxRTY4MUU2QTFFNkMxRTZFMUU3MDFFNzIxRTc0MUU3NjFFNzgxRTdBMUU3QzFFN0UxRTgwMUU4MjFFODQxRTg2MUU4ODFFOEExRThDMUU4RTFFOTAxRTkyMUU5NDFFOUUxRUEwMUVBMjFFQTQxRUE2MUVBODFFQUExRUFDMUVBRTFFQjAxRUIyMUVCNDFFQjYxRUI4MUVCQTFFQkMxRUJFMUVDMDFFQzIxRUM0MUVDNjFFQzgxRUNBMUVDQzFFQ0UxRUQwMUVEMjFFRDQxRUQ2MUVEODFFREExRURDMUVERTFFRTAxRUUyMUVFNDFFRTYxRUU4MUVFQTFFRUMxRUVFMUVGMDFFRjIxRUY0MUVGNjFFRjgxRUZBMUVGQzFFRkUxRjA4LTFGMEYxRjE4LTFGMUQxRjI4LTFGMkYxRjM4LTFGM0YxRjQ4LTFGNEQxRjU5MUY1QjFGNUQxRjVGMUY2OC0xRjZGMUZCOC0xRkJCMUZDOC0xRkNCMUZEOC0xRkRCMUZFOC0xRkVDMUZGOC0xRkZCMjEwMjIxMDcyMTBCLTIxMEQyMTEwLTIxMTIyMTE1MjExOS0yMTFEMjEyNDIxMjYyMTI4MjEyQS0yMTJEMjEzMC0yMTMzMjEzRTIxM0YyMTQ1MjE2MC0yMTZGMjE4MzI0QjYtMjRDRjJDMDAtMkMyRTJDNjAyQzYyLTJDNjQyQzY3MkM2OTJDNkIyQzZELTJDNzAyQzcyMkM3NTJDN0UtMkM4MDJDODIyQzg0MkM4NjJDODgyQzhBMkM4QzJDOEUyQzkwMkM5MjJDOTQyQzk2MkM5ODJDOUEyQzlDMkM5RTJDQTAyQ0EyMkNBNDJDQTYyQ0E4MkNBQTJDQUMyQ0FFMkNCMDJDQjIyQ0I0MkNCNjJDQjgyQ0JBMkNCQzJDQkUyQ0MwMkNDMjJDQzQyQ0M2MkNDODJDQ0EyQ0NDMkNDRTJDRDAyQ0QyMkNENDJDRDYyQ0Q4MkNEQTJDREMyQ0RFMkNFMDJDRTIyQ0VCMkNFRDJDRjJBNjQwQTY0MkE2NDRBNjQ2QTY0OEE2NEFBNjRDQTY0RUE2NTBBNjUyQTY1NEE2NTZBNjU4QTY1QUE2NUNBNjVFQTY2MEE2NjJBNjY0QTY2NkE2NjhBNjZBQTY2Q0E2ODBBNjgyQTY4NEE2ODZBNjg4QTY4QUE2OENBNjhFQTY5MEE2OTJBNjk0QTY5NkE3MjJBNzI0QTcyNkE3MjhBNzJBQTcyQ0E3MkVBNzMyQTczNEE3MzZBNzM4QTczQUE3M0NBNzNFQTc0MEE3NDJBNzQ0QTc0NkE3NDhBNzRBQTc0Q0E3NEVBNzUwQTc1MkE3NTRBNzU2QTc1OEE3NUFBNzVDQTc1RUE3NjBBNzYyQTc2NEE3NjZBNzY4QTc2QUE3NkNBNzZFQTc3OUE3N0JBNzdEQTc3RUE3ODBBNzgyQTc4NEE3ODZBNzhCQTc4REE3OTBBNzkyQTdBMEE3QTJBN0E0QTdBNkE3QThBN0FBRkYyMS1GRjNBXCIsXHJcbiAgICAgICAgTG93ZXJjYXNlOiBcIjAwNjEtMDA3QTAwQUEwMEI1MDBCQTAwREYtMDBGNjAwRjgtMDBGRjAxMDEwMTAzMDEwNTAxMDcwMTA5MDEwQjAxMEQwMTBGMDExMTAxMTMwMTE1MDExNzAxMTkwMTFCMDExRDAxMUYwMTIxMDEyMzAxMjUwMTI3MDEyOTAxMkIwMTJEMDEyRjAxMzEwMTMzMDEzNTAxMzcwMTM4MDEzQTAxM0MwMTNFMDE0MDAxNDIwMTQ0MDE0NjAxNDgwMTQ5MDE0QjAxNEQwMTRGMDE1MTAxNTMwMTU1MDE1NzAxNTkwMTVCMDE1RDAxNUYwMTYxMDE2MzAxNjUwMTY3MDE2OTAxNkIwMTZEMDE2RjAxNzEwMTczMDE3NTAxNzcwMTdBMDE3QzAxN0UtMDE4MDAxODMwMTg1MDE4ODAxOEMwMThEMDE5MjAxOTUwMTk5LTAxOUIwMTlFMDFBMTAxQTMwMUE1MDFBODAxQUEwMUFCMDFBRDAxQjAwMUI0MDFCNjAxQjkwMUJBMDFCRC0wMUJGMDFDNjAxQzkwMUNDMDFDRTAxRDAwMUQyMDFENDAxRDYwMUQ4MDFEQTAxREMwMUREMDFERjAxRTEwMUUzMDFFNTAxRTcwMUU5MDFFQjAxRUQwMUVGMDFGMDAxRjMwMUY1MDFGOTAxRkIwMUZEMDFGRjAyMDEwMjAzMDIwNTAyMDcwMjA5MDIwQjAyMEQwMjBGMDIxMTAyMTMwMjE1MDIxNzAyMTkwMjFCMDIxRDAyMUYwMjIxMDIyMzAyMjUwMjI3MDIyOTAyMkIwMjJEMDIyRjAyMzEwMjMzLTAyMzkwMjNDMDIzRjAyNDAwMjQyMDI0NzAyNDkwMjRCMDI0RDAyNEYtMDI5MzAyOTUtMDJCODAyQzAwMkMxMDJFMC0wMkU0MDM0NTAzNzEwMzczMDM3NzAzN0EtMDM3RDAzOTAwM0FDLTAzQ0UwM0QwMDNEMTAzRDUtMDNENzAzRDkwM0RCMDNERDAzREYwM0UxMDNFMzAzRTUwM0U3MDNFOTAzRUIwM0VEMDNFRi0wM0YzMDNGNTAzRjgwM0ZCMDNGQzA0MzAtMDQ1RjA0NjEwNDYzMDQ2NTA0NjcwNDY5MDQ2QjA0NkQwNDZGMDQ3MTA0NzMwNDc1MDQ3NzA0NzkwNDdCMDQ3RDA0N0YwNDgxMDQ4QjA0OEQwNDhGMDQ5MTA0OTMwNDk1MDQ5NzA0OTkwNDlCMDQ5RDA0OUYwNEExMDRBMzA0QTUwNEE3MDRBOTA0QUIwNEFEMDRBRjA0QjEwNEIzMDRCNTA0QjcwNEI5MDRCQjA0QkQwNEJGMDRDMjA0QzQwNEM2MDRDODA0Q0EwNENDMDRDRTA0Q0YwNEQxMDREMzA0RDUwNEQ3MDREOTA0REIwNEREMDRERjA0RTEwNEUzMDRFNTA0RTcwNEU5MDRFQjA0RUQwNEVGMDRGMTA0RjMwNEY1MDRGNzA0RjkwNEZCMDRGRDA0RkYwNTAxMDUwMzA1MDUwNTA3MDUwOTA1MEIwNTBEMDUwRjA1MTEwNTEzMDUxNTA1MTcwNTE5MDUxQjA1MUQwNTFGMDUyMTA1MjMwNTI1MDUyNzA1NjEtMDU4NzFEMDAtMURCRjFFMDExRTAzMUUwNTFFMDcxRTA5MUUwQjFFMEQxRTBGMUUxMTFFMTMxRTE1MUUxNzFFMTkxRTFCMUUxRDFFMUYxRTIxMUUyMzFFMjUxRTI3MUUyOTFFMkIxRTJEMUUyRjFFMzExRTMzMUUzNTFFMzcxRTM5MUUzQjFFM0QxRTNGMUU0MTFFNDMxRTQ1MUU0NzFFNDkxRTRCMUU0RDFFNEYxRTUxMUU1MzFFNTUxRTU3MUU1OTFFNUIxRTVEMUU1RjFFNjExRTYzMUU2NTFFNjcxRTY5MUU2QjFFNkQxRTZGMUU3MTFFNzMxRTc1MUU3NzFFNzkxRTdCMUU3RDFFN0YxRTgxMUU4MzFFODUxRTg3MUU4OTFFOEIxRThEMUU4RjFFOTExRTkzMUU5NS0xRTlEMUU5RjFFQTExRUEzMUVBNTFFQTcxRUE5MUVBQjFFQUQxRUFGMUVCMTFFQjMxRUI1MUVCNzFFQjkxRUJCMUVCRDFFQkYxRUMxMUVDMzFFQzUxRUM3MUVDOTFFQ0IxRUNEMUVDRjFFRDExRUQzMUVENTFFRDcxRUQ5MUVEQjFFREQxRURGMUVFMTFFRTMxRUU1MUVFNzFFRTkxRUVCMUVFRDFFRUYxRUYxMUVGMzFFRjUxRUY3MUVGOTFFRkIxRUZEMUVGRi0xRjA3MUYxMC0xRjE1MUYyMC0xRjI3MUYzMC0xRjM3MUY0MC0xRjQ1MUY1MC0xRjU3MUY2MC0xRjY3MUY3MC0xRjdEMUY4MC0xRjg3MUY5MC0xRjk3MUZBMC0xRkE3MUZCMC0xRkI0MUZCNjFGQjcxRkJFMUZDMi0xRkM0MUZDNjFGQzcxRkQwLTFGRDMxRkQ2MUZENzFGRTAtMUZFNzFGRjItMUZGNDFGRjYxRkY3MjA3MTIwN0YyMDkwLTIwOUMyMTBBMjEwRTIxMEYyMTEzMjEyRjIxMzQyMTM5MjEzQzIxM0QyMTQ2LTIxNDkyMTRFMjE3MC0yMTdGMjE4NDI0RDAtMjRFOTJDMzAtMkM1RTJDNjEyQzY1MkM2NjJDNjgyQzZBMkM2QzJDNzEyQzczMkM3NDJDNzYtMkM3RDJDODEyQzgzMkM4NTJDODcyQzg5MkM4QjJDOEQyQzhGMkM5MTJDOTMyQzk1MkM5NzJDOTkyQzlCMkM5RDJDOUYyQ0ExMkNBMzJDQTUyQ0E3MkNBOTJDQUIyQ0FEMkNBRjJDQjEyQ0IzMkNCNTJDQjcyQ0I5MkNCQjJDQkQyQ0JGMkNDMTJDQzMyQ0M1MkNDNzJDQzkyQ0NCMkNDRDJDQ0YyQ0QxMkNEMzJDRDUyQ0Q3MkNEOTJDREIyQ0REMkNERjJDRTEyQ0UzMkNFNDJDRUMyQ0VFMkNGMzJEMDAtMkQyNTJEMjcyRDJEQTY0MUE2NDNBNjQ1QTY0N0E2NDlBNjRCQTY0REE2NEZBNjUxQTY1M0E2NTVBNjU3QTY1OUE2NUJBNjVEQTY1RkE2NjFBNjYzQTY2NUE2NjdBNjY5QTY2QkE2NkRBNjgxQTY4M0E2ODVBNjg3QTY4OUE2OEJBNjhEQTY4RkE2OTFBNjkzQTY5NUE2OTdBNzIzQTcyNUE3MjdBNzI5QTcyQkE3MkRBNzJGLUE3MzFBNzMzQTczNUE3MzdBNzM5QTczQkE3M0RBNzNGQTc0MUE3NDNBNzQ1QTc0N0E3NDlBNzRCQTc0REE3NEZBNzUxQTc1M0E3NTVBNzU3QTc1OUE3NUJBNzVEQTc1RkE3NjFBNzYzQTc2NUE3NjdBNzY5QTc2QkE3NkRBNzZGLUE3NzhBNzdBQTc3Q0E3N0ZBNzgxQTc4M0E3ODVBNzg3QTc4Q0E3OEVBNzkxQTc5M0E3QTFBN0EzQTdBNUE3QTdBN0E5QTdGOC1BN0ZBRkIwMC1GQjA2RkIxMy1GQjE3RkY0MS1GRjVBXCIsXHJcbiAgICAgICAgV2hpdGVfU3BhY2U6IFwiMDAwOS0wMDBEMDAyMDAwODUwMEEwMTY4MDE4MEUyMDAwLTIwMEEyMDI4MjAyOTIwMkYyMDVGMzAwMFwiLFxyXG4gICAgICAgIE5vbmNoYXJhY3Rlcl9Db2RlX1BvaW50OiBcIkZERDAtRkRFRkZGRkVGRkZGXCIsXHJcbiAgICAgICAgRGVmYXVsdF9JZ25vcmFibGVfQ29kZV9Qb2ludDogXCIwMEFEMDM0RjExNUYxMTYwMTdCNDE3QjUxODBCLTE4MEQyMDBCLTIwMEYyMDJBLTIwMkUyMDYwLTIwNkYzMTY0RkUwMC1GRTBGRkVGRkZGQTBGRkYwLUZGRjhcIixcclxuICAgICAgICAvLyBcXHB7QW55fSBtYXRjaGVzIGEgY29kZSB1bml0LiBUbyBtYXRjaCBhbnkgY29kZSBwb2ludCB2aWEgc3Vycm9nYXRlIHBhaXJzLCB1c2UgKD86W1xcMC1cXHVEN0ZGXFx1REMwMC1cXHVGRkZGXXxbXFx1RDgwMC1cXHVEQkZGXVtcXHVEQzAwLVxcdURGRkZdfFtcXHVEODAwLVxcdURCRkZdKVxyXG4gICAgICAgIEFueTogXCIwMDAwLUZGRkZcIiwgLy8gXFxwe15Bbnl9IGNvbXBpbGVzIHRvIFteXFx1MDAwMC1cXHVGRkZGXTsgW1xccHteQW55fV0gdG8gW11cclxuICAgICAgICBBc2NpaTogXCIwMDAwLTAwN0ZcIixcclxuICAgICAgICAvLyBcXHB7QXNzaWduZWR9IGlzIGVxdWl2YWxlbnQgdG8gXFxwe15Dbn1cclxuICAgICAgICAvL0Fzc2lnbmVkOiBYUmVnRXhwKFwiW1xcXFxwe15Dbn1dXCIpLnNvdXJjZS5yZXBsYWNlKC9bW1xcXV18XFxcXHUvZywgXCJcIikgLy8gTmVnYXRpb24gaW5zaWRlIGEgY2hhcmFjdGVyIGNsYXNzIHRyaWdnZXJzIGludmVyc2lvblxyXG4gICAgICAgIEFzc2lnbmVkOiBcIjAwMDAtMDM3NzAzN0EtMDM3RTAzODQtMDM4QTAzOEMwMzhFLTAzQTEwM0EzLTA1MjcwNTMxLTA1NTYwNTU5LTA1NUYwNTYxLTA1ODcwNTg5MDU4QTA1OEYwNTkxLTA1QzcwNUQwLTA1RUEwNUYwLTA1RjQwNjAwLTA2MDQwNjA2LTA2MUIwNjFFLTA3MEQwNzBGLTA3NEEwNzRELTA3QjEwN0MwLTA3RkEwODAwLTA4MkQwODMwLTA4M0UwODQwLTA4NUIwODVFMDhBMDA4QTItMDhBQzA4RTQtMDhGRTA5MDAtMDk3NzA5NzktMDk3RjA5ODEtMDk4MzA5ODUtMDk4QzA5OEYwOTkwMDk5My0wOUE4MDlBQS0wOUIwMDlCMjA5QjYtMDlCOTA5QkMtMDlDNDA5QzcwOUM4MDlDQi0wOUNFMDlENzA5REMwOUREMDlERi0wOUUzMDlFNi0wOUZCMEEwMS0wQTAzMEEwNS0wQTBBMEEwRjBBMTAwQTEzLTBBMjgwQTJBLTBBMzAwQTMyMEEzMzBBMzUwQTM2MEEzODBBMzkwQTNDMEEzRS0wQTQyMEE0NzBBNDgwQTRCLTBBNEQwQTUxMEE1OS0wQTVDMEE1RTBBNjYtMEE3NTBBODEtMEE4MzBBODUtMEE4RDBBOEYtMEE5MTBBOTMtMEFBODBBQUEtMEFCMDBBQjIwQUIzMEFCNS0wQUI5MEFCQy0wQUM1MEFDNy0wQUM5MEFDQi0wQUNEMEFEMDBBRTAtMEFFMzBBRTYtMEFGMTBCMDEtMEIwMzBCMDUtMEIwQzBCMEYwQjEwMEIxMy0wQjI4MEIyQS0wQjMwMEIzMjBCMzMwQjM1LTBCMzkwQjNDLTBCNDQwQjQ3MEI0ODBCNEItMEI0RDBCNTYwQjU3MEI1QzBCNUQwQjVGLTBCNjMwQjY2LTBCNzcwQjgyMEI4MzBCODUtMEI4QTBCOEUtMEI5MDBCOTItMEI5NTBCOTkwQjlBMEI5QzBCOUUwQjlGMEJBMzBCQTQwQkE4LTBCQUEwQkFFLTBCQjkwQkJFLTBCQzIwQkM2LTBCQzgwQkNBLTBCQ0QwQkQwMEJENzBCRTYtMEJGQTBDMDEtMEMwMzBDMDUtMEMwQzBDMEUtMEMxMDBDMTItMEMyODBDMkEtMEMzMzBDMzUtMEMzOTBDM0QtMEM0NDBDNDYtMEM0ODBDNEEtMEM0RDBDNTUwQzU2MEM1ODBDNTkwQzYwLTBDNjMwQzY2LTBDNkYwQzc4LTBDN0YwQzgyMEM4MzBDODUtMEM4QzBDOEUtMEM5MDBDOTItMENBODBDQUEtMENCMzBDQjUtMENCOTBDQkMtMENDNDBDQzYtMENDODBDQ0EtMENDRDBDRDUwQ0Q2MENERTBDRTAtMENFMzBDRTYtMENFRjBDRjEwQ0YyMEQwMjBEMDMwRDA1LTBEMEMwRDBFLTBEMTAwRDEyLTBEM0EwRDNELTBENDQwRDQ2LTBENDgwRDRBLTBENEUwRDU3MEQ2MC0wRDYzMEQ2Ni0wRDc1MEQ3OS0wRDdGMEQ4MjBEODMwRDg1LTBEOTYwRDlBLTBEQjEwREIzLTBEQkIwREJEMERDMC0wREM2MERDQTBEQ0YtMERENDBERDYwREQ4LTBEREYwREYyLTBERjQwRTAxLTBFM0EwRTNGLTBFNUIwRTgxMEU4MjBFODQwRTg3MEU4ODBFOEEwRThEMEU5NC0wRTk3MEU5OS0wRTlGMEVBMS0wRUEzMEVBNTBFQTcwRUFBMEVBQjBFQUQtMEVCOTBFQkItMEVCRDBFQzAtMEVDNDBFQzYwRUM4LTBFQ0QwRUQwLTBFRDkwRURDLTBFREYwRjAwLTBGNDcwRjQ5LTBGNkMwRjcxLTBGOTcwRjk5LTBGQkMwRkJFLTBGQ0MwRkNFLTBGREExMDAwLTEwQzUxMEM3MTBDRDEwRDAtMTI0ODEyNEEtMTI0RDEyNTAtMTI1NjEyNTgxMjVBLTEyNUQxMjYwLTEyODgxMjhBLTEyOEQxMjkwLTEyQjAxMkIyLTEyQjUxMkI4LTEyQkUxMkMwMTJDMi0xMkM1MTJDOC0xMkQ2MTJEOC0xMzEwMTMxMi0xMzE1MTMxOC0xMzVBMTM1RC0xMzdDMTM4MC0xMzk5MTNBMC0xM0Y0MTQwMC0xNjlDMTZBMC0xNkYwMTcwMC0xNzBDMTcwRS0xNzE0MTcyMC0xNzM2MTc0MC0xNzUzMTc2MC0xNzZDMTc2RS0xNzcwMTc3MjE3NzMxNzgwLTE3REQxN0UwLTE3RTkxN0YwLTE3RjkxODAwLTE4MEUxODEwLTE4MTkxODIwLTE4NzcxODgwLTE4QUExOEIwLTE4RjUxOTAwLTE5MUMxOTIwLTE5MkIxOTMwLTE5M0IxOTQwMTk0NC0xOTZEMTk3MC0xOTc0MTk4MC0xOUFCMTlCMC0xOUM5MTlEMC0xOURBMTlERS0xQTFCMUExRS0xQTVFMUE2MC0xQTdDMUE3Ri0xQTg5MUE5MC0xQTk5MUFBMC0xQUFEMUIwMC0xQjRCMUI1MC0xQjdDMUI4MC0xQkYzMUJGQy0xQzM3MUMzQi0xQzQ5MUM0RC0xQzdGMUNDMC0xQ0M3MUNEMC0xQ0Y2MUQwMC0xREU2MURGQy0xRjE1MUYxOC0xRjFEMUYyMC0xRjQ1MUY0OC0xRjREMUY1MC0xRjU3MUY1OTFGNUIxRjVEMUY1Ri0xRjdEMUY4MC0xRkI0MUZCNi0xRkM0MUZDNi0xRkQzMUZENi0xRkRCMUZERC0xRkVGMUZGMi0xRkY0MUZGNi0xRkZFMjAwMC0yMDY0MjA2QS0yMDcxMjA3NC0yMDhFMjA5MC0yMDlDMjBBMC0yMEI5MjBEMC0yMEYwMjEwMC0yMTg5MjE5MC0yM0YzMjQwMC0yNDI2MjQ0MC0yNDRBMjQ2MC0yNkZGMjcwMS0yQjRDMkI1MC0yQjU5MkMwMC0yQzJFMkMzMC0yQzVFMkM2MC0yQ0YzMkNGOS0yRDI1MkQyNzJEMkQyRDMwLTJENjcyRDZGMkQ3MDJEN0YtMkQ5NjJEQTAtMkRBNjJEQTgtMkRBRTJEQjAtMkRCNjJEQjgtMkRCRTJEQzAtMkRDNjJEQzgtMkRDRTJERDAtMkRENjJERDgtMkRERTJERTAtMkUzQjJFODAtMkU5OTJFOUItMkVGMzJGMDAtMkZENTJGRjAtMkZGQjMwMDAtMzAzRjMwNDEtMzA5NjMwOTktMzBGRjMxMDUtMzEyRDMxMzEtMzE4RTMxOTAtMzFCQTMxQzAtMzFFMzMxRjAtMzIxRTMyMjAtMzJGRTMzMDAtNERCNTREQzAtOUZDQ0EwMDAtQTQ4Q0E0OTAtQTRDNkE0RDAtQTYyQkE2NDAtQTY5N0E2OUYtQTZGN0E3MDAtQTc4RUE3OTAtQTc5M0E3QTAtQTdBQUE3RjgtQTgyQkE4MzAtQTgzOUE4NDAtQTg3N0E4ODAtQThDNEE4Q0UtQThEOUE4RTAtQThGQkE5MDAtQTk1M0E5NUYtQTk3Q0E5ODAtQTlDREE5Q0YtQTlEOUE5REVBOURGQUEwMC1BQTM2QUE0MC1BQTREQUE1MC1BQTU5QUE1Qy1BQTdCQUE4MC1BQUMyQUFEQi1BQUY2QUIwMS1BQjA2QUIwOS1BQjBFQUIxMS1BQjE2QUIyMC1BQjI2QUIyOC1BQjJFQUJDMC1BQkVEQUJGMC1BQkY5QUMwMC1EN0EzRDdCMC1EN0M2RDdDQi1EN0ZCRDgwMC1GQTZERkE3MC1GQUQ5RkIwMC1GQjA2RkIxMy1GQjE3RkIxRC1GQjM2RkIzOC1GQjNDRkIzRUZCNDBGQjQxRkI0M0ZCNDRGQjQ2LUZCQzFGQkQzLUZEM0ZGRDUwLUZEOEZGRDkyLUZEQzdGREYwLUZERkRGRTAwLUZFMTlGRTIwLUZFMjZGRTMwLUZFNTJGRTU0LUZFNjZGRTY4LUZFNkJGRTcwLUZFNzRGRTc2LUZFRkNGRUZGRkYwMS1GRkJFRkZDMi1GRkM3RkZDQS1GRkNGRkZEMi1GRkQ3RkZEQS1GRkRDRkZFMC1GRkU2RkZFOC1GRkVFRkZGOS1GRkZEXCJcclxuICAgIH0pO1xyXG5cclxufShYUmVnRXhwKSk7XHJcblxyXG5cbi8qKioqKiBtYXRjaHJlY3Vyc2l2ZS5qcyAqKioqKi9cblxuLyohXHJcbiAqIFhSZWdFeHAubWF0Y2hSZWN1cnNpdmUgdjAuMi4wXHJcbiAqIChjKSAyMDA5LTIwMTIgU3RldmVuIExldml0aGFuIDxodHRwOi8veHJlZ2V4cC5jb20vPlxyXG4gKiBNSVQgTGljZW5zZVxyXG4gKi9cclxuXHJcbihmdW5jdGlvbiAoWFJlZ0V4cCkge1xyXG4gICAgXCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG4vKipcclxuICogUmV0dXJucyBhIG1hdGNoIGRldGFpbCBvYmplY3QgY29tcG9zZWQgb2YgdGhlIHByb3ZpZGVkIHZhbHVlcy5cclxuICogQHByaXZhdGVcclxuICovXHJcbiAgICBmdW5jdGlvbiByb3codmFsdWUsIG5hbWUsIHN0YXJ0LCBlbmQpIHtcclxuICAgICAgICByZXR1cm4ge3ZhbHVlOnZhbHVlLCBuYW1lOm5hbWUsIHN0YXJ0OnN0YXJ0LCBlbmQ6ZW5kfTtcclxuICAgIH1cclxuXHJcbi8qKlxyXG4gKiBSZXR1cm5zIGFuIGFycmF5IG9mIG1hdGNoIHN0cmluZ3MgYmV0d2VlbiBvdXRlcm1vc3QgbGVmdCBhbmQgcmlnaHQgZGVsaW1pdGVycywgb3IgYW4gYXJyYXkgb2ZcclxuICogb2JqZWN0cyB3aXRoIGRldGFpbGVkIG1hdGNoIHBhcnRzIGFuZCBwb3NpdGlvbiBkYXRhLiBBbiBlcnJvciBpcyB0aHJvd24gaWYgZGVsaW1pdGVycyBhcmVcclxuICogdW5iYWxhbmNlZCB3aXRoaW4gdGhlIGRhdGEuXHJcbiAqIEBtZW1iZXJPZiBYUmVnRXhwXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgU3RyaW5nIHRvIHNlYXJjaC5cclxuICogQHBhcmFtIHtTdHJpbmd9IGxlZnQgTGVmdCBkZWxpbWl0ZXIgYXMgYW4gWFJlZ0V4cCBwYXR0ZXJuLlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gcmlnaHQgUmlnaHQgZGVsaW1pdGVyIGFzIGFuIFhSZWdFeHAgcGF0dGVybi5cclxuICogQHBhcmFtIHtTdHJpbmd9IFtmbGFnc10gRmxhZ3MgZm9yIHRoZSBsZWZ0IGFuZCByaWdodCBkZWxpbWl0ZXJzLiBVc2UgYW55IG9mOiBgZ2ltbnN4eWAuXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gTGV0cyB5b3Ugc3BlY2lmeSBgdmFsdWVOYW1lc2AgYW5kIGBlc2NhcGVDaGFyYCBvcHRpb25zLlxyXG4gKiBAcmV0dXJucyB7QXJyYXl9IEFycmF5IG9mIG1hdGNoZXMsIG9yIGFuIGVtcHR5IGFycmF5LlxyXG4gKiBAZXhhbXBsZVxyXG4gKlxyXG4gKiAvLyBCYXNpYyB1c2FnZVxyXG4gKiB2YXIgc3RyID0gJyh0KChlKSlzKXQoKShpbmcpJztcclxuICogWFJlZ0V4cC5tYXRjaFJlY3Vyc2l2ZShzdHIsICdcXFxcKCcsICdcXFxcKScsICdnJyk7XHJcbiAqIC8vIC0+IFsndCgoZSkpcycsICcnLCAnaW5nJ11cclxuICpcclxuICogLy8gRXh0ZW5kZWQgaW5mb3JtYXRpb24gbW9kZSB3aXRoIHZhbHVlTmFtZXNcclxuICogc3RyID0gJ0hlcmUgaXMgPGRpdj4gPGRpdj5hbjwvZGl2PjwvZGl2PiBleGFtcGxlJztcclxuICogWFJlZ0V4cC5tYXRjaFJlY3Vyc2l2ZShzdHIsICc8ZGl2XFxcXHMqPicsICc8L2Rpdj4nLCAnZ2knLCB7XHJcbiAqICAgdmFsdWVOYW1lczogWydiZXR3ZWVuJywgJ2xlZnQnLCAnbWF0Y2gnLCAncmlnaHQnXVxyXG4gKiB9KTtcclxuICogLy8gLT4gW1xyXG4gKiAvLyB7bmFtZTogJ2JldHdlZW4nLCB2YWx1ZTogJ0hlcmUgaXMgJywgICAgICAgc3RhcnQ6IDAsICBlbmQ6IDh9LFxyXG4gKiAvLyB7bmFtZTogJ2xlZnQnLCAgICB2YWx1ZTogJzxkaXY+JywgICAgICAgICAgc3RhcnQ6IDgsICBlbmQ6IDEzfSxcclxuICogLy8ge25hbWU6ICdtYXRjaCcsICAgdmFsdWU6ICcgPGRpdj5hbjwvZGl2PicsIHN0YXJ0OiAxMywgZW5kOiAyN30sXHJcbiAqIC8vIHtuYW1lOiAncmlnaHQnLCAgIHZhbHVlOiAnPC9kaXY+JywgICAgICAgICBzdGFydDogMjcsIGVuZDogMzN9LFxyXG4gKiAvLyB7bmFtZTogJ2JldHdlZW4nLCB2YWx1ZTogJyBleGFtcGxlJywgICAgICAgc3RhcnQ6IDMzLCBlbmQ6IDQxfVxyXG4gKiAvLyBdXHJcbiAqXHJcbiAqIC8vIE9taXR0aW5nIHVubmVlZGVkIHBhcnRzIHdpdGggbnVsbCB2YWx1ZU5hbWVzLCBhbmQgdXNpbmcgZXNjYXBlQ2hhclxyXG4gKiBzdHIgPSAnLi4uezF9XFxcXHt7ZnVuY3Rpb24oeCx5KXtyZXR1cm4geSt4O319JztcclxuICogWFJlZ0V4cC5tYXRjaFJlY3Vyc2l2ZShzdHIsICd7JywgJ30nLCAnZycsIHtcclxuICogICB2YWx1ZU5hbWVzOiBbJ2xpdGVyYWwnLCBudWxsLCAndmFsdWUnLCBudWxsXSxcclxuICogICBlc2NhcGVDaGFyOiAnXFxcXCdcclxuICogfSk7XHJcbiAqIC8vIC0+IFtcclxuICogLy8ge25hbWU6ICdsaXRlcmFsJywgdmFsdWU6ICcuLi4nLCBzdGFydDogMCwgZW5kOiAzfSxcclxuICogLy8ge25hbWU6ICd2YWx1ZScsICAgdmFsdWU6ICcxJywgICBzdGFydDogNCwgZW5kOiA1fSxcclxuICogLy8ge25hbWU6ICdsaXRlcmFsJywgdmFsdWU6ICdcXFxceycsIHN0YXJ0OiA2LCBlbmQ6IDh9LFxyXG4gKiAvLyB7bmFtZTogJ3ZhbHVlJywgICB2YWx1ZTogJ2Z1bmN0aW9uKHgseSl7cmV0dXJuIHkreDt9Jywgc3RhcnQ6IDksIGVuZDogMzV9XHJcbiAqIC8vIF1cclxuICpcclxuICogLy8gU3RpY2t5IG1vZGUgdmlhIGZsYWcgeVxyXG4gKiBzdHIgPSAnPDE+PDw8Mj4+PjwzPjQ8NT4nO1xyXG4gKiBYUmVnRXhwLm1hdGNoUmVjdXJzaXZlKHN0ciwgJzwnLCAnPicsICdneScpO1xyXG4gKiAvLyAtPiBbJzEnLCAnPDwyPj4nLCAnMyddXHJcbiAqL1xyXG4gICAgWFJlZ0V4cC5tYXRjaFJlY3Vyc2l2ZSA9IGZ1bmN0aW9uIChzdHIsIGxlZnQsIHJpZ2h0LCBmbGFncywgb3B0aW9ucykge1xyXG4gICAgICAgIGZsYWdzID0gZmxhZ3MgfHwgXCJcIjtcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB2YXIgZ2xvYmFsID0gZmxhZ3MuaW5kZXhPZihcImdcIikgPiAtMSxcclxuICAgICAgICAgICAgc3RpY2t5ID0gZmxhZ3MuaW5kZXhPZihcInlcIikgPiAtMSxcclxuICAgICAgICAgICAgYmFzaWNGbGFncyA9IGZsYWdzLnJlcGxhY2UoL3kvZywgXCJcIiksIC8vIEZsYWcgeSBjb250cm9sbGVkIGludGVybmFsbHlcclxuICAgICAgICAgICAgZXNjYXBlQ2hhciA9IG9wdGlvbnMuZXNjYXBlQ2hhcixcclxuICAgICAgICAgICAgdk4gPSBvcHRpb25zLnZhbHVlTmFtZXMsXHJcbiAgICAgICAgICAgIG91dHB1dCA9IFtdLFxyXG4gICAgICAgICAgICBvcGVuVG9rZW5zID0gMCxcclxuICAgICAgICAgICAgZGVsaW1TdGFydCA9IDAsXHJcbiAgICAgICAgICAgIGRlbGltRW5kID0gMCxcclxuICAgICAgICAgICAgbGFzdE91dGVyRW5kID0gMCxcclxuICAgICAgICAgICAgb3V0ZXJTdGFydCxcclxuICAgICAgICAgICAgaW5uZXJTdGFydCxcclxuICAgICAgICAgICAgbGVmdE1hdGNoLFxyXG4gICAgICAgICAgICByaWdodE1hdGNoLFxyXG4gICAgICAgICAgICBlc2M7XHJcbiAgICAgICAgbGVmdCA9IFhSZWdFeHAobGVmdCwgYmFzaWNGbGFncyk7XHJcbiAgICAgICAgcmlnaHQgPSBYUmVnRXhwKHJpZ2h0LCBiYXNpY0ZsYWdzKTtcclxuXHJcbiAgICAgICAgaWYgKGVzY2FwZUNoYXIpIHtcclxuICAgICAgICAgICAgaWYgKGVzY2FwZUNoYXIubGVuZ3RoID4gMSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiY2FuJ3QgdXNlIG1vcmUgdGhhbiBvbmUgZXNjYXBlIGNoYXJhY3RlclwiKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBlc2NhcGVDaGFyID0gWFJlZ0V4cC5lc2NhcGUoZXNjYXBlQ2hhcik7XHJcbiAgICAgICAgICAgIC8vIFVzaW5nIFhSZWdFeHAudW5pb24gc2FmZWx5IHJld3JpdGVzIGJhY2tyZWZlcmVuY2VzIGluIGBsZWZ0YCBhbmQgYHJpZ2h0YFxyXG4gICAgICAgICAgICBlc2MgPSBuZXcgUmVnRXhwKFxyXG4gICAgICAgICAgICAgICAgXCIoPzpcIiArIGVzY2FwZUNoYXIgKyBcIltcXFxcU1xcXFxzXXwoPzooPyFcIiArIFhSZWdFeHAudW5pb24oW2xlZnQsIHJpZ2h0XSkuc291cmNlICsgXCIpW15cIiArIGVzY2FwZUNoYXIgKyBcIl0pKykrXCIsXHJcbiAgICAgICAgICAgICAgICBmbGFncy5yZXBsYWNlKC9bXmltXSsvZywgXCJcIikgLy8gRmxhZ3MgZ3kgbm90IG5lZWRlZCBoZXJlOyBmbGFncyBuc3ggaGFuZGxlZCBieSBYUmVnRXhwXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB3aGlsZSAodHJ1ZSkge1xyXG4gICAgICAgICAgICAvLyBJZiB1c2luZyBhbiBlc2NhcGUgY2hhcmFjdGVyLCBhZHZhbmNlIHRvIHRoZSBkZWxpbWl0ZXIncyBuZXh0IHN0YXJ0aW5nIHBvc2l0aW9uLFxyXG4gICAgICAgICAgICAvLyBza2lwcGluZyBhbnkgZXNjYXBlZCBjaGFyYWN0ZXJzIGluIGJldHdlZW5cclxuICAgICAgICAgICAgaWYgKGVzY2FwZUNoYXIpIHtcclxuICAgICAgICAgICAgICAgIGRlbGltRW5kICs9IChYUmVnRXhwLmV4ZWMoc3RyLCBlc2MsIGRlbGltRW5kLCBcInN0aWNreVwiKSB8fCBbXCJcIl0pWzBdLmxlbmd0aDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsZWZ0TWF0Y2ggPSBYUmVnRXhwLmV4ZWMoc3RyLCBsZWZ0LCBkZWxpbUVuZCk7XHJcbiAgICAgICAgICAgIHJpZ2h0TWF0Y2ggPSBYUmVnRXhwLmV4ZWMoc3RyLCByaWdodCwgZGVsaW1FbmQpO1xyXG4gICAgICAgICAgICAvLyBLZWVwIHRoZSBsZWZ0bW9zdCBtYXRjaCBvbmx5XHJcbiAgICAgICAgICAgIGlmIChsZWZ0TWF0Y2ggJiYgcmlnaHRNYXRjaCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGxlZnRNYXRjaC5pbmRleCA8PSByaWdodE1hdGNoLmluZGV4KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmlnaHRNYXRjaCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGxlZnRNYXRjaCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLyogUGF0aHMgKExNOmxlZnRNYXRjaCwgUk06cmlnaHRNYXRjaCwgT1Q6b3BlblRva2Vucyk6XHJcbiAgICAgICAgICAgIExNIHwgUk0gfCBPVCB8IFJlc3VsdFxyXG4gICAgICAgICAgICAxICB8IDAgIHwgMSAgfCBsb29wXHJcbiAgICAgICAgICAgIDEgIHwgMCAgfCAwICB8IGxvb3BcclxuICAgICAgICAgICAgMCAgfCAxICB8IDEgIHwgbG9vcFxyXG4gICAgICAgICAgICAwICB8IDEgIHwgMCAgfCB0aHJvd1xyXG4gICAgICAgICAgICAwICB8IDAgIHwgMSAgfCB0aHJvd1xyXG4gICAgICAgICAgICAwICB8IDAgIHwgMCAgfCBicmVha1xyXG4gICAgICAgICAgICAqIERvZXNuJ3QgaW5jbHVkZSB0aGUgc3RpY2t5IG1vZGUgc3BlY2lhbCBjYXNlXHJcbiAgICAgICAgICAgICogTG9vcCBlbmRzIGFmdGVyIHRoZSBmaXJzdCBjb21wbGV0ZWQgbWF0Y2ggaWYgYCFnbG9iYWxgICovXHJcbiAgICAgICAgICAgIGlmIChsZWZ0TWF0Y2ggfHwgcmlnaHRNYXRjaCkge1xyXG4gICAgICAgICAgICAgICAgZGVsaW1TdGFydCA9IChsZWZ0TWF0Y2ggfHwgcmlnaHRNYXRjaCkuaW5kZXg7XHJcbiAgICAgICAgICAgICAgICBkZWxpbUVuZCA9IGRlbGltU3RhcnQgKyAobGVmdE1hdGNoIHx8IHJpZ2h0TWF0Y2gpWzBdLmxlbmd0aDtcclxuICAgICAgICAgICAgfSBlbHNlIGlmICghb3BlblRva2Vucykge1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHN0aWNreSAmJiAhb3BlblRva2VucyAmJiBkZWxpbVN0YXJ0ID4gbGFzdE91dGVyRW5kKSB7XHJcbiAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAobGVmdE1hdGNoKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIW9wZW5Ub2tlbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICBvdXRlclN0YXJ0ID0gZGVsaW1TdGFydDtcclxuICAgICAgICAgICAgICAgICAgICBpbm5lclN0YXJ0ID0gZGVsaW1FbmQ7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICArK29wZW5Ub2tlbnM7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmlnaHRNYXRjaCAmJiBvcGVuVG9rZW5zKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIS0tb3BlblRva2Vucykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh2Tikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodk5bMF0gJiYgb3V0ZXJTdGFydCA+IGxhc3RPdXRlckVuZCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3V0cHV0LnB1c2gocm93KHZOWzBdLCBzdHIuc2xpY2UobGFzdE91dGVyRW5kLCBvdXRlclN0YXJ0KSwgbGFzdE91dGVyRW5kLCBvdXRlclN0YXJ0KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHZOWzFdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvdXRwdXQucHVzaChyb3codk5bMV0sIHN0ci5zbGljZShvdXRlclN0YXJ0LCBpbm5lclN0YXJ0KSwgb3V0ZXJTdGFydCwgaW5uZXJTdGFydCkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh2TlsyXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3V0cHV0LnB1c2gocm93KHZOWzJdLCBzdHIuc2xpY2UoaW5uZXJTdGFydCwgZGVsaW1TdGFydCksIGlubmVyU3RhcnQsIGRlbGltU3RhcnQpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodk5bM10pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKHJvdyh2TlszXSwgc3RyLnNsaWNlKGRlbGltU3RhcnQsIGRlbGltRW5kKSwgZGVsaW1TdGFydCwgZGVsaW1FbmQpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG91dHB1dC5wdXNoKHN0ci5zbGljZShpbm5lclN0YXJ0LCBkZWxpbVN0YXJ0KSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGxhc3RPdXRlckVuZCA9IGRlbGltRW5kO1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghZ2xvYmFsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInN0cmluZyBjb250YWlucyB1bmJhbGFuY2VkIGRlbGltaXRlcnNcIik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy8gSWYgdGhlIGRlbGltaXRlciBtYXRjaGVkIGFuIGVtcHR5IHN0cmluZywgYXZvaWQgYW4gaW5maW5pdGUgbG9vcFxyXG4gICAgICAgICAgICBpZiAoZGVsaW1TdGFydCA9PT0gZGVsaW1FbmQpIHtcclxuICAgICAgICAgICAgICAgICsrZGVsaW1FbmQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChnbG9iYWwgJiYgIXN0aWNreSAmJiB2TiAmJiB2TlswXSAmJiBzdHIubGVuZ3RoID4gbGFzdE91dGVyRW5kKSB7XHJcbiAgICAgICAgICAgIG91dHB1dC5wdXNoKHJvdyh2TlswXSwgc3RyLnNsaWNlKGxhc3RPdXRlckVuZCksIGxhc3RPdXRlckVuZCwgc3RyLmxlbmd0aCkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIG91dHB1dDtcclxuICAgIH07XHJcblxyXG59KFhSZWdFeHApKTtcclxuXHJcblxuLyoqKioqIGJ1aWxkLmpzICoqKioqL1xuXG4vKiFcclxuICogWFJlZ0V4cC5idWlsZCB2MC4xLjBcclxuICogKGMpIDIwMTIgU3RldmVuIExldml0aGFuIDxodHRwOi8veHJlZ2V4cC5jb20vPlxyXG4gKiBNSVQgTGljZW5zZVxyXG4gKiBJbnNwaXJlZCBieSBSZWdFeHAuY3JlYXRlIGJ5IExlYSBWZXJvdSA8aHR0cDovL2xlYS52ZXJvdS5tZS8+XHJcbiAqL1xyXG5cclxuKGZ1bmN0aW9uIChYUmVnRXhwKSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbiAgICB2YXIgc3VicGFydHMgPSAvKFxcKCkoPyFcXD8pfFxcXFwoWzEtOV1cXGQqKXxcXFxcW1xcc1xcU118XFxbKD86W15cXFxcXFxdXXxcXFxcW1xcc1xcU10pKl0vZyxcclxuICAgICAgICBwYXJ0cyA9IFhSZWdFeHAudW5pb24oWy9cXCh7eyhbXFx3JF0rKX19XFwpfHt7KFtcXHckXSspfX0vLCBzdWJwYXJ0c10sIFwiZ1wiKTtcclxuXHJcbi8qKlxyXG4gKiBTdHJpcHMgYSBsZWFkaW5nIGBeYCBhbmQgdHJhaWxpbmcgdW5lc2NhcGVkIGAkYCwgaWYgYm90aCBhcmUgcHJlc2VudC5cclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtTdHJpbmd9IHBhdHRlcm4gUGF0dGVybiB0byBwcm9jZXNzLlxyXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBQYXR0ZXJuIHdpdGggZWRnZSBhbmNob3JzIHJlbW92ZWQuXHJcbiAqL1xyXG4gICAgZnVuY3Rpb24gZGVhbmNob3IocGF0dGVybikge1xyXG4gICAgICAgIHZhciBzdGFydEFuY2hvciA9IC9eKD86XFwoXFw/OlxcKSk/XFxeLywgLy8gTGVhZGluZyBgXmAgb3IgYCg/OileYCAoaGFuZGxlcyAveCBjcnVmdClcclxuICAgICAgICAgICAgZW5kQW5jaG9yID0gL1xcJCg/OlxcKFxcPzpcXCkpPyQvOyAvLyBUcmFpbGluZyBgJGAgb3IgYCQoPzopYCAoaGFuZGxlcyAveCBjcnVmdClcclxuICAgICAgICBpZiAoZW5kQW5jaG9yLnRlc3QocGF0dGVybi5yZXBsYWNlKC9cXFxcW1xcc1xcU10vZywgXCJcIikpKSB7IC8vIEVuc3VyZSB0cmFpbGluZyBgJGAgaXNuJ3QgZXNjYXBlZFxyXG4gICAgICAgICAgICByZXR1cm4gcGF0dGVybi5yZXBsYWNlKHN0YXJ0QW5jaG9yLCBcIlwiKS5yZXBsYWNlKGVuZEFuY2hvciwgXCJcIik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBwYXR0ZXJuO1xyXG4gICAgfVxyXG5cclxuLyoqXHJcbiAqIENvbnZlcnRzIHRoZSBwcm92aWRlZCB2YWx1ZSB0byBhbiBYUmVnRXhwLlxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge1N0cmluZ3xSZWdFeHB9IHZhbHVlIFZhbHVlIHRvIGNvbnZlcnQuXHJcbiAqIEByZXR1cm5zIHtSZWdFeHB9IFhSZWdFeHAgb2JqZWN0IHdpdGggWFJlZ0V4cCBzeW50YXggYXBwbGllZC5cclxuICovXHJcbiAgICBmdW5jdGlvbiBhc1hSZWdFeHAodmFsdWUpIHtcclxuICAgICAgICByZXR1cm4gWFJlZ0V4cC5pc1JlZ0V4cCh2YWx1ZSkgP1xyXG4gICAgICAgICAgICAgICAgKHZhbHVlLnhyZWdleHAgJiYgIXZhbHVlLnhyZWdleHAuaXNOYXRpdmUgPyB2YWx1ZSA6IFhSZWdFeHAodmFsdWUuc291cmNlKSkgOlxyXG4gICAgICAgICAgICAgICAgWFJlZ0V4cCh2YWx1ZSk7XHJcbiAgICB9XHJcblxyXG4vKipcclxuICogQnVpbGRzIHJlZ2V4ZXMgdXNpbmcgbmFtZWQgc3VicGF0dGVybnMsIGZvciByZWFkYWJpbGl0eSBhbmQgcGF0dGVybiByZXVzZS4gQmFja3JlZmVyZW5jZXMgaW4gdGhlXHJcbiAqIG91dGVyIHBhdHRlcm4gYW5kIHByb3ZpZGVkIHN1YnBhdHRlcm5zIGFyZSBhdXRvbWF0aWNhbGx5IHJlbnVtYmVyZWQgdG8gd29yayBjb3JyZWN0bHkuIE5hdGl2ZVxyXG4gKiBmbGFncyB1c2VkIGJ5IHByb3ZpZGVkIHN1YnBhdHRlcm5zIGFyZSBpZ25vcmVkIGluIGZhdm9yIG9mIHRoZSBgZmxhZ3NgIGFyZ3VtZW50LlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cFxyXG4gKiBAcGFyYW0ge1N0cmluZ30gcGF0dGVybiBYUmVnRXhwIHBhdHRlcm4gdXNpbmcgYHt7bmFtZX19YCBmb3IgZW1iZWRkZWQgc3VicGF0dGVybnMuIEFsbG93c1xyXG4gKiAgIGAoe3tuYW1lfX0pYCBhcyBzaG9ydGhhbmQgZm9yIGAoPzxuYW1lPnt7bmFtZX19KWAuIFBhdHRlcm5zIGNhbm5vdCBiZSBlbWJlZGRlZCB3aXRoaW5cclxuICogICBjaGFyYWN0ZXIgY2xhc3Nlcy5cclxuICogQHBhcmFtIHtPYmplY3R9IHN1YnMgTG9va3VwIG9iamVjdCBmb3IgbmFtZWQgc3VicGF0dGVybnMuIFZhbHVlcyBjYW4gYmUgc3RyaW5ncyBvciByZWdleGVzLiBBXHJcbiAqICAgbGVhZGluZyBgXmAgYW5kIHRyYWlsaW5nIHVuZXNjYXBlZCBgJGAgYXJlIHN0cmlwcGVkIGZyb20gc3VicGF0dGVybnMsIGlmIGJvdGggYXJlIHByZXNlbnQuXHJcbiAqIEBwYXJhbSB7U3RyaW5nfSBbZmxhZ3NdIEFueSBjb21iaW5hdGlvbiBvZiBYUmVnRXhwIGZsYWdzLlxyXG4gKiBAcmV0dXJucyB7UmVnRXhwfSBSZWdleCB3aXRoIGludGVycG9sYXRlZCBzdWJwYXR0ZXJucy5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogdmFyIHRpbWUgPSBYUmVnRXhwLmJ1aWxkKCcoP3gpXiB7e2hvdXJzfX0gKHt7bWludXRlc319KSAkJywge1xyXG4gKiAgIGhvdXJzOiBYUmVnRXhwLmJ1aWxkKCd7e2gxMn19IDogfCB7e2gyNH19Jywge1xyXG4gKiAgICAgaDEyOiAvMVswLTJdfDA/WzEtOV0vLFxyXG4gKiAgICAgaDI0OiAvMlswLTNdfFswMV1bMC05XS9cclxuICogICB9LCAneCcpLFxyXG4gKiAgIG1pbnV0ZXM6IC9eWzAtNV1bMC05XSQvXHJcbiAqIH0pO1xyXG4gKiB0aW1lLnRlc3QoJzEwOjU5Jyk7IC8vIC0+IHRydWVcclxuICogWFJlZ0V4cC5leGVjKCcxMDo1OScsIHRpbWUpLm1pbnV0ZXM7IC8vIC0+ICc1OSdcclxuICovXHJcbiAgICBYUmVnRXhwLmJ1aWxkID0gZnVuY3Rpb24gKHBhdHRlcm4sIHN1YnMsIGZsYWdzKSB7XHJcbiAgICAgICAgdmFyIGlubGluZUZsYWdzID0gL15cXChcXD8oW1xcdyRdKylcXCkvLmV4ZWMocGF0dGVybiksXHJcbiAgICAgICAgICAgIGRhdGEgPSB7fSxcclxuICAgICAgICAgICAgbnVtQ2FwcyA9IDAsIC8vIENhcHMgaXMgc2hvcnQgZm9yIGNhcHR1cmVzXHJcbiAgICAgICAgICAgIG51bVByaW9yQ2FwcyxcclxuICAgICAgICAgICAgbnVtT3V0ZXJDYXBzID0gMCxcclxuICAgICAgICAgICAgb3V0ZXJDYXBzTWFwID0gWzBdLFxyXG4gICAgICAgICAgICBvdXRlckNhcE5hbWVzLFxyXG4gICAgICAgICAgICBzdWIsXHJcbiAgICAgICAgICAgIHA7XHJcblxyXG4gICAgICAgIC8vIEFkZCBmbGFncyB3aXRoaW4gYSBsZWFkaW5nIG1vZGUgbW9kaWZpZXIgdG8gdGhlIG92ZXJhbGwgcGF0dGVybidzIGZsYWdzXHJcbiAgICAgICAgaWYgKGlubGluZUZsYWdzKSB7XHJcbiAgICAgICAgICAgIGZsYWdzID0gZmxhZ3MgfHwgXCJcIjtcclxuICAgICAgICAgICAgaW5saW5lRmxhZ3NbMV0ucmVwbGFjZSgvLi9nLCBmdW5jdGlvbiAoZmxhZykge1xyXG4gICAgICAgICAgICAgICAgZmxhZ3MgKz0gKGZsYWdzLmluZGV4T2YoZmxhZykgPiAtMSA/IFwiXCIgOiBmbGFnKTsgLy8gRG9uJ3QgYWRkIGR1cGxpY2F0ZXNcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKHAgaW4gc3Vicykge1xyXG4gICAgICAgICAgICBpZiAoc3Vicy5oYXNPd25Qcm9wZXJ0eShwKSkge1xyXG4gICAgICAgICAgICAgICAgLy8gUGFzc2luZyB0byBYUmVnRXhwIGVuYWJsZXMgZW50ZW5kZWQgc3ludGF4IGZvciBzdWJwYXR0ZXJucyBwcm92aWRlZCBhcyBzdHJpbmdzXHJcbiAgICAgICAgICAgICAgICAvLyBhbmQgZW5zdXJlcyBpbmRlcGVuZGVudCB2YWxpZGl0eSwgbGVzdCBhbiB1bmVzY2FwZWQgYChgLCBgKWAsIGBbYCwgb3IgdHJhaWxpbmdcclxuICAgICAgICAgICAgICAgIC8vIGBcXGAgYnJlYWtzIHRoZSBgKD86KWAgd3JhcHBlci4gRm9yIHN1YnBhdHRlcm5zIHByb3ZpZGVkIGFzIHJlZ2V4ZXMsIGl0IGRpZXMgb25cclxuICAgICAgICAgICAgICAgIC8vIG9jdGFscyBhbmQgYWRkcyB0aGUgYHhyZWdleHBgIHByb3BlcnR5LCBmb3Igc2ltcGxpY2l0eVxyXG4gICAgICAgICAgICAgICAgc3ViID0gYXNYUmVnRXhwKHN1YnNbcF0pO1xyXG4gICAgICAgICAgICAgICAgLy8gRGVhbmNob3JpbmcgYWxsb3dzIGVtYmVkZGluZyBpbmRlcGVuZGVudGx5IHVzZWZ1bCBhbmNob3JlZCByZWdleGVzLiBJZiB5b3VcclxuICAgICAgICAgICAgICAgIC8vIHJlYWxseSBuZWVkIHRvIGtlZXAgeW91ciBhbmNob3JzLCBkb3VibGUgdGhlbSAoaS5lLiwgYF5eLi4uJCRgKVxyXG4gICAgICAgICAgICAgICAgZGF0YVtwXSA9IHtwYXR0ZXJuOiBkZWFuY2hvcihzdWIuc291cmNlKSwgbmFtZXM6IHN1Yi54cmVnZXhwLmNhcHR1cmVOYW1lcyB8fCBbXX07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFBhc3NpbmcgdG8gWFJlZ0V4cCBkaWVzIG9uIG9jdGFscyBhbmQgZW5zdXJlcyB0aGUgb3V0ZXIgcGF0dGVybiBpcyBpbmRlcGVuZGVudGx5IHZhbGlkO1xyXG4gICAgICAgIC8vIGhlbHBzIGtlZXAgdGhpcyBzaW1wbGUuIE5hbWVkIGNhcHR1cmVzIHdpbGwgYmUgcHV0IGJhY2tcclxuICAgICAgICBwYXR0ZXJuID0gYXNYUmVnRXhwKHBhdHRlcm4pO1xyXG4gICAgICAgIG91dGVyQ2FwTmFtZXMgPSBwYXR0ZXJuLnhyZWdleHAuY2FwdHVyZU5hbWVzIHx8IFtdO1xyXG4gICAgICAgIHBhdHRlcm4gPSBwYXR0ZXJuLnNvdXJjZS5yZXBsYWNlKHBhcnRzLCBmdW5jdGlvbiAoJDAsICQxLCAkMiwgJDMsICQ0KSB7XHJcbiAgICAgICAgICAgIHZhciBzdWJOYW1lID0gJDEgfHwgJDIsIGNhcE5hbWUsIGludHJvO1xyXG4gICAgICAgICAgICBpZiAoc3ViTmFtZSkgeyAvLyBOYW1lZCBzdWJwYXR0ZXJuXHJcbiAgICAgICAgICAgICAgICBpZiAoIWRhdGEuaGFzT3duUHJvcGVydHkoc3ViTmFtZSkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUmVmZXJlbmNlRXJyb3IoXCJ1bmRlZmluZWQgcHJvcGVydHkgXCIgKyAkMCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAoJDEpIHsgLy8gTmFtZWQgc3VicGF0dGVybiB3YXMgd3JhcHBlZCBpbiBhIGNhcHR1cmluZyBncm91cFxyXG4gICAgICAgICAgICAgICAgICAgIGNhcE5hbWUgPSBvdXRlckNhcE5hbWVzW251bU91dGVyQ2Fwc107XHJcbiAgICAgICAgICAgICAgICAgICAgb3V0ZXJDYXBzTWFwWysrbnVtT3V0ZXJDYXBzXSA9ICsrbnVtQ2FwcztcclxuICAgICAgICAgICAgICAgICAgICAvLyBJZiBpdCdzIGEgbmFtZWQgZ3JvdXAsIHByZXNlcnZlIHRoZSBuYW1lLiBPdGhlcndpc2UsIHVzZSB0aGUgc3VicGF0dGVybiBuYW1lXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gYXMgdGhlIGNhcHR1cmUgbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgIGludHJvID0gXCIoPzxcIiArIChjYXBOYW1lIHx8IHN1Yk5hbWUpICsgXCI+XCI7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGludHJvID0gXCIoPzpcIjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIG51bVByaW9yQ2FwcyA9IG51bUNhcHM7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gaW50cm8gKyBkYXRhW3N1Yk5hbWVdLnBhdHRlcm4ucmVwbGFjZShzdWJwYXJ0cywgZnVuY3Rpb24gKG1hdGNoLCBwYXJlbiwgYmFja3JlZikge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXJlbikgeyAvLyBDYXB0dXJpbmcgZ3JvdXBcclxuICAgICAgICAgICAgICAgICAgICAgICAgY2FwTmFtZSA9IGRhdGFbc3ViTmFtZV0ubmFtZXNbbnVtQ2FwcyAtIG51bVByaW9yQ2Fwc107XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICsrbnVtQ2FwcztcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNhcE5hbWUpIHsgLy8gSWYgdGhlIGN1cnJlbnQgY2FwdHVyZSBoYXMgYSBuYW1lLCBwcmVzZXJ2ZSB0aGUgbmFtZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiKD88XCIgKyBjYXBOYW1lICsgXCI+XCI7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGJhY2tyZWYpIHsgLy8gQmFja3JlZmVyZW5jZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gXCJcXFxcXCIgKyAoK2JhY2tyZWYgKyBudW1QcmlvckNhcHMpOyAvLyBSZXdyaXRlIHRoZSBiYWNrcmVmZXJlbmNlXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgICAgICAgICAgIH0pICsgXCIpXCI7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKCQzKSB7IC8vIENhcHR1cmluZyBncm91cFxyXG4gICAgICAgICAgICAgICAgY2FwTmFtZSA9IG91dGVyQ2FwTmFtZXNbbnVtT3V0ZXJDYXBzXTtcclxuICAgICAgICAgICAgICAgIG91dGVyQ2Fwc01hcFsrK251bU91dGVyQ2Fwc10gPSArK251bUNhcHM7XHJcbiAgICAgICAgICAgICAgICBpZiAoY2FwTmFtZSkgeyAvLyBJZiB0aGUgY3VycmVudCBjYXB0dXJlIGhhcyBhIG5hbWUsIHByZXNlcnZlIHRoZSBuYW1lXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiKD88XCIgKyBjYXBOYW1lICsgXCI+XCI7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoJDQpIHsgLy8gQmFja3JlZmVyZW5jZVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFwiXFxcXFwiICsgb3V0ZXJDYXBzTWFwWyskNF07IC8vIFJld3JpdGUgdGhlIGJhY2tyZWZlcmVuY2VcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gJDA7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHJldHVybiBYUmVnRXhwKHBhdHRlcm4sIGZsYWdzKTtcclxuICAgIH07XHJcblxyXG59KFhSZWdFeHApKTtcclxuXHJcblxuLyoqKioqIHByb3RvdHlwZXMuanMgKioqKiovXG5cbi8qIVxyXG4gKiBYUmVnRXhwIFByb3RvdHlwZSBNZXRob2RzIHYxLjAuMFxyXG4gKiAoYykgMjAxMiBTdGV2ZW4gTGV2aXRoYW4gPGh0dHA6Ly94cmVnZXhwLmNvbS8+XHJcbiAqIE1JVCBMaWNlbnNlXHJcbiAqL1xyXG5cclxuLyoqXHJcbiAqIEFkZHMgYSBjb2xsZWN0aW9uIG9mIG1ldGhvZHMgdG8gYFhSZWdFeHAucHJvdG90eXBlYC4gUmVnRXhwIG9iamVjdHMgY29waWVkIGJ5IFhSZWdFeHAgYXJlIGFsc29cclxuICogYXVnbWVudGVkIHdpdGggYW55IGBYUmVnRXhwLnByb3RvdHlwZWAgbWV0aG9kcy4gSGVuY2UsIHRoZSBmb2xsb3dpbmcgd29yayBlcXVpdmFsZW50bHk6XHJcbiAqXHJcbiAqIFhSZWdFeHAoJ1thLXpdJywgJ2lnJykueGV4ZWMoJ2FiYycpO1xyXG4gKiBYUmVnRXhwKC9bYS16XS9pZykueGV4ZWMoJ2FiYycpO1xyXG4gKiBYUmVnRXhwLmdsb2JhbGl6ZSgvW2Etel0vaSkueGV4ZWMoJ2FiYycpO1xyXG4gKi9cclxuKGZ1bmN0aW9uIChYUmVnRXhwKSB7XHJcbiAgICBcInVzZSBzdHJpY3RcIjtcclxuXHJcbi8qKlxyXG4gKiBDb3B5IHByb3BlcnRpZXMgb2YgYGJgIHRvIGBhYC5cclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtPYmplY3R9IGEgT2JqZWN0IHRoYXQgd2lsbCByZWNlaXZlIG5ldyBwcm9wZXJ0aWVzLlxyXG4gKiBAcGFyYW0ge09iamVjdH0gYiBPYmplY3Qgd2hvc2UgcHJvcGVydGllcyB3aWxsIGJlIGNvcGllZC5cclxuICovXHJcbiAgICBmdW5jdGlvbiBleHRlbmQoYSwgYikge1xyXG4gICAgICAgIGZvciAodmFyIHAgaW4gYikge1xyXG4gICAgICAgICAgICBpZiAoYi5oYXNPd25Qcm9wZXJ0eShwKSkge1xyXG4gICAgICAgICAgICAgICAgYVtwXSA9IGJbcF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgLy9yZXR1cm4gYTtcclxuICAgIH1cclxuXHJcbiAgICBleHRlbmQoWFJlZ0V4cC5wcm90b3R5cGUsIHtcclxuXHJcbi8qKlxyXG4gKiBJbXBsaWNpdGx5IGNhbGxzIHRoZSByZWdleCdzIGB0ZXN0YCBtZXRob2Qgd2l0aCB0aGUgZmlyc3QgdmFsdWUgaW4gdGhlIHByb3ZpZGVkIGFyZ3VtZW50cyBhcnJheS5cclxuICogQG1lbWJlck9mIFhSZWdFeHAucHJvdG90eXBlXHJcbiAqIEBwYXJhbSB7Kn0gY29udGV4dCBJZ25vcmVkLiBBY2NlcHRlZCBvbmx5IGZvciBjb25ncnVpdHkgd2l0aCBgRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5YC5cclxuICogQHBhcmFtIHtBcnJheX0gYXJncyBBcnJheSB3aXRoIHRoZSBzdHJpbmcgdG8gc2VhcmNoIGFzIGl0cyBmaXJzdCB2YWx1ZS5cclxuICogQHJldHVybnMge0Jvb2xlYW59IFdoZXRoZXIgdGhlIHJlZ2V4IG1hdGNoZWQgdGhlIHByb3ZpZGVkIHZhbHVlLlxyXG4gKiBAZXhhbXBsZVxyXG4gKlxyXG4gKiBYUmVnRXhwKCdbYS16XScpLmFwcGx5KG51bGwsIFsnYWJjJ10pOyAvLyAtPiB0cnVlXHJcbiAqL1xyXG4gICAgICAgIGFwcGx5OiBmdW5jdGlvbiAoY29udGV4dCwgYXJncykge1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50ZXN0KGFyZ3NbMF0pO1xyXG4gICAgICAgIH0sXHJcblxyXG4vKipcclxuICogSW1wbGljaXRseSBjYWxscyB0aGUgcmVnZXgncyBgdGVzdGAgbWV0aG9kIHdpdGggdGhlIHByb3ZpZGVkIHN0cmluZy5cclxuICogQG1lbWJlck9mIFhSZWdFeHAucHJvdG90eXBlXHJcbiAqIEBwYXJhbSB7Kn0gY29udGV4dCBJZ25vcmVkLiBBY2NlcHRlZCBvbmx5IGZvciBjb25ncnVpdHkgd2l0aCBgRnVuY3Rpb24ucHJvdG90eXBlLmNhbGxgLlxyXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFN0cmluZyB0byBzZWFyY2guXHJcbiAqIEByZXR1cm5zIHtCb29sZWFufSBXaGV0aGVyIHRoZSByZWdleCBtYXRjaGVkIHRoZSBwcm92aWRlZCB2YWx1ZS5cclxuICogQGV4YW1wbGVcclxuICpcclxuICogWFJlZ0V4cCgnW2Etel0nKS5jYWxsKG51bGwsICdhYmMnKTsgLy8gLT4gdHJ1ZVxyXG4gKi9cclxuICAgICAgICBjYWxsOiBmdW5jdGlvbiAoY29udGV4dCwgc3RyKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRlc3Qoc3RyKTtcclxuICAgICAgICB9LFxyXG5cclxuLyoqXHJcbiAqIEltcGxpY2l0bHkgY2FsbHMge0BsaW5rICNYUmVnRXhwLmZvckVhY2h9LlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cC5wcm90b3R5cGVcclxuICogQGV4YW1wbGVcclxuICpcclxuICogWFJlZ0V4cCgnXFxcXGQnKS5mb3JFYWNoKCcxYTIzNDUnLCBmdW5jdGlvbiAobWF0Y2gsIGkpIHtcclxuICogICBpZiAoaSAlIDIpIHRoaXMucHVzaCgrbWF0Y2hbMF0pO1xyXG4gKiB9LCBbXSk7XHJcbiAqIC8vIC0+IFsyLCA0XVxyXG4gKi9cclxuICAgICAgICBmb3JFYWNoOiBmdW5jdGlvbiAoc3RyLCBjYWxsYmFjaywgY29udGV4dCkge1xyXG4gICAgICAgICAgICByZXR1cm4gWFJlZ0V4cC5mb3JFYWNoKHN0ciwgdGhpcywgY2FsbGJhY2ssIGNvbnRleHQpO1xyXG4gICAgICAgIH0sXHJcblxyXG4vKipcclxuICogSW1wbGljaXRseSBjYWxscyB7QGxpbmsgI1hSZWdFeHAuZ2xvYmFsaXplfS5cclxuICogQG1lbWJlck9mIFhSZWdFeHAucHJvdG90eXBlXHJcbiAqIEBleGFtcGxlXHJcbiAqXHJcbiAqIHZhciBnbG9iYWxDb3B5ID0gWFJlZ0V4cCgncmVnZXgnKS5nbG9iYWxpemUoKTtcclxuICogZ2xvYmFsQ29weS5nbG9iYWw7IC8vIC0+IHRydWVcclxuICovXHJcbiAgICAgICAgZ2xvYmFsaXplOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBYUmVnRXhwLmdsb2JhbGl6ZSh0aGlzKTtcclxuICAgICAgICB9LFxyXG5cclxuLyoqXHJcbiAqIEltcGxpY2l0bHkgY2FsbHMge0BsaW5rICNYUmVnRXhwLmV4ZWN9LlxyXG4gKiBAbWVtYmVyT2YgWFJlZ0V4cC5wcm90b3R5cGVcclxuICogQGV4YW1wbGVcclxuICpcclxuICogdmFyIG1hdGNoID0gWFJlZ0V4cCgnVVxcXFwrKD88aGV4PlswLTlBLUZdezR9KScpLnhleGVjKCdVKzI2MjAnKTtcclxuICogbWF0Y2guaGV4OyAvLyAtPiAnMjYyMCdcclxuICovXHJcbiAgICAgICAgeGV4ZWM6IGZ1bmN0aW9uIChzdHIsIHBvcywgc3RpY2t5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBYUmVnRXhwLmV4ZWMoc3RyLCB0aGlzLCBwb3MsIHN0aWNreSk7XHJcbiAgICAgICAgfSxcclxuXHJcbi8qKlxyXG4gKiBJbXBsaWNpdGx5IGNhbGxzIHtAbGluayAjWFJlZ0V4cC50ZXN0fS5cclxuICogQG1lbWJlck9mIFhSZWdFeHAucHJvdG90eXBlXHJcbiAqIEBleGFtcGxlXHJcbiAqXHJcbiAqIFhSZWdFeHAoJ2MnKS54dGVzdCgnYWJjJyk7IC8vIC0+IHRydWVcclxuICovXHJcbiAgICAgICAgeHRlc3Q6IGZ1bmN0aW9uIChzdHIsIHBvcywgc3RpY2t5KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBYUmVnRXhwLnRlc3Qoc3RyLCB0aGlzLCBwb3MsIHN0aWNreSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH0pO1xyXG5cclxufShYUmVnRXhwKSk7XHJcblxyXG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiMVlpWjVTXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vbm9kZV9tb2R1bGVzL2xvZ2NhdC1wYXJzZS9ub2RlX21vZHVsZXMveHJlZ2V4cC94cmVnZXhwLWFsbC5qc1wiLFwiLy4uL25vZGVfbW9kdWxlcy9sb2djYXQtcGFyc2Uvbm9kZV9tb2R1bGVzL3hyZWdleHBcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG5cbnZhciBwYXJzZXIgPSByZXF1aXJlKCdsb2djYXQtcGFyc2UnKTtcblxudmFyIEdJU1RfSURfUEFUVEVSTiA9IC9eWzAtOWEtZl0rJC9pXG52YXIgQkxBQ0tMSVNUX1RBR1MgPSBbXG4gLyogICBcIkNvbm5lY3Rpdml0eVNlcnZpY2VcIixcbiAgICBcIlBob25lQXBwXCIsXG4gICAgXCJRY3JpbE1zZ1R1bm5lbFNvY2tldFwiLFxuICAgIFwiUGVyZm9ybUJhY2t1cFRhc2tcIixcbiAgICBcImF1ZGlvX2h3X3ByaW1hcnlcIixcbiAgICBcIkF1ZGlvVHJhY2tcIixcbiAgICBcIkF1ZGlvRmxpbmdlclwiLFxuICAgIFwiQXVkaW9Qb2xpY3lNYW5hZ2VyQmFzZVwiLFxuICAgIFwiU3VyZmFjZUZsaW5nZXJcIiovXG4gICAgXTtcblxudmFyICRjb250ZW50ID0gJChcIiNnaXN0LWNvbnRlbnRcIik7XG5cbnZhciBsb2FkR2lzdCA9IGZ1bmN0aW9uKGdpc3RJZCkge1xuICAgIGNvbnNvbGUubG9nKFwiYXR0ZW1wdGluZyB0byBsb2FkIGdpc3Qgd2l0aCBpZCBcIiArIGdpc3RJZCk7XG4gICAgJGNvbnRlbnQuaHRtbChcIkxvYWRpbmcuLi5cIik7XG4gICAgaWYgKCFHSVNUX0lEX1BBVFRFUk4udGVzdChnaXN0SWQpKSB7XG4gICAgICAgICRjb250ZW50LnRleHQoXCJOb3QgYSB2YWxpZCBnaXN0IGlkLlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAkLmdldEpTT04oXCJodHRwczovL2FwaS5naXRodWIuY29tL2dpc3RzL1wiK2dpc3RJZCwgZnVuY3Rpb24oZ2lzdF9pbmZvKSB7XG4gICAgICAgICAgICB2YXIgZmlsZXMgPSBnaXN0X2luZm9bXCJmaWxlc1wiXTtcbiAgICAgICAgICAgIGZvciAodmFyIGZpbGUgaW4gZmlsZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZmlsZXMuaGFzT3duUHJvcGVydHkoZmlsZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coXCJ1c2luZyBmaWxlIFwiICsgZmlsZSk7XG4gICAgICAgICAgICAgICAgICAgIGxvZ2NhdCA9IHBhcnNlci5wYXJzZShmaWxlc1tmaWxlXVtcImNvbnRlbnRcIl0pO1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhsb2djYXQpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZnJhZ21lbnQgPSBcIlwiO1xuICAgICAgICAgICAgICAgICAgICB2YXIgaSwgbGVuO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGkgPSAwLCBsZW4gPSBsb2djYXQubWVzc2FnZXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBsaW5lID0gbG9nY2F0Lm1lc3NhZ2VzW2ldO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEJMQUNLTElTVF9UQUdTLmluZGV4T2YobGluZS50YWcudHJpbSgpKSA8IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcmFnbWVudCArPSBcIiAgPGRpdiBjbGFzcz1cXFwibG9nXFxcIj5cXG5cIjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcmFnbWVudCArPSBcIiAgIDxzcGFuIGNsYXNzPVxcXCJsZWZ0LWJsb2NrXFxcIj5cIjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcmFnbWVudCArPSBcIiAgICA8c3BhbiBjbGFzcz1cXFwidGFnXFxcIj5cIiArIGxpbmUudGFnICsgXCI8L3NwYW4+XFxuXCI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnJhZ21lbnQgKz0gXCIgICAgPHNwYW4gY2xhc3M9XFxcImxldmVsIGxldmVsLVwiK2xpbmUubGV2ZWwrXCJcXFwiPlwiICsgbGluZS5sZXZlbCArIFwiPC9zcGFuPlxcblwiO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZyYWdtZW50ICs9IFwiICAgPC9zcGFuPjxzcGFuIGNsYXNzPVxcXCJyaWdodC1ibG9ja1xcXCI+XCI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZnJhZ21lbnQgKz0gXCIgICAgPHNwYW4gY2xhc3M9XFxcIm1zZ1xcXCI+XCIgKyBsaW5lLm1lc3NhZ2UgKyBcIjwvc3Bhbj5cXG5cIjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcmFnbWVudCArPSBcIiAgIDwvc3Bhbj5cIjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcmFnbWVudCArPSBcIiAgPC9kaXY+XFxuXCI7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgJGNvbnRlbnQuaHRtbChmcmFnbWVudCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIC5mYWlsKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgJGNvbnRlbnQudGV4dChcIkNvdWxkbid0IGxvYWQgdGhlIGdpc3QsIHNvcnJ5LlwiKTtcbiAgICAgICAgfSk7XG59O1xuXG52YXIgbG9hZEhhc2hHaXN0ID0gZnVuY3Rpb24oKSB7IGxvYWRHaXN0KCQudXJsKCkuYXR0cignZnJhZ21lbnQnKSk7IH07XG4kKHdpbmRvdykub24oJ2hhc2hjaGFuZ2UnLCBsb2FkSGFzaEdpc3QpO1xubG9hZEhhc2hHaXN0KCk7XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiMVlpWjVTXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvZmFrZV9jYTdhOWFiZi5qc1wiLFwiL1wiKSJdfQ==
