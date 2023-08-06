import {compress, uncompress} from 'snappy'
import {crc32c} from '@node-rs/crc32'
import stream from 'stream'

const CHUNKS = {
  streamIdentifier: 0xff,
  compressedData: 0x00,
  uncompressedData: 0x01,
  padding: 0xfe,
  unskippable: (v: number) => (v >= 0x02 && v <= 0x7f ? v : -1),
}

const STREAM_IDENTIFIER = Buffer.from([
  0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59,
])
const MAX_FRAME_DATA_SIZE = 65536

const checksumMask = (data: Buffer | string) => {
  const c = crc32c(data)
  const result = new Uint32Array(1)
  result[0] = ((c >>> 15) | (c * Math.pow(2, 17))) + 0xa282ead8
  return result[0]
}

export class SnappyStream extends stream.Transform {
  constructor(options?: stream.TransformOptions) {
    super(options)
    this.push(STREAM_IDENTIFIER)
  }

  // No buffering of data before producing a compressed frame. If the data size
  // exceeds the size of a frame, then it will automatically be split across
  // frames per the Snappy frame spec.
  _transform(
    data: Buffer | string,
    _: BufferEncoding,
    callback: (err?: Error) => void
  ) {
    // Split data if need be into chunks no larger than the maximum size for
    // a frame.
    const out = Buffer.from(data)

    const dataChunks: Buffer[] = []
    for (let offset = 0; offset < out.length / MAX_FRAME_DATA_SIZE; offset++) {
      const start = offset * MAX_FRAME_DATA_SIZE
      const end = start + MAX_FRAME_DATA_SIZE
      dataChunks.push(out.subarray(start, end))
    }
    Promise.all(dataChunks.map((chunk) => compress(chunk)))
      .then((compressedDataChunks) => {
        const frameChunks: Buffer[] = []
        for (let i = 0; i < dataChunks.length; i++) {
          const chunkData = dataChunks[i]!
          const frameData = compressedDataChunks[i]!

          const frameStart = Buffer.alloc(8)

          let headerType = CHUNKS.compressedData
          let payload = frameData

          // If the improvement isn't more than 12.5% then use uncompressed
          // data.
          if (frameData.length >= chunkData.length - chunkData.length / 8) {
            headerType = CHUNKS.uncompressedData
            payload = chunkData
          }

          frameStart.writeUInt8(headerType, 0)
          frameStart.writeUintLE(payload.length + 4, 1, 3)
          frameStart.writeUInt32LE(checksumMask(chunkData), 4)

          frameChunks.push(frameStart)
          frameChunks.push(payload)
        }

        this.push(Buffer.concat(frameChunks))
        return callback()
      })
      .catch((err: Error) => {
        callback(err)
      })
  }
}

export class UnsnappyStream extends stream.Transform {
  public verifyChecksums: boolean
  private identifierFound: boolean
  private frameBuffer: Buffer | null

  constructor(verifyChecksums = false, options = {}) {
    super(options)
    this.verifyChecksums = verifyChecksums
    this.identifierFound = false
    this.frameBuffer = null
  }

  // Returns snappy compressed payload. Throws an error if the checksum fails
  // provided stream is checking checksums.
  framePayload(frame: Buffer) {
    const frameLength = frame.readUIntLE(1, 3)
    return frame.subarray(8, frameLength + 4)
  }

  frameMask(frame: Buffer) {
    return frame.readUInt32LE(4)
  }

  // Data contains at least one full frame.
  hasFrame(data: Buffer) {
    return data.length > 4 && data.readUIntLE(1, 3) + 4 <= data.length
  }

  // Return the buffer starting at the next frame. It assumes that a full frame
  // exists within data.
  toNextFrame(data: Buffer) {
    const frameLength = data.readUIntLE(1, 3)
    return data.subarray(4 + frameLength)
  }

  verify(mask: number | null, data: Buffer | string) {
    if (this.verifyChecksums && checksumMask(data) !== mask) {
      throw new Error('Frame failed checksum')
    }
  }

  async processChunks(
    chunks: [number, number | null, Buffer][],
    done?: (err?: Error) => void
  ) {
    const verify = this.verify.bind(this)
    try {
      const uncompressFrames = await Promise.all(
        chunks.map(async (chunk) => {
          const [frameType, mask, payload] = chunk
          const uncompressedData =
            frameType === CHUNKS.uncompressedData
              ? payload
              : await uncompress(payload)
          verify(mask, uncompressedData)
          return Buffer.isBuffer(uncompressedData)
            ? uncompressedData
            : Buffer.from(uncompressedData)
        })
      )
      this.push(Buffer.concat(uncompressFrames))
      if (done) {
        done()
      }
    } catch (err) {
      this.emit('error', err)
    }
  }

  _transform(
    data: Buffer | string,
    encoding: BufferEncoding | null,
    done: (err?: Error) => void
  ) {
    // Tuples of frame ID and frame payload
    const chunks: [number, number | null, Buffer][] = []

    let _data = encoding
      ? Buffer.from(data as string, encoding)
      : (data as Buffer)
    if (this.frameBuffer) {
      _data = Buffer.concat([this.frameBuffer, _data])
    }
    this.frameBuffer = null

    if (
      !this.identifierFound &&
      _data.readUInt8(0) !== CHUNKS.streamIdentifier
    ) {
      return this.emit('error', new Error('Missing snappy stream identifier'))
    }

    // Loop only while a full frame is available within data.
    while (this.hasFrame(_data)) {
      const frameId = _data.readUInt8(0)

      try {
        switch (frameId) {
          case CHUNKS.streamIdentifier:
            if (
              _data.subarray(0, 10).toString() !== STREAM_IDENTIFIER.toString()
            ) {
              return this.emit('error', new Error('Invalid stream identifier'))
            }
            this.identifierFound = true
            break
          case CHUNKS.compressedData:
            chunks.push([
              CHUNKS.compressedData,
              this.frameMask(_data),
              this.framePayload(_data),
            ])
            break
          case CHUNKS.uncompressedData:
            chunks.push([
              CHUNKS.uncompressedData,
              this.frameMask(_data),
              this.framePayload(_data),
            ])
            break
          case CHUNKS.unskippable(frameId):
            return this.emit(
              'error',
              new Error('Encountered unskippable frame')
            )
        }
      } catch (err) {
        return this.emit('error', err)
      }

      _data = this.toNextFrame(_data)
    }

    if (_data.length) {
      this.frameBuffer = _data
    }

    if (chunks.length) {
      return this.processChunks(chunks, done)
    } else {
      return done()
    }
  }

  _flush(done: (err?: Error) => void) {
    const err = this.frameBuffer?.length
      ? new Error('Failed to decompress Snappy stream')
      : undefined
    done(err)
  }
}
