//jQuery-like convience ;)
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

// A list of connected websockets.
var connectedSockets = [];

// ID of the connected USB serial port.
var connectedUSB = null;

// Containers for the http and ws servers
var server = new http.Server();
var wsServer = new http.WebSocketServer(server);

// Keep track of the interval that sends the port list so it can be turned off
var portListener = null;


document.addEventListener('DOMContentLoaded', function() {
  $('connect-disconnect').onclick = function() {
    if($('connect-disconnect').innerHTML === 'Connect') {
      connect_ws($('bpc-port').value, $('bpc-url').value);
      $('connect-disconnect').innerHTML = 'Connected &#10003';
      $('connect-disconnect').className = 'button button-green';
    } else {
      $('connect-disconnect').innerHTML = 'Connect';
      $('connect-disconnect').className = 'button button-blue';
      for (var i = 0; i < connectedSockets.length; i++) {
        connectedSockets[i].close();
      }
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
            log('Loading Propeller ' + ws_msg.action + '<br>');
            loadPropeller(ws_msg.action, ws_msg.payload, ws_msg.debug, ws_msg.portPath, ws_msg.success);  // success is a JSON that the browser generates and expects back to know if the load was successful or not
  
          // open or close the serial port for terminal/debug
          } else if (ws_msg.type === "serial-terminal") {
            serialTerminal(ws_msg.action, ws_msg.portPath, ws_msg.baudrate); // action is "open" or "close"
            log('Port ' + ws_msg.action + ' [' + ws_msg.portPath + '] at ' + ws_msg.baudrate + ' baud<br>');
  
          // send an updated port list
          } else if (ws_msg.type === "port-list-request") {
            sendPortList();
  
          // Handle unknown messages
          } else {
            log('Unknown message type: ' + e.data + '<br>');
          }
        } else {
          log('Unknown message type: ' + e.data + '<br>');
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

function loadPropeller(action, payload, debug, portPath, success) {
  
  
}

function serialTerminal(action, portPath, baudrate) {
  if (action === "open") {
    makeConnection(portPath, baudrate);
  } else {
    breakConnection();
  }
}


chrome.serial.onReceive.addListener(function(info) {
  if(info.connectionId === connectedUSB) {
    var output = null;
    if(displayChars === true) {
      output = ab2str(info.data);
    } else {
      output = ab2num(info.data);
    }
    // TODO: do something with the ouptut - send?  Use during Prop Programming...
  }
});


var settings = {
  dataBits: 'eight',
  parityBit: 'no',
  stopBits: 'one',
  ctsFlowControl: false
};
      
var makeConnection = function(portPath, baudrate) {
      chrome.serial.connect(portPath, {
        'bitrate': buadrate,
        'dataBits': settings.dataBits,
        'parityBit': settings.parityBit,
        'stopBits': settings.stopBits,
        'ctsFlowControl': settings.ctsFlowControl
      }, 
        function(openInfo) {
        if (openInfo === undefined) {
          log('Unable to connect to device<br>');
          connectedUSB = null;
          return true;
        } else {
          connectedUSB = parseInt(openInfo.connectionId);
          log('Device connected to [' + connectedUSB + '] ' + portPath + '<br>');
          return false;
        }
    });
};
 
var breakConnection = function() {
  if(connectedUSB !== null) {
      chrome.serial.disconnect(connectedUSB, function() {
      connectedUSB = null;
      log('Device disconnected<br>');
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
  handshakeCheck = '';
  PropVersion = '';
  var bufView = new Uint8Array(buf);
  var unis = [];
  var tn = '';
  for (var i = 0; i < bufView.length; i++) {
    unis.push(bufView[i]);
  }
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


