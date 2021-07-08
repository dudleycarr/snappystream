const int24 = require('int24')
const snappy = require('snappy')
const {SnappyStream} = require('../lib/snappystreams')

const sentence = 'the quick brown fox jumped over the lazy dog.'
const txt = [sentence, sentence, sentence].join('\n')

// Generate a snappy stream from data. Return the snappy stream as a string.
function compress(data, callback) {
  let compressedFrames = Buffer.alloc(0)
  const compressor = new SnappyStream()

  compressor.on('readable', () => {
    data = compressor.read()
    if (!data) {
      return
    }

    return (compressedFrames = Buffer.concat([compressedFrames, data]))
  })
  compressor.on('end', () => callback(null, compressedFrames))

  compressor.write(data)
  return compressor.end()
}

describe('SnappyStream', () => {
  describe('stream identifer', () => {
    let compressedFrames = null

    beforeEach((done) => {
      compress(txt, (err, data) => {
        compressedFrames = data
        return done(err)
      })
    })

    it('should have the stream identifier chunk ID', () => {
      expect(compressedFrames.readUInt8(0)).toBe(0xff)
    })

    it('should have the stream identifer chunk size of 6 bytes', () => {
      expect(int24.readUInt24LE(compressedFrames, 1)).toBe(6)
    })

    it('should have the stream identifier payload', () => {
      expect(compressedFrames.slice(4, 10).toString()).toBe('sNaPpY')
    })
  })

  describe('single compressed frame', () => {
    let compressedFrames = null
    let compressedData = null

    beforeEach((done) =>
      snappy.compress(txt, (err, snappyData) => {
        if (err) {
          return done(err)
        }
        compressedData = snappyData

        return compress(txt, (err, out) => {
          compressedFrames = out.slice(10)
          return done(err)
        })
      })
    )

    it('should start with the compressed data chunk ID', () => {
      expect(compressedFrames.readUInt8(0)).toBe(0x00)
    })

    it('should have a valid frame size', () => {
      // Frame size is the size of the checksum mask (4 bytes) and the byte
      // length of the snappy compressed data.
      const frameSize = 4 + compressedData.length
      expect(int24.readUInt24LE(compressedFrames, 1)).toBe(frameSize)
    })

    it('should have a valid checksum mask', () => {
      expect(compressedFrames.readUInt32LE(4)).toBe(0x63885e6b)
    })

    it('should have match decompressed data', (done) => {
      const payload = compressedFrames.slice(8)
      return snappy.uncompress(
        payload,
        {asBuffer: false},
        (err, uncompressedPayload) => {
          expect(uncompressedPayload).toBe(txt)
          return done(err)
        }
      )
    })
  })

  describe('multiple compressed frames', () => {
    // Two frames worth of data.
    const data = new Array(100000).join('a')
    let compressedFrames = Buffer.alloc(0)

    beforeEach((done) => {
      compress(data, (err, compressedData) => {
        compressedFrames = compressedData.slice(10)
        return done(err)
      })
    })

    it('should have the first chunk start with a compressed data chunk ID', () => {
      expect(compressedFrames.readUInt8(0)).toBe(0x00)
    })

    it('should have the 1st chunk with an uncompressed size of 65,536', (done) => {
      const frameSize = int24.readUInt24LE(compressedFrames, 1)
      const compressedData = compressedFrames.slice(8, frameSize + 4)

      return snappy.uncompress(compressedData, (err, frameData) => {
        if (err) {
          return done(err)
        }

        expect(frameData.length).toBe(65536)
        expect(frameData.toString()).toBe(data.slice(0, 65536))
        return done()
      })
    })

    it('should have the 2nd chunk start with a compressed data chunk ID', () => {
      expect(compressedFrames.readUInt8(3085)).toBe(0x00)
    })

    it('should have the 2nd chunk with an uncompressed size of 34,464', (done) => {
      const secondFrame = compressedFrames.slice(3085)
      const frameSize = int24.readUInt24LE(secondFrame, 1)

      expect(frameSize).toBe(secondFrame.length - 4)

      return snappy.uncompress(
        secondFrame.slice(8),
        {asBuffer: false},
        function (err, frameData) {
          if (err) {
            return done(err)
          }

          expect(frameData).toEqual(data.slice(65536))
          return done()
        }
      )
    })
  })
})
