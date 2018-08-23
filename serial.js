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


//TODO Study effects of sudden USB port disappearance and try to handle gracefully
//TODO Enhance to protect against (or support) downloading to multiple active ports simultaneously (involves loadPropeller, talkToProp, and hearFromProp)
//TODO Revisit promisify and see if it will clean up code significantly
//TODO Study .bind for opportunities to save scope context of private functions

/***********************************************************
 *                 Serial Support Functions                *
 ***********************************************************/

//TODO Consider returning error object
//TODO Consider enhancing error to indicate if the port is already open (this would only be for developer mistakes though)
function openPort(sock, portPath, baudrate, connMode) {
/* Return a promise to open serial port at portPath with baudrate and connect to sock.
   sock can be null to open serial port without an associated socket
   portPath is the string path to the wired serial port
   baudrate is optional; defaults to initialBaudrate
   connMode is the current point of the connection; 'debug', 'programming'
   Resolves (with nothing); rejects with Error*/
    return new Promise(function(resolve, reject) {
        baudrate = baudrate ? parseInt(baudrate) : initialBaudrate;
        var port = findPort(byPath, portPath);
        if (port) {
            if (port.connId) {
                //Already open; ensure correct baudrate, socket, and connMode, then resolve.
                updatePort(port.connId, sock, connMode, portPath, "", baudrate)
                    .then(function() {resolve()})
                    .catch(function (e) {reject(e)});
            } else {
                //Not already open; attempt to open it
                chrome.serial.connect(portPath, {
                        'bitrate': baudrate,
                        'dataBits': 'eight',
                        'parityBit': 'no',
                        'stopBits': 'one',
                        'ctsFlowControl': false
                    },
                    function (openInfo) {
                        if (!chrome.runtime.lastError) {
                            // No error; update serial port object
                            updatePort(openInfo.connectionId, sock, connMode, portPath, "", baudrate);
                            log("Port " + portPath + " open with ID " + openInfo.connectionId, mStat);
                            resolve();
                        } else {
                            // Error
                            reject(Error(notice(neCanNotOpenPort, [portPath])));
                        }
                    }
                );
            }
        } else {
            // Error; port record not found
            reject(Error(notice(neCanNotFindPort, [portPath])));
        }
    });
}

//TODO Promisify closePort()
//TODO Consider returning error object
function closePort(port) {
/* Close the port.
   port is the port object*/
   if (port && port.connId) {
       chrome.serial.disconnect(port.connId, function (closeResult) {
           if (closeResult) {
               log("Closed port " + port.path + " (id " + port.connId + ")", mStat);
               // Clear connection id to indicate port is closed
               updatePort(null, port.socket, port.connMode, port.path, port.iP, port.baud);
           } else {
               log("Could not close port " + port.path + " (id " + port.connId + ")", mStat);
           }
       });
   }
}

function changeBaudrate(port, baudrate) {
/* Return a promise that changes the port's baudrate.
   port is the open port's object
   baudrate is optional; defaults to finalBaudrate
   Resolves (with nothing); rejects with Error*/
    return new Promise(function(resolve, reject) {
        baudrate = baudrate ? parseInt(baudrate) : finalBaudrate;
        if (port) {
            if (port.baud !== baudrate) {
                // Need to change current baudrate
                log("Changing " + port.path + " to " + baudrate + " baud", mDbug);
                chrome.serial.update(port.connId, {'bitrate': baudrate}, function (updateResult) {
                    if (updateResult) {
                        port.baud = baudrate;
                        resolve();
                    } else {
                        reject(Error(notice(neCanNotSetBaudrate, [port.path, baudrate])));
                    }
                });
            } else {
                // Port is already set to baudrate
                resolve();
            }
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
            reject(Error(notice(000, ["Can not set port " + port.path + "'s options: " + options])));
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
              reject(Error(notice(000, ["Can not flush port " + port.path + "'s transmit/receive buffer"])));
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
        if (!p.ip && !--p.life) deletePort(byPath, p.path);
    })
}


//TODO Check send callback
//TODO Promisify and return error object
function send(port, data) {
/* Transmit data on port
   port is the open port's object*/

    // Convert data from string or buffer to an ArrayBuffer
    if (typeof data === 'string') {
        data = str2ab(data);
    } else {
        if (data instanceof ArrayBuffer === false) {data = buf2ab(data);}
    }
    return chrome.serial.send(port.connId, data, function (sendResult) {
    });
}

chrome.serial.onReceive.addListener(function(info) {
// Permanent serial receive listener- routes debug data from Propeller to connected browser when necessary
    let port = findPort(byID, info.connectionId);
    if (port) {
        if (port.mode === 'debug' && port.socket !== null) {
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
                    port.packet.timer = setTimeout(sendDebugPacket, serPacketFillTime, port)
                }
            } while (offset < info.data.byteLength);
        }
    }

    function sendDebugPacket(port) {
        if (port.packet.timer !== null) {
            clearTimeout(port.packet.timer);
            port.packet.timer = null;
        }
        port.socket.send(JSON.stringify({type: 'serial-terminal', packetID: port.packet.id++, msg: btoa(ab2str(port.packet.bufView.slice(0, port.packet.len)))}));
        port.packet.len = 0;
    }
});

chrome.serial.onReceiveError.addListener(function(info) {
// Permanent serial receive error listener.
    switch (info.error) {
        case "disconnected":
        case "device_lost" :
        case "system_error": deletePort(byID, info.connectionId);
    }
//    log("Error: PortID "+info.connectionId+" "+info.error, mDeep);
});