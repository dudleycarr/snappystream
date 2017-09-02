snappystream
===========

A NodeJS library for supporting the
[Snappy](https://code.google.com/p/snappy/) framing format via streams. See
the [Snappy Framing Format
Description](https://github.com/google/snappy/blob/master/framing_format.txt) for
details.

[![Greenkeeper badge](https://badges.greenkeeper.io/dudleycarr/snappystream.svg)](https://greenkeeper.io/)
[![Build Status](https://travis-ci.org/dudleycarr/snappystream.svg?branch=master)](https://travis-ci.org/dudleycarr/snappystream)


[![NPM](https://nodei.co/npm/snappystream.svg?downloads=true)](https://nodei.co/npm/snappystream/)

Usage:
SnappyStream and UnsnappyStream are
[Transform streams](http://nodejs.org/api/stream.html#stream_class_stream_transform).

```javascript
const {SnappyStream} = require('snappystream')

const in = fs.createReadStream('snappy.txt')
const snappyStream = new SnappyStream()
const out = fs.createWriteStream('snappy_frame.txt')

in.pipe(snappyStream).pipe(out)
```

UnsnappyStream constructor takes an optional argument ```verifyChecksums```
which is false by default.

```javascript
const {UnsnappyStream} = require('snappysteam')

const in = fs.createReadStream('snappy_frame.txt')
const unsnappyStream = new UnsnappyStream(true)

unsnappyStream.on('end', function() {
  console.log(unsnappyStream.read())
})

in.pipe(unsnappyStream)
```
