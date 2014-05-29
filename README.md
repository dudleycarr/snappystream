snappystream
===========
A NodeJS library for supporting the
[Snappy](https://code.google.com/p/snappy/) framing format via streams. See
the [Snappy Framing Format
Description](https://snappy.googlecode.com/svn/trunk/framing_format.txt) for
details.

[![Build Status](https://travis-ci.org/dudleycarr/snappystream.png?branch=master)](https://travis-ci.org/dudleycarr/snappystream)


[![NPM](https://nodei.co/npm/snappystream.png?downloads=true)](https://nodei.co/npm/snappystream/)

Usage:
SnappyStream and UnsnappyStream are
[Transform streams](http://nodejs.org/api/stream.html#stream_class_stream_transform).

```javascript
var SnappyStream = require('snappystream').SnappyStream;

var in = fs.createReadStream('snappy.txt');
var snappyStream = new SnappyStream();
var out = fs.createWriteStream('snappy_frame.txt')

in.pipe(snappyStream).pipe(out);
```

UnsnappyStream constructor takes an optional argument ```verifyChecksums```
which is false by default.

```javascript
var SnappyStream = require('snappysteam').UnsnappyStream;

var in = fs.createReadStream('snappy_frame.txt');
var unsnappyStream = new UnsnappyStream(true);

unsnappyStream.on('end', function() {
  console.log(unsnappyStream.read());
});

in.pipe(unsnappyStream);
```
