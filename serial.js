//TODO Enhance (or integrate with index.js) to support multiple active connections (portIDs); talkToProp and hearFromProp especially
//TODO Revisit promisify and see if it will clean up code significantly

var portID = -1;
var portBaudrate = 0;
const initialBaudrate = 115200;                     //Initial Propeller communication baud rate (standard boot loader)
const finalBaudrate = 921600;                       //Final Propeller communication baud rate (Micro Boot Loader)
var txData;                                         //Data to transmit to the Propeller (size/contents created later)

const defaultClockSpeed = 80000000;
const defaultClockMode = 0x6F;


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
var propComm = {};                                  //Holds current status
var mblRespAB = new ArrayBuffer(8);                 //Buffer for Micro Boot Loader responses

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

//Add programming receive handler
chrome.serial.onReceive.addListener(hearFromProp);

/***********************************************************
 *                 Serial Support Functions                *
 ***********************************************************/

//TODO Consider returning error object
//TODO Determine why portID (openInfo.connectionId) always increases per OS session and not just per app session.  Is that a problem?  Are we not cleaning up something that should be addressed?
function openPort(portPath, baudrate) {
//Open serial port at portPath with baudrate.
//baudrate is optional; defaults to initialBaudrate
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
                if (openInfo === undefined) {
                    console.log("Could not open port %s", portPath);
                } else {
                    portID = openInfo.connectionId;
                    console.log("Port", portPath, "open with ID", portID);
                    resolve(portID);
                }
            }
        );
    });
}

//TODO Consider returning error object
function closePort() {
    isOpen()
        .then(function() {
            chrome.serial.disconnect(portID,
                function (closeResult) {
                    if (closeResult === true) {
                        portID = -1;
                        console.log("Port closed");
                    } else {
                        console.log("Port not closed");
                    }
                });
        });
}

function isOpen() {
//Return promise that is resolved if port is open, rejected otherwise
    return new Promise(function(resolve, reject) {
        portID >= 0 ? resolve() : reject()
    });
}

function changeBaudrate(baudrate) {
//Change port's baudrate.
//baudrate is optional; defaults to finalBaudrate
    portBaudrate = baudrate ? parseInt(baudrate) : finalBaudrate;
    return new Promise(function(resolve, reject) {
        console.log("Changing baudrate to " + portBaudrate);
        chrome.serial.update(portID, {'bitrate': portBaudrate}, function(updateResult) {
            updateResult ? resolve() : reject(Error("Can not set baudrate: " + baudrate));
        });
        resolve();
    });
}

//TODO determine if there's a better way to promisify callbacks (with boolean results)
function setControl(options) {
    return new Promise(function(resolve, reject) {
        chrome.serial.setControlSignals(portID, options, function(controlResult) {
            controlResult ? resolve() : reject(Error("Can not set " + options))
        });
    });
}

function flush() {
// Empty transmit and receive buffers
    return new Promise(function(resolve, reject) {
        chrome.serial.flush(portID, function(flushResult) {
            flushResult ? resolve() : reject(Error("Can not flush transmit/receive buffer"))
        });
    });
}

//TODO Check send callback
//TODO Consider returning error object
function send(data) {
// Transmit data
    // Convert data from string or buffer to an ArrayBuffer
    if (typeof data === 'string') {
        data = str2ab(data);
    } else {
        if (data instanceof ArrayBuffer === false) {data = buffer2ArrayBuffer(data)}
    }
    return chrome.serial.send(portID, data, function (sendResult) {
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

function talkToProp() {
// Transmit programming stream to Propeller

    function sendLoader(waittime) {
    // Return a promise that waits for waittime then sends communication package including loader.
        return new Promise(function(resolve, reject) {
            console.log("Waiting %d ms to deliver Micro Boot Loader package", waittime);
            setTimeout(function() {
                console.log("Transmitting package");
                send(txData);
                resolve();
            }, waittime);
        });
    }

    function isLoaderReady(packetId, waittime) {
    /* Is Micro Boot Loader delivered and Ready?
     Return a promise that waits for waittime then validates the responding Propeller Handshake, Version, and that the Micro Boot Loader delivery succeeded.
     Rejects if any error occurs.  Micro Boot Loader must respond with packetId (plus transmissionId) for success (resolve).
     Error is "Propeller not found" unless handshake received (and proper) and version received; error is more specific thereafter.*/

        return new Promise(function(resolve, reject) {
            function verifier() {
                console.log("Verifying package delivery");
                //Check handshake and version
                if (propComm.handshake === stValidating || propComm.handshake === stInvalid || propComm.version === stValidating) {reject(Error("Propeller not found.")); return}
                //Check for proper version
                if (propComm.version !== 1) {reject(Error("Found Propeller version " + propComm.version + " - expected version 1.")); return}
                //Check RAM checksum
                if (propComm.ramCheck === stValidating) {reject(Error("Propeller communication lost waiting for RAM Checksum.")); return}
                if (propComm.ramCheck === stInvalid) {reject(Error("RAM checksum failure.")); return}
                //Check Micro Boot Loader Ready Signal
                if (propComm.mblResponse !== stValid || propComm.mblPacketId[0] !== packetId) {reject(Error("Micro Boot Loader failed.")); return}
                console.log("Found Propeller!  Micro Boot Loader ready.");
                resolve();
            }
            console.log("Waiting %d ms for package delivery", waittime);
            setTimeout(verifier, waittime);
        });
    }

    //!!! Temporarily fix packetId
    var packetId = 3;

    //Generate communication and loader package
    generateLoaderPacket(ltCore, packetId, defaultClockSpeed, defaultClockMode);

    //Calculate expected max package delivery time
    //=300 [>max post-reset-delay] + ((10 [bits per byte] * (data bytes [transmitting] + silence bytes [MBL waiting] +
    // MBL "ready" bytes [MBL responding])) / baud rate) * 1,000 [to scale ms to integer] + 1 [to always round up]
    var deliveryTime = 300+((10*(txData.byteLength+20+8))/portBaudrate)*1000+1;

    isOpen()
        .then(function() {       Object.assign(propComm, propCommStart)} )       //Reset propComm object
        .then(function() {       console.log("Generating reset signal")} )
        .then(function() {return setControl({dtr: false})}               )       //Start Propeller Reset Signal
        .then(function() {return flush()}                                )       //Flush transmit/receive buffers (during Propeller reset)
        .then(function() {return setControl({dtr: true})}                )       //End Propeller Reset
        .then(function() {return sendLoader(100)}                        )       //After Post-Reset-Delay, send package: Calibration Pulses+Handshake through Micro Boot Loader application+RAM Checksum Polls
        .then(function() {return isLoaderReady(packetId, deliveryTime)}  )       //Verify package accepted
        .then(function() {return changeBaudrate()}                       )       //Bump up to faster finalBaudrate
        .catch(function(err) {console.log("Error: %s", err.message)}     );      //Catch errors

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
        return
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
    var patchedLoader = new Uint8Array(patchWorkspace, 0);
    var bootClkSpeed = new DataView(patchWorkspace, 0, 4);                      //Booter's clock speed
    var bootClkMode = new DataView(patchWorkspace, 4, 1);                       //Booter's clock mode (1 byte)
    var bootChecksum = new DataView(patchWorkspace, 5, 1);                      //Booter's checksum (1 byte)
    var bootClkSel = new DataView(patchWorkspace, InitOffset, 4);               //Booter's clock selection bits
    var iBitTime = new DataView(patchWorkspace, InitOffset + 4, 4);             //Initial Bit Time (baudrate in clock cycles)
    var fBitTime = new DataView(patchWorkspace, InitOffset + 8, 4);             //Final Bit Time (baudrate in clock cycles)
    var bitTime1_5 = new DataView(patchWorkspace, InitOffset + 12, 4);          //1.5x Final Bit Time
    var failsafe = new DataView(patchWorkspace, InitOffset + 16, 4);            //Failsafe Timeout
    var endOfPacket = new DataView(patchWorkspace, InitOffset + 20, 4);         //EndOfPacket Timeout
    var sTime = new DataView(patchWorkspace, InitOffset + 24, 4);               //Minimum EEPROM Start/Stop Condition setup/hold time
    var sclHighTime = new DataView(patchWorkspace, InitOffset + 28, 4);         //Minimum EEPROM SCL high time
    var sclLowTime = new DataView(patchWorkspace, InitOffset + 32, 4);          //Minimum EEPROM SCL low time
    var expectedID = new DataView(patchWorkspace, InitOffset + 36, 4);          //First Expected Packet ID; total packet count

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
            checksum += patchedLoader[idx]
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
        tv = new Uint8Array(txData);
        tv.set(txHandshake, 0);
        var txLength = txHandshake.length;
        var rawSize = rawLoaderImage.length / 4;
        for (idx = 0; idx < 11; idx++) {
            tv[txLength++] = 0x92 | (idx < 10 ? 0x00 : 0x60) | rawSize & 1 | (rawSize & 2) << 2 | (rawSize & 4) << 4;
            rawSize = rawSize >>> 3;
        }
        tv.set(encodedLoader, txLength);
        tv.set(timingPulses, txLength + encodedLoader.byteLength);
    } else {
        //Prepare loader's special executable packet
        txData = new ArrayBuffer(2 * 4 + exeSnippet[loaderType].length);                        //Set txData size for header plus executable packet
        tv = new Uint8Array(txData);
        (new DataView(txData, 0, 4)).setUint32(0, packetId, true);                              //Store Packet ID (skip over Transmission ID field; "transmitPacket" will fill that)
        tv.set(exeSnippet[loaderType], 8);                                                      //Copy the executable packet code into it
    }

}