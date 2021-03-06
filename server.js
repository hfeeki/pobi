var fs = require('fs')
  , path = require('path')
  , net = require('net')
  , d = require('domain').create()
  , debug = require('./debug')('APP')

// ----

function getLocalIP(callback) {
  var socket = net.createConnection(53, '8.8.8.8');
  socket.on('connect', function() {
    callback(undefined, socket.address().address);
    socket.destroy();
  });
  socket.on('error', function(e) {
    callback(e, 'error');
  });
}

var template = "/tmpl/server.tmpl";

function getConfig(ctx, callback) {
  try {
    var t = fs.readFileSync(path.dirname(__filename)+template, 'utf8');
    var s = tmpl(t, ctx);
    var j = JSON.parse(s);
    callback(undefined, j);
  } catch(x) {
    callback(x);
  }
}

// ---- begin inline underscore template function

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  var templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  var tmpl = function(text, data, settings) {
    settings = settings || templateSettings;

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      }
      if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      }
      if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }
      index = offset + match.length;
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      var render = new Function(settings.variable || 'obj', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data);
    var template = function(data) {
      return render.call(this, data);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

// ---- end inline underscore template function

// ---- exports

exports.tmpl = tmpl;

// ---- main entry

/*
// node http leaks socket, bug 3536
process.on('uncaughtException', function(e){
  debug('UNCAUGHTEXCEPTION', e);
});
*/

// command
// ** on local as a LOCAL (worker ip: 1.2.3.4)

// start local app for shadowsocks / socks5 / vpn
// npm -g start --lodns=udp://192.168.1.1:53 --worker=shadow://pas@1.2.3.4:5678
// npm -g start --lodns=udp://192.168.1.1:53 --worker=socks5://192.168.1.3:7070
// npm -g start --lodns=udp://192.168.1.1:53 --worker=vpn://192.168.5.1

// ** on remote as a WORKER (self ip: 1.2.3.4)

// npm -g start --app=worker --shadow=shadow://pass@0.0.0.0:5678
// npm -g start --app=worker --socks5=socks5://0.0.0.0:7890
// npm -g start --app=worker --vpn=vpn://192.168.5.2

if (!module.parent) {

  var app = process.env.npm_config_app || 'local';
  var lodns = process.env.npm_config_lodns; // || 'udp://192.168.1.1:53';

  if ((lodns == undefined) && (app == 'local')) {
    console.log('It\'s not a bug, but local DNS is needed.');
    console.log('  example: sudo npm start --lodns=udp://192.168.1.1:53');
    console.log('Will run in remote DNS only, it\'s very slow.');
    // console.log('');
    // process.exit(0);
  }

  getLocalIP(function (error, localip) {
    if (error) return console.log('Not Online? error:', error);
    var ip = localip || '127.0.0.1';
    var ctx = {
      local: {
	ip: ip,
	lodns: lodns || 'udp://8.8.8.8:53',
	worker: process.env.npm_config_worker || 'shadow://cool@'+ip+':1027'
      },
      worker: {
	socks5: process.env.npm_config_socks5 || 'socks5://cool@'+ip+':1026',
	shadow: process.env.npm_config_shadow || 'shadow://cool@'+ip+':1027'
      }
    };
    getConfig(ctx, function(error, conf){
      if (error) return console.log('Config fail. error:', error);
      debug('starting %s on %s', app, localip);
      // the config parser
      function config(){
	// debug("%j",conf);
	var args = Array.prototype.slice.call(arguments);
	var val = conf;
	for (var i=0; i<args.length; i++) {
	  var key = args[i];
	  val = val[key];
	  if (!val) {
	    debug("!!!! config('"+args.slice(0,i+1).join()+"'):undefined");
	    break;
	  }
	}
	return val;
      }

      var cfg = config(app);

      // start them one by one
      d.on('error', function(e){
	debug('!!!! ERROR %s %j', e.message, e.stack);
	// debug('!!!! ERROR %s', e.message);
      });
      d.run(function(){
	for(var mod in cfg){
	  var conf = cfg[mod];
	  // debug("start %s:%s %j", app, mod, conf);
	  require('./'+mod).start(conf);
	}
      });

    });
  });
}
