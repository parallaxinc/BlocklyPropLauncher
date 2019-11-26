/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */

// jQuery-like convience ;)
function $(id) {
  return document.getElementById(id);
}

// Programming metrics
const initialBaudrate = 115200;                     //Initial Propeller communication baud rate (standard boot loader)
const finalBaudrate = 921600;                       //Final Propeller communication baud rate (Micro Boot Loader)

// Defaults
const defaultPort = '6009';
const defaultURL = 'localhost';
const defaultSM0 = '255';
const defaultSM1 = '255';
const defaultSM2 = '255';
const defaultSM3 = '0';
const defaultWX = true;

// Communication metrics (ensure intervals don't coincide)
const portListSendInterval = 5000;
const wDiscoverInterval = 6100;
const wxDiscoverInterval = 3500;

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

// Timer to manage possible disableWX/enableWX cycling (resetWX)
var wxEnableDelay = null;

// Is verbose loggin turned on?
var verboseLogging = false;

document.addEventListener('DOMContentLoaded', function() {

    // Previous subnet mask (for future comparison)
    var sm = null;

    $('version-text').innerHTML = 'v'+clientVersion;

    // Determine platform
    chrome.runtime.getPlatformInfo(function(platformInfo) {
        if (!chrome.runtime.lastError) {
        let os = platformInfo.os;
        platform = (os === "cros" ? pfChr : (os === "linux" ? pfLin : (os === "mac" ? pfMac : (os === "win" ? pfWin : pfUnk))));
        }
    });

    // Restore settings from storage (if possible)
    if(chrome.storage) {
        chrome.storage.sync.get(null, function(result) {
            if (!chrome.runtime.lastError) {
                // Stored values retrieved
                $('bpc-port').value = result.s_port || defaultPort;
                $('bpc-url').value = result.s_url || defaultURL;
                $('sm0').value = result.sm0 || defaultSM0;
                $('sm1').value = result.sm1 || defaultSM1;
                $('sm2').value = result.sm2 || defaultSM2;
                $('sm3').value = result.sm3 || defaultSM3;
                $('wx-allow').checked = (result.en_wx !== undefined) ? result.en_wx : defaultWX;
                // Save subnet mask for future comparison (must be done here because chrome.storage.sync is asynchronous)
                sm = sm32bit();
            } else {
                storageError();
            }
        })
    } else {
        $('bpc-port').value = defaultPort;
        $('bpc-url').value = defaultURL;
        $('sm0').value = defaultSM0;
        $('sm1').value = defaultSM1;
        $('sm2').value = defaultSM2;
        $('sm3').value = defaultSM3;
        $('wx-allow').checked = defaultWX;
        // Save subnet mask for future comparison
        sm = sm32bit();
    }

    $('open-blocklypropsolo').onclick = function() {
        chrome.browser.openTab({ url: "https://solo.parallax.com/"});
    };

    $('open-blocklyprop').onclick = function() {
        chrome.browser.openTab({ url: "https://blockly.parallax.com/"});
    };
  
    // TODO: re-write this to use onblur and/or onchange to auto-save.
    $('refresh-connection').onclick = function() {
        disconnect();
        closeServer();
        if(chrome.storage) {
            chrome.storage.sync.set({'s_port':$('bpc-port').value, 's_url':$('bpc-url').value}, function() {if (chrome.runtime.lastError) {storageError()}});
        }
        connect();
    };

    $('netmask').addEventListener("blur", function() {
        if (sm32bit() !== sm) {
            // Subnet mask changed; retain new mask (for future comparison) and re-discover WX
            sm = sm32bit();
            if (chrome.storage) {
                // Storage available
                chrome.storage.sync.set({'sm0':$('sm0').value, 'sm1':$('sm1').value, 'sm2':$('sm2').value, 'sm3':$('sm3').value}, function () {
                    if (chrome.runtime.lastError) {storageError()}
                })
            }
            resetWX();
        }
    }, true);

    $('open-settings').onclick = function() {
        if($('settings-pane').style.top !== '10px') {
            setTimeout(function() {$('version-text').style.visibility = 'hidden'}, 200);
            $('settings-pane').style.top = '10px';
            $('open-settings').className = 'button settings-active';
        } else {
            setTimeout(function() {$('version-text').style.visibility = 'visible'}, 350);
            $('settings-pane').style.top = '550px';
            $('open-settings').className = 'button settings';
        }
    };
  
    $('bpc-trace').onclick = function() {
        verboseLogging = $('bpc-trace').checked;
    };

    // Enable/disable wireless (WX) port scanning; save setting
    $('wx-allow').onclick = function() {
        if($('wx-allow').checked) {
            enableWX();
        } else {
            disableWX();
        }
        if(chrome.storage) {
            chrome.storage.sync.set({'en_wx': $('wx-allow').checked}, function () {if (chrome.runtime.lastError) {storageError()}});
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

function sm32bit() {
// Convert current subnet mask (string form) to a 32-bit (4-byte) value
    return (parseInt($('sm0').value) << 24) + (parseInt($('sm1').value) << 16) + (parseInt($('sm2').value) << 8) + parseInt($('sm3').value);
}

function storageError() {
// Log Chrome Storage error
    log("Settings Error: " + chrome.runtime.lastError, mDbug);
}

function connect() {
//Connect via websocket to browser and enable wired and wireless port scanning
    connect_ws($('bpc-port').value, $('bpc-url').value);
    enableW();
    enableWX();
}

function disconnect() {
//Disconnect from browser and disable wired and wireless port scanning
    closeSockets();
    disableW();
    disableWX();
}

function updateStatus(connected) {
    if (connected) {
        $('sys-waiting').style.opacity=0.0;
        $('sys-connected').style.opacity=1.0;
        log('BlocklyProp site connected');
    } else {
        $('sys-waiting').style.opacity=1.0;
        $('sys-connected').style.opacity=0.0;
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
    var port = parseInt(ws_port);

    if (http.Server && http.WebSocketServer && !isServer) {
        // Listen for HTTP connections.
        server.listen(port);
        isServer = true;
  
        wsServer.addEventListener('request', function(req) {
            var socket = req.accept();

        socket.addEventListener('message', function(e) {
            if (isJson(e.data)) {
                var ws_msg = JSON.parse(e.data);
                //Note: ws.msg.portPath is now really a "pathless" portName but kept named as-is for legacy support

                if (ws_msg.type === "load-prop") {
                    // load the propeller
                    log('Received Propeller Application for ' + ws_msg.action);
                    setTimeout(function() {loadPropeller(socket, ws_msg.portPath, ws_msg.action, ws_msg.payload, ws_msg.debug)}, 10);  // success is a JSON that the browser generates and expects back to know if the load was successful or not
                } else if (ws_msg.type === "serial-terminal") {
                    // open or close the serial port for terminal/debug
                    serialTerminal(socket, ws_msg.action, ws_msg.portPath, ws_msg.baudrate, ws_msg.msg); // action is "open", "close" or "msg"
                } else if (ws_msg.type === "port-list-request") {
                    // send an updated port list (and continue on scheduled interval)
//                  log("Browser requested port-list for socket " + socket.pSocket_.socketId, mDbug);
                    sendPortList(socket);
                    portLister.push({socket: socket, scanner: setInterval(function() {sendPortList(socket)}, portListSendInterval)});
                } else if (ws_msg.type === "hello-browser") {
                    // handle unknown messages
                    helloClient(socket, ws_msg.baudrate || 115200);
                    updateStatus(true);
                } else if (ws_msg.type === "debug-cts") {
                    // Handle clear-to-send
                    //TODO Add clear-to-send handling code
                } else {
                    // Handle unknown messages
                    log('Unknown JSON message: ' + e.data);
                }
            } else {
                // Handle unknown format
                log('Unknown message type: ' + e.data);
            }
        });


        socket.addEventListener('close', function() {
            // Browser socket closed; terminate its port scans and remove it from list of ports.
            log("Browser socket closing: " + socket.pSocket_.socketId, mDbug);
            let Idx = portLister.findIndex(function(s) {return s.socket === socket});
            if (Idx > -1) {
                clearInterval(portLister[Idx].scanner);
                portLister.splice(Idx, 1);
            }
            ports.forEach(function(p) {if (p.bSocket === socket) {p.bSocket = null}});
            if (!portLister.length) {
                updateStatus(false);
                // chrome.app.window.current().drawAttention();  //Disabled to prevent unnecessary user interruption
            }
        });

        return true;
    });
  }
}

function enableW() {
//Enable periodic wired port scanning
    if (!wScannerInterval) {
        scanWPorts();
        wScannerInterval = setInterval(scanWPorts, wDiscoverInterval);
    }
}

function disableW() {
//Disable wired port scanning
    if(wScannerInterval) {
        clearInterval(wScannerInterval);
        wScannerInterval = null;
    }
}

function enableWX() {
//Enable periodic wireless port scanning (if allowed)
    if (wxEnableDelay) { // Clear WX Enable delay, if any
        clearInterval(wxEnableDelay);
        wxEnableDelay = null;
    }
    if ($('wx-allow').checked) {
        if (!wxScannerInterval) {
            scanWXPorts();
            wxScannerInterval = setInterval(scanWXPorts, wxDiscoverInterval);
        }
    }
}

function disableWX() {
//Disable wireless port scanning
    if(wxScannerInterval) {
        clearInterval(wxScannerInterval);
        wxScannerInterval = null;
    }
    $('wx-list').innerHTML = '';
    deleteAllWirelessPorts();
}

function resetWX() {
//Cycle WX scanning (off, then on again after delay to receive and clear possible in-progress responses)
    disableWX();
    wxEnableDelay = setTimeout(enableWX, 500);
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
        log(chrome.runtime.lastError, mDbug);
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

