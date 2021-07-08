# snappystream

A Node.js library for supporting the
[Snappy](https://code.google.com/p/snappy/) framing format via streams. See
the [Snappy Framing Format
Description](https://github.com/google/snappy/blob/master/framing_format.txt) for
details.

Usage:
SnappyStream and UnsnappyStream are
[Transform streams](http://nodejs.org/api/stream.html#stream_class_stream_transform).

```javascript
const {SnappyStream} = require('snappystream')
const fs = require('fs')

const inStream = fs.createReadStream('snappy.txt')
const snappyStream = new SnappyStream()
const outStream = fs.createWriteStream('snappy_frame.txt')

inStream.pipe(snappyStream).pipe(outStream)
```

UnsnappyStream constructor takes an optional argument `verifyChecksums`
which is false by default.

```javascript
const {UnsnappyStream} = require('snappysteam')
const fs = require('fs')

const inStream = fs.createReadStream('snappy_frame.txt')
const unsnappyStream = new UnsnappyStream(true)

unsnappyStream.on('end', function () {
  console.log(unsnappyStream.read())
})

inStream.pipe(unsnappyStream)
```
