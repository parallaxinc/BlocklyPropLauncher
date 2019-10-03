/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */


// TODO: allow user to change port and server IP/addr.  Feilds and button are there, but no supporting code.
// TODO: update bkg img to include S3 robot.
// TODO: Add all linking messages/data for the BlocklyProp site via the websocket connection.

// jQuery-like convience ;)
function $(id) {
  return document.getElementById(id);
}

// Programming metrics
const initialBaudrate = 115200;                     //Initial Propeller communication baud rate (standard boot loader)
const finalBaudrate = 921600;                       //Final Propeller communication baud rate (Micro Boot Loader)

// Messaging types
// These classify messages sent to log() to be routed to one or more destinations (browser dialog, app log, or app/browser console).
// The intention is that such messages can be later filtered via options set in the app itself to make debugging easier.

// [Message Categories]
const mcUser    = 1;       // User message
const mcStatus  = 2;       // Developer status message
const mcVerbose = 4;       // Deep developer status message

// [Message Destinations]
const mdDisplay = 8;       // BP browser display
const mdLog     = 16;      // BP local log
const mdConsole = 32;      // BP local console

// [Messages]     --- Category(ies) ---   ------- Destination(s) ------
const mUser     = mcUser                +  mdDisplay;
const mStat     = mcStatus              +              mdLog;
const mDbug     = mcStatus              +              mdLog + mdConsole;
const mDeep     = mcVerbose             +                      mdConsole;
const mAll      = mcUser                +  mdDisplay + mdLog + mdConsole;

//TODO allow this to be further filtered with includes/excludes set by app options at runtime
//TODO provide mechanism for this to be a downloadable date-stamped file.
//TODO should filters apply to downloadable file?  Not sure yet.
function log(text = "", type = mStat, socket = null) {
/* Messaging conduit.  Delivers text to one, or possibly many, destination(s) according to destination and filter type(s).
   text is the message to convey.
   type is an optional category and destination(s) that the message applies too; defaults to mStat (log status).
   socket is the websocket to send an mUser message to; ignored unless message is an mcUser category.*/
  if (type & (mcUser | mcStatus | mcVerbose)) {
  // Deliver categorized message to proper destination
      if ((type & mdDisplay) && socket !== null) {
          let dispText = text !== "." ? '\r' + text : text;
          socket.send(JSON.stringify({type:'ui-command', action:'message-compile', msg:dispText}))
      }
      if (type & mdLog) {$('log').innerHTML += text + '<br>'}
      if (type & mdConsole) {console.log(Date.now().toString().slice(-5) + ': ' + text)}
  }
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
var clientVersion = chrome.runtime.getManifest().version;

// Platform metrics (var in DOMContentLoaded listener)
const pfUnk = 0;
const pfChr = 1;
const pfLin = 2;
const pfMac = 3;
const pfWin = 4;
var platform = pfUnk;

// Windows default port origin
const winPortOrigin = '\\\\.\\';
const winPortOriginLen = 4;

/* Serial port ID pattern (index into with platform value)
             Unknown    ChromeOS        Linux             macOS          Windows */
portPattern = ["",   "/dev/ttyUSB",   "dev/tty",   "/dev/cu.usbserial",   "COM"];
portDelim =   ["",       "/",            "/",              "/",            "\\"];

// Http and ws servers
var server = new http.Server();
var wsServer = new http.WebSocketServer(server);
var isServer = false;

// Timer(s) to scan and send the port list
var wScannerInterval = null;
var portLister = [];

// Is verbose loggin turned on?
var verboseLogging = false;

document.addEventListener('DOMContentLoaded', function() {

  $('version-text').innerHTML = 'v'+clientVersion;

  chrome.runtime.getPlatformInfo(function(platformInfo) {
    if (!chrome.runtime.lastError) {
      let os = platformInfo.os;
      platform = (os === "cros" ? pfChr : (os === "linux" ? pfLin : (os === "mac" ? pfMac : (os === "win" ? pfWin : pfUnk))));
    }
  });

  if ($('wx-allow').checked) {
    enableWX();
  }

  if(chrome.storage) {
    chrome.storage.sync.get('s_port', function(result) {$('bpc-port').value = result.s_port || '6009';});
    chrome.storage.sync.get('s_url', function(result) {$('bpc-url').value = result.s_url || 'localhost';});
    chrome.storage.sync.get('sm-0', function(result) {$('sm-0').value = result.s_url || '255';});
    chrome.storage.sync.get('sm-1', function(result) {$('sm-1').value = result.s_url || '255';});
    chrome.storage.sync.get('sm-2', function(result) {$('sm-2').value = result.s_url || '255';});
    chrome.storage.sync.get('sm-3', function(result) {$('sm-3').value = result.s_url || '0';});
  } else {
    $('bpc-port').value = '6009';
    $('bpc-url').value = 'localhost';
    $('sm-0').value = '255';
    $('sm-1').value = '255';
    $('sm-2').value = '255';
    $('sm-3').value = '0';
  }

  $('open-browser').onclick = function() {
    chrome.browser.openTab({ url: "https://blockly.parallax.com/"});
  };
  
  // TODO: re-write this to use onblur and/or onchange to auto-save. 
  $('refresh-connection').onclick = function() {
    disconnect();
    closeServer();
    if(chrome.storage) {
      chrome.storage.sync.set({'s_port':$('bpc-port').value}, function() {});
      chrome.storage.sync.set({'s_url':$('bpc-url').value}, function() {});
    }
    connect();
  };

  // TODO: re-write this to use onblur and/or onchange to auto-save. 
  $('save-netmask').onclick = function() {
    if(chrome.storage) {
      chrome.storage.sync.set({'sm-0':$('sm-0').value}, function() {});
      chrome.storage.sync.set({'sm-1':$('sm-1').value}, function() {});
      chrome.storage.sync.set({'sm-2':$('sm-2').value}, function() {});
      chrome.storage.sync.set({'sm-3':$('sm-3').value}, function() {});
    }
  };

  $('open-settings').onclick = function() {
    if($('settings-pane').style.top !== '10px') {
      setTimeout(function() {$('version-text').style.visibility = 'hidden'}, 200);
      $('settings-pane').style.top = '10px';
    } else {
      setTimeout(function() {$('version-text').style.visibility = 'visible'}, 350);
      $('settings-pane').style.top = '550px';
    }
  };
  
  $('bpc-trace').onclick = function() {
    verboseLogging = $('bpc-trace').checked;
  };

  $('wx-allow').onclick = function() {
    var wx_enabled = $('wx-allow').checked;
    if(wx_enabled) {
      enableWX();
    } else {
      disableWX();
    }
  };

  $('wmt').onclick = function() {
    if($('wx-module-tab').className === 'tab-unselect tab-right') {
      $('wx-module-tab').className = 'tab-selected tab-right';
      $('port-path-tab').className = 'tab-unselect tab-left';
      $('wx-module-settings').style.visibility = 'visible';
      $('port-path-settings').style.visibility = 'hidden';
      $('sep-right').style.visibility = 'visible';
      $('sep-left').style.visibility = 'hidden';
      $('cor-left').style.visibility = 'visible';
      $('cor-right').style.visibility = 'hidden';
    }
  };

  $('ppt').onclick = function() {
    if($('port-path-tab').className === 'tab-unselect tab-left') {
      $('wx-module-tab').className = 'tab-unselect tab-right';
      $('port-path-tab').className = 'tab-selected tab-left';
      $('wx-module-settings').style.visibility = 'hidden';
      $('port-path-settings').style.visibility = 'visible';
      $('sep-left').style.visibility = 'visible';
      $('sep-right').style.visibility = 'hidden';
      $('cor-right').style.visibility = 'visible';
      $('cor-left').style.visibility = 'hidden';
    }
  };

  //Connect automatically upon opening
  setTimeout(connect, 500);
});

function connect() {
  connect_ws($('bpc-port').value, $('bpc-url').value);
  scanWPorts();
  wScannerInterval = setInterval(scanWPorts, 6010); // 6010: Scan at different intervals than send processes
}

function disconnect() {
  closeSockets();
  clearInterval(wScannerInterval);
  wScannerInterval = null;
}

function updateStatus(connected) {
  if (connected) {
      $('sys-connected').style.visibility='visible';
      $('sys-waiting').style.visibility='hidden';
//      $('sys-connected').className = 'status status-green';
      log('BlocklyProp site connected');
  } else {
      $('sys-waiting').style.visibility='visible';
      $('sys-connected').style.visibility='hidden';
//      $('sys-connected').className = 'status status-clear';
      log('BlocklyProp site disconnected');
  }
}

function closeServer() {
  wsServer.removeEventListener('request');
  server.close();
  isServer = false;
}

function closeSockets() {
// Close all sockets and remove them from the ports and portLister lists
    ports.forEach(function(p) {
        if (p.bSocket) {
            p.bSocket.close();
            p.bSocket = null;
        }});
    while (portLister.length) {
        clearInterval(portLister[0].scanner);
        portLister.splice(0, 1);
    }
}

function connect_ws(ws_port, url_path) {
  var port = parseInt(ws_port); //6010;
// commented out unused variable
  if (http.Server && http.WebSocketServer && !isServer) {
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
      var socket = req.accept();

      socket.addEventListener('message', function(e) {
        if (isJson(e.data)) {
          var ws_msg = JSON.parse(e.data);
          //Note: ws.msg.portPath is now really a "pathless" portName but kept named as-is for legacy support
          // load the propeller
          if (ws_msg.type === "load-prop") {
            log('Received Propeller Application for ' + ws_msg.action);
            setTimeout(function() {loadPropeller(socket, ws_msg.portPath, ws_msg.action, ws_msg.payload, ws_msg.debug)}, 10);  // success is a JSON that the browser generates and expects back to know if the load was successful or not
          // open or close the serial port for terminal/debug
          } else if (ws_msg.type === "serial-terminal") {
            serialTerminal(socket, ws_msg.action, ws_msg.portPath, ws_msg.baudrate, ws_msg.msg); // action is "open", "close" or "msg"
          // send an updated port list
          } else if (ws_msg.type === "port-list-request") {
          // Send port list now and set up scanner to send port list on regular interval
//            log("Browser requested port-list for socket " + socket.pSocket_.socketId, mDbug);
            sendPortList(socket);
            let s = setInterval(function() {sendPortList(socket)}, 5000);
            portLister.push({socket: socket, scanner: s});
          // Handle unknown messages
          } else if (ws_msg.type === "hello-browser") {
            helloClient(socket, ws_msg.baudrate || 115200);
            updateStatus(true);
          // Handle clear-to-send
          } else if (ws_msg.type === "debug-cts") {
          //TODO Add clear-to-send handling code
          // Handle unknown messages
          } else {
            log('Unknown JSON message: ' + e.data);
          }
        } else {
          log('Unknown message type: ' + e.data);
        }
      });


      // Browser socket closed; terminate its port scans and remove it from list of ports.
      socket.addEventListener('close', function() {
        log("Browser socket closing: " + socket.pSocket_.socketId, mDbug);
        let Idx = portLister.findIndex(function(s) {return s.socket === socket});
        if (Idx > -1) {
            clearInterval(portLister[Idx].scanner);
            portLister.splice(Idx, 1);
        }
        ports.forEach(function(p) {if (p.bSocket === socket) {p.bSocket = null}});
        if (!portLister.length) {
            updateStatus(false);
            chrome.app.window.current().drawAttention();
        }
      });

      return true;
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

function enableWX() {
    scanWXPorts();
    wScannerInterval = setInterval(scanWXPorts, 3500);
}

function disableWX() {
    if(wScannerInterval) {
        clearInterval(wScannerInterval);
        $('wx-list').innerHTML = '';
    }
}

function scanWPorts() {
// Generate list of current wired ports (filtered according to platform and type)
    chrome.serial.getDevices(
        function(portlist) {
            let wn = [];
            let wln = [];
            // update wired ports
            portlist.forEach(function(port) {
                // Get consistently formatted port path; If Windows, strip off possible leading port origin path for ease in comparison
                var portPath = ((platform === pfWin) && (port.path.indexOf(winPortOrigin) === 0)) ? port.path.slice(winPortOriginLen) : port.path;
                // Add only proper port types (platform specific and excluding bluetooth ports)
                if ((portPath.indexOf(portPattern[platform]) === 0) && (port.displayName.indexOf(' bt ') === -1 && port.displayName.indexOf('bluetooth') === -1)) {
                    addPort({path: port.path});
                }
            });
            ageWiredPorts();  //Note, wired ports age here (just scanned) and wireless ports age elsewhere (where they are scanned)
        }
    );
}

function scanWXPorts() {
// Generate list of current wireless ports
    discoverWirelessPorts();
    ageWirelessPorts();
    displayWirelessPorts();
}

function sendPortList(socket) {
// Find and send list of communication ports (filtered according to platform and type) to browser via socket
    let wn = [];
    let wln = [];
//    log("sendPortList() for socket " + socket.pSocket_.socketId, mDbug);
    // gather separated and sorted port lists (wired names and wireless names)
    ports.forEach(function(p) {if (p.isWired) {wn.push(p.name)} else {wln.push(p.name)}});
    wn.sort();
    wln.sort();

    // report back to editor
    var msg_to_send = {type:'port-list',ports:wn.concat(wln)};
    socket.send(JSON.stringify(msg_to_send));
    if (chrome.runtime.lastError) {
      console.log(chrome.runtime.lastError);
      }
}


function helloClient(sock, baudrate) {
  var msg_to_send = {type:'hello-client', version:clientVersion};
  sock.send(JSON.stringify(msg_to_send));
}

//TODO Check send results and act accordingly?
//TODO refactor to combine usb and wx-based port code efficiently
function serialTerminal(sock, action, portName, baudrate, msg) {
  // Find port from portName
  let port = findPort(byName, portName);
  if (port) {
      // Convert msg from string or buffer to an ArrayBuffer
      if (typeof msg === 'string') {
          msg = str2ab(msg);
      } else {
          if (msg instanceof ArrayBuffer === false) {msg = buf2ab(msg);}
      }
      if (action === "open") {
          // Open port for terminal use
          openPort(sock, port.name, baudrate, 'debug')
              .then(function() {log('Connected terminal to ' + portName + ' at ' + baudrate + ' baud.');})
              .catch(function() {
                  log('Unable to connect terminal to ' + portName);
                  var msg_to_send = {type:'serial-terminal', msg:'Failed to connect.\rPlease close this terminal and select a connected port.'};
                  sock.send(JSON.stringify(msg_to_send));
              });
      } else if (action === "close") {
          /* Terminal closed.  Keep wired port open because chrome.serial always toggles DTR upon closing (resetting the Propeller) which causes
             lots of unnecessary confusion (especially if an older version of the user's app is in the Propeller's EEPROM).
             Instead, update the connection mode so that serial debug data halts.*/
          port.mode = 'none';
      } else if (action === "msg") {
          // Message to send to the Propeller
          if ((port.isWired && port.connId) || (port.isWireless && port.ptSocket)) { //Send only if port is open
              send(port, msg, false);
          }
      }
  } else {
      var msg_to_send = {type:'serial-terminal', msg:'Port ' + portName + ' not found.\rPlease close this terminal and select an existing port.'};
      sock.send(JSON.stringify(msg_to_send));
  }
}

var ab2str = function(buf) {
// Convert ArrayBuffer to String
  var bufView = new Uint8Array(buf);
  var unis = [];
  for (var i = 0; i < bufView.length; i++) {
    unis.push(bufView[i]);
  }
  return String.fromCharCode.apply(null, unis);
};

var str2ab = function(str, len = null) {
// Convert str to array buffer, optionally of size len
    if (!len) {
        len = str.length;
    }
    var buf = new ArrayBuffer(len);
    var bufView = new Uint8Array(buf);
    for (var i = 0; i < Math.min(len, str.length); i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
};

var buf2ab = function (buffer) {
// Convert buffer to ArrayBuffer
    var buf = new ArrayBuffer(buffer.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0; i < buffer.length; i++) {
        bufView[i] = buffer[i];
    }
    return buf;
};

var str2buf = function(str) {
// Convert str to buffer
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i = 0; i < str.length; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
};

function isNumber(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

// calculate the checksum of a Propeller program image:
function checksumArray(arr, l) {
  if (!l) l = arr.length;
  var chksm = 236;
  for (var a = 0; a < l; a++) {
    chksm = arr[a] + chksm;
  }
  chksm = (256 - chksm) & 255;
  return chksm;
}

