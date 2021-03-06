var camp = require('camp').start({
  port: process.env.PORT||+process.argv[2]||80
});
var https = require('https');
var badge = require('./badge.js');
var svg2img = require('./svg-to-img.js');
var serverStartTime = new Date((new Date()).toGMTString());

// Travis integration.
camp.route(/^\/travis\/(.*)\.(svg|png|gif|jpg)$/,
function(data, match, end, ask) {
  var userRepo = match[1];  // eg, `joyent/node`.
  var format = match[2];
  var apiUrl = 'https://api.travis-ci.org/repositories/' + userRepo + '.json';
  var badgeData = {text:['build', 'n/a'], colorscheme:'lightgrey'};
  https.get(apiUrl, function(res) {
    var buffer = '';
    res.on('data', function(chunk) { buffer += ''+chunk; });
    res.on('end', function(chunk) {
      if (chunk) { buffer += ''+chunk; }
      try {
        var data = JSON.parse(buffer);
      } catch(e) {
        badgeData.text[1] = 'invalid';
        badge(badgeData, makeSend(format, ask.res, end));
        return;
      }
      if (data.last_build_status === 0) {
        badgeData.text[1] = 'passing';
        badgeData.colorscheme = 'green';
      } else if (data.last_build_status === 1) {
        badgeData.text[1] = 'failing';
        badgeData.colorscheme = 'red';
      } else if (data.last_build_status === null) {
        badgeData.text[1] = 'pending';
        badgeData.colorscheme = 'yellow';
      } else {
        badgeData.text[1] = 'n/a';
        badgeData.colorscheme = 'lightgrey';
      }
      badge(badgeData, makeSend(format, ask.res, end));
    });
  }).on('error', function(e) {
    badgeData.text[1] = 'inaccessible';
    badge(badgeData, makeSend(format, ask.res, end));
  });
});

// Any badge.
camp.route(/^\/:(([^-]|--)+)-(([^-]|--)+)-(([^-]|--)+)\.(svg|png|gif|jpg)$/,
function(data, match, end, ask) {
  var subject = escapeFormat(match[1]);
  var status = escapeFormat(match[3]);
  var color = escapeFormat(match[5]);
  var format = match[7];

  // Cache management.
  var cacheDuration = (3600*24*1)|0;  // 1 day.
  ask.res.setHeader('Cache-Control', 'public, max-age=' + cacheDuration);
  if (+(new Date(ask.req.headers['if-modified-since'])) >= +serverStartTime) {
    ask.res.statusCode = 304;
    ask.res.end();  // not modified.
    return;
  }
  ask.res.setHeader('Last-Modified', serverStartTime.toGMTString());

  // Badge creation.
  try {
    var badgeData = {text: [subject, status]};
    if (sixHex(color)) {
      badgeData.colorB = '#' + color;
    } else {
      badgeData.colorscheme = color;
    }
    badge(badgeData, makeSend(format, ask.res, end));
  } catch(e) {
    badge({text: ['error', 'bad badge'], colorscheme: 'red'},
      makeSend(format, ask.res, end));
  }
});

// Escapes `t` using the format specified in
// <https://github.com/espadrine/gh-badges/issues/12#issuecomment-31518129>
function escapeFormat(t) {
  return t
    // Inline single underscore.
    .replace(/([^_])_([^_])/g, '$1 $2')
    // Leading or trailing underscore.
    .replace(/([^_])_$/, '$1 ').replace(/^_([^_])/, ' $1')
    // Double underscore and double dash.
    .replace(/__/g, '_').replace(/--/g, '-');
}

function sixHex(s) { return /^[0-9a-fA-F]{6}$/.test(s); }

function makeSend(format, askres, end) {
  if (format === 'svg') {
    return function(res) { sendSVG(res, askres, end); };
  } else {
    return function(res) { sendOther(format, res, askres, end); };
  }
}

function sendSVG(res, askres, end) {
  askres.setHeader('Content-Type', 'image/svg+xml');
  end(null, {template: streamFromString(res)});
}

function sendOther(format, res, askres, end) {
  askres.setHeader('Content-Type', 'image/' + format);
  svg2img(res, format, askres);
}

var stream = require('stream');
function streamFromString(str) {
  var newStream = new stream.Readable();
  newStream._read = function() { newStream.push(str); newStream.push(null); };
  return newStream;
}
