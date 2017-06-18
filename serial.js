
//TODO Eliminate portBaudrate; instead, store it with the connection id.
//TODO Enhance to protect against (or support) downloading to multiple active ports (cids) simultaneously (involves loadPropeller, talkToProp, and hearFromProp)
//TODO Revisit promisify and see if it will clean up code significantly
//TODO Study .bind for opportunities to save scope context of private functions

let portBaudrate = 0;                               //Current baud rate

// Programming metrics
const initialBaudrate = 115200;                     //Initial Propeller communication baud rate (standard boot loader)
const finalBaudrate = 921600;                       //Final Propeller communication baud rate (Micro Boot Loader)
let txData;                                         //Data to transmit to the Propeller (size/contents created later)

const defaultClockSpeed = 80000000;
const defaultClockMode = 0x6F;
const maxDataSize = 1392;                           //Max data packet size (for packets sent to running Micro Boot Loader)

// propComm status values
const stValidating = -1;
const stInvalid = 0;
const stValid = 1;

// propComm stage values
const sgError = -2;
const sgIdle = -1;
const sgHandshake = 0;
const sgVersion = 1;
const sgRAMChecksum = 2;
const sgMBLResponse = 3;
//const sgEEProgram = 3;
//const sgEEChecksum = 4;

// Propeller Communication (propComm) status; categorizes Propeller responses
let propComm = {};                                  //Holds current status
let mblRespAB = new ArrayBuffer(8);                 //Buffer for Micro Boot Loader responses

const propCommStart = {                             //propCommStart is used to initialize propComm
    stage       : sgHandshake,                      //Propeller Protocol Stage
    rxCount     : 0,                                //Current count of receive bytes (for stage)
    handshake   : stValidating,                     //ROM-resident boot loader RxHandshake response validity
    version     : stValidating,                     //ROM-resident boot loader Propeller version number response validity
    ramCheck    : stValidating,                     //ROM-resident boot loader RAM Checksum response validity
    mblResponse : stValidating,                     //Micro Boot Loader response format validity
    mblRespBuf  : new Uint8Array(mblRespAB),        //Micro Boot Loader responses data (unsigned byte format)
    mblPacketId : new Int32Array(mblRespAB, 0, 1),  //Micro Boot Loader requested next packet id (32-bit signed int format)
    mblTransId  : new Int32Array(mblRespAB, 4, 1)   //Micro Boot Loader transmission id (32-bit signed int format)
//    eeProg    : stValidating,
//    eeCheck   : stValidating
};

//Loader type; used for generateLoaderPacket()
const ltCore = -1;
const ltVerifyRAM = 0;
const ltProgramEEPROM = 1;
const ltReadyToLaunch = 2;
const ltLaunchNow = 3;

//Add programming protocol serial receive handler
chrome.serial.onReceive.addListener(hearFromProp);


//Add experimental event
//chrome.app.window.onClosed.addListener(function() {
//chrome.runtime.onSuspend.addListener(function() {
//  console.log('Whoa!');
//    while (connectedUSB.length > 0) {
//        closePort(connectedUSB[0].connId);
//    }
//});

/***********************************************************
 *                 Serial Support Functions                *
 ***********************************************************/

//TODO Consider returning error object
//TODO Consider enhancing error to indicate if the port is already open (this would only be for developer mistakes though)
function openPort(sock, portPath, baudrate, connMode) {
/* Return a promise to open serial port at portPath with baudrate and connect to sock.
   sock can be null to open serial port without an associated socket
   baudrate is optional; defaults to initialBaudrate
   Resolves with connection id (cid); rejects with Error*/
    return new Promise(function(resolve, reject) {
        console.log("Attempting to open port");
        portBaudrate = baudrate ? parseInt(baudrate) : initialBaudrate;
        chrome.serial.connect(portPath, {
                'bitrate': portBaudrate,
                'dataBits': 'eight',
                'parityBit': 'no',
                'stopBits': 'one',
                'ctsFlowControl': false
            },
            function (openInfo) {
                if (!chrome.runtime.lastError) {
                    // No error
                    serialJustOpened = openInfo.connectionId;
                    var vs = null;
                    // Find the socket in the socket connection holder - if not found, create null one (this allows null to be passed for the socket).
                    for (var j = 0; j < connectedSockets.length; j++) {
                        if (connectedSockets[j] === sock) {
                            vs = j;
                            break;
                        }
                    }
                    connectedUSB.push({wsSocket:vs, connId:parseInt(openInfo.connectionId), mode:connMode, path:portPath});
                    log('Device [' + parseInt(openInfo.connectionId) + '] ' + portPath + ' connected');
                    console.log("Port", portPath, "open with ID", openInfo.connectionId);
                    resolve(openInfo.connectionId);
                } else {
                    // Error
                    reject(Error("Could not open port " + portPath));
                }
            }
        );
    });
}

//TODO Promisify closePort()
//TODO Consider returning error object
function closePort(cid) {
/* Close the cid port.
   cid is the open port's connection identifier*/
    isOpen(cid)
        .then(function() {
            chrome.serial.disconnect(cid, function(closeResult) {
                if (closeResult === true) {
                    var cn, k = null;
                    for (cn = 0; cn < connectedUSB.length; cn++) {
                        if (connectedUSB[cn].connId === cid) {
                            k = cn;
                            break;
                        }
                    }
                    if (k !== null) {
                        log('Device [' + connectedUSB[k].connId + '] ' + connectedUSB[k].path + ' disconnected');
                        console.log("Closed port %s (id %d)", findConnectionPath(cid), cid);
                        connectedUSB.splice(k, 1);
                    } else {
                        console.log("Closed port %s (id %d), but connection not found", findConnectionPath(cid), cid);
                    }
                } else {
                    console.log("Connection not closed");
                }
            });
        })
        .catch(function(e) {console.log(e.message)});
}

function findConnectionId(portPath) {
// Return id (cid) of connection associated with portPath
  var cn, k = null;
  for (cn = 0; cn < connectedUSB.length; cn++) {
    if (connectedUSB[cn].path === portPath) {
      k = cn;
      break;
    }
  }
  if(k !== null) {
    return connectedUSB[cn].connId;
  } else {
    return null;
  }
}

function findConnectionPath(cid) {
// Return portPath associated cid connection
    var cn, k = null;
    for (cn = 0; cn < connectedUSB.length; cn++) {
        if (connectedUSB[cn].connId === cid) {
            k = cn;
            break;
        }
    }
    if(k !== null) {
        return connectedUSB[cn].path;
    } else {
        return null;
    }
}

function isOpen(cid) {
/* Return a promise that is resolved if cid port is open, rejected otherwise
   cid is the open port's connection identifier*/
    return new Promise(function(resolve, reject) {
        chrome.serial.getInfo(cid, function () {
            if (!chrome.runtime.lastError) {
                resolve(cid);
            } else {
                reject(Error("Port id:" + cid + " is not open."));
            }
        })
    });
}

//TODO: Determine if portBaudrate... statement need be inside the Promise
function changeBaudrate(cid, baudrate) {
/* Return a promise that changes the cid port's baudrate.
   cid is the open port's connection identifier
   baudrate is optional; defaults to finalBaudrate
   Resolves with cid; rejects with Error*/
    portBaudrate = baudrate ? parseInt(baudrate) : finalBaudrate;
    return new Promise(function(resolve, reject) {
        isOpen(cid)
            .then(function() {
                console.log("Changing %s baudrate to %d", findConnectionPath(cid), portBaudrate);
                chrome.serial.update(cid, {'bitrate': portBaudrate}, function(updateResult) {
                    if (updateResult) {
                        resolve(cid);
                    } else {
                        reject(Error("Can not set port " + findConnectionPath(cid) + " to baudrate " + baudrate));
                    }
                });
            })
    });
}

function setControl(cid, options) {
/* Return a promise that sets/clears the control option(s).
   cid is the open port's connection identifier*/
    return new Promise(function(resolve, reject) {
        chrome.serial.setControlSignals(cid, options, function(controlResult) {
          if (controlResult) {
            resolve();
          } else {
            reject(Error("Can not set port " + findConnectionPath(cid) + "'s options: " + options));
          }
        });
    });
}

function flush(cid) {
/* Return a promise that empties the transmit and receive buffers
   cid is the open port's connection identifier*/
    return new Promise(function(resolve, reject) {
        chrome.serial.flush(cid, function(flushResult) {
            if (flushResult) {
              resolve();
            } else {
              reject(Error("Can not flush port " + findConnectionPath(cid) + "'s transmit/receive buffer"));
            }
        });
    });
}

//TODO Check send callback
//TODO Consider returning error object
//TODO Promisify
function send(cid, data) {
/* Transmit data on port cid
   cid is the open port's connection identifier*/

    // Convert data from string or buffer to an ArrayBuffer
    if (typeof data === 'string') {
        data = str2ab(data);
    } else {
        if (data instanceof ArrayBuffer === false) {data = buffer2ArrayBuffer(data);}
    }
    return chrome.serial.send(cid, data, function (sendResult) {
    });
}

function buffer2ArrayBuffer(buffer) {
// Convert buffer to ArrayBuffer
    var buf = new ArrayBuffer(buffer.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0; i < buffer.length; i++) {
        bufView[i] = buffer[i];
    }
    return buf;
}


/***********************************************************
 *             Propeller Programming Functions             *
 ***********************************************************/

//TODO This is hard-coded.  Adjust to properly handle parameters from real caller
//TODO Make download finish with port in original (or initial) baudrate
//TODO Save existing connection's baud rate and restore it after programming
//TODO debug and connMode... don't think we need to keep track of the intent of the actual opened port in the connection records; however, if debug=false, we simply need to close to port after downloading
//TODO Need to notify of success or failure.  This had better be done with a promise as it can not hold up the UI.
function loadPropeller(sock, portPath, action, payload, debug) {
/* Download payload to Propeller with action on portPath.  If debug, keep port open for communication with sock.
   sock may be null (for development purposes)
   portPath is serial port's pathname
   action is 'RAM' or 'EEPROM'
   payload is an ArrayBuffer containing the Propeller Application image
   debug is false to close the port after download; true to keep port open for associated sock*/

//    console.log(parseFile(payload));

    //Temporary hard-coded Propeller Application for development testing
/*    const binImage = [
        0x00, 0xB4, 0xC4, 0x04, 0x6F, 0x61, 0x10, 0x00, 0x30, 0x00, 0x38, 0x00, 0x18, 0x00, 0x3C, 0x00,
        0x20, 0x00, 0x02, 0x00, 0x08, 0x00, 0x00, 0x00, 0x38, 0x1A, 0x3D, 0xD6, 0x1C, 0x38, 0x1A, 0x3D,
        0xD4, 0x47, 0x35, 0xC0, 0x37, 0x00, 0xF6, 0x3F, 0x91, 0xEC, 0x23, 0x04, 0x70, 0x32, 0x00, 0x00
    ];*/
    const binImage = [
        0x00, 0xB4, 0xC4, 0x04, 0x6F, 0x01, 0x10, 0x00, 0x1C, 0x02, 0x50, 0x02, 0x3E, 0x00, 0x54, 0x02,
        0xBC, 0x00, 0x04, 0x01, 0x2E, 0x00, 0x00, 0x00, 0x63, 0x00, 0x00, 0x00, 0xA4, 0x00, 0x00, 0x00,
        0xBC, 0x00, 0x28, 0x00, 0x6B, 0x00, 0x6C, 0x00, 0x00, 0x00, 0x6D, 0x00, 0x6E, 0x00, 0x6F, 0x00,
        0x6E, 0x00, 0x6D, 0x00, 0x00, 0x00, 0x6C, 0x00, 0x6B, 0x00, 0x01, 0x00, 0xFF, 0xFF, 0x01, 0x3A,
        0x4C, 0x4B, 0x40, 0x06, 0x04, 0x01, 0x38, 0x14, 0x38, 0x1B, 0x3E, 0xD6, 0x1C, 0x37, 0x00, 0x43,
        0x15, 0x2C, 0x01, 0x8A, 0x24, 0xAA, 0xB4, 0x14, 0x06, 0x04, 0x02, 0x01, 0x05, 0x03, 0x01, 0x37,
        0x21, 0x06, 0x04, 0x06, 0x88, 0x24, 0xB6, 0x14, 0x94, 0x34, 0xFC, 0x0A, 0x03, 0x8A, 0x24, 0x18,
        0x04, 0x60, 0x32, 0x01, 0x38, 0x0A, 0x06, 0x04, 0x05, 0x38, 0x14, 0x38, 0x1B, 0x3E, 0xD6, 0x1C,
        0x38, 0x1B, 0x3D, 0xD4, 0x1C, 0x37, 0x22, 0x08, 0x12, 0x3A, 0x01, 0xC1, 0x38, 0x3F, 0x91, 0xEC,
        0x23, 0x36, 0x38, 0x14, 0x38, 0x1B, 0x3E, 0xD4, 0x43, 0x09, 0x6E, 0x37, 0x22, 0x08, 0x12, 0x3A,
        0x01, 0xC1, 0x38, 0x3F, 0x91, 0xEC, 0x23, 0x36, 0x38, 0x14, 0x38, 0x1B, 0x3E, 0xD4, 0x42, 0x09,
        0x6E, 0x04, 0x52, 0x32, 0x38, 0x14, 0x38, 0x1B, 0x3E, 0xD4, 0x1C, 0x01, 0x38, 0x7D, 0x06, 0x04,
        0x05, 0x38, 0x14, 0x38, 0x1B, 0x3E, 0xD4, 0x18, 0x32, 0x00, 0x00, 0x00, 0x50, 0x01, 0x0B, 0x00,
        0x5E, 0x00, 0x00, 0x00, 0x6F, 0x00, 0x00, 0x00, 0xBD, 0x00, 0x00, 0x00, 0xE1, 0x00, 0x00, 0x00,
        0xF7, 0x00, 0x00, 0x00, 0x0C, 0x01, 0x00, 0x00, 0x1D, 0x01, 0x00, 0x00, 0x21, 0x01, 0x00, 0x00,
        0x32, 0x01, 0x00, 0x00, 0x42, 0x01, 0x00, 0x00, 0x00, 0x1B, 0xB7, 0x00, 0x20, 0x4E, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x40, 0x0D, 0x03, 0x00, 0x7D, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x22, 0x2A, 0x32, 0x3A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F,
        0x73, 0x74, 0x75, 0x76, 0x77, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F, 0x64, 0xC5, 0x34, 0xC4, 0x34, 0x38,
        0x64, 0xF6, 0x39, 0x01, 0x7D, 0xE4, 0x37, 0x00, 0xD5, 0x38, 0x32, 0x38, 0x04, 0x80, 0x38, 0x18,
        0xE8, 0xFF, 0x64, 0x38, 0x18, 0xE8, 0xF0, 0x0A, 0x2A, 0x38, 0x04, 0x80, 0x37, 0x22, 0xE8, 0x64,
        0x38, 0x78, 0xE8, 0xEA, 0x35, 0xC0, 0x20, 0x38, 0x04, 0x80, 0x37, 0x22, 0xE8, 0x37, 0x00, 0xE5,
        0xD4, 0x38, 0x38, 0x04, 0x80, 0x37, 0x22, 0xE8, 0x37, 0x21, 0xED, 0x35, 0xE4, 0xF3, 0xF4, 0x3F,
        0x91, 0xEC, 0x23, 0x64, 0x64, 0x37, 0x00, 0xE5, 0xD4, 0x2C, 0x64, 0x37, 0x22, 0xE8, 0x37, 0x21,
        0xED, 0x35, 0xE4, 0xF3, 0xF4, 0x62, 0x80, 0x20, 0x32, 0x64, 0xF1, 0x64, 0x64, 0xF1, 0x36, 0xED,
        0xF3, 0xEB, 0xF1, 0x37, 0x21, 0xED, 0x35, 0xE4, 0x38, 0x05, 0xF4, 0xEC, 0x36, 0xED, 0x65, 0x64,
        0x38, 0x1A, 0xF9, 0x0A, 0x07, 0x00, 0x64, 0x94, 0x44, 0x05, 0x02, 0x61, 0x32, 0x35, 0xC0, 0x3A,
        0x0F, 0x42, 0x40, 0xF6, 0x64, 0xF4, 0x39, 0x0F, 0x58, 0xED, 0x39, 0x01, 0x7D, 0xE4, 0x3F, 0x91,
        0xEC, 0x23, 0x32, 0x35, 0xC0, 0x39, 0x03, 0xE8, 0xF6, 0x64, 0xF4, 0x39, 0x0F, 0x5C, 0xED, 0x39,
        0x01, 0x7D, 0xE4, 0x3F, 0x91, 0xEC, 0x23, 0x32, 0x35, 0xC0, 0x64, 0xF4, 0x39, 0x0B, 0xC8, 0xED,
        0x39, 0x01, 0x7D, 0xE4, 0x3F, 0x91, 0xEC, 0x23, 0x32, 0x3F, 0x91, 0x41, 0x32, 0x35, 0xC0, 0x3A,
        0x0F, 0x42, 0x40, 0xF6, 0x64, 0xF4, 0x39, 0x01, 0x7D, 0xE4, 0x42, 0xCC, 0x23, 0x32, 0x35, 0xC0,
        0x39, 0x03, 0xE8, 0xF6, 0x64, 0xF4, 0x39, 0x01, 0x7D, 0xE4, 0x42, 0xCC, 0x23, 0x32, 0x35, 0xC0,
        0x64, 0xF4, 0x39, 0x01, 0x7D, 0xE4, 0x42, 0xCC, 0x23, 0x32, 0x00, 0x00
    ];


    // Look for an existing connection
    var cid = findConnectionId(portPath);
    var connect;
    if (cid) {
        // Connection exists, prep to reuse it
        connect = function() {return changeBaudrate(cid, initialBaudrate)}
    } else {
        // No connection yet, prep to create one
        connect = function() {return openPort(sock, portPath, initialBaudrate, 'programming')}
    }
    // Use connection to download application to the Propeller
    connect()
        .then(function(id) {cid = id})
        .then(function()   {return talkToProp(cid, buffer2ArrayBuffer(binImage), action === 'EEPROM')})
//        .then(function()return true)
        .catch(function(e) {console.log(e.message)});
}


function talkToProp(cid, binImage, toEEPROM) {
/* Return promise to deliver Propeller Application (binImage) to Propeller
   cid is the open port's connection identifier
   binImage must be an ArrayBuffer
   toEEPROM is false to program RAM only, true to program RAM+EEPROM*/

    return new Promise(function(resolve, reject) {


        function sendLoader(waittime) {
        // Return a promise that waits for waittime then sends communication package including loader.
            return new Promise(function(resolve, reject) {
                console.log("Waiting %d ms to deliver Micro Boot Loader package", waittime);
                setTimeout(function() {
                    console.log("Transmitting package");
                    send(cid, txData);
                    resolve();
                }, waittime);
            });
        }

        function isLoaderReady(packetId, waittime) {
        /* Is Micro Boot Loader delivered and Ready?
        Return a promise that waits for waittime then validates the responding Propeller Handshake, Version, and that the Micro Boot Loader delivery succeeded.
        Rejects if any error occurs.  Micro Boot Loader must respond with Packet ID (plus Transmission ID) for success (resolve).
        Error is "Propeller not found" unless handshake received (and proper) and version received; error is more specific thereafter.*/

            return new Promise(function(resolve, reject) {
                function verifier() {
                    console.log("Verifying package delivery");
                    //Check handshake and version
                    if (propComm.handshake === stValidating || propComm.handshake === stInvalid || propComm.version === stValidating) {reject(Error("Propeller not found.")); return;}
                    //Check for proper version
                    if (propComm.version !== 1) {reject(Error("Found Propeller version " + propComm.version + " - expected version 1.")); return;}
                    //Check RAM checksum
                    if (propComm.ramCheck === stValidating) {reject(Error("Propeller communication lost while delivering loader.")); return;}
                    if (propComm.ramCheck === stInvalid) {reject(Error("Unable to deliver loader.")); return;}
                    //Check Micro Boot Loader Ready Signal
                    if (propComm.mblResponse !== stValid || (propComm.mblPacketId[0]^packetId) + (propComm.mblTransId[0]^transmissionId) !== 0) {reject(Error("Loader failed.")); return;}
                    console.log("Found Propeller!");
                    resolve();
                }
                console.log("Waiting %d ms for package delivery", waittime);
                setTimeout(verifier, waittime);
            });
        }

        function prepForMBLResponse() {
            // Set propComm to prep for another Micro Boot Loader response.
            propComm.mblResponse = stValidating;
            propComm.stage = sgMBLResponse;
            propComm.rxCount = 0;
        }

        //TODO lower waittime
        //TODO catch send() errors
        //TODO add transmitPacket function to auto-retry 3 times if needing to harden against flaky wireless connections
        //TODO verify TotalPackets used somewhere
        //TODO may have to decrement packetId elsewhere
        //TODO determine if txPacketLength and idx can refer to bytes instead of longs to lessen iterative calculations
        function sendUserApp() {
        // Return a promise that delivers the user application to the Micro Boot Loader.
            return new Promise(function(resolve, reject) {

                function sendUA() {
                    return new Promise(function(resolve, reject) {
                        console.log("Delivering user application packet %d of %d", totalPackets-packetId+1, totalPackets);
                        prepForMBLResponse();
                    //repeat {Transmit target application packets}                                             {Transmit application image}

                        var txPacketLength = 2 +                                                                   //Determine packet length (in longs); header + packet limit or remaining data length
                            Math.min(Math.trunc(maxDataSize / 4) - 2, Math.trunc(binImage.byteLength / 4) - pIdx);
                        binView = new Uint8Array(binImage, pIdx * 4, (txPacketLength - 2) * 4);                    //Get view of next section of binary image
                        txData = new ArrayBuffer(txPacketLength * 4);                                              //Set packet length (in longs)}
                        txView = new Uint8Array(txData);
                        transmissionId = Math.floor(Math.random()*4294967296);                                     //Create next random Transmission ID
                        (new DataView(txData, 0, 4)).setUint32(0, packetId, true);                                 //Store Packet ID
                        (new DataView(txData, 4, 4)).setUint32(0, transmissionId, true);                           //Store random Transmission ID
                        txView.set(binView, 8);                                                                    //Store section of binary image
                        send(cid, txData);                                                                         //Transmit packet
                        pIdx += txPacketLength - 2;                                                                //Increment image index
                        packetId--;                                                                                //Decrement Packet ID (to next packet)

                    //{repeat - Transmit target application packets...}
                    //until PacketID = 0;                                                                      {Loop until done}

                        resolve();
                    });
                }
                function loaderAcknowledged(waittime) {
                /* Did Micro Boot Loader acknowledge the packet?
                Return a promise that waits for waittime then validates that the Micro Boot Loader acknowledged the packet.
                Rejects if error occurs.  Micro Boot Loader must respond with next Packet ID (plus Transmission ID) for success (resolve).*/
                    return new Promise(function(resolve, reject) {
                        function verifier() {
                            console.log("Verifying loader acknowledgement to packet %d of %d", totalPackets-packetId+0, totalPackets);
                            //Check Micro Boot Loader response
                            if (propComm.mblResponse !== stValid || (propComm.mblPacketId[0]^packetId) + (propComm.mblTransId[0]^transmissionId) !== 0) {
                                reject(Error("Download failed")); return
                            }
                            console.log("Packet delivered.");
                            resolve();
                        }
                        console.log("Waiting %d ms for acknowledgement", waittime);
                        setTimeout(verifier, waittime);
                    });
                }
                //TODO setTimeout may not be needed here?  Probably not... a return of the sendUA promise chain may work?
                //No delay, but call sendUA promise with setTimeout for asynchronous processing
                setTimeout(function() {
                    sendUA()
                        .then(function() {return loaderAcknowledged(600+((10*(txData.byteLength+2+8))/portBaudrate)*1000+1);})
                        .then(function() {if (packetId > 0) {return sendUserApp()}})
                        .then(function() {return resolve()})
                        .catch(function(e) {return reject(e)});
                });
            });
        }

        //TODO lower waittime
        function finalizeDelivery() {
        // Return a promise that sends the final packets (special executable packets) that verifies RAM, programs and verifies EEPROM, and launches user code.
            return new Promise(function(resolve, reject) {

                function sendRAMVerify() {
                    return new Promise(function(resolve, reject) {
                        console.log("Requesting RAM Verify");
                        prepForMBLResponse();
                        generateLoaderPacket(ltVerifyRAM, packetId);                                               //Generate VerifyRAM executable packet
                        transmissionId = Math.floor(Math.random()*4294967296);                                     //Create next random Transmission ID
                        (new DataView(txData, 4, 4)).setUint32(0, transmissionId, true);                           //Store random Transmission ID
                        send(cid, txData);                                                                         //Transmit packet
                        packetId = -checksum;                                                                      //Ready next packet; ID's by -checksum now
                        resolve();
                    });
                }
                function sendEEPROMProgram() {
                    return new Promise(function(resolve, reject) {
                        console.log("Requesting EEPROM Program/Verify");
                        prepForMBLResponse();
                        generateLoaderPacket(ltProgramEEPROM, packetId);                                           //Generate Program/VerifyEEPROM executable packet
                        transmissionId = Math.floor(Math.random()*4294967296);                                     //Create next random Transmission ID
                        (new DataView(txData, 4, 4)).setUint32(0, transmissionId, true);                           //Store random Transmission ID
                        send(cid, txData);                                                                         //Transmit packet
                        packetId = -checksum*2;                                                                    //Ready next packet; ID's by -checksum*2 now
                        resolve();
                    });
                }
                function sendReadyToLaunch() {
                    return new Promise(function(resolve, reject) {
                        console.log("Requesting Launch");
                        prepForMBLResponse();
                        generateLoaderPacket(ltReadyToLaunch, packetId);                                           //Generate ReadyToLaunch executable packet
                        transmissionId = Math.floor(Math.random()*4294967296);                                     //Create next random Transmission ID
                        (new DataView(txData, 4, 4)).setUint32(0, transmissionId, true);                           //Store random Transmission ID
                        send(cid, txData);                                                                         //Transmit packet
                        packetId -= 1;                                                                             //Ready next packet; ID's by prev checksum-1 now
                        resolve();
                    });
                }
                function sendLaunchNow() {
                    return new Promise(function(resolve, reject) {
                        console.log("Commanding Launch");
                        prepForMBLResponse();
                        generateLoaderPacket(ltLaunchNow, packetId);                                               //Generate LaunchNow executable packet
                        transmissionId = Math.floor(Math.random()*4294967296);                                     //Create next random Transmission ID
                        (new DataView(txData, 4, 4)).setUint32(0, transmissionId, true);                           //Store random Transmission ID
                        send(cid, txData);                                                                         //Transmit packet
                        resolve();
                    });
                }
                function loaderAcknowledged(waittime) {
                /* Did Micro Boot Loader acknowledge the packet?
                Return a promise that waits for waittime then validates that the Micro Boot Loader acknowledged the packet.
                Rejects if error occurs.  Micro Boot Loader must respond with next Packet ID (plus Transmission ID) for success (resolve).*/
                    return new Promise(function(resolve, reject) {
                        function verifier() {
                            console.log("Verifying loader acknowledgement");
                            //Check Micro Boot Loader response (values checked by value only, not value+type)
                            if (propComm.mblResponse !== stValid || (propComm.mblPacketId[0]^packetId) + (propComm.mblTransId[0]^transmissionId) !== 0) {
                                reject(Error("RAM checksum failure!")); return;
//!!!                                reject(Error("EEPROM Programming Failure!")); return;
//!!!                                reject(Error("Communication failed!")); return;
                            }
                            console.log("Packet delivered.");
                            resolve();
                        }
                        console.log("Waiting %d ms for acknowledgement", waittime);
                        setTimeout(verifier, waittime);
                    });
                }
                //TODO setTimeout may not be needed here?  Probably not... a return of the sendUA promise chain may work?
                //No delay, but call sendUA promise with setTimeout for asynchronous processing
                setTimeout(function() {
                    sendRAMVerify()
                        .then(function() {return loaderAcknowledged(800+((10*(txData.byteLength+2+8))/portBaudrate)*1000+1);})
                        .then(function() {if (toEEPROM) {return sendEEPROMProgram();}})
                        .then(function() {if (toEEPROM) {return loaderAcknowledged(4500+((10*(txData.byteLength+2+8))/portBaudrate)*1000+1);}})
                        .then(function() {return sendReadyToLaunch();})
                        .then(function() {return loaderAcknowledged(800+((10*(txData.byteLength+2+8))/portBaudrate)*1000+1);})
                        .then(function() {return sendLaunchNow();})
                        .then(function() {return resolve()})
                        .catch(function(e) {return reject(e)});
                });
            });
        }

        //Determine number of required packets for target application image; value becomes first Packet ID
        var totalPackets = Math.ceil(binImage.byteLength / (maxDataSize-4*2));           //binary image size (in bytes) / (max packet size - packet header)
        var packetId = totalPackets;
        var transmissionId = 0;                                                          //Initial Transmission ID
        var pIdx = 0;                                                                    //Packet index (points to next data in binary image to send
        //Calculate target application's full checksum (used for RAM Checksum confirmation)}
        binView = new Uint8Array(binImage);                                              //Create view of the Propeller Application Image
        var checksum = 0x7EC;                                                            //Start with full checksum of initial call frame
        for (idx = 0; idx < binView.byteLength; idx++) {checksum += binView[idx];}       //Add in all Propeller Application Image bytes (retaining full checksum value)

        //Pre-generate communication and loader package (saves time during during initial communication)
        generateLoaderPacket(ltCore, packetId, defaultClockSpeed, defaultClockMode);

        //Calculate expected max package delivery time
        //=300 [>max post-reset-delay] + ((10 [bits per byte] * (data bytes [transmitting] + silence bytes [MBL waiting] +
        // MBL "ready" bytes [MBL responding])) / baud rate) * 1,000 [to scale ms to integer] + 1 [to always round up]
        var deliveryTime = 300+((10*(txData.byteLength+20+8))/portBaudrate)*1000+1;

        isOpen(cid)
            .then(function() {       Object.assign(propComm, propCommStart);}       )    //Reset propComm object
            .then(function() {       console.log("Generating reset signal");}       )
            .then(function() {return setControl(cid, {dtr: false});}                )    //Start Propeller Reset Signal
            .then(function() {return flush(cid);}                                   )    //Flush transmit/receive buffers (during Propeller reset)
            .then(function() {return setControl(cid, {dtr: true});}                 )    //End Propeller Reset
            .then(function() {return sendLoader(100);}                              )    //After Post-Reset-Delay, send package: Calibration Pulses+Handshake through Micro Boot Loader application+RAM Checksum Polls
            .then(function() {return isLoaderReady(packetId, deliveryTime);}        )    //Verify package accepted
            .then(function() {return changeBaudrate(cid, finalBaudrate);}           )    //Bump up to faster finalBaudrate
            .then(function() {return sendUserApp();}                                )    //Send user application
            .then(function() {return finalizeDelivery();}                           )    //Finalize delivery and launch user application
            .then(function() {return resolve();}                                    )    //Success!
            .catch(function(e) {console.log("Error: %s", e.message); reject(e);}    );   //Catch errors
    });
}


function hearFromProp(info) {
// Receive Propeller's responses during programming.  Parse responses for expected stages.
    const rxHandshake = [
        0xEE,0xCE,0xCE,0xCF,0xEF,0xCF,0xEE,0xEF,0xCF,0xCF,0xEF,0xEF,0xCF,0xCE,0xEF,0xCF,  //The rxHandshake array consists of 125 bytes encoded to represent
        0xEE,0xEE,0xCE,0xEE,0xEF,0xCF,0xCE,0xEE,0xCE,0xCF,0xEE,0xEE,0xEF,0xCF,0xEE,0xCE,  //the expected 250-bit (125-byte @ 2 bits/byte) response of
        0xEE,0xCE,0xEE,0xCF,0xEF,0xEE,0xEF,0xCE,0xEE,0xEE,0xCF,0xEE,0xCF,0xEE,0xEE,0xCF,  //continuing-LFSR stream bits from the Propeller, prompted by the
        0xEF,0xCE,0xCF,0xEE,0xEF,0xEE,0xEE,0xEE,0xEE,0xEF,0xEE,0xCF,0xCF,0xEF,0xEE,0xCE,  //timing templates following the txHandshake stream.
        0xEF,0xEF,0xEF,0xEF,0xCE,0xEF,0xEE,0xEF,0xCF,0xEF,0xCF,0xCF,0xCE,0xCE,0xCE,0xCF,
        0xCF,0xEF,0xCE,0xEE,0xCF,0xEE,0xEF,0xCE,0xCE,0xCE,0xEF,0xEF,0xCF,0xCF,0xEE,0xEE,
        0xEE,0xCE,0xCF,0xCE,0xCE,0xCF,0xCE,0xEE,0xEF,0xEE,0xEF,0xEF,0xCF,0xEF,0xCE,0xCE,
        0xEF,0xCE,0xEE,0xCE,0xEF,0xCE,0xCE,0xEE,0xCF,0xCF,0xCE,0xCF,0xCF
    ];

    console.log("Received", info.data.byteLength, "bytes =", ab2num(info.data));
    // Exit immediately if we're not programming
    if (propComm.stage === sgIdle) {
        console.log("...ignoring");
        return;
    }

    var stream = ab2num(info.data);
    var sIdx = 0;

    // Validate rxHandshake
    if (propComm.stage === sgHandshake) {
        while (sIdx < stream.length && propComm.rxCount < rxHandshake.length) {
            //More data to match against rxHandshake...
            if (stream[sIdx++] === rxHandshake[propComm.rxCount++]) {
                //Handshake matches so far...
                if (propComm.rxCount === rxHandshake.length) {
                    //Entire handshake matches!  Note valid and prep for next stage
                    propComm.handshake = stValid;
                    propComm.rxCount = 0;
                    propComm.stage = sgVersion;
                    break;
                }
            } else {
                //Handshake failure!  Ignore the rest
                propComm.handshake = stInvalid;
                propComm.stage = sgIdle;
                break;
            }
        }
    }

    // Extract Propeller version
    if (propComm.stage === sgVersion) {
        while (sIdx < stream.length && propComm.rxCount < 4) {
            //More data to decode into Propeller version (4 bytes, 2 data bits per byte)
            propComm.version = (propComm.version >> 2 & 0x3F) | ((stream[sIdx] & 0x01) << 6) | ((stream[sIdx] & 0x20) << 2);
            sIdx++;
            if (++propComm.rxCount === 4) {
                //Received all 4 bytes
                if (propComm.version === 1) {
                    //Version matches expected value!  Prep for next stage
                    propComm.rxCount = 0;
                    propComm.stage = sgRAMChecksum;
                } else {
                    //Unexpected version!  Ignore the rest
                    propComm.stage = sgIdle;
                }
                break;
            }
        }
    }

    // Receive RAM Checksum
    if (propComm.stage === sgRAMChecksum && sIdx < stream.length) {
        //Received RAM Checksum response?
        propComm.ramCheck = stream[sIdx++] === 0xFE ? stValid : stInvalid;
        //Set next stage according to result
        propComm.rxCount = 0;
        propComm.stage = propComm.ramCheck ? sgMBLResponse : sgIdle;
    }

    // Receive Micro Boot Loader's "Ready" Signal
    if (propComm.stage === sgMBLResponse) {
        while (sIdx < stream.length && propComm.rxCount < propComm.mblRespBuf.byteLength) {
            propComm.mblRespBuf[propComm.rxCount++] = stream[sIdx++];
            //Finish stage when expected response size received
            if (propComm.rxCount === propComm.mblRespBuf.byteLength) {
                propComm.stage = sgIdle;
                //Valid if end of stream, otherwise something's wrong (invalid response)
                propComm.mblResponse = stream.length === sIdx ? stValid : stInvalid;
            }
        }
    }
}

//TODO Revisit timedPromise and make it work properly for optimized communication
/*
function timedPromise(promise, timeout){
// Takes in a promise and returns it as a promise that rejects in timeout milliseconds if not resolved beforehand
    var expired = function() {
        return new Promise(function (resolve, reject) {
            var id = setTimeout(function() {
                console.log("Timed out!");
                clearTimeout(id);
                reject(Error('Timed out in ' + timeout + ' ms.'));
            }, timeout);
        })
    };
    // Returns a promise race between passed-in promise and timeout promise
    return Promise.race([promise(), expired()])
}
*/

function generateLoaderPacket(loaderType, packetId, clockSpeed, clockMode) {
/*Generate a packet (in txData) containing the portion of the Micro Boot Loader (IP_Loader.spin) indicated by LoaderType.
 Initial call should use loaderType of ltCore and later calls use other loaderTypes; details described below.
 If loaderType is ltCore...
   * target application's total packet count must be included in packetID.
   * target application's system clock speed must be included in clockSpeed.
   * target application's system clock mode must be included in clockMode.
   * generated packet contains the Propeller handshake, timing templates, and core code from the Micro Boot Loader (IP_Loader.spin),
     with optimal encoding (3, 4, or 5 bits per byte; 7 to 11 bytes per long).
     - Optimal encoding means, for every 5 contiguous bits in Propeller Application Image (LSB first) 3, 4, or 5 bits will be translated
       to a byte.  The process uses a translation array (for speed)- input up to 5 bits and the bit count (ie: indexed into the pDSTx array)
       and output a byte containing the first 3, 4, or 5 bits of the input encoded into the Propeller download stream format plus the number
       of bits actually encoded.  If less than 5 bits were translated, the remaining bits lead the next 5-bit translation unit input to the
       translation process.
 If loaderType is not ltCore...
   * packetIds should be less than 0 for this type of packet in order to work with the Micro Boot Loader core.
   * clockSpeed and clockMode are omitted.
   * generated packet is a snippet of loader code aligned to be executable from inside the Core's packet buffer.  This snippet is in raw
     form (not encoded) and should be transmitted as such.

 Propeller Download Stream Translator array.  Index into this array with the "Binary Value" (usually 5 bits) to translate,
 the incoming bit size (again, usually 5), and the desired data element to retrieve (0 = translation, 1 = translated bit count.
 A portion of the array is not applicable (unused "[0,0]") including the first column (0 bits input).

       Propeller Download Stream Translator (pDSTx) Usage:

                Binary     Incoming    Translation
                Value      Bit Size    and Bit Count
           pDSTx[0..31,      1..5,         0..1]
 */
    const pDSTx = [
        /*     0-BITs     *****  1-BIT  *****     *****  2-BIT  *****     *****  3-BIT  *****     *****  4-BIT  *****     *****  5-BIT  *****       */
        [  [0, 0],   /*0b00000*/ [0xFE, 1],  /*0b00000*/ [0xF2, 2],  /*0b00000*/ [0x92, 3],  /*0b00000*/ [0x92, 3],  /*0b00000*/ [0x92, 3]  ],
        [  [0, 0],   /*0b00001*/ [0xFF, 1],  /*0b00001*/ [0xF9, 2],  /*0b00001*/ [0xC9, 3],  /*0b00001*/ [0xC9, 3],  /*0b00001*/ [0xC9, 3]  ],
        [  [0, 0],                 [0, 0],   /*0b00010*/ [0xFA, 2],  /*0b00010*/ [0xCA, 3],  /*0b00010*/ [0xCA, 3],  /*0b00010*/ [0xCA, 3]  ],
        [  [0, 0],                 [0, 0],   /*0b00011*/ [0xFD, 2],  /*0b00011*/ [0xE5, 3],  /*0b00011*/ [0x25, 4],  /*0b00011*/ [0x25, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],   /*0b00100*/ [0xD2, 3],  /*0b00100*/ [0xD2, 3],  /*0b00100*/ [0xD2, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],   /*0b00101*/ [0xE9, 3],  /*0b00101*/ [0x29, 4],  /*0b00101*/ [0x29, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],   /*0b00110*/ [0xEA, 3],  /*0b00110*/ [0x2A, 4],  /*0b00110*/ [0x2A, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],   /*0b00111*/ [0xFA, 3],  /*0b00111*/ [0x95, 4],  /*0b00111*/ [0x95, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01000*/ [0x92, 3],  /*0b01000*/ [0x92, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01001*/ [0x49, 4],  /*0b01001*/ [0x49, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01010*/ [0x4A, 4],  /*0b01010*/ [0x4A, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01011*/ [0xA5, 4],  /*0b01011*/ [0xA5, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01100*/ [0x52, 4],  /*0b01100*/ [0x52, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01101*/ [0xA9, 4],  /*0b01101*/ [0xA9, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01110*/ [0xAA, 4],  /*0b01110*/ [0xAA, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b01111*/ [0xD5, 4],  /*0b01111*/ [0xD5, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10000*/ [0x92, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10001*/ [0xC9, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10010*/ [0xCA, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10011*/ [0x25, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10100*/ [0xD2, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10101*/ [0x29, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10110*/ [0x2A, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b10111*/ [0x95, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11000*/ [0x92, 3]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11001*/ [0x49, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11010*/ [0x4A, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11011*/ [0xA5, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11100*/ [0x52, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11101*/ [0xA9, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11110*/ [0xAA, 4]  ],
        [  [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],                 [0, 0],   /*0b11111*/ [0x55, 5]  ]
    ];

    //Power of 2 - 1 array.  Index into this array with the desired power of 2 (1 through 5) and element value is mask equal to power of 2 minus 1
    pwr2m1 = [0x00, 0x01, 0x03, 0x07, 0x0F, 0x1F];

    const txHandshake = [                                                                               //Transmit Handshake pattern.
        0x49,                                                                                           //First timing template ('1' and '0') plus first two bits of handshake ('0' and '1')
        0xAA, 0x52, 0xA5, 0xAA, 0x25, 0xAA, 0xD2, 0xCA, 0x52, 0x25, 0xD2, 0xD2, 0xD2, 0xAA, 0x49, 0x92, //Remaining 248 bits of handshake...
        0xC9, 0x2A, 0xA5, 0x25, 0x4A, 0x49, 0x49, 0x2A, 0x25, 0x49, 0xA5, 0x4A, 0xAA, 0x2A, 0xA9, 0xCA,
        0xAA, 0x55, 0x52, 0xAA, 0xA9, 0x29, 0x92, 0x92, 0x29, 0x25, 0x2A, 0xAA, 0x92, 0x92, 0x55, 0xCA,
        0x4A, 0xCA, 0xCA, 0x92, 0xCA, 0x92, 0x95, 0x55, 0xA9, 0x92, 0x2A, 0xD2, 0x52, 0x92, 0x52, 0xCA,
        0xD2, 0xCA, 0x2A, 0xFF,
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, //250 timing templates ('1' and '0')
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, //to receive 250-bit handshake from
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, //Propeller.}
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29,
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, //This is encoded as two pairs per}
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, //byte; 125 bytes}
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29,
        0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29, 0x29,
        0x29, 0x29, 0x29, 0x29,                                                                         //8 timing templates ('1' and '0') to receive 8-bit Propeller ver; two pairs per byte; 4 bytes
        0x93, 0x92, 0x92, 0x92, 0x92, 0x92, 0x92, 0x92, 0x92, 0x92, 0xF2                                //Download command (1; program RAM and run); 11 bytes
    ];

    const rawLoaderImage = [                                                                            //Raw loader image.
        0x00, 0xB4, 0xC4, 0x04, 0x6F, 0x2B, 0x10, 0x00, 0x88, 0x01, 0x90, 0x01, 0x80, 0x01, 0x94, 0x01, //This is the Micro Boot Loader, a Propeller
        0x78, 0x01, 0x02, 0x00, 0x70, 0x01, 0x00, 0x00, 0x4D, 0xE8, 0xBF, 0xA0, 0x4D, 0xEC, 0xBF, 0xA0, //Application written in PASM that fits entirely into the initial
        0x51, 0xB8, 0xBC, 0xA1, 0x01, 0xB8, 0xFC, 0x28, 0xF1, 0xB9, 0xBC, 0x80, 0xA0, 0xB6, 0xCC, 0xA0, //download packet.  Once downloaded and launched, it assists with
        0x51, 0xB8, 0xBC, 0xF8, 0xF2, 0x99, 0x3C, 0x61, 0x05, 0xB6, 0xFC, 0xE4, 0x59, 0x24, 0xFC, 0x54, //the remainder of the download (at a faster speed, without the
        0x62, 0xB4, 0xBC, 0xA0, 0x02, 0xBC, 0xFC, 0xA0, 0x51, 0xB8, 0xBC, 0xA0, 0xF1, 0xB9, 0xBC, 0x80, //need for special encoding, and with more relaxed interstitial
        0x04, 0xBE, 0xFC, 0xA0, 0x08, 0xC0, 0xFC, 0xA0, 0x51, 0xB8, 0xBC, 0xF8, 0x4D, 0xE8, 0xBF, 0x64, //timing capable of surviving unexpected delays, even when
        0x01, 0xB2, 0xFC, 0x21, 0x51, 0xB8, 0xBC, 0xF8, 0x4D, 0xE8, 0xBF, 0x70, 0x12, 0xC0, 0xFC, 0xE4, //transmission is using Internet Protocol delivery.  This image
        0x51, 0xB8, 0xBC, 0xF8, 0x4D, 0xE8, 0xBF, 0x68, 0x0F, 0xBE, 0xFC, 0xE4, 0x48, 0x24, 0xBC, 0x80, //isn't used as-is; just before download, it is adjusted to contain
        0x0E, 0xBC, 0xFC, 0xE4, 0x52, 0xA2, 0xBC, 0xA0, 0x54, 0x44, 0xFC, 0x50, 0x61, 0xB4, 0xFC, 0xA0, //special values assigned by this host (communication timing and
        0x5A, 0x5E, 0xBC, 0x54, 0x5A, 0x60, 0xBC, 0x54, 0x5A, 0x62, 0xBC, 0x54, 0x04, 0xBE, 0xFC, 0xA0, //synchronization values) and then is translated into an optimized
        0x54, 0xB6, 0xBC, 0xA0, 0x53, 0xB8, 0xBC, 0xA1, 0x00, 0xBA, 0xFC, 0xA0, 0x80, 0xBA, 0xFC, 0x72, //Propeller Download Stream understandable by the Propeller
        0xF2, 0x99, 0x3C, 0x61, 0x25, 0xB6, 0xF8, 0xE4, 0x36, 0x00, 0x78, 0x5C, 0xF1, 0xB9, 0xBC, 0x80, //ROM-based boot loader.
        0x51, 0xB8, 0xBC, 0xF8, 0xF2, 0x99, 0x3C, 0x61, 0x00, 0xBB, 0xFC, 0x70, 0x01, 0xBA, 0xFC, 0x29,
        0x2A, 0x00, 0x4C, 0x5C, 0xFF, 0xC2, 0xFC, 0x64, 0x5D, 0xC2, 0xBC, 0x68, 0x08, 0xC2, 0xFC, 0x20,
        0x55, 0x44, 0xFC, 0x50, 0x22, 0xBE, 0xFC, 0xE4, 0x01, 0xB4, 0xFC, 0x80, 0x1E, 0x00, 0x7C, 0x5C,
        0x22, 0xB6, 0xBC, 0xA0, 0xFF, 0xB7, 0xFC, 0x60, 0x54, 0xB6, 0x7C, 0x86, 0x00, 0x8E, 0x68, 0x0C,
        0x59, 0xC2, 0x3C, 0xC2, 0x09, 0x00, 0x54, 0x5C, 0x01, 0xB2, 0xFC, 0xC1, 0x63, 0x00, 0x70, 0x5C,
        0x63, 0xB4, 0xFC, 0x84, 0x45, 0xC6, 0x3C, 0x08, 0x04, 0x8A, 0xFC, 0x80, 0x48, 0x7E, 0xBC, 0x80,
        0x3F, 0xB4, 0xFC, 0xE4, 0x63, 0x7E, 0xFC, 0x54, 0x09, 0x00, 0x7C, 0x5C, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00,
        0xFF, 0xFF, 0xF9, 0xFF, 0x10, 0xC0, 0x07, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x40,
        0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x10, 0x6F, 0x00, 0x00, 0x00, 0xB6, 0x02, 0x00, 0x00,
        0x56, 0x00, 0x00, 0x00, 0x82, 0x00, 0x00, 0x00, 0x55, 0x73, 0xCB, 0x00, 0x18, 0x51, 0x00, 0x00,
        0x30, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x35, 0xC7, 0x08, 0x35, 0x2C, 0x32, 0x00, 0x00
    ];

    /*Offset (in bytes) within the Raw Loader Image (above) to the start of host-initialized values that exist within it.  Host-Initialized values are
     constants in the source (Propeller Assembly code) that are intended to be replaced by the host (the computer running 'this' code) before packetization
     and transmission of the image to the Propeller.  Host-Initialized Values are Initial Bit Time, Final Bit Time, 1.5x Bit Time, Failsafe timeout,
     End of Packet Timeout, Start/Stop Time, SCL High Time, SCL Low Time, and ExpectedID.  In addition to replacing these values, the host needs to update
     the image's checksum at word 5.*/
    //                                         Value Bytes    Spin Bytes*
    const InitOffset = rawLoaderImage.length - (  10 * 4  ) - (    8   );     // *DAT block data is always placed before the first Spin method

    //Loader patching workspace
    var patchWorkspace = new ArrayBuffer(rawLoaderImage.length);
    var patchedLoader  = new Uint8Array(patchWorkspace,                0);
    var bootClkSpeed   = new DataView(patchWorkspace, 0,               4);      //Booter's clock speed
    var bootClkMode    = new DataView(patchWorkspace, 4,               1);      //Booter's clock mode (1 byte)
    var bootChecksum   = new DataView(patchWorkspace, 5,               1);      //Booter's checksum (1 byte)
    var bootClkSel     = new DataView(patchWorkspace, InitOffset,      4);      //Booter's clock selection bits
    var iBitTime       = new DataView(patchWorkspace, InitOffset +  4, 4);      //Initial Bit Time (baudrate in clock cycles)
    var fBitTime       = new DataView(patchWorkspace, InitOffset +  8, 4);      //Final Bit Time (baudrate in clock cycles)
    var bitTime1_5     = new DataView(patchWorkspace, InitOffset + 12, 4);      //1.5x Final Bit Time
    var failsafe       = new DataView(patchWorkspace, InitOffset + 16, 4);      //Failsafe Timeout
    var endOfPacket    = new DataView(patchWorkspace, InitOffset + 20, 4);      //EndOfPacket Timeout
    var sTime          = new DataView(patchWorkspace, InitOffset + 24, 4);      //Minimum EEPROM Start/Stop Condition setup/hold time
    var sclHighTime    = new DataView(patchWorkspace, InitOffset + 28, 4);      //Minimum EEPROM SCL high time
    var sclLowTime     = new DataView(patchWorkspace, InitOffset + 32, 4);      //Minimum EEPROM SCL low time
    var expectedID     = new DataView(patchWorkspace, InitOffset + 36, 4);      //First Expected Packet ID; total packet count

    //Loader encoding workspace
    var encodeWorkspace = new ArrayBuffer(rawLoaderImage.length / 4 * 11);      //Reserve up to 11 bytes per encoded long
    var encodedLoader = new Uint8Array(encodeWorkspace, 0);

    //Maximum number of cycles by which the detection of a start bit could be off (as affected by the Loader code)
    const maxRxSenseError = 23;

    //Loader VerifyRAM snippet
    const verifyRAM = [
        0x49, 0xBC, 0xBC, 0xA0, 0x45, 0xBC, 0xBC, 0x84, 0x02, 0xBC, 0xFC, 0x2A, 0x45, 0x8C, 0x14, 0x08,
        0x04, 0x8A, 0xD4, 0x80, 0x66, 0xBC, 0xD4, 0xE4, 0x0A, 0xBC, 0xFC, 0x04, 0x04, 0xBC, 0xFC, 0x84,
        0x5E, 0x94, 0x3C, 0x08, 0x04, 0xBC, 0xFC, 0x84, 0x5E, 0x94, 0x3C, 0x08, 0x01, 0x8A, 0xFC, 0x84,
        0x45, 0xBE, 0xBC, 0x00, 0x5F, 0x8C, 0xBC, 0x80, 0x6E, 0x8A, 0x7C, 0xE8, 0x46, 0xB2, 0xBC, 0xA4,
        0x09, 0x00, 0x7C, 0x5C
    ];

    //Loader ProgramVerifyEEPROM snippet
    const programVerifyEEPROM = [
        0x03, 0x8C, 0xFC, 0x2C, 0x4F, 0xEC, 0xBF, 0x68, 0x82, 0x18, 0xFD, 0x5C, 0x40, 0xBE, 0xFC, 0xA0,
        0x45, 0xBA, 0xBC, 0x00, 0xA0, 0x62, 0xFD, 0x5C, 0x79, 0x00, 0x70, 0x5C, 0x01, 0x8A, 0xFC, 0x80,
        0x67, 0xBE, 0xFC, 0xE4, 0x8F, 0x3E, 0xFD, 0x5C, 0x49, 0x8A, 0x3C, 0x86, 0x65, 0x00, 0x54, 0x5C,
        0x00, 0x8A, 0xFC, 0xA0, 0x49, 0xBE, 0xBC, 0xA0, 0x7D, 0x02, 0xFD, 0x5C, 0xA3, 0x62, 0xFD, 0x5C,
        0x45, 0xC0, 0xBC, 0x00, 0x5D, 0xC0, 0x3C, 0x86, 0x79, 0x00, 0x54, 0x5C, 0x01, 0x8A, 0xFC, 0x80,
        0x72, 0xBE, 0xFC, 0xE4, 0x01, 0x8C, 0xFC, 0x28, 0x8F, 0x3E, 0xFD, 0x5C, 0x01, 0x8C, 0xFC, 0x28,
        0x46, 0xB2, 0xBC, 0xA4, 0x09, 0x00, 0x7C, 0x5C, 0x82, 0x18, 0xFD, 0x5C, 0xA1, 0xBA, 0xFC, 0xA0,
        0x8D, 0x62, 0xFD, 0x5C, 0x79, 0x00, 0x70, 0x5C, 0x00, 0x00, 0x7C, 0x5C, 0xFF, 0xBD, 0xFC, 0xA0,
        0xA0, 0xBA, 0xFC, 0xA0, 0x8D, 0x62, 0xFD, 0x5C, 0x83, 0xBC, 0xF0, 0xE4, 0x45, 0xBA, 0x8C, 0xA0,
        0x08, 0xBA, 0xCC, 0x28, 0xA0, 0x62, 0xCD, 0x5C, 0x45, 0xBA, 0x8C, 0xA0, 0xA0, 0x62, 0xCD, 0x5C,
        0x79, 0x00, 0x70, 0x5C, 0x00, 0x00, 0x7C, 0x5C, 0x47, 0x8E, 0x3C, 0x62, 0x90, 0x00, 0x7C, 0x5C,
        0x47, 0x8E, 0x3C, 0x66, 0x09, 0xC0, 0xFC, 0xA0, 0x58, 0xB8, 0xBC, 0xA0, 0xF1, 0xB9, 0xBC, 0x80,
        0x4F, 0xE8, 0xBF, 0x64, 0x4E, 0xEC, 0xBF, 0x78, 0x56, 0xB8, 0xBC, 0xF8, 0x4F, 0xE8, 0xBF, 0x68,
        0xF2, 0x9D, 0x3C, 0x61, 0x56, 0xB8, 0xBC, 0xF8, 0x4E, 0xEC, 0xBB, 0x7C, 0x00, 0xB8, 0xF8, 0xF8,
        0xF2, 0x9D, 0x28, 0x61, 0x91, 0xC0, 0xCC, 0xE4, 0x79, 0x00, 0x44, 0x5C, 0x7B, 0x00, 0x48, 0x5C,
        0x00, 0x00, 0x68, 0x5C, 0x01, 0xBA, 0xFC, 0x2C, 0x01, 0xBA, 0xFC, 0x68, 0xA4, 0x00, 0x7C, 0x5C,
        0xFE, 0xBB, 0xFC, 0xA0, 0x09, 0xC0, 0xFC, 0xA0, 0x58, 0xB8, 0xBC, 0xA0, 0xF1, 0xB9, 0xBC, 0x80,
        0x4F, 0xE8, 0xBF, 0x64, 0x00, 0xBB, 0x7C, 0x62, 0x01, 0xBA, 0xFC, 0x34, 0x4E, 0xEC, 0xBF, 0x78,
        0x57, 0xB8, 0xBC, 0xF8, 0x4F, 0xE8, 0xBF, 0x68, 0xF2, 0x9D, 0x3C, 0x61, 0x58, 0xB8, 0xBC, 0xF8,
        0xA7, 0xC0, 0xFC, 0xE4, 0xFF, 0xBA, 0xFC, 0x60, 0x00, 0x00, 0x7C, 0x5C
    ];

    //Loader LaunchStart snippet
    const readyToLaunch = [
        0xB8, 0x72, 0xFC, 0x58, 0x66, 0x72, 0xFC, 0x50, 0x09, 0x00, 0x7C, 0x5C, 0x06, 0xBE, 0xFC, 0x04,
        0x10, 0xBE, 0x7C, 0x86, 0x00, 0x8E, 0x54, 0x0C, 0x04, 0xBE, 0xFC, 0x00, 0x78, 0xBE, 0xFC, 0x60,
        0x50, 0xBE, 0xBC, 0x68, 0x00, 0xBE, 0x7C, 0x0C, 0x40, 0xAE, 0xFC, 0x2C, 0x6E, 0xAE, 0xFC, 0xE4,
        0x04, 0xBE, 0xFC, 0x00, 0x00, 0xBE, 0x7C, 0x0C, 0x02, 0x96, 0x7C, 0x0C
    ];

    //Loader LaunchFinal snippet
    const launchNow = [0x66, 0x00, 0x7C, 0x5C];

    //Executable code snippet array (indexed by loaderType starting at ltVerifyRAM)
    var exeSnippet = [verifyRAM, programVerifyEEPROM, readyToLaunch, launchNow];

    //Checksum value of Initial Call Frame (0xFF, 0xFF, 0xF9, 0xFF, 0xFF, 0xFF, 0xF9, 0xFF); not included in
    //Raw Loader Image, but auto-inserted by ROM-resident boot loader, so it's checksum value must be included in image.
    const initCallFrameChecksum = 236;

    //Maximum needed RAM Checksum timing pulses (per Propeller response window specs)
    var timingPulses = new Array(3110).fill(0xF9);

    //Packet workspace
    var packet = new ArrayBuffer(5120);

    if (loaderType === ltCore) {
        //Generate specially-prepared stream of Micro Boot Loader's core (with handshake, timing templates, and host-initialized timing

        //Prepare Loader Image with patched clock metrics and host-initialized values in little-endian form (regardless of platform)
        patchedLoader.set(rawLoaderImage, 0);                                                  //Copy raw loader image for adjustments and processing
        bootClkSpeed.setUint32(0, clockSpeed, true);                                           //Set booter's clock speed
        bootClkMode.setUint8(0, clockMode);                                                    //Set booter's clock mode (1 byte)
        bootClkSel.setUint32(0, clockMode & 0x07, true);                                       //Booter's clock selection bits
        iBitTime.setUint32(0, Math.round(clockSpeed / initialBaudrate), true);                 //Initial Bit Time (baudrate in clock cycles)
        fBitTime.setUint32(0, Math.round(clockSpeed / finalBaudrate), true);                   //Final Bit Time (baudrate in clock cycles)
        bitTime1_5.setUint32(0, Math.round(((1.5 * clockSpeed) / finalBaudrate) - maxRxSenseError), true);  //1.5x Final Bit Time minus maximum start bit sense error
        failsafe.setUint32(0, 2 * Math.trunc(clockSpeed / (3 * 4)), true);                     //Failsafe Timeout (seconds-worth of Loader's Receive loop iterations)
        endOfPacket.setUint32(0, Math.round(2 * clockSpeed / finalBaudrate * 10 / 12), true);  //EndOfPacket Timeout (2 bytes worth of Loader's Receive loop iterations)
        sTime.setUint32(0, Math.max(Math.round(clockSpeed * 0.0000006), 14), true);            //Minimum EEPROM Start/Stop Condition setup/hold time (400 KHz = 1/0.6 µS); Minimum 14 cycles}
        sclHighTime.setUint32(0, Math.max(Math.round(clockSpeed * 0.0000006), 14), true);      //Minimum EEPROM SCL high time (400 KHz = 1/0.6 µS); Minimum 14 cycles
        sclLowTime.setUint32(0, Math.max(Math.round(clockSpeed * 0.0000013), 14), true);       //Minimum EEPROM SCL low time (400 KHz = 1/1.3 µS); Minimum 26 cycles
        expectedID.setUint32(0, packetId, true);                                               //First Expected Packet ID; total packet count

        //Recalculate and update checksum
        bootChecksum.setUint8(0, 0);
        var checksum = initCallFrameChecksum;
        for (var idx = 0; idx < patchedLoader.byteLength; idx++) {
            checksum += patchedLoader[idx];
        }
        bootChecksum.setUint8(0, 0x100 - (checksum & 0xFF));

        //Generate Micro Boot Loader Download Stream from patchedLoader
        var bCount = 0;
        var loaderEncodedSize = 0;
        while (bCount < patchedLoader.byteLength * 8) {                                         //For all bits in data stream...
            var bitsIn = Math.min(5, patchedLoader.byteLength * 8 - bCount);                    //  Determine number of bits in current unit to translate; usually 5 bits
            var bValue = ( (patchedLoader[Math.trunc(bCount / 8)] >>> (bCount % 8)) +           //  Extract next translation unit (contiguous bits, LSB first; usually 5 bits)
                (patchedLoader[Math.trunc(bCount / 8) + 1] << (8 - (bCount % 8))) ) & pwr2m1[bitsIn];
            encodedLoader[loaderEncodedSize++] = pDSTx[bValue][bitsIn][0];                      //  Translate unit to encoded byte
            bCount += pDSTx[bValue][bitsIn][1];                                                 //  Increment bit index (usually 3, 4, or 5 bits, but can be 1 or 2 at end of stream)
        }
        //Prepare loader packet
        //Contains timing pulses + handshake + encoded Micro Boot Loader application + timing pulses
        txData = new ArrayBuffer(txHandshake.length + 11 + encodedLoader.byteLength + timingPulses.length);
        txView = new Uint8Array(txData);
        txView.set(txHandshake, 0);
        var txLength = txHandshake.length;
        var rawSize = rawLoaderImage.length / 4;
        for (idx = 0; idx < 11; idx++) {
            txView[txLength++] = 0x92 | (idx < 10 ? 0x00 : 0x60) | rawSize & 1 | (rawSize & 2) << 2 | (rawSize & 4) << 4;
            rawSize = rawSize >>> 3;
        }
        txView.set(encodedLoader, txLength);
        txView.set(timingPulses, txLength + encodedLoader.byteLength);
    } else {
        //Generate special loader's executable packet according to loaderType (> ltCore)
        txData = new ArrayBuffer(2 * 4 + exeSnippet[loaderType].length);                        //Set txData size for header plus executable packet
        txView = new Uint8Array(txData);
        (new DataView(txData, 0, 4)).setUint32(0, packetId, true);                              //Store Packet ID (skip over Transmission ID field; it will be filled at time of transmission)
        txView.set(exeSnippet[loaderType], 8);                                                  //Copy the executable packet code into it
    }

}