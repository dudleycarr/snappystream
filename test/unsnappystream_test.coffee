should = require 'should'
int24 = require 'int24'
snappy = require 'snappy'
{SnappyStream, UnsnappyStream} = require '../src/snappystreams.coffee'

STREAM_IDENTIFIER = new Buffer [0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50,
        0x70, 0x59]

describe 'UnsnappyStream', ->
  data = 'uncompressed frame data'
  compressedData = null
  validChecksum = 0xa3051056
  stream = null
  frame = null

  beforeEach (done) ->
    snappy.compress data, (err, snappyData) ->
      return done err if err

      compressedData = snappyData
      stream = new UnsnappyStream()

      frame = new Buffer 8
      # Frame ID
      frame.writeUInt8 0x00, 0
      # Frame payload length
      int24.writeUInt24LE frame, 1, 4 + compressedData.length
      # Checksum (invalid)
      frame.writeUInt32LE 0x00, 4
      # Frame with payload
      frame = Buffer.concat [frame, compressedData]

      done()

  describe 'framePayload', ->
    it 'unpack a frame without failing checksum check', ->
      stream.verifyChecksum = false
      stream.framePayload(frame).toString().should.eql compressedData.toString()

    it 'unpack a frame failing checksum check', ->
      stream.verifyChecksum = true
      stream.framePayload.bind(frame).should.throw

    it 'unpack a frame without checksum check with valid checksum', ->
      frame.writeUInt32LE validChecksum, 4
      stream.verifyChecksum = true
      stream.framePayload(frame).toString().should.eql compressedData.toString()

  describe 'hasFrame', ->
    it 'should return false on an empty buffer', ->
      stream.hasFrame(new Buffer 0).should.be.false

    it 'should return false given just the frame ID', ->
      stream.hasFrame(frame[0..1]).should.be.false

    it 'should return false given partial length', ->
      stream.hasFrame(frame[0..3]).should.be.false

    it 'should return false given just the length', ->
      stream.hasFrame(frame[0..4]).should.be.false

    it 'should return false given partial frame', ->
      stream.hasFrame(frame[0..10]).should.be.false

    it 'should return true given the whole frame', ->
      stream.hasFrame(frame).should.be.true

    it 'should return true given multiple frames', ->
      stream.hasFrame(Buffer.concat [frame, frame]).should.be.true

  describe 'toNextFrame', ->
    it 'should return a buffer with the remaining frames', ->
      frameWithChecksum = new Buffer frame
      frameWithChecksum.writeUInt32LE validChecksum, 4

      frameSlice = stream.toNextFrame Buffer.concat [frame, frameWithChecksum]
      frameSlice.toString().should.eql frameWithChecksum.toString()

  describe 'processChunks', ->
    it 'should return decompressed data for compressed chunks', (done) ->
      chunks = [[0x00, compressedData], [0x00, compressedData]]
      stream.processChunks chunks, ->
        stream.read().should.eql new Buffer data + data
        done()
    it 'should return decompressed data for multiple of chunks types', (done) ->
      chunks = [[0x00, compressedData], [0x01, new Buffer 'hello world']]
      stream.processChunks chunks, ->
        stream.read().should.eql new Buffer data + 'hello world'
        done()

  describe 'stream identifer', ->
    it 'should fail if stream starts with malformed data', (done) ->
      stream = new UnsnappyStream()
      stream.on 'error', (err) ->
        err.should.exist
        done()
      stream.write 'bad snappy frame data'
      stream.end()

    it 'should fail if a non-stream identifer frame is first', (done) ->
      stream = new UnsnappyStream()
      stream.on 'error', (err) ->
        err.should.exist
        done()

      badStreamIdentifier = new Buffer STREAM_IDENTIFIER
      badStreamIdentifier.writeUInt8 0x00, 0

      stream.write badStreamIdentifier
      stream.end()

    it 'should silently consume stream header', (done) ->
      stream = new UnsnappyStream()
      stream.on 'finish', ->
        should(stream.read()).not.exist
        done()

      stream.write STREAM_IDENTIFIER
      stream.end()

  describe 'stream processing', ->
    it 'should return the uncompressed data via read', (done) ->
      stream.on 'finish', ->
        stream.read().toString().should.eql data
        done()

      stream.write STREAM_IDENTIFIER
      stream.write frame
      stream.end()

  describe 'piping from snappystream to unsnappystream', ->
    it 'should yield the input to snappystream', (done) ->
      data = 'Oh, Snappy!'
      compressStream = new SnappyStream()
      decompressStream = new UnsnappyStream true

      compressStream.pipe decompressStream
      decompressStream.on 'finish', ->
        decompressStream.read().toString().should.eql data
        done()

      compressStream.write data
      compressStream.end()
