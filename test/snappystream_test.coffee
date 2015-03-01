should = require 'should'
int24 = require 'int24'
snappy = require 'snappy'
{SnappyStream} = require '../src/snappystreams.coffee'

# Generate a snappy stream from data. Return the snappy stream as a string.
compress = (data, callback) ->
  compressedFrames = new Buffer 0
  compressor = new SnappyStream()

  compressor.on 'readable', ->
    data = compressor.read()
    return unless data

    compressedFrames = Buffer.concat [compressedFrames, data]
  compressor.on 'end', ->
    callback null, compressedFrames

  compressor.write data
  compressor.end()


describe 'SnappyStream', ->
  describe 'stream identifer', ->
    compressedFrames = null

    before (done) ->
      compress 'test', (err, data) ->
        compressedFrames = data
        done()

    it 'should have the stream identifier chunk ID', ->
      compressedFrames.readUInt8(0).should.eql 0xff

    it 'should have the stream identifer chunk size of 6 bytes', ->
      int24.readUInt24LE(compressedFrames, 1).should.eql 6

    it 'should have the stream identifier payload', ->
      compressedFrames[4...10].toString().should.eql 'sNaPpY'

  describe 'single compressed frame', ->
    data = 'test'
    compressedFrames = null
    compressedData = null

    before (done) ->
      snappy.compress data, (err, snappyData) ->
        compressedData = snappyData

        compress data, (err, out) ->
          compressedFrames = out[10..]
          done()

    it 'should start with the compressed data chunk ID', ->
      compressedFrames.readUInt8(0).should.eql 0x00

    it 'should have a valid frame size', ->
      # Frame size is the size of the checksum mask (4 bytes) and the byte
      # length of the snappy compressed data.
      frameSize = 4 + compressedData.length
      int24.readUInt24LE(compressedFrames, 1).should.eql frameSize

    it 'should have a valid checksum mask', ->
      compressedFrames.readUInt32LE(4).should.eql 0x3239074d

    it 'should have match decompressed data', (done) ->
      payload = compressedFrames[8..]
      snappy.uncompress payload, {asBuffer: false},
        (err, uncompressedPayload) ->
          uncompressedPayload.should.eql data
          done()

  describe 'multiple compressed frames', ->
    # Two frames worth of data.
    data = new Array(100000).join 'a'
    compressedFrames = new Buffer 0

    before (done) ->
      compress data, (err, compressedData) ->
        compressedFrames = compressedData[10..]
        done()

    it 'should have the first chunk start with a compressed data chunk ID', ->
      compressedFrames.readUInt8(0).should.eql 0x00

    it 'should have the 1st chunk with an uncompressed size of 65,536',
      (done) ->
        frameSize = int24.readUInt24LE compressedFrames, 1
        compressedData = compressedFrames[8...frameSize+4]

        snappy.uncompress compressedData, (err, frameData) ->
          return done err if err

          frameData.length.should.eql 65536
          frameData.toString().should.eql data[...65536]
          done()

    it 'should have the 2nd chunk start with a compressed data chunk ID', ->
      compressedFrames.readUInt8(3085).should.eql 0x00

    it 'should have the 2nd chunk with an uncompressed size of 34,464',
      (done) ->
        secondFrame = compressedFrames[3085..]
        frameSize = int24.readUInt24LE secondFrame, 1

        frameSize.should.eql secondFrame.length - 4

        snappy.uncompress secondFrame[8..], {asBuffer: false},
          (err, frameData) ->
            return done err if err

            frameData.should.eql data[65536..]
            done()
