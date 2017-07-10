/* Parallax Inc. ("PARALLAX") CONFIDENTIAL
 Unpublished Copyright (c) 2017 Parallax Inc., All Rights Reserved.

 NOTICE:  All information contained herein is, and remains the property of PARALLAX.  The intellectual and technical concepts contained
 herein are proprietary to PARALLAX and may be covered by U.S. and Foreign Patents, patents in process, and are protected by trade
 secret or copyright law.  Dissemination of this information or reproduction of this material is strictly forbidden unless prior written
 permission is obtained from PARALLAX.  Access to the source code contained herein is hereby forbidden to anyone except current PARALLAX
 employees, managers or contractors who have executed Confidentiality and Non-disclosure agreements explicitly covering such access.

 The copyright notice above does not evidence any actual or intended publication or disclosure of this source code, which includes
 information that is confidential and/or proprietary, and is a trade secret, of PARALLAX.  ANY REPRODUCTION, MODIFICATION, DISTRIBUTION,
 PUBLIC PERFORMANCE, OR PUBLIC DISPLAY OF OR THROUGH USE OF THIS SOURCE CODE WITHOUT THE EXPRESS WRITTEN CONSENT OF PARALLAX IS STRICTLY
 PROHIBITED, AND IN VIOLATION OF APPLICABLE LAWS AND INTERNATIONAL TREATIES.  THE RECEIPT OR POSSESSION OF THIS SOURCE CODE AND/OR
 RELATED INFORMATION DOES NOT CONVEY OR IMPLY ANY RIGHTS TO REPRODUCE, DISCLOSE OR DISTRIBUTE ITS CONTENTS, OR TO MANUFACTURE, USE, OR
 SELL ANYTHING THAT IT MAY DESCRIBE, IN WHOLE OR IN PART.                                                                                */


// TODO: allow user to change port and server IP/addr.  Feilds and button are there, but no supporting code.
// TODO: update bkg img to include S3 robot.
// TODO: Add all linking messages/data for the BlocklyProp site via the websocket connection.

// jQuery-like convience ;)
function $(id) {
  return document.getElementById(id);
}

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
      if (type & mdConsole) {console.log(text)}
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
var clientVersion = '0.7.0';

// Platform metrics (var in DOMContentLoaded listener)
const pfUnk = 0;
const pfChr = 1;
const pfLin = 2;
const pfMac = 3;
const pfWin = 4;
var platform = pfUnk;

/* Serial port ID pattern (index into with platform value)
             Unknown    ChromeOS        Linux             macOS          Windows */
portPattern = ["",   "/dev/ttyUSB",   "dev/tty",   "/dev/cu.usbserial",   "COM"];

// A list of connected websockets.
var sockets = [];

// Http and ws servers
var server = new http.Server();
var wsServer = new http.WebSocketServer(server);
var isServer = false;

// Keep track of the interval that sends the port list so it can be turned off
var portListener = null;

// Is verbose loggin turned on?
var verboseLogging = false;


document.addEventListener('DOMContentLoaded', function() {

  chrome.runtime.getPlatformInfo(function(platformInfo) {
    if (!chrome.runtime.lastError) {
      let os = platformInfo.os;
      platform = (os === "cros" ? pfChr : (os === "linux" ? pfLin : (os === "mac" ? pfMac : (os === "win" ? pfWin : pfUnk))));
    }
  });

  if(chrome.storage) {
    chrome.storage.sync.get('s_port', function(result) {
      $('bpc-port').value = result.s_port || '6009';
    });
    
    chrome.storage.sync.get('s_url', function(result) {
      $('bpc-url').value = result.s_url || 'localhost';
    });
  } else {
    $('bpc-port').value = '6009';
    $('bpc-url').value = 'localhost';
  }

  $('websocket-connect').onclick = function() {
    if($('websocket-connect').innerHTML === 'Connect') {
      connect();
    } else {
      disconnect();
    }
  };

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
    connect_ws($('bpc-port').value, $('bpc-url').value);
  };

  $('open-settings').onclick = function() {
    if($('settings-pane').style.top !== '10px') {
      $('settings-pane').style.top = '10px';
    } else {
      $('settings-pane').style.top = '550px';
    }
  };
  
  $('bpc-trace').onclick = function() {
    verboseLogging = $('bpc-trace').checked;
  };
  
  $('wx-module-tab').onclick = function() {
    if($('wx-module-tab').className === 'tab-unselect') {
      $('wx-module-tab').className = 'tab-selected';
      $('port-path-tab').className = 'tab-unselect';
      $('wx-module-settings').style.display = 'block';
      $('port-path-settings').style.display = 'none';
    }
  };

  $('port-path-tab').onclick = function() {
    if($('port-path-tab').className === 'tab-unselect') {
      $('wx-module-tab').className = 'tab-unselect';
      $('port-path-tab').className = 'tab-selected';
      $('wx-module-settings').style.display = 'none';
      $('port-path-settings').style.display = 'block';
    }
  };

  //Connect automatically upon opening
  setTimeout(connect, 500);
});

function connect() {
  connect_ws($('bpc-port').value, $('bpc-url').value);
}

function disconnect() {
  closeSockets();
}

function updateStatus(connected) {
  if (connected) {
      $('connect-disconnect').innerHTML = '&#10004; Connected';
      $('websocket-connect').innerHTML = 'Disconnect';
      $('ws-button-container').style.visibility = 'visible';
      $('log').style.height = '240px';
      $('connect-disconnect').className = 'status status-green';
      log('BlocklyProp site connected');
  } else {
      $('connect-disconnect').innerHTML = 'Waiting to<br>connect...';
      $('connect-disconnect').className = 'status status-clear';
      $('ws-button-container').style.visibility = 'hidden';
      $('log').style.height = '240px';
      $('websocket-connect').innerHTML = 'Connect';
      log('BlocklyProp site disconnected');
  }
}

function closeServer() {
  wsServer.removeEventListener('request');
  server.close();
  isServer = false;
}

function findSocketIdx(socket) {
/* Return index of socket in sockets list
   Returns -1 if not found*/
    return sockets.findIndex(function(s) {return s.socket === socket});
}

function closeSockets() {
// Close all sockets and remove them from the list
  while (sockets.length) {
    sockets[0].socket.close();
    deleteSocket(0);
  }
}

function deleteSocket(socketOrIdx) {
/* Delete socket from lists (sockets and ports)
   socketOrIdx is socket object or index of socket record to delete*/
  let idx = (typeof socketOrIdx === "number") ? socketOrIdx : findSocketIdx(socketOrIdx);
  if (idx > -1 && idx < sockets.length) {
    // Clear USB's knowledge of socket connection record
    if (sockets[idx].serialIdx > -1) {
      ports[sockets[idx].serialIdx].socket = null;
      ports[sockets[idx].serialIdx].socketIdx = -1;
    }
    // Delete socket connection record and adjust USB's later references down, if any
    sockets.splice(idx, 1);
    ports.forEach(function(v) {if (v.socketIdx > idx) {v.socketIdx--}});
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
      sockets.push({socket:socket, serialIdx:-1});
      
      //Listen for ports
      if(portListener === null) {
        portListener = setInterval(function() {sendPortList();}, 5000);
      }
  
      socket.addEventListener('message', function(e) {
        if (isJson(e.data)) {
          var ws_msg = JSON.parse(e.data);
          
          // load the propeller
          if (ws_msg.type === "load-prop") {
            log('Received Propeller Application for ' + ws_msg.action);
            setTimeout(function() {loadPropeller(socket, ws_msg.portPath, ws_msg.action, ws_msg.payload, ws_msg.debug)}, 10);  // success is a JSON that the browser generates and expects back to know if the load was successful or not
//            var msg_to_send = {type:'ui-command', action:'message-compile', msg:'Working...'};
//            socket.send(JSON.stringify(msg_to_send));


              // open or close the serial port for terminal/debug
          } else if (ws_msg.type === "serial-terminal") {
            serialTerminal(socket, ws_msg.action, ws_msg.portPath, ws_msg.baudrate, ws_msg.msg); // action is "open" or "close"

          // send an updated port list
          } else if (ws_msg.type === "port-list-request") {
            sendPortList();
  
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


      // When a socket is closed, remove it from the list of connected sockets.
      socket.addEventListener('close', function() {
        deleteSocket(socket);
        if (sockets.length === 0) {
          updateStatus(false);
          clearInterval(portListener);
          portListener = null;
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


function sendPortList() {
// find and send list of serial devices (filtered according to platform and type)
  chrome.serial.getDevices(
    function(ports) {
      var pt = [];
      ports.forEach(function(pl) {
        if ((pl.path.indexOf(portPattern[platform]) > -1) && (pl.path.indexOf(' bt ') === -1 && pl.path.indexOf('bluetooth') === -1)) {
          pt.push(pl.path);
        }
      });
      var msg_to_send = {type:'port-list',ports:pt};
      for (var i = 0; i < sockets.length; i++) {
        sockets[i].socket.send(JSON.stringify(msg_to_send));
        if (chrome.runtime.lastError) {
          console.log(chrome.runtime.lastError);
        }
      }
    }
  );
}


function helloClient(sock, baudrate) {
  var msg_to_send = {type:'hello-client', version:clientVersion};
  sock.send(JSON.stringify(msg_to_send));
}

//TODO Check send results and act accordingly?
function serialTerminal(sock, action, portPath, baudrate, msg) {
  if (action === "open") {
    openPort(sock, portPath, baudrate, 'debug')
      .then(function(id) {var cid = id})
      .then(function() {log('Connected terminal to ' + portPath + ' at ' + baudrate + ' baud.');})
      .catch(function() {
        log('Unable to connect terminal to ' + portPath);
        var msg_to_send = {type:'serial-terminal', msg:'Failed to connect.\rPlease close this terminal and select a connected serial port.'};
        sock.send(JSON.stringify(msg_to_send));
      });
  } else if (action === "close") {
    // Terminal closed.  Keep port open because chrome.serial always toggles DTR upon closing (resetting the Propeller) which causes
    // lots of unnecessary confusion (especially if an older version of the user's app is in the Propeller's EEPROM).
    // Instead, update the connection mode so that serial debug data halts.
//      closePort(findPortId(portPath));
    let conn = findPort(portPath);
    if (conn) {conn.mode = 'none'}
  } else if (action === "msg") {
    // Serial message to send to the device
    send(findPortId(portPath), msg);
  }
}

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
};

// Converts String to ArrayBuffer.
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

var str2buf = function(str) {
// Convert str to buffer
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i = 0; i < str.length; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return bufView;
};

var getIndexByValue = function(element, value) {
  var list = element.options;
  for (var i = 0; i < list.length; i++) {
    if (list[i].value === value) {
      return i;
    }
  }
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

// retrieves a value from a byte array, parameters for address, endianness, and number of bytes
function getValueAt(arr, addr, order, byteCount) {
  var o = 0, k;
  if (order === 1) {
    for (k = addr + byteCount - 1; k >= addr; k--) {
      o = o + arr[k];
      if (k !== addr)
        o = o * 256;
    }
  } else {
    for (k = addr; k <= addr + byteCount - 1; k++) {
      o = o + arr[k];
      if (k !== addr + byteCount - 1)
        o = o * 256;
    }
  }
  return o;
}


