
/*
var settings = {
    bitrate: 115200,
    dataBits: 'eight',
    parityBit: 'no',
    stopBits: 'one',
    ctsFlowControl: false
};
*/

var portID = 0;

function openPort(portPath, baudrate) {
    console.log("in open");
    chrome.serial.connect(portPath, {
        'bitrate': parseInt(baudrate),
        'dataBits': 'eight',
        'parityBit': 'no',
        'stopBits': 'one',
        'ctsFlowControl': false
        },
        function(openInfo) {
            if (openInfo === undefined) {
                console.log("Could not open port %s", portPath);
            } else {
                portID = openInfo.connectionId;
                console.log("Port ", portPath, " open with ID ", portID);
            }
        });
};

function closePort() {
    chrome.serial.disconnect(portID,
        function(closeResult) {
            if (closeResult === true) {
                console.log("Port closed");
            } else {
                console.log("Port not closed");
            }
        });
}

/*
var makeConnection = function(sock, portPath, baudrate, connMode) {
    settings.bitrate = parseInt(baudrate);
    chrome.serial.connect(portPath, {
            'bitrate': settings.bitrate,
            'dataBits': settings.dataBits,
            'parityBit': settings.parityBit,
            'stopBits': settings.stopBits,
            'ctsFlowControl': settings.ctsFlowControl
        },
        function(openInfo) {
            if (openInfo === undefined) {
                log('Unable to connect to device<br>');
                //connectedUSB = null;
                //return true;
            } else {
                serialJustOpened = openInfo.connectionId;
                for (var j = 0; j < connectedSockets.length; j++) {
                    if (connectedSockets[j] === sock) {
                        connectedUSB.push({wsSocket:j, connId:parseInt(openInfo.connectionId), mode:connMode, path:portPath});
                        break;
                    }
                }
                log('Device connected to [' + openInfo.connectionId + '] ' + portPath);

                //return false;
            }
        });
};
*/