const async = require('async')
const snappy = require('snappy')
const crc32c = require('fast-crc32c').calculate
const int24 = require('int24')
const stream = require('stream')

const CHUNKS = {
  streamIdentifier: 0xff,
  compressedData: 0x00,
  uncompressedData: 0x01,
  padding: 0xfe,
  unskippable: v => v >= 0x02 && v <= 0x7f
}

const STREAM_IDENTIFIER = Buffer.from([
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
  const c = crc32c(data)
  const result = new Uint32Array(1)
  result[0] = ((c >>> 15) | (c * Math.pow(2, 17))) + 0xa282ead8
  return result[0]
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
    const out = Buffer.from(data)

    const dataChunks = []
    for (let offset = 0; offset < out.length / MAX_FRAME_DATA_SIZE; offset++) {
      const start = offset * MAX_FRAME_DATA_SIZE
      const end = start + MAX_FRAME_DATA_SIZE
      dataChunks.push(out.slice(start, end))
    }

    return async.map(
      dataChunks,
      snappy.compress,
      (err, compressedDataChunks) => {
        if (err) {
          return callback(err)
        }

        const frameChunks = []

        for (let i = 0; i < dataChunks.length; i++) {
          const chunkData = dataChunks[i]
          const frameData = compressedDataChunks[i]

          const frameStart = Buffer.alloc(8)

          let headerType = CHUNKS.compressedData
          let payload = frameData

          // If the improvement isn't more than 12.5% then use uncompressed
          // data.
          if (frameData.length >= (chunkData.length - chunkData.length / 8)) {
            headerType = CHUNKS.uncompressedData
            payload = chunkData
          }

          frameStart.writeUInt8(headerType, 0)
          int24.writeUInt24LE(frameStart, 1, payload.length + 4)
          frameStart.writeUInt32LE(checksumMask(chunkData), 4, true)

          frameChunks.push(frameStart)
          frameChunks.push(payload)
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
  framePayload (frame) {
    const frameLength = int24.readUInt24LE(frame, 1)
    return frame.slice(8, frameLength + 4)
  }

  frameMask (frame) {
    return frame.readUInt32LE(4)
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

  verify (mask, data, callback) {
    if (this.verifyChecksums && checksumMask(data) !== mask) {
      return callback(new Error('Frame failed checksum'))
    }

    callback(null, data)
  }

  processChunks (chunks, done) {
    const uncompressVerify = ([frameType, mask, payload], callback) => {
      async.waterfall([
        // Uncompress daeta if need be
        callback => {
          if (frameType === CHUNKS.uncompressedData) {
            return callback(null, payload)
          }

          snappy.uncompress(payload, callback)
        },
        // Verify
        (uncompressedPayload, callback) => {
          this.verify(mask, uncompressedPayload, callback)
        }
      ],
      callback)
    }

    return async.map(chunks, uncompressVerify, (err, data) => {
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
      data = Buffer.from(data, encoding)
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
            chunks.push([
              CHUNKS.compressedData,
              this.frameMask(data),
              this.framePayload(data)
            ])
            break
          case CHUNKS.uncompressedData:
            chunks.push([
              CHUNKS.uncompressedData,
              this.frameMask(data),
              this.framePayload(data)
            ])
            break
          case CHUNKS.unskippable(frameId):
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
