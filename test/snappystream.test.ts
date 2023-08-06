import snappy from 'snappy'
import {SnappyStream} from '../lib/snappystreams'

const sentence = 'the quick brown fox jumped over the lazy dog.'
const txt = [sentence, sentence, sentence].join('\n')

// Generate a snappy stream from data. Return the snappy stream as a string.
async function compress(data: string) {
  const frames: Buffer[] = []
  const compressor = new SnappyStream()
  compressor.write(data)
  compressor.end()

  for await (const frame of compressor) {
    frames.push(frame as Buffer)
  }
  return Buffer.concat(frames)
}

describe('SnappyStream', () => {
  describe('stream identifier', () => {
    let compressedFrames: Buffer
    beforeAll(async () => {
      compressedFrames = await compress(txt)
    })

    it('should have the stream identifier chunk ID', () => {
      expect(compressedFrames.readUInt8(0)).toBe(0xff)
    })

    it('should have the stream identifier chunk size of 6 bytes', () => {
      expect(compressedFrames.readUIntLE(1, 3)).toBe(6)
    })

    it('should have the stream identifier payload', () => {
      expect(compressedFrames.slice(4, 10).toString()).toBe('sNaPpY')
    })
  })

  describe('single compressed frame', () => {
    let compressedData: Buffer
    let compressedFrames: Buffer
    beforeAll(async () => {
      compressedData = await snappy.compress(txt)
      compressedFrames = (await compress(txt)).subarray(10)
    })

    it('should start with the compressed data chunk ID', () => {
      expect(compressedFrames.readUInt8(0)).toBe(0x00)
    })

    it('should have a valid frame size', () => {
      // Frame size is the size of the checksum mask (4 bytes) and the byte
      // length of the snappy compressed data.
      const frameSize = 4 + compressedData.length
      expect(compressedFrames.readUIntLE(1, 3)).toBe(frameSize)
    })

    it('should have a valid checksum mask', () => {
      expect(compressedFrames.readUInt32LE(4)).toBe(0x63885e6b)
    })

    it('should have match decompressed data', async () => {
      const payload = compressedFrames.subarray(8)
      const uncompressedPayload = await snappy.uncompress(payload)
      expect(uncompressedPayload.toString()).toBe(txt)
    })
  })

  describe('multiple compressed frames', () => {
    let data: string
    let compressedFrames: Buffer
    beforeAll(async () => {
      // Two frames worth of data.
      data = new Array(100000).join('a')
      compressedFrames = (await compress(data)).subarray(10)
    })

    it('should have the first chunk start with a compressed data chunk ID', () => {
      expect(compressedFrames.readUInt8(0)).toBe(0x00)
    })

    it('should have the 1st chunk with an uncompressed size of 65,536', async () => {
      const frameSize = compressedFrames.readUIntLE(1, 3)
      const compressedData = compressedFrames.subarray(8, frameSize + 4)

      const frameData = await snappy.uncompress(compressedData)
      expect(frameData.length).toBe(65536)
      expect(frameData.toString()).toBe(data.slice(0, 65536))
    })

    it('should have the 2nd chunk start with a compressed data chunk ID', () => {
      expect(compressedFrames.readUInt8(3085)).toBe(0x00)
    })

    it('should have the 2nd chunk with an uncompressed size of 34,464', async () => {
      const secondFrame = compressedFrames.subarray(3085)
      const frameSize = secondFrame.readUIntLE(1, 3)
      expect(frameSize).toBe(secondFrame.length - 4)

      const frameData = await snappy.uncompress(secondFrame.subarray(8))
      expect(frameData.toString()).toEqual(data.slice(65536))
    })
  })
})
