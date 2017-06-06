// jQuery-like convience ;)
function $(id) {
  return document.getElementById(id);
}

// TODO: turn this into a hidden field and downloadable datestamped file.
function log(text) {
  $('log').innerHTML += text + '<br>';
}

function isJson(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

// the version of this BPclient/app
var clientVersion = '0.7.0';

// A list of connected websockets.
var connectedSockets = [];

// container for IDs of connected USB serial ports and what is being done with those ports.
var connectedUSB = [];

// Containers for the http and ws servers
var server = new http.Server();
var wsServer = new http.WebSocketServer(server);

// Keep track of the interval that sends the port list so it can be turned off
var portListener = null;

// tag a new serial port for buffer flushing
var serialJustOpened = null;


document.addEventListener('DOMContentLoaded', function() {
  $('connect-disconnect').onclick = function() {
    if($('connect-disconnect').innerHTML === 'Connect') {
      connect_ws($('bpc-port').value, $('bpc-url').value);
      $('connect-disconnect').innerHTML = 'Connected &#10003';
      $('connect-disconnect').className = 'button button-green';
      console.log('Connected');
      openPort('COM3', 115200)
//      openPort('/dev/ttyUSB0', 115200)
          .then(function(){
              talkToProp();
          });
    } else {
      $('connect-disconnect').innerHTML = 'Connect';
      $('connect-disconnect').className = 'button button-blue';
      for (var i = 0; i < connectedSockets.length; i++) {
        connectedSockets[i].close();
      }
      closePort();
      console.log('Disonnected');
    }
  };

  $('open-browser').onclick = function() {
    chrome.browser.openTab({ url: "https://blockly.parallax.com/"});
  };
  
  $('open-settings').onclick = function() {
    if($('settings-pane').style.top === '550px') {
      $('settings-pane').style.top = '10px';
    } else {
      $('settings-pane').style.top = '550px';
    }
  };
  
});

function connect_ws(ws_port, url_path) {
  var port = parseInt(ws_port); //6010;
  var isServer = false;
  if (http.Server && http.WebSocketServer) {
    // Listen for HTTP connections.
    server.listen(port);
    isServer = true;
  
    // Do we need this?
    /*
    server.addEventListener('request', function(req) {
      var url = req.headers.url;
      if (url == '/')
        url = '/index.html';
      // Serve the pages of this chrome application.
      req.serveUrl(url);
      return true;
    });
    */
  
    wsServer.addEventListener('request', function(req) {
      log('Client connected');
      var socket = req.accept();
      connectedSockets.push(socket);
      
      //Listen for ports
      if(portListener === null) {
        portListener = setInterval(function() {sendPortList();}, 5000);
      }
  
      socket.addEventListener('message', function(e) {
        if (isJson(e.data)) {
          var ws_msg = JSON.parse(e.data);
          
          // load the propeller
          if (ws_msg.type === "load-prop") {
            log('Loading Propeller ' + ws_msg.action);
            loadPropeller(socket, ws_msg.action, ws_msg.payload, ws_msg.debug, ws_msg.portPath, ws_msg.success);  // success is a JSON that the browser generates and expects back to know if the load was successful or not
  
          // open or close the serial port for terminal/debug
          } else if (ws_msg.type === "serial-terminal") {
            serialTerminal(socket, ws_msg.action, ws_msg.portPath, ws_msg.baudrate, ws_msg.msg); // action is "open" or "close"
            log('Port ' + ws_msg.action + ' [' + ws_msg.portPath + '] at ' + ws_msg.baudrate + ' baud');
  
          // send an updated port list
          } else if (ws_msg.type === "port-list-request") {
            sendPortList();
  
          // Handle unknown messages
          } else if (ws_msg.type === "hello-browser") {
            helloClient(socket, ws_msg.baudrate || 115200);
            $('connect-disconnect').innerHTML = 'Connected &#10003';
            $('connect-disconnect').className = 'button button-green';
            log('BlocklyProp site connected');
  
          // Handle unknown messages
          } else {
            log('Unknown JSON message: ' + e.data);
          }
        } else {
          log('Unknown message type: ' + e.data);
        }
      });


      // When a socket is closed, remove it from the list of connected sockets.
      socket.addEventListener('close', function() {
        log('Client disconnected');
        for (var i = 0; i < connectedSockets.length; i++) {
          if (connectedSockets[i] == socket) {
            connectedSockets.splice(i, 1);
            break;
          }
        }
        if (connectedSockets.length === 0) {
          $('connect-disconnect').innerHTML = 'Connect';
          $('connect-disconnect').className = 'button button-blue';
          clearInterval(portListener);
          portListener = null;
          chrome.app.window.current().drawAttention();
        }
      });

      return true;
    });

    // TODO: sends messages - eventually delete
    $('input').addEventListener('keydown', function(e) {
      if (e.keyCode == 13) {
        for (var i = 0; i < connectedSockets.length; i++) {
          connectedSockets[i].send(this.value);
        }
        this.value = '';
      }
    });

  }


  //document.addEventListener('DOMContentLoaded', function() {

  /*
    log('This is a test of an HTTP and WebSocket server. This application is ' +
        'serving its own source code on port ' + port + '. Each client ' +
        'connects to the server on a WebSocket and all messages received on ' +
        'one WebSocket are echoed to all connected clients - i.e. a chat ' +
        'server. Enjoy!');
    // FIXME: Wait for 1s so that HTTP Server socket is listening...
    setTimeout(function() {
      //var url_path = 'localhost';
      var address = isServer ? 'ws://' + url_path + ':' + port + '/' :
          window.location.href.replace('http', 'ws');
      var ws = new WebSocket(address);
      ws.addEventListener('open', function() {
        log('Connected');
      });
      ws.addEventListener('close', function() {
        log('Connection lost');
        $('input').disabled = true;
      });
      ws.addEventListener('message', function(e) {
        if(e.data.bread) {
          log('got some bread!');
        } else {
          log(e.data);
        }
      });
      $('input').addEventListener('keydown', function(e) {
        if (ws && ws.readyState == 1 && e.keyCode == 13) {
          ws.send(this.value);
          this.value = '';
        }
      });
    }, 1000);
    
    */
    
  //});
}

function sendPortList() {
  chrome.serial.getDevices(
    function(ports) {
      var pt = [];
      ports.forEach(function(pl) {
        if(pl.path.indexOf('dev/tty') > -1 && pl.path.indexOf('luetoo') === -1) {
          pt.push(pl.path);
        }
      });
      var msg_to_send = {type:'port-list',ports:pt};
      for (var i = 0; i < connectedSockets.length; i++) {
        connectedSockets[i].send(JSON.stringify(msg_to_send));
      }
    }
  );
}

function loadPropeller(sock, action, payload, debug, portPath, success) {
  // TODO: disconnect USB is already active first.
  // TODO: everything else :)
  
  
}


function helloClient(sock, baudrate) {
  var msg_to_send = {type:'hello-client', version:clientVersion};
  sock.send(JSON.stringify(msg_to_send));
}


function serialTerminal(sock, action, portPath, baudrate, msg) {
  // TODO: disconnect USB is already active first.
  if (action === "open") {
    if (portPath.indexOf('dev/tty') === -1) {
      log('Not opening: ' + portPath);
      var msg_to_send = {type:'serial-terminal', msg:'Failed to connect.\rPlease close this terminal and select a connected serial port.'};
      sock.send(JSON.stringify(msg_to_send));
    } else {
      makeConnection(sock, portPath, baudrate, 'debug');
      log('opening ' + portPath);
    }
  } else if (action === "close" && portPath.indexOf('dev/tty') !== -1) {
    breakConnection(portPath);
  } else if (action === "msg") {
    // must be something to send to the device - find its connection ID and send it.    
    var cn, k = null;
    for (cn = 0; cn < connectedUSB.length; cn++) {
      if (connectedUSB[cn].path === portPath) {
        k = cn;
        break;
      }
    }
    if (k !== null) {
      chrome.serial.send(connectedUSB[k].connId, str2ab(msg), function() {
          //log('sent: ' + msg);
      });
    }
  }
}


chrome.serial.onReceive.addListener(function(info) {
  var cn, k = null;
  for (cn = 0; cn < connectedUSB.length; cn++) {
    if (connectedUSB[cn].connId === info.connectionId) {
      k = cn;
      break;
    }
  }
  if(k !== null) {
    var output = null;
    if(connectedUSB[k].mode === 'progNum') {
      output = ab2num(info.data);
    } else {
      output = ab2str(info.data);
      if(connectedUSB[k].mode === 'progStr') {
        
      } else {
        if(serialJustOpened === info.connectionId) {
          chrome.serial.flush(serialJustOpened, function(result) {
            if(result === true) {
              serialJustOpened = null;
            }
          });
        } else {
          // send to terminal in broswer tab
          var msg_to_send = JSON.stringify({type:'serial-terminal', msg:output});
          if(connectedSockets[connectedUSB[k].wsSocket]) {
            connectedSockets[connectedUSB[k].wsSocket].send(msg_to_send);
          }
        }
      }
    }
  } else {
    // NOT 100% SURE ABOUT THIS!!!!
//!!! Commented out the closing of "rouge serial connection(s)" because it's interfering with Propeller programming development work.  May be reinstated later.
//!!!    chrome.serial.disconnect(info.connectionId, function() {console.log('disconnected a rouge serial connection');});
  }
});


var settings = {
  bitrate: 115200,
  dataBits: 'eight',
  parityBit: 'no',
  stopBits: 'one',
  ctsFlowControl: false
};
      
var makeConnection = function(sock, portPath, baudrate, connMode) {
  settings.bitrate = parseInt(baudrate);
      chrome.serial.connect(portPath, {
        'bitrate': settings.bitrate,
        'dataBits': settings.dataBits,
        'parityBit': settings.parityBit,
        'stopBits': settings.stopBits,
        'ctsFlowControl': settings.ctsFlowControl
      }, 
        function(openInfo) {
        if (openInfo === undefined) {
          log('Unable to connect to device<br>');
          //connectedUSB = null;
          //return true;
        } else {
          serialJustOpened = openInfo.connectionId;
          for (var j = 0; j < connectedSockets.length; j++) {
            if (connectedSockets[j] === sock) {
              connectedUSB.push({wsSocket:j, connId:parseInt(openInfo.connectionId), mode:connMode, path:portPath});
              break;
            }
          }
          log('Device connected to [' + openInfo.connectionId + '] ' + portPath);
          
          //return false;
        }
    });
};
 
var breakConnection = function(portPath) {
  var cn, k = null;
  for (cn = 0; cn < connectedUSB.length; cn++) {
    if (connectedUSB[cn].path === portPath && portPath.indexOf('dev/tty') !== -1) {
      k = cn;
      break;
    }
  }
  if (k !== null && connectedUSB[k] !== undefined && connectedUSB.length > 0) {
    chrome.serial.disconnect(connectedUSB[k].connId, function() {
      log('Device [' + connectedUSB[k].connId + '] ' + portPath + ' disconnected');
      connectedUSB.splice(k, 1);
    });
  }
};

// Convert ArrayBuffer to String
var ab2str = function(buf) {
  var bufView = new Uint8Array(buf);
  var unis = [];
  for (var i = 0; i < bufView.length; i++) {
    unis.push(bufView[i]);
  }
  return String.fromCharCode.apply(null, unis);
};

// Convert ArrayBuffer to Number Array
var ab2num = function(buf) {
  var bufView = new Uint8Array(buf);
  var unis = [];
  for (var i = 0; i < bufView.length; i++) {
    unis.push(bufView[i]);
  }
  return unis;

  /* ----- some code for prop programming -----
  handshakeCheck = '';
  PropVersion = '';
  var tn = '';
  for (i = 0; i < unis.length; i++) {
    if(i < 125) {
      if(rxHandshake[i] === unis[i]) 
        handshakeCheck += 'P';
    }
    tn += ' 0x' + unis[i].toString(16) + ',';
  }
  if(unis.length > 128) {
    for (i = 125; i <= 128; i++)
      PropVersion = (PropVersion >> 2 & 0x3F) | ((unis[i] & 0x01) << 6) | ((unis[i] & 0x20) << 2);
  }
  return tn;
  */
  
};

// Converts String to ArrayBuffer.
var str2ab = function(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i = 0; i < str.length; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
};

var getIndexByValue = function(element, value) {
  var list = element.options;
  for (var i = 0; i < list.length; i++) {
    if (list[i].value === value) {
      return i;
    }
  }
};


