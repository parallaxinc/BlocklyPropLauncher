/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */


//TODO Study effects of sudden USB port disappearance and try to handle gracefully
//TODO Enhance to protect against (or support) downloading to multiple active ports simultaneously (involves loadPropeller, talkToProp, and hearFromProp)
//TODO Revisit promisify and see if it will clean up code significantly
//TODO Study .bind for opportunities to save scope context of private functions

/***********************************************************
 *                 Serial Support Functions                *
 ***********************************************************/

//TODO Consider enhancing error to indicate if the port is already open (this would only be for developer mistakes though)
function openPort(sock, portName, baudrate, connMode) {
/* Return a promise to open wired or wireless port at portName with baudrate and connect to browser sock.  If wireless, the port is opened
   as a Telnet-based debug service.
   sock can be null to open port without an associated browser socket
   portName is the string name of the wired or wireless port
   baudrate is optional; defaults to initialBaudrate
   connMode is the current point of the connection; 'debug', 'programming'
   Resolves (with nothing); rejects with Error*/
    return new Promise(function(resolve, reject) {
        baudrate = baudrate ? parseInt(baudrate) : initialBaudrate;
        var port = findPort(byName, portName);
        if (port) {
            if (port.isWired) { /*Wired port*/
                if (port.connId) {
                    //Already open; ensure correct baudrate, socket, and connMode, then resolve.
                    updatePort(port, {bSocket: sock, mode: connMode, baud: baudrate})
                        .then(function() {resolve()})
                        .catch(function(e) {reject(e)});
                } else {
                    //Not already open; attempt to open it
                    chrome.serial.connect(port.path, {bitrate: baudrate, dataBits: 'eight', parityBit: 'no', stopBits: 'one', ctsFlowControl: false},
                        function (openInfo) {
                            if (!chrome.runtime.lastError) {
                                // No error; update serial port object
                                updatePort(port, {connId: openInfo.connectionId, bSocket: sock, mode: connMode});
                                port.baud = baudrate;  //Update baud; does not use updatePort() to avoid unnecessary port activity
                                log("Port " + portName + " open with ID " + openInfo.connectionId + " at " + baudrate + " baud", mDbug);
                                resolve();
                            } else {
                                // Error
                                reject(Error(notice(neCanNotOpenPort, [port.name])));
                            }
                        }
                    );
                }
            } else {            /*Wireless port*/
                openSocket(port, false)
                    .then(updatePort(port, {bSocket: sock, mode: connMode, baud: baudrate})
                    .then(function() {resolve()})
                    .catch(function (e) {reject(e)}));
            }
        } else {
            // Error; port record not found
            reject(Error(notice(neCanNotFindPort, [portName])));
        }
    });
}

function openSocket(port, command) {
/* Open Propeller command (HTTP) or debug (Telnet) socket on port
   port is the port's object
   command is true to open HTTP-based command service and false to open Telnet-based Debug service
   Resolves with object describing socket type*/
    return new Promise(function(resolve, reject) {
        let p = (command) ? {socket: "phSocket", portNum: 80} : {socket: "ptSocket", portNum: 23};
        if (port[p.socket]) { // Already open; resolve
            resolve(p);
        } else {              // No ph or pt socket yet; create one and connect to it
            chrome.sockets.tcp.create(function (info) {
                updatePort(port, {[p.socket]: info.socketId});
                chrome.sockets.tcp.connect(port[p.socket], port.ip, p.portNum, function () {
                    //TODO Handle connect result
                    chrome.sockets.tcp.setNoDelay(info.socketId, true, function(result) {
                        if (result < 0) {log("Warning: unable to disable Nagle timer", mDbug)}
                        resolve(p);
                    });
                });
            });
        }
    });
}

//TODO !!! This is no longer a pure-wired-serial function; decide what to do long-term
function closePort(port, command) {
/* Close the port.
   port is the port object
   command [ignored unless wireless] must be true to close socket to Wi-Fi Module's HTTP-based command service and false to close socket to Propeller via Telnet service
   Resolves (with nothing); rejects with Error*/

    return new Promise(function(resolve, reject) {

        function socketClose(socket) {
            // Nullify port's HTTP or Telnet socket reference
            let sID = port[socket];
            if (sID) {
                updatePort(port, {[socket]: null});
                // Disconnect and/or close socket (if necessary)
                chrome.sockets.tcp.getInfo(sID, function(info) {
                    log("Closing wireless port socket " + sID, mDbug);
                    if (info.connected) {
                        chrome.sockets.tcp.disconnect(sID, function() {
                            chrome.sockets.tcp.close(sID, function() {
                                resolve();
                            })
                        })
                    } else {
                        chrome.sockets.tcp.close(sID, function() {
                            resolve();
                        })
                    }
                });
            } else {
                reject(Error(notice(neCanNotClosePort, [port.name])));
            }
        }

        if (port) {
            if (port.isWired) {
                // Wired port
                if (port.connId) {
                    chrome.serial.disconnect(port.connId, function (closeResult) {
                        if (closeResult) {
                            log("Closed port " + port.name + " (id " + port.connId + ")", mDbug);
                            // Clear connection id to indicate port is closed
                            updatePort(port, {connId: null});
                            resolve();
                        } else {
                            log("Could not close port " + port.name + " (id " + port.connId + ")", mDbug);
                            reject(Error(notice(neCanNotClosePort, [port.name])));
                        }
                    });
                }
            } else {
                // Wireless port
                socketClose((command) ? "phSocket" : "ptSocket");
            }
        }

    });
}

//TODO !!! This is no longer a pure-wired-serial function; decide what to do long-term
function changeBaudrate(port, baudrate) {
/* Return a promise that changes the port's baudrate.
   port is the port's object
   baudrate is optional; defaults to finalBaudrate
   Resolves (with nothing); rejects with Error*/
    return new Promise(function(resolve, reject) {
        baudrate = baudrate ? parseInt(baudrate) : finalBaudrate;
        if (port.baud !== baudrate) {
            // Need to change current baudrate
            log("Changing " + port.name + " to " + baudrate + " baud", mDbug);
            if (port.isWired) {
                chrome.serial.update(port.connId, {'bitrate': baudrate}, function (updateResult) {
                    if (updateResult) {
                        port.baud = baudrate;  //Update baud; does not use updatePort() to avoid circular reference
                        resolve();
                    } else {
                        reject(Error(notice(neCanNotSetBaudrate, [port.name, baudrate])));
                    }
                });
            } else {
                //TODO Need to check for errors.
                resetPropComm(port, 1500, sgWXResponse, notice(neCanNotSetBaudrate, [port.name, baudrate]), true);
                openSocket(port, true)
                    .then(function(p) {
                        let postStr = "POST /wx/setting?name=baud-rate&value=" + baudrate + " HTTP/1.1\r\n\r\n";
                        chrome.sockets.tcp.send(port.phSocket, str2ab(postStr), function () {
                            propComm.response
                                .then(function() {port.baud = baudrate; return resolve();})  //Update baud; does not use updatePort() because of circular reference //!!!
                                .catch(function(e) {return reject(e);})
                        });
                    })
                    .catch(function(e) {return reject(e)});
            }
        } else {
            // Port is already set to baudrate
            resolve();
        }
    });
}

function setControl(port, options) {
/* Return a promise that sets/clears the control option(s).
   port is the open port's object*/
    return new Promise(function(resolve, reject) {
        chrome.serial.setControlSignals(port.connId, options, function(controlResult) {
          if (controlResult) {
            resolve();
          } else {
            reject(Error(notice(000, ["Can not set port " + port.name + "'s options: " + options])));
          }
        });
    });
}

function flush(port) {
/* Return a promise that empties the transmit and receive buffers
   port is the open port's object*/
    return new Promise(function(resolve, reject) {
        chrome.serial.flush(port.connId, function(flushResult) {
            if (flushResult) {
              resolve();
            } else {
              reject(Error(notice(000, ["Can not flush port " + port.name + "'s transmit/receive buffer"])));
            }
        });
    });
}

function unPause(port) {
/* Return a promise that unpauses the port
   port is the open port's object*/
    return new Promise(function(resolve) {
        chrome.serial.setPaused(port.connId, false, function() {
            resolve();
        });
    });
}

function ageWiredPorts() {
// Age wired ports and remove those that haven't been seen for some time from the list
    ports.forEach(function(p) {
        if (p.isWired && !--p.life) deletePort(byName, p.name);
    })
}

//TODO !!! This is no longer a pure-wired-serial function; decide what to do long-term
//TODO Check send callback
//TODO Reject with error objects as needed
function send(port, data, command) {
/* Return a promise that transmits data on port.  Port must already be open if wired, may be open or not if wireless.
   port is the port's object
   data is an ArrayBuffer
   command [ignored unless wireless] is true to send to Wi-Fi Module's HTTP-based command service and false to send to Propeller via Telnet service*/
    return new Promise(function(resolve, reject) {
        if (port.isWired) { // Wired port
            if (platform !== pfMac) {
                //Any platform other than Mac? Send as one full packet (any size)
                chrome.serial.send(port.connId, data, function () {
                    resolve();
                });
            } else {
                //Mac platform? Split into smaller chucks (1,024-byte or less) so Mac can transmit properly
                let idx, last, chunk = 1024, macPackets = [];         //Support vars plus array of small buffers to handle "baffling" limited transmission size on a Mac
                for (idx = 0, last = data.byteLength; idx < last; idx += chunk) {
                    let size = Math.min(chunk, last-idx);             //Make size <= 1024
                    macPackets.push(new ArrayBuffer(size));           //Add pre-sized element to macPackets then set data into that element
                    (new Uint8Array(macPackets[macPackets.length-1])).set((new Uint8Array(data)).slice(idx, idx+size), 0);
                }
                //Transmit all packets, one after another
                let transmit = function() {
                    if (macPackets.length) {
                        chrome.serial.send(port.connId, macPackets.shift(), transmit);
                    } else {
                        resolve();
                    }
                };
                transmit();
            }
        } else {            // Wireless port
            openSocket(port, command)
                .then(function (p) {
                    chrome.sockets.tcp.send(port[p.socket], data, function () {
                        //TODO handle send result
                        resolve();
                    });
                })
                .catch(function (e) {reject(e)});
        }
    });
}

//TODO !!! This is no longer a pure-wired-serial function; decide what to do long-term
function debugReceiver(info) {
// Wired and wireless receive listener- routes debug data from Propeller to connected browser when necessary
    let wired = (info.hasOwnProperty("connectionId"));
    let port = wired ? findPort(byCID, info.connectionId) : findPort(byPTID, info.socketId);
    if (port) {
        if (port.mode === 'debug' && port.bSocket) {
            // send to terminal in browser tab
            let offset = 0;
            do {
                let byteCount = Math.min(info.data.byteLength-offset, serPacketMax-port.packet.len);
                port.packet.bufView.set(new Uint8Array(info.data).slice(offset, offset+byteCount), port.packet.len);
                port.packet.len += byteCount;
                offset += byteCount;
                if (port.packet.len === serPacketMax) {
                    sendDebugPacket(port);
                } else if (port.packet.timer === null) {
                    port.packet.timer = setTimeout(sendDebugPacket, serPacketMaxTxTime, port)
                }
            } while (offset < info.data.byteLength);
        }
    }

    function sendDebugPacket(port) {
        if (port.packet.timer !== null) {
            clearTimeout(port.packet.timer);
            port.packet.timer = null;
        }
        if (port.mode === 'debug' && port.bSocket) {
            port.bSocket.send(JSON.stringify({type: 'serial-terminal', packetID: port.packet.id++, msg: btoa(ab2str(port.packet.bufView.slice(0, port.packet.len)))}));
        }
        port.packet.len = 0;
    }
}

//TODO !!! This is no longer a pure-wired-serial function; decide what to do long-term
function serialError(info) {
// Wired and wireless serial error listener.
    if (info.hasOwnProperty("connectionId")) {
        switch (info.error) {
            case "disconnected":
            case "device_lost" :
            case "system_error": deletePort(byCID, info.connectionId);
        }
//        log("Error: PortID "+info.connectionId+" "+info.error, mDeep);
    } else {
        switch (info.resultCode) {
            case -100: //Port closed
                //Find port by Propeller Telnet ID or HTTP ID and clear record
                let port = findPort(byPTID, info.socketId);
                if (port) {
                    updatePort(port, {ptSocket: null});
                } else {
                    port = findPort(byPHID, info.socketId);
                    if (port) {updatePort(port, {phSocket: null})}
                }
                if (port) {
                    log("SocketID " + info.socketId + " connection closed" + ((port) ? " for port " + port.name + "." : "."), mDeep);
                }
                break;
            default:
                log("Error: SocketID " + info.socketId + " Code " + info.resultCode, mDeep);
        }
    }
}

chrome.serial.onReceive.addListener(debugReceiver);
chrome.serial.onReceiveError.addListener(serialError);