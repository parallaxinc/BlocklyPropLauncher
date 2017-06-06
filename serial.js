//TODO Enhanced (or integrate with index.js) to support multiple active connections (portIDs)

var portID = -1;

function openPort(portPath, baudrate) {
    console.log("in open");
    return new Promise(function(fulfill, reject) {
        chrome.serial.connect(portPath, {
                'bitrate': parseInt(baudrate),
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
                    fulfill(portID);
//TODO Determine why portID (openInfo.connectionId) always increases per OS session and not just per app session.  Is that a problem?  Are we not cleaning up something that should be addressed?
                }
            }
        );
    });
}

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
    return new Promise(function(fulfill, reject) {
        if (portID >= 0) {
            fulfill(true);
        } else {
            reject(false);
        };
    });
}

function talkToProp() {
    console.log("talking to Propeller");
    isOpen()
        .then(function() {
//           return transport.flush();
//        })
//        .then(function(){
//            if(transport.isPaused()){
//                return transport.unpause();
//            }
//        })
//        .then(function(){
            setControl({dtr: false})
        })
        .then(function() {
            setControl({dtr: true});
        })
        .then(function() {
            setTimeout(function(){send("This is a test")}, 100);
        })
//            if(transport.isPaused()){
//                return transport.unpause();
//            }
//        })
        .then(function() {
            setControl({dtr: false});
            setControl({dtr: true});
            flush();
        });

//    return nodefn.bindCallback(promise, cb);
    console.log("done talking to Propeller");
}

//TODO determine if there's a better way to promisify callbacks (with boolean results)
function setControl(options) {
    return new Promise(function(fulfill, reject) {
        chrome.serial.setControlSignals(portID, options, function(controlResult) {
            if (controlResult) {
                fulfill(true);
            } else {
                reject(false);
            }
        });
    });
}

function flush() {
    return new Promise(function(fulfill, reject) {
        chrome.serial.flush(portID, function(flushResult) {
            if (flushResult) {
                fulfill(true);
            } else {
                reject(false);
            }
        });
    });
}

function send(data) {
    if (typeof data === 'string') {
        data = str2ab(data);
    }
    if (data instanceof ArrayBuffer === false) {
        data = buffer2ArrayBuffer(data);
    }

    return chrome.serial.send(portID, data, function (sendResult) {
    });
}

// Convert string to ArrayBuffer
function str2ab(str) {
    var buf = new ArrayBuffer(str.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0; i < str.length; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

// Convert buffer to ArrayBuffer
function buffer2ArrayBuffer(buffer) {
    var buf = new ArrayBuffer(buffer.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0; i < buffer.length; i++) {
        bufView[i] = buffer[i];
    }
    return buf;
}
