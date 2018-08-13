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

// Container for attributes of connected ports (wired or wireless)
var ports = [];

// Serial packet handling (for transmissions to browser's terminal)
const serPacketFillTime = 10;                                                   // Max wait time to fill packet (ms)
const serPacketMax = Math.trunc(serPacketFillTime/1000/(1/finalBaudrate*10));   // Size of buffer to hold max bytes receivable in FillTime at max baudrate
const serPacket = {
    id      : 0,
    bufView : new Uint8Array(new ArrayBuffer(serPacketMax)),
    len     : 0,
    timer   : null,
};

function addPort(cid, socket, connMode, portPath, iP, mAC, portBaudrate) {
// Add new serial port record
    let idx = findSocketIdx(socket);
    /*    if (idx = -1) {
     log("Adding port at index " + ports.length, mDbug);
     } else {
     log("Adding port at index " + sockets.length + " referencing socket at index " + idx, mDbug);
     }*/
    ports.push({
        connId    : cid,
        path      : portPath,
        ip        : iP,
        mac       : mAC,
        life      : 0,           //!!!  Need to set to initial value
        socket    : socket,
        socketIdx : idx,
        mode      : connMode,
        baud      : portBaudrate,
        packet    : {}
    });
    // Give it its own packet buffer
    Object.assign(ports[ports.length-1].packet, serPacket);
    // Point existing socket reference to new serial port record
    if (idx > -1) {sockets[idx].serialIdx = ports.length-1}
}

function updatePort(socket, cid, connMode, portBaudrate) {     //!!! Need to update
// Update port attributes if necessary
// Automatically handles special cases like baudrate changes and sockets<->ports links
    return new Promise(function(resolve, reject) {
        let cIdx = findPortIdx(cid);
//        log("Updating port at index " + cIdx, mDbug);
        if (cIdx > -1) {
            //Update sockets<->ports links as necessary
            let sIdx = (socket) ? findSocketIdx(socket) : -1;
            if (ports[cIdx].socketIdx !== sIdx) {
                // newSocket is different; update required
//                log("  Linking to socket index " + sIdx, mDbug);
                if (ports[cIdx].socketIdx !== -1) {
                    // Adjust existing socket's record
                    sockets[ports[cIdx].socketIdx].serialIdx = -1;
                }
                // Update port and socket records
                ports[cIdx].socket = socket;
                ports[cIdx].socketIdx = sIdx;
                if (sIdx > -1) {
                    sockets[sIdx].serialIdx = cIdx;
                }
            }
            //Update connection mode
            ports[cIdx].mode = connMode;
            //Update baudrate
            changeBaudrate(cid, portBaudrate)
                .then(function (p) {resolve(p)})
                .catch(function (e) {reject(e)});
        }
    })
}

function findPortId(portPath) {                                    //!!! Need to update
    /* Return id (cid) of serial port associated with portPath
     Returns null if not found*/
    const port = findPort(portPath);
    return port ? port.connId : null;
}

function findPortPath(id) {                                        //!!! Need to update
    /* Return path of serial port associated with id
     Returns null if not found*/
    const port = findPort(id);
    return port ? port.path : null;
}

function findPortIdx(id) {                                         //!!! Need to update
    /* Return index of serial port associated with id
     Returns -1 if not found*/
    return ports.findIndex(function(p) {return p.connId === id});
}

function deletePort(id) {                                          //!!! Need to update
// Delete serial port associated with id
    let idx = 0;
    while (idx < ports.length && ports[idx].connId !== id) {idx++}
    if (idx < ports.length) {
        if (ports[idx].socketIdx > -1) {
            // Clear socket's knowledge of serial port record
            sockets[ports[idx].socketIdx].serialIdx = -1;
        }
        // Delete port record and adjust socket's later references down, if any
        ports.splice(idx, 1)
        sockets.forEach(function(v) {if (v.serialIdx > idx) {v.serialIdx--}});

    }
}

function findPort(cidOrPath) {                                     //!!! Need to update
    /* Return port record associated with cidOrPath.  This allows caller to directly retrieve any member of the record (provided caller safely checks for null)
     cidOrPath can be a numeric cid (Connection ID) or an alphanumeric path (serial port identifier)
     Returns null record if not found*/
    let cn = 0;
    // Find port record based on scan function
    function findConn(scan) {
        while (cn < ports.length && !scan()) {cn++}
        return cn < ports.length ? ports[cn] : null;
    }
    // Scan for connID or path
    if (isNumber(cidOrPath)) {
        return findConn(function() {return ports[cn].connId === cidOrPath})
    } else {
        return findConn(function() {return ports[cn].path === cidOrPath})
    }
}
