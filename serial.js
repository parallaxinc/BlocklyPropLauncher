//TODO Enhanced (or integrate with index.js) to support multiple active connections (portIDs)

var portID = -1;

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
//TODO Determine why portID (openInfo.connectionId) always increases per OS session and not just per app session.  Is that a problem?  Are we not cleaning up something that should be addressed?
            }
        });
};

function closePort() {
    if (isOpen) {
        chrome.serial.disconnect(portID,
            function (closeResult) {
                if (closeResult === true) {
                    portID = -1;
                    console.log("Port closed");
                } else {
                    console.log("Port not closed");
                }
            });
    };
};

function isOpen() {
    return portId >= 0;
};
