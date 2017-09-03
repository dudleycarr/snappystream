const should = require('should')
const int24 = require('int24')
const snappy = require('snappy')
const { SnappyStream, UnsnappyStream } = require('../lib/snappystreams')

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

describe('UnsnappyStream', () => {
  let data = 'uncompressed frame data'
  let compressedData = null
  const validChecksum = 0xa3051056
  let stream = null
  let frame = null

  beforeEach(done =>
    snappy.compress(data, function (err, snappyData) {
      if (err) {
        return done(err)
      }

      compressedData = snappyData
      stream = new UnsnappyStream()

      frame = Buffer.alloc(8)
      // Frame ID
      frame.writeUInt8(0x00, 0)
      // Frame payload length
      int24.writeUInt24LE(frame, 1, 4 + compressedData.length)
      // Checksum (invalid)
      frame.writeUInt32LE(0x00, 4)
      // Frame with payload
      frame = Buffer.concat([frame, compressedData])

      return done()
    })
  )

  describe('framePayload', () => {
    it('unpack a frame without failing checksum check', () => {
      stream.verifyChecksum = false
      return stream
        .framePayload(frame)
        .toString()
        .should.eql(compressedData.toString())
    })

    it('unpack a frame failing checksum check', () => {
      stream.verifyChecksum = true
      return stream.framePayload.bind(frame).should.throw
    })

    return it('unpack a frame without checksum check with valid checksum', () => {
      frame.writeUInt32LE(validChecksum, 4)
      stream.verifyChecksum = true
      return stream
        .framePayload(frame)
        .toString()
        .should.eql(compressedData.toString())
    })
  })

  describe('hasFrame', () => {
    it('should return false on an empty buffer', () =>
      stream.hasFrame(Buffer.alloc(0)).should.be.false)

    it('should return false given just the frame ID', () =>
      stream.hasFrame(frame.slice(0, 2)).should.be.false)

    it('should return false given partial length', () =>
      stream.hasFrame(frame.slice(0, 4)).should.be.false)

    it('should return false given just the length', () =>
      stream.hasFrame(frame.slice(0, 5)).should.be.false)

    it('should return false given partial frame', () =>
      stream.hasFrame(frame.slice(0, 11)).should.be.false)

    it('should return true given the whole frame', () =>
      stream.hasFrame(frame).should.be.true)

    return it('should return true given multiple frames', () =>
      stream.hasFrame(Buffer.concat([frame, frame])).should.be.true)
  })

  describe('toNextFrame', () =>
    it('should return a buffer with the remaining frames', () => {
      const frameWithChecksum = Buffer.from(frame)
      frameWithChecksum.writeUInt32LE(validChecksum, 4)

      const frameSlice = stream.toNextFrame(
        Buffer.concat([frame, frameWithChecksum])
      )
      return frameSlice.toString().should.eql(frameWithChecksum.toString())
    }))

  describe('processChunks', () => {
    it('should return decompressed data for compressed chunks', done => {
      const chunks = [[0x00, null, compressedData], [0x00, null, compressedData]]
      return stream.processChunks(chunks, () => {
        stream.read().should.eql(Buffer.from(data + data))
        return done()
      })
    })
    return it('should return decompressed data for multiple of chunks types',
      done => {
        const chunks = [[0x00, null, compressedData], [0x01, null, Buffer.from('hello world')]]
        return stream.processChunks(chunks, () => {
          stream.read().should.eql(Buffer.from(data + 'hello world'))
          return done()
        })
      })
  })

  describe('stream identifer', () => {
    it('should fail if stream starts with malformed data', done => {
      stream = new UnsnappyStream()
      stream.on('error', err => {
        should.exist(err)
        return done()
      })
      stream.write('bad snappy frame data')
      return stream.end()
    })

    it('should fail if a non-stream identifer frame is first', done => {
      stream = new UnsnappyStream()
      stream.on('error', err => {
        should.exist(err)
        return done()
      })

      const badStreamIdentifier = Buffer.from(STREAM_IDENTIFIER)
      badStreamIdentifier.writeUInt8(0x00, 0)

      stream.write(badStreamIdentifier)
      return stream.end()
    })

    return it('should silently consume stream header', done => {
      stream = new UnsnappyStream()
      stream.on('finish', () => {
        should.not.exist(stream.read())
        return done()
      })

      stream.write(STREAM_IDENTIFIER)
      return stream.end()
    })
  })

  describe('stream processing', () =>
    it('should return the uncompressed data via read', done => {
      stream.on('finish', () => {
        stream
          .read()
          .toString()
          .should.eql(data)
        return done()
      })

      stream.write(STREAM_IDENTIFIER)
      stream.write(frame)
      return stream.end()
    }))

  return describe('piping from snappystream to unsnappystream', () =>
    it('should yield the input to snappystream', done => {
      data = 'Oh, Snappy!'
      const compressStream = new SnappyStream()
      const decompressStream = new UnsnappyStream(true)

      compressStream.pipe(decompressStream)
      decompressStream.on('finish', () => {
        decompressStream
          .read()
          .toString()
          .should.eql(data)
        return done()
      })

      compressStream.write(data)
      return compressStream.end()
    }))
})
