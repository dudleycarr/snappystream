/*
 * decaffeinate suggestions:
 * DS001: Remove Babel/TypeScript constructor workaround
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS202: Simplify dynamic range loops
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require('async')
const snappy = require('snappy')
const crc32 = require('sse4_crc32')
const int24 = require('int24')
const stream = require('stream')
const util = require('util')

const CHUNKS = {
  streamIdentifier: 0xff,
  compressedData: 0x00,
  uncompressedData: 0x01,
  padding: 0xfe,
  unskippable: __range__(0x02, 0x7f, true),
  skippable: __range__(0x80, 0xfd, true)
}

const STREAM_IDENTIFIER = new Buffer([
  0xff,
  0x06,
  0x00,
  0x00,
  0x73,
  0x4e,
  0x61,
  0x50,
  0x70,
  0x59
])
const MAX_FRAME_DATA_SIZE = 65536

const checksumMask = function (data) {
  const crc32Checksum = crc32.calculate(data)
  return ((crc32Checksum >> 15) | (crc32Checksum << 17)) + 0xa282ead8
}

class SnappyStream extends stream.Transform {
  constructor (options) {
    super(options)
    this.push(STREAM_IDENTIFIER)
  }

  // No buffering of data before producing a compressed frame. If the data size
  // exceeds the size of a frame, then it will automatically be split across
  // frames per the Snappy frame spec.
  _transform (data, encoding, callback) {
    // Split data if need be into chunks no larger than the maximum size for
    // a frame.
    const out = new Buffer(data)
    const dataChunks = (() => {
      const result = []
      for (
        let offset = 0,
          end1 = out.length / MAX_FRAME_DATA_SIZE,
          asc = end1 >= 0;
        asc ? offset <= end1 : offset >= end1;
        asc ? offset++ : offset--
      ) {
        const start = offset * MAX_FRAME_DATA_SIZE
        const end = start + MAX_FRAME_DATA_SIZE
        result.push(out.slice(start, end))
      }
      return result
    })()

    return async.map(
      dataChunks,
      snappy.compress,
      (err, compressedDataChunks) => {
        if (err) {
          return callback(err)
        }

        const frameChunks = []
        for (let frameData of Array.from(compressedDataChunks)) {
          const frameStart = new Buffer(8)
          frameStart.writeUInt8(CHUNKS.compressedData, 0)
          int24.writeUInt24LE(frameStart, 1, frameData.length + 4)
          frameStart.writeUInt32LE(checksumMask(frameData), 4, true)

          frameChunks.push(frameStart)
          frameChunks.push(frameData)
        }

        this.push(Buffer.concat(frameChunks))
        return callback()
      }
    )
  }
}

class UnsnappyStream extends stream.Transform {
  constructor (verifyChecksums = false, options = {}) {
    super(options)
    this.verifyChecksums = verifyChecksums
    this.identifierFound = false
    this.frameBuffer = null
  }

  // Returns snappy compressed payload. Throws an error if the checksum fails
  // provided stream is checking checksums.
  framePayload (data) {
    const frameLength = int24.readUInt24LE(data, 1)
    const mask = data.readUInt32LE(4)
    const payload = data.slice(8, frameLength + 4)

    if (this.verifyChecksums && checksumMask(payload) !== mask) {
      throw new Error('Frame failed checksum')
    }

    return payload
  }

  // Data contains at least one full frame.
  hasFrame (data) {
    return data.length > 4 && int24.readInt24LE(data, 1) + 4 <= data.length
  }

  // Return the buffer starting at the next frame. It assumes that a full frame
  // exists within data.
  toNextFrame (data) {
    const frameLength = int24.readUInt24LE(data, 1)
    return data.slice(4 + frameLength)
  }

  processChunks (chunks, done) {
    const uncompressChunk = function (chunk, cb) {
      if (chunk[0] === CHUNKS.uncompressedData) {
        return cb(null, chunk[1])
      }
      return snappy.uncompress(chunk[1], cb)
    }

    return async.map(chunks, uncompressChunk, (err, data) => {
      if (err) {
        return this.emit('error', err)
      }
      this.push(Buffer.concat(data))
      return done()
    })
  }

  _transform (data, encoding, done) {
    // Tuples of frame ID and frame payload
    const chunks = []

    if (encoding) {
      data = new Buffer(data, encoding)
    }
    if (this.frameBuffer) {
      data = Buffer.concat([this.frameBuffer, data])
    }
    this.frameBuffer = null

    if (
      !this.identifierFound &&
      data.readUInt8(0) !== CHUNKS.streamIdentifier
    ) {
      return this.emit('error', new Error('Missing snappy stream identifier'))
    }

    // Loop only while a full frame is available within data.
    while (this.hasFrame(data)) {
      const frameId = data.readUInt8(0)

      try {
        switch (frameId) {
          case CHUNKS.streamIdentifier:
            if (data.slice(0, 10).toString() !== STREAM_IDENTIFIER.toString()) {
              throw new Error('Invalid stream identifier')
            }
            this.identifierFound = true
            break
          case CHUNKS.compressedData:
            chunks.push([CHUNKS.compressedData, this.framePayload(data)])
            break
          case CHUNKS.uncompressedData:
            chunks.push([CHUNKS.uncompressedData, this.framePayload(data)])
            break
          case Array.from(CHUNKS.unskippable).includes(frameId):
            throw new Error('Encountered unskippable frame')
        }
      } catch (err) {
        return this.emit('error', err)
      }

      data = this.toNextFrame(data)
    }

    if (data.length) {
      this.frameBuffer = data
    }
    if (chunks.length) {
      return this.processChunks(chunks, done)
    } else {
      return done()
    }
  }

  flush (done) {
    if (this.frameBuffer.length) {
      return this.emit('error', new Error('Failed to decompress Snappy stream'))
    }
  }
}

module.exports = { SnappyStream, UnsnappyStream }

function __range__ (left, right, inclusive) {
  let range = []
  let ascending = left < right
  let end = !inclusive ? right : ascending ? right + 1 : right - 1
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i)
  }
  return range
}
