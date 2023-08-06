import snappy from 'snappy'
import {SnappyStream, UnsnappyStream} from '../lib/snappystreams'

const STREAM_IDENTIFIER = Buffer.from([
  0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59,
])

describe('UnsnappyStream', () => {
  let data = 'uncompressed frame data'
  let compressedData: Buffer
  let stream: UnsnappyStream
  let frame: Buffer
  const validChecksum = 0xa3051056

  beforeEach(async () => {
    compressedData = await snappy.compress(data)
    stream = new UnsnappyStream()

    frame = Buffer.alloc(8)
    // Frame ID
    frame.writeUInt8(0x00, 0)
    // Frame payload length
    frame.writeUIntLE(4 + compressedData.length, 1, 3)
    // Checksum (invalid)
    frame.writeUInt32LE(0x00, 4)
    // Frame with payload
    frame = Buffer.concat([frame, compressedData])
  })

  describe('framePayload', () => {
    it('unpack a frame without failing checksum check', () => {
      stream.verifyChecksums = false
      return expect(stream.framePayload(frame).toString()).toBe(
        compressedData.toString()
      )
    })

    it('unpack a frame failing checksum check', () => {
      stream.verifyChecksums = true
      return expect(stream.framePayload.bind(frame)).toThrow()
    })

    it('unpack a frame without checksum check with valid checksum', () => {
      frame.writeUInt32LE(validChecksum, 4)
      stream.verifyChecksums = true
      return expect(stream.framePayload(frame).toString()).toBe(
        compressedData.toString()
      )
    })
  })

  describe('hasFrame', () => {
    it('should return false on an empty buffer', () => {
      expect(stream.hasFrame(Buffer.alloc(0))).toBe(false)
    })

    it('should return false given just the frame ID', () => {
      expect(stream.hasFrame(frame.subarray(0, 2))).toBe(false)
    })

    it('should return false given partial length', () => {
      expect(stream.hasFrame(frame.subarray(0, 4))).toBe(false)
    })

    it('should return false given just the length', () => {
      expect(stream.hasFrame(frame.subarray(0, 5))).toBe(false)
    })

    it('should return false given partial frame', () => {
      expect(stream.hasFrame(frame.subarray(0, 11))).toBe(false)
    })

    it('should return true given the whole frame', () => {
      expect(stream.hasFrame(frame)).toBe(true)
    })

    it('should return true given multiple frames', () => {
      expect(stream.hasFrame(Buffer.concat([frame, frame]))).toBe(true)
    })
  })

  describe('toNextFrame', () => {
    it('should return a buffer with the remaining frames', () => {
      const frameWithChecksum = Buffer.from(frame)
      frameWithChecksum.writeUInt32LE(validChecksum, 4)

      const frameSlice = stream.toNextFrame(
        Buffer.concat([frame, frameWithChecksum])
      )
      expect(frameSlice.toString()).toBe(frameWithChecksum.toString())
    })
  })

  describe('processChunks', () => {
    it('should return decompressed data for compressed chunks', async () => {
      const chunks: [number, number | null, Buffer][] = [
        [0x00, null, compressedData],
        [0x00, null, compressedData],
      ]
      await stream.processChunks(chunks)
      expect(stream.read()).toEqual(Buffer.from(data + data))
    })
    it('should return decompressed data for multiple of chunks types', async () => {
      const chunks: [number, number | null, Buffer][] = [
        [0x00, null, compressedData],
        [0x01, null, Buffer.from('hello world')],
      ]
      await stream.processChunks(chunks)
      expect(stream.read()).toEqual(Buffer.from(data + 'hello world'))
    })
  })

  describe('stream identifier', () => {
    it('should fail if stream starts with malformed data', (done) => {
      stream = new UnsnappyStream()
      stream.on('error', (err) => {
        expect(err).toBeTruthy()
        done()
      })
      stream.write('bad snappy frame data')
      stream.end()
    })

    it('should fail if a non-stream identifier frame is first', (done) => {
      stream = new UnsnappyStream()
      stream.on('error', (err) => {
        expect(err).toBeTruthy()
        done()
      })

      const badStreamIdentifier = Buffer.from(STREAM_IDENTIFIER)
      badStreamIdentifier.writeUInt8(0x00, 0)

      stream.write(badStreamIdentifier)
      stream.end()
    })

    it('should silently consume stream header', (done) => {
      stream = new UnsnappyStream()
      stream.on('finish', () => {
        expect(stream.read()).toBeFalsy()
        done()
      })

      stream.write(STREAM_IDENTIFIER)
      stream.end()
    })
  })

  describe('stream processing', () => {
    it('should return the uncompressed data via read', (done) => {
      stream.on('finish', () => {
        const b = stream.read() as Buffer
        expect(b.toString()).toBe(data)
        done()
      })

      stream.write(STREAM_IDENTIFIER)
      stream.write(frame)
      stream.end()
    })
  })

  describe('piping from snappystream to unsnappystream', () => {
    it('should yield the input to snappystream', (done) => {
      data = 'Oh, Snappy!'
      const compressStream = new SnappyStream()
      const decompressStream = new UnsnappyStream(true)

      compressStream.pipe(decompressStream)
      decompressStream.on('finish', () => {
        const b = decompressStream.read() as Buffer
        expect(b.toString()).toBe(data)
        done()
      })

      compressStream.write(data)
      compressStream.end()
    })
  })
})
