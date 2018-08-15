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


// Find Port identifier types
const byID = 0;
const byPath = 1;

// Port's max lifetime
const wLife = 2;
const wlLife = 3;

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

function makePortName(cid) {
    /* Return wireless fabricated name in the form 'wx-#######' using last 6 digits of it's MAC address (cid).*/
    return 'wx-' + cid.substr(9,16).replace(/\:/g,'');
}

function addPort(cid, socket, connMode, portPath, iP, portBaudrate) {
/* Add new wired or wireless port record (automatically updates existing port if necessary)
   cid must be a unique identifier (wired serial port connection id or wireless MAC address)
   socket may be null or may be valid socket to associate with port
   connMode is the current point of the connection; 'debug', 'programming'
   portPath (required) is the string path to the wired serial port, or custom name of wireless port.  If empty, wireless name is fabricated from cid (MAC address)
   ip must be wireless ports IP address, or empty if wired
   portBaudrate is optional wired serial speed*/
    if (!portPath) {
        //No port path?  If wireless port, craft path from MAC (cid), else abort (return)
        if (iP && cid) {portPath = makePortName(cid)} else {return}
    }
    if ((cid && findPort(byID, cid)) || (findPort(byPath, portPath))) {
        // Exists already? Update it
        updatePort(cid, socket, connMode, portPath, iP, portBaudrate);
    } else {
        // else, add it
        let idx = findSocketIdx(socket);
        /*    if (idx = -1) {
         log("Adding port at index " + ports.length, mDbug);
         } else {
         log("Adding port at index " + sockets.length + " referencing socket at index " + idx, mDbug);
         }*/
        ports.push({
            connId    : cid,                                               /*Holds wired serial port's connection id or wireless port's MAC address*/
            path      : portPath,                                          /*Wired port path, or wireless port's custom name, or fabricated name*/
            ip        : iP,                                                /*Wireless port's IP address*/
            life      : (!iP) ? wLife : wlLife,                            /*Initial life value; wired and wireless*/
            socket    : socket,                                            /*Socket to browser*/
            socketIdx : idx,                                               /*Index of socket in sockets list*/
            mode      : connMode,                                          /*The current point of the connection; 'debug', 'programming'*/
            baud      : portBaudrate,                                      /*Wired port's data rate*/
            packet    : {}                                                 /*Packet buffer for socket*/
        });
        // Give it its own packet buffer
        Object.assign(ports[ports.length-1].packet, serPacket);
        // Point existing socket reference to new serial port record
        if (idx > -1) {sockets[idx].serialIdx = ports.length-1}
    }
}

function updatePort(cid, socket, connMode, portPath, iP, portBaudrate) {
// Update port attributes if necessary
// Automatically handles special cases like baudrate changes and sockets<->ports links
    return new Promise(function(resolve, reject) {
        if (!portPath) {
            // No port path?  If wireless port, craft path from MAC (cid), else abort (reject)
            if (iP && cid) {portPath = makePortName(cid)} else {reject("portPath required!"); return}
        }
        let pIdx = (cid) ? findPortIdx(byID, cid) : findPortIdx(byPath, portPath);
//        log("Updating port at index " + pIdx, mDbug);
        if (pIdx > -1) {
            // Update most attributes
            ports[pIdx].connId = cid;
            ports[pIdx].path = portPath;
            ports[pIdx].ip = iP;
            ports[pIdx].life = (!iP) ? wLife : wlLife;
            ports[pIdx].mode = connMode;
            // Update sockets<->ports links as necessary
            let sIdx = (socket) ? findSocketIdx(socket) : -1;
            if (ports[pIdx].socketIdx !== sIdx) {
                // newSocket is different; update required
//                log("  Linking to socket index " + sIdx, mDbug);
                if (ports[pIdx].socketIdx !== -1) {
                    // Adjust existing socket's record
                    sockets[ports[pIdx].socketIdx].serialIdx = -1;
                }
                // Update port and socket records
                ports[pIdx].socket = socket;
                ports[pIdx].socketIdx = sIdx;
                if (sIdx > -1) {
                    sockets[sIdx].serialIdx = pIdx;
                }
            }
            //Update baudrate
            if (portBaudrate > 0) {
                changeBaudrate(cid, portBaudrate)
                    .then(function (p) {resolve(p)})
                    .catch(function (e) {reject(e)});
            }
        }
    })
}

function findPortId(portPath) {
    /* Return id (cid) of wired or wireless port associated with portPath
     Returns null if not found*/
    const port = findPort(byPath, portPath);
    return port ? port.connId : null;
}

function findPortPath(id) {
    /* Return path of wired or wireless port associated with id
     Returns null if not found*/
    const port = findPort(byID, id);
    return port ? port.path : null;
}

function findPortIdx(type, clue) {
    /* Return index of wired or wireless port associated with clue
     Returns -1 if not found*/
    if (type === byID) {
        return ports.findIndex(function(p) {return p.connId === clue})
    } else {
        return ports.findIndex(function(p) {return p.path === clue})
    }
}

function deletePort(type, clue) {
// Delete wired or wireless port associated with clue
    let idx = findPortIdx(type, clue);
    if (idx > -1) {
        if (ports[idx].socketIdx > -1) {
            // Clear socket's knowledge of wired or wireless port record
            sockets[ports[idx].socketIdx].serialIdx = -1;
        }
        // Delete port record and adjust socket's later references down, if any
        ports.splice(idx, 1)
        sockets.forEach(function(v) {if (v.serialIdx > idx) {v.serialIdx--}});
    }
}

function findPort(type, clue) {
    /* Return port record associated with clue.  This allows caller to directly retrieve any member of the record (provided caller safely checks for null)
     type must be byID or byPath
     If type = byID, clue must be a numeric Connection ID (cid) or an alphanumeric MAC address
     If type = byPath, clue must be an alphanumeric path (wired/wireless port identifier)
     Returns null record if not found*/
    let cn = 0;
    // Find port record based on scan function
    function findConn(scan) {
        while (cn < ports.length && !scan()) {cn++}
        return cn < ports.length ? ports[cn] : null;
    }
    // Scan for ID or path
    if (type === byID) {
        return findConn(function() {return ports[cn].connId === clue})
    } else {
        return findConn(function() {return ports[cn].path === clue})
    }
}
