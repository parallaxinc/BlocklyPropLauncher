/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */

// jQuery-like convience ;)
function $(id) {
  return document.getElementById(id);
}

/*
Launcher Communication Port Rules:
  * New download, terminal/graphic request, or "pref-port" message from browser?  Launcher records portPath as the preferred device.
  * Newly-arrived ports (since the last port selection) are marked as new and stay "new" until a different preferred port is selected or the existing preferred port disappears.
    This affords the user certain new-since-selection-change actions.
  * Ports in list are prioritized in this order: preferred (if any), new wired, old wired, new wireless, old wireless.  This elevates the most likely targets higher in the list
    for the user to quickly spot and select, and also takes advantage of browser app behavior to auto-select a port only when we want that to happen.
  * A port is auto-selected (using the preferred and/or browser-side logic) if it is 1) the preferred wired/wireless port, if it exists, or 2) a newly-arrived wired port, if no
    port was already selected (ie: blank port was selected).  This infers intent-to-connect upon direct-wired ports (a natural workflow) while preventing frequent unintended
    connections to wireless ports (since there can be many arriving/departing frequently in large networks or school classrooms).

Port List Updated; sendPortList():
  * 0 ports found?
    * send an empty port list.  This allows system to say "Searching..."
  * 1+ ports found?
    * 0 match preferred port?
      * 0 are new or 1+ are new but are not wired ports?
        * send a blank port (empty string "") followed by the other ports.  This makes the system choose the blank port (user can select a port if desired, or wait for port
          new wired port (or previous port) to arrive).
      * 1+ wired port is new?
        * send new wired port, followed by all the other ports.  This makes the system automatically choose the first (new) port and follow it.
    * 1 matches perferred port?
      * send preferred port first, followed by all the other ports.  This makes the system automatically choose the first (preferred) port and follow it.

System Scenarios (results in parentheses):
  * Start up with no ports ("Searching...") then a new port (preferred or not) arrives (new port automatically selected and followed).
  * Start up with 1 preferred port (automatically selected and followed).
  * Start up with 1 preferred port and 1+ other ports (preferred automatically selected and followed).
  * Start up with 1+ non-preferred ports (no port selected).
  * Non-preferred port already selected then new port arrives (new is listed at top but system continues to follow the selected port).
  * Preferred port already selected then new port arrives (preferred is listed at top, followed by new, but system continues to follow the selected port).
  * Port (preferred or not) already selected, new ports arrive (new, or the preferred port followed by new, is listed at top, system continues to follow the selected port),
    then the selected port disappears (all new ports are now marked as old, system shows no port selected, blank, until either the previously-selected port returns or a new
    wired port arrives in which case system automatically selects the new-arrived wired port).
  * Preferred wireless port selected then disappears and other ports, wired or wireless, may or may not exist (system shows no port selected until either the
    previously-selected port returns or a new wired port arrives in which case system automatically selects the new-arrived wired port.)  User can choose to select a different
    port rather than wait for a port return or new wired port arrival.
*/

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
const defaultVerboseLogging = false;

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
const mdLog     = 16;      // BP Launcher local log
const mdConsole = 32;      // BP Launcher local console

// [Messages]     --- Category(ies) ---   ------- Destination(s) ------
const mUser     = mcUser                +  mdDisplay;
const mStat     = mcStatus              +              mdLog;
const mDbug     = mcStatus              +              mdLog + mdConsole;
const mDeep     = mcVerbose             +                      mdConsole;
const mAll      = mcUser                +  mdDisplay + mdLog + mdConsole;

let logLines = [];
//TODO determine if more messages should be converted to mUser - instead of manually socket.send()'ing them
//TODO allow this to be further filtered with includes/excludes set by app options at runtime
//TODO provide mechanism for this to be a downloadable date-stamped file.
//TODO should filters apply to downloadable file?  Not sure yet.
function log(text = "", type = mStat, socket = null, direction = 0) {
/* Messaging conduit.  Delivers text to one, or possibly many, destination(s) according to the type (which describes a category and destination).
   text is the message to convey.
   type [optional; default mStat] - category and destination(s) that the message applies to.
   socket [optional; default null] - the websocket message received from, or to send an mUser message to; ignored unless type is mdUser or verbose logging enabled.
   direction [optional; default 0] - -1 = prepend '<-' (indicates outgoing socket event); 1 = prepend '->' (indicates incoming socket event)*/

    function stamp(condition) {
        let timeStamp = (condition) ? Date.now().toString().slice(-5) + ': ' : '';
        let socketStamp = (condition && (socket !== null)) ? '[S:'+Math.abs(socket.pSocket_.socketId)+'] ' : '';
        let directionStamp = (!direction) ? '' : ((direction > 0) ? '-> ' : '<- ');
        return timeStamp + socketStamp + directionStamp;
    }

    if (type & (mcUser | mcStatus | mcVerbose)) {
    // Proper type provided
        //Elevate all messages when verbose logging enabled
        if (verboseLogging) {type |= mdLog}
        //Deliver categorized message to proper destination(s)
        if ((type & mdDisplay) && socket !== null) {
            //Send to browser display
            let dispText = text !== "." ? '\r' + text : text;
            socket.send(JSON.stringify({type:'ui-command', action:'message-compile', msg:dispText}));
        }
        if (type & mdLog) {
            //Send to Launcher log view
            let logView = $('log');
            //Note scroll position to maintain current view (user-set or auto-scroll)
            let scrollPosition = logView.scrollTop;
            let autoScroll = (scrollPosition+1 >= logView.scrollHeight-logView.clientHeight);
            //Add log message, delete oldest (if necessary), update display, and reposition view (if necessary)
            logLines.push(stamp(verboseLogging) + text + '<br>');
            let logIsMax = logLines.length > 250;
            //TODO adjust scrollPosition by calculated line height
            if (logIsMax) {logLines.shift(); scrollPosition -= 12;}
            logView.innerHTML = logLines.join('');
            if (autoScroll) {logView.scrollTo(0, logView.scrollHeight)} else {if (logIsMax) {logView.scrollTo(0, scrollPosition)}}
        }
        //Send to Launcher console window
        if (type & mdConsole) {console.log(stamp(true) + text)}
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
var platformStr = ['Unknown', 'Chrome', 'Linux', 'macOS', 'Windows'];

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

// Timer(s) to scan wired ports and send the port list to browser sockets (wireless port scanning defined in wx.js)
var wScannerInterval = null;
var portLister = [];

// Timer to manage possible disableWX/enableWX cycling (resetWX)
var wxEnableDelay = null;

// Default logging and preferred port (could be overridden by stored setting)
var verboseLogging = defaultVerboseLogging;
var storedPreferredPort = '';

document.addEventListener('DOMContentLoaded', function() {

    // Previous subnet mask (for future comparison)
    var sm = null;

    // Determine platform
    chrome.runtime.getPlatformInfo(function(platformInfo) {
        if (!chrome.runtime.lastError) {
            let os = platformInfo.os;
            platform = (os === "cros" ? pfChr : (os === "linux" ? pfLin : (os === "mac" ? pfMac : (os === "win" ? pfWin : pfUnk))));
            $('for-os').innerHTML = 'for ' + platformStr[platform];
        }
    });

    $('version-text').innerHTML = 'v' + clientVersion;

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
                verboseLogging = (result.en_vlog !== undefined) ? result.en_vlog : defaultVerboseLogging;
                $('verbose-logging').checked = verboseLogging;
                storedPreferredPort = (result.pref_port !== undefined) ? result.pref_port : '';
                // Save subnet mask for future comparison (must be done here because chrome.storage.sync is asynchronous)
                sm = sm32bit();
            } else {
                storageError();
            }
        })
    } else {
        log('Launcher settings unavailable - using defaults', mDbug);
        $('bpc-port').value = defaultPort;
        $('bpc-url').value = defaultURL;
        $('sm0').value = defaultSM0;
        $('sm1').value = defaultSM1;
        $('sm2').value = defaultSM2;
        $('sm3').value = defaultSM3;
        $('wx-allow').checked = defaultWX;
        $('verbose-logging').checked = defaultVerboseLogging;
        storedPreferredPort = '';
        // Save subnet mask for future comparison
        sm = sm32bit();
    }

    $('open-blocklypropsolo').onclick = function() {
        chrome.browser.openTab({ url: "https://solo.parallax.com/"});
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
            setTimeout(function() {$('for-os').style.visibility = 'hidden'}, 200);
            setTimeout(function() {$('version-text').style.visibility = 'hidden'}, 200);
            $('settings-pane').style.top = '10px';
            $('open-settings').className = 'button settings-active';
        } else {
            setTimeout(function() {$('for-os').style.visibility = 'visible'}, 350);
            setTimeout(function() {$('version-text').style.visibility = 'visible'}, 350);
            $('settings-pane').style.top = '550px';
            $('open-settings').className = 'button settings';
        }
    };
  
    $('verbose-logging').onclick = function() {
        verboseLogging = $('verbose-logging').checked;
        log((verboseLogging) ? 'Verbose logging enabled' : 'Verbose logging disabled');
        if(chrome.storage) {
            chrome.storage.sync.set({'en_vlog': verboseLogging}, function () {if (chrome.runtime.lastError) {storageError()}});
        }
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

function updatePreferredPort(port, socket) {
/* Remember new preferred port (if not null).
   Returns true if port is new (to this socket); false otherwise.
   socket (required) is the sender associated with this request. */
   let isNewPort = false;
   if (port) {
       // First, store in settings if new
       if (port !== storedPreferredPort) {
           storedPreferredPort = port;
           if (chrome.storage) {
               chrome.storage.sync.set({'pref_port': storedPreferredPort}, function () {if (chrome.runtime.lastError) {storageError()}});
           }
       }
       // Next, set as preferred for this socket, if new (for this socket)
       let lister = portLister.find(function(p) {return p.socket === socket});  //Find the portLister object that belongs to this socket
       isNewPort = (lister) && (lister.prefPort.name !== port);
       if (isNewPort) {
           lister.prefPort = {name: port, exists: true};
           // Since a new port selection was made, set all existing ports to non-new status - applies globally to all connected browsers (sockets)
           clearNewPortStatus();
       }
   }
   return isNewPort;
}

function sm32bit() {
// Convert current subnet mask (string form) to a 32-bit (4-byte) value
    return (parseInt($('sm0').value) << 24) + (parseInt($('sm1').value) << 16) + (parseInt($('sm2').value) << 8) + parseInt($('sm3').value);
}

function storageError() {
// Log Chrome Storage error
    log("Launcher Settings Error: " + chrome.runtime.lastError, mDbug);
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

function updateStatus(socket, connected) {
/* Update visible status of browser connection.
   socket is the socket associated with this event
   connected - true = newly-connected browser socket; false = newly-disconnected. */
    log((connected ? '+ Site connected' : '- Site disconnected'), mDbug, socket);
    // toggle waiting/connected image depending on if at least one browser socket is connected
    connected |= portLister.length;
    $('sys-waiting').style.opacity=(connected ? 0.0 : 1.0);
    $('sys-connected').style.opacity=(connected ? 1.0 : 0.0);
}

function closeServer() {
    wsServer.removeEventListener('request');
    server.close();
    isServer = false;
}

function closeSockets() {
// Close all browser sockets, remove them from ports list and delete their portLister list item
    ports.forEach(function(p) {
        if (p.bSocket) {
            p.bSocket.close();
            p.bSocket = null;
        }});
    while (portLister.length) {deletePortLister(0)}
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
                    log('Received Propeller Application for ' + ws_msg.action, mDbug, socket, 1);
                    updatePreferredPort(ws_msg.portPath, socket);
                    setTimeout(function() {loadPropeller(socket, ws_msg.portPath, ws_msg.action, ws_msg.payload, ws_msg.debug)}, 10);  // success is a JSON that the browser generates and expects back to know if the load was successful or not
                } else if (ws_msg.type === "serial-terminal") {
                    // open or close the serial port for terminal/debug
                    updatePreferredPort(ws_msg.portPath, socket);
                    serialTerminal(socket, ws_msg.action, ws_msg.portPath, ws_msg.baudrate, ws_msg.msg); // action is "open", "close" or "msg"
                } else if (ws_msg.type === "pref-port") {
                    // user selected a new preferred port
                    log('User selected preferred port: ' + ws_msg.portPath, mDbug, socket, 1);
                    if (updatePreferredPort(ws_msg.portPath, socket)) {sendPortList(socket)};
                } else if (ws_msg.type === "port-list-request") {
                    // send an updated port list (and continue on scheduled interval)
                    log('Site requested port list', mDbug, socket, 1);
                    addPortLister(socket);
                } else if (ws_msg.type === "hello-browser") {
                    // handle unknown messages
                    helloClient(socket, ws_msg.baudrate || 115200);
                    updateStatus(socket, true);
                } else if (ws_msg.type === "debug-cts") {
                    // Handle clear-to-send
                    //TODO Add clear-to-send handling code
                } else {
                    // Handle unknown messages
                    log('Unknown JSON message: ' + e.data, mDeep, socket, 1);
                }
            } else {
                // Handle unknown format
                log('Unknown message type: ' + e.data, mDeep, socket, 1);
            }
        });


        socket.addEventListener('close', function() {
            // Browser socket closed; terminate its port scans, remove it from list of ports, and update visible status.
            deletePortLister(portLister.findIndex(function(s) {return s.socket === socket}));
            ports.forEach(function(p) {if (p.bSocket === socket) {p.bSocket = null}});
            updateStatus(socket, false);
        });

        return true;
    });
  }
}

// Port Lister management functions
// The Port Lister items are timers (and sockets) to automatically send wired/wireless port updates to connected browser sockets
function addPortLister(socket) {
//Create new port lister (to send port lists to browser on a timed interval) using last saved preferred port as the default.
//socket is the browser socket to send updates to.
    startPortListerScanner(portLister.push({socket: socket, prefPort: {name: storedPreferredPort, exists: false}})-1);
}

function startPortListerScanner(idx) {
//Start portLister idx's scanner timer
    if (idx > -1) {
        portLister[idx].scanner = setInterval(sendPortList, portListSendInterval, portLister[idx].socket);
        // Fresh start; clear "new" status of ports before sending
        clearNewPortStatus();
        sendPortList(portLister[idx].socket);
    }
}

function stopPortListerScanner(idx) {
//Stop (clear) portLister (idx) scanner timer
    if (idx > -1) {
        if (portLister[idx].scanner) {
            clearInterval(portLister[idx].scanner);
            portLister[idx].scanner = null;
        }
    }
}

function deletePortLister(idx) {
//Clear scanner timer and delete portLister (idx)
    if (idx > -1) {
        stopPortListerScanner(idx);
        portLister.splice(idx, 1);
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

function disableWX(retainWXPorts) {
/* Disable wireless port scanning
   retainWXPorts [optional] - true = keep list of existing wireless ports; false (default) = delete list of existing wireless ports */
    if(wxScannerInterval) {
        clearInterval(wxScannerInterval);
        wxScannerInterval = null;
    }
    if (!retainWXPorts) {
        $('wx-list').innerHTML = '';
        deleteAllWirelessPorts();
    }
}

function resetWX() {
//Cycle WX scanning (off, then on again after delay to receive and clear possible in-progress responses)
    disableWX();
    wxEnableDelay = setTimeout(enableWX, 500);
}

function haltTimedEvents() {
//Halt timed events.  Restart with resumeTimedEvents().
    //Disable wired and wireless port scanning
    log('Halting timed events', mDbug);
    disableW();
    disableWX(true);
    portLister.forEach(function(p, idx) {stopPortListerScanner(idx)});
}

function resumeTimedEvents() {
//Resume timed events that were stopped via haltTimedEvents().
    //Enable wired and wireless port scanning
    log('Resuming timed events', mDbug);
    enableW();
    enableWX();
    portLister.forEach(function(p, idx) {startPortListerScanner(idx)});
}

function scanWPorts() {
// Generate list of current wired ports (filtered according to platform and type)
    //log('Scanning wired ports', mDbug);
    chrome.serial.getDevices(
        function(portlist) {
            let wn = [];
            let wln = [];
            // update wired ports
            portlist.forEach(function(port) {
                // Get consistently formatted port path; If Windows, strip off possible leading port origin path for ease in comparison
                var portPath = ((platform === pfWin) && (port.path.indexOf(winPortOrigin) === 0)) ? port.path.slice(winPortOriginLen) : port.path;
                // Add only proper port types (platform specific and excluding bluetooth ports)
                if ((portPath.indexOf(portPattern[platform]) === 0) && (port.displayName.toLowerCase().indexOf(' bt ') === -1 && port.displayName.toLowerCase().indexOf('bluetooth') === -1)) {
                    addPort({path: port.path});
                }
            });
            ageWiredPorts();  //Note, wired ports age here (just scanned) and wireless ports age elsewhere (where they are scanned)
        }
    );
}

function scanWXPorts() {
// Generate list of current wireless ports
    //log('Scanning wireless ports', mDbug);
    discoverWirelessPorts();
    ageWirelessPorts();
}

function sendPortList(socket) {
/* Send list of current communication ports to browser via socket.
   (See "Launcher Communication Port Rules," above, for detailed rules and scenarios that this function (and ports.js and index.js) implements.)
   List is ordered as: blank (rarely) or preferred (if any) followed by individually sorted groups of new wired, old wired, new wireless, then old wireless ports.
   "New" means newly-arrived (since last port selection changed); "old" means existing since before last port selection changed.*/
    let bp = [];      // Either empty (common) or blank string (rarely)
    let pp = [];      // Peferred port name (qty 0 or 1)
    let nwp = [];     // New wired port name list (often qty 0 or 1)
    let owp = [];     // Old wired port name list (> 0 often)
    let nwlp = [];    // New wireless port name list (=> 0)
    let owlp = [];    // Old Wireless port (=> 0)
    let qty = 0;      // Quantity of ports found

    //Find the portLister object that belongs to this socket
    let lister = portLister.find(function(p) {return p.socket === socket});
    if (lister) {
        // Found our required lister object
        // gather separated port lists (preferred port (if any), new wired/wireless ports (if any), old wired/wireless ports, then sort them)
        ports.forEach(function(p) {
            if (p.name === lister.prefPort.name) {
                pp.push(p.name)
            } else {
                if (p.isWired) {
                    if (p.new) {nwp.push(p.name)} else {owp.push(p.name)}
                } else {
                    if (p.new) {nwlp.push(p.name)} else {owlp.push(p.name)}
                }
            }
        });
        nwp.sort();
        owp.sort();
        nwlp.sort();
        owlp.sort();
        qty = pp.length+nwp.length+owp.length+nwlp.length+owlp.length;

        // Remember when the preferred port exists; otherwise if preferred port just disappeared, clear all "new" port statuses - we only care about new-arrivals since last preferred port selection
        if (pp.length) {lister.prefPort.exists = true} else {if (lister.prefPort.exists) {lister.prefPort.exists = false; clearNewPortStatus();}}

        // report back to editor; blank (rarely), preferred port first (if any), new wired ports (if any), old wired ports, new wireless ports (if any), and finally old wireless ports
        if (qty && !pp.length && !nwp.length) {bp.push("")}  // Send leading blank port only if > 0 ports found, none match the preferred port, and there are no new wired ports
        var msg_to_send = {type:'port-list',ports:bp.concat(pp.concat(nwp.concat(owp.concat(nwlp.concat(owlp)))))};

        log('Sending port list' + (!verboseLogging ? ' (qty '+qty+')' : ': ' + msg_to_send.ports.toString()), mDbug, lister.socket, -1);
        lister.socket.send(JSON.stringify(msg_to_send));
        if (chrome.runtime.lastError) {log(chrome.runtime.lastError, mDbug)}
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

