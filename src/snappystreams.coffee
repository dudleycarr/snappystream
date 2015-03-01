async = require 'async'
snappy = require 'snappy'
crc32 = require 'sse4_crc32'
int24 = require 'int24'
stream = require 'stream'
util = require 'util'

CHUNKS =
  streamIdentifier: 0xff
  compressedData: 0x00
  uncompressedData: 0x01
  padding: 0xfe
  unskippable: [0x02..0x7f]
  skippable: [0x80..0xfd]

STREAM_IDENTIFIER =
  new Buffer [0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]
MAX_FRAME_DATA_SIZE = 65536

checksumMask = (data) ->
  crc32Checksum = crc32.calculate data
  ((crc32Checksum >> 15) | (crc32Checksum << 17)) + 0xa282ead8


class SnappyStream extends stream.Transform

  constructor: (options) ->
    super options
    @push STREAM_IDENTIFIER

  # No buffering of data before producing a compressed frame. If the data size
  # exceeds the size of a frame, then it will automatically be split across
  # frames per the Snappy frame spec.
  _transform: (data, encoding, callback) ->
    # Split data if need be into chunks no larger than the maximum size for
    # a frame.
    out = new Buffer data
    dataChunks = for offset in [0..out.length / MAX_FRAME_DATA_SIZE]
      start = offset * MAX_FRAME_DATA_SIZE
      end = start + MAX_FRAME_DATA_SIZE
      out[start...end]

    async.map dataChunks, snappy.compress, (err, compressedDataChunks) =>
      return callback err if err

      frameChunks = []
      for frameData in compressedDataChunks
        frameStart = new Buffer 8
        frameStart.writeUInt8 CHUNKS.compressedData, 0
        int24.writeUInt24LE frameStart, 1, frameData.length + 4
        frameStart.writeUInt32LE checksumMask(frameData), 4, true

        frameChunks.push frameStart
        frameChunks.push frameData

      @push Buffer.concat frameChunks
      callback()


class UnsnappyStream extends stream.Transform

  constructor: (@verifyChecksums=false, options={}) ->
    super options
    @identifierFound = false
    @frameBuffer = null

  # Returns snappy compressed payload. Throws an error if the checksum fails
  # provided stream is checking checksums.
  framePayload: (data) ->
    frameLength = int24.readUInt24LE data, 1
    mask = data.readUInt32LE 4
    payload = data[8...frameLength+4]

    if @verifyChecksums and checksumMask(payload) isnt mask
      throw new Error 'Frame failed checksum'

    payload

  # Data contains at least one full frame.
  hasFrame: (data) ->
    data.length > 4 and int24.readInt24LE(data, 1) + 4 <= data.length

  # Return the buffer starting at the next frame. It assumes that a full frame
  # exists within data.
  toNextFrame: (data) ->
    frameLength = int24.readUInt24LE data, 1
    data[4+frameLength..]

  processChunks: (chunks, done) ->
    uncompressChunk = (chunk, cb) ->
      return cb null, chunk[1] if chunk[0] is CHUNKS.uncompressedData
      snappy.uncompress chunk[1], cb

    async.map chunks, uncompressChunk, (err, data) =>
      return @emit 'error', err if err
      @push Buffer.concat data
      done()

  _transform: (data, encoding, done) ->
    # Tuples of frame ID and frame payload
    chunks = []

    data = new Buffer data, encoding if encoding
    data = Buffer.concat [@frameBuffer, data] if @frameBuffer
    @frameBuffer = null

    unless @identifierFound or data.readUInt8(0) is CHUNKS.streamIdentifier
      return @emit 'error', new Error 'Missing snappy stream identifier'

    # Loop only while a full frame is available within data.
    while @hasFrame data
      frameId = data.readUInt8 0

      try
        switch frameId
          when CHUNKS.streamIdentifier
            unless data[0...10].toString() is STREAM_IDENTIFIER.toString()
              throw new Error 'Invalid stream identifier'
            @identifierFound = true
          when CHUNKS.compressedData
            chunks.push [CHUNKS.compressedData, @framePayload data]
          when CHUNKS.uncompressedData
            chunks.push [CHUNKS.uncompressedData, @framePayload data]
          when frameId in CHUNKS.unskippable
            throw new Error 'Encountered unskippable frame'

      catch err
        return @emit 'error', err

      data = @toNextFrame data

    @frameBuffer = data if data.length
    if chunks.length
      @processChunks chunks, done
    else
      done()

  flush: (done) ->
    if @frameBuffer.length
      @emit 'error', new Error 'Failed to decompress Snappy stream'


module.exports = {SnappyStream, UnsnappyStream}
