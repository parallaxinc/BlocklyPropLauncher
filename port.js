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

function makePortName(mac) {
    /* Return wireless fabricated name in the form 'wx-#######' using last 6 digits of it's MAC address.*/
    return 'wx-' + mac.substr(9,16).replace(/\:/g,'');
}

function addPort(alist) {
/* Add new wired or wireless port record (automatically updates existing port if necessary).
   alist: [required] one or more attributes of port to add.  Possible attributes are:
     connId: unique identifier for the wired serial port connection id or wireless MAC address; can be null unless path = ""
     socket: active socket to associate with port; may be null
     mode: the current point of the connection; 'debug', 'programming'
     path: [required] the string path to the wired serial port, or custom name of wireless port.  Can be empty ("") and a wireless name will be fabricated from cid (MAC address)
     ip: the wireless port's IP address; empty ("") if wired
     baud: wired serial speed*/
    if (!alist.path) {
        //No port path?  If wireless port, craft path from MAC (cid), else abort (return)
        if (exists("ip", alist) && exists("connId", alist)) {alist.path = makePortName(alist.connId)} else {return}
    }
    // Look for existing port
    let port = (exists("connId", alist) && alist.connId) ? findPort(byID, alist.connId) : findPort(byPath, alist.path);
    if (port) {
        // Exists already? Update it's (portPath or iP)
        updatePort(port, alist);
    } else {
        // else, add it
//!!!        log("Adding port (" + cid + ", " + portPath + ", " + iP + ")", mDbug);
        ports.push({
            connId    : cid,                         /*[null+] Holds wired serial port's connection id (if open), null (if closed), or wireless port's MAC address*/
            path      : portPath,                    /*[<>""]  Wired port path, or wireless port's custom name, or fabricated name; never empty*/
            ip        : iP,                          /*[""+]   Wireless port's IP address; */
            life      : (!iP) ? wLife : wlLife,      /*[>=0]   Initial life value; wired and wireless*/
            socket    : null,                        /*[null+] Socket to browser*/
            socketIdx : -1,                          /*[>=-1]  Index of socket in sockets list*/
            mode      : "",                          /*[""+]   Intention of the connection; '', 'debug', or 'programming'*/
            baud      : 0,                           /*[>=0]   Wired port's data rate*/
            packet    : {}                           /*Packet buffer for socket*/
        });
        // Give it its own packet buffer
        Object.assign(ports[ports.length-1].packet, serPacket);
    }
}

function updatePort(port, alist) {
/* Update port attributes if necessary.  Automatically handles special cases like baudrate changes and sockets<->ports links.
   port: [required] port object to update
   alist: [required] one or more attributes of port to update.  Possible attributes are:
     connId: unique identifier for the wired serial port connection id or wireless MAC address; can be null unless path = ""
     socket: active socket to associate with port; may be null
     mode: the current point of the connection; 'debug', 'programming'
     path: the string path to the wired serial port, or custom name of wireless port.  Can be empty ("") and a wireless name will be fabricated from cid (MAC address)
     ip: the wireless port's IP address; empty ("") if wired
     baud: wired serial speed*/
    return new Promise(function(resolve, reject) {
        if (exists("path", alist) && !alist.path) {
            // Empty port path?  If wireless port, craft path from MAC (cid), else abort (reject)
            if (port.ip && port.connId) {alist.path = makePortName(port.connId)} else {reject("path required!"); return}
        }
//!!!        log("Updating port '" + port.path + "' with " + alist, mDbug);
        // Update most attributes
        setAttr(port, "connId", alist);
        setAttr(port, "path", alist);
        setAttr(port, "ip", alist);
        port.life = (!port.ip) ? wLife : wlLife;
        setAttr(port, "mode", alist);
        // Update sockets<->ports links as necessary
        let sIdx = (exists("socket", alist)) ? findSocketIdx(alist["socket"]) : -1;
        if (port.socketIdx !== sIdx) {
            // newSocket is different; update required
//            log("  Linking to socket index " + sIdx, mDbug);
            // Adjust existing socket's record
            if (port.socketIdx !== -1) {sockets[port.socketIdx].serialIdx = -1}
            // Update port and socket records
            port.socket = socket;
            port.socketIdx = sIdx;
            if (sIdx > -1) {sockets[sIdx].serialIdx = findPortIdx(byPath, port.path)}
        }
        //Update baudrate
        if (exists("baud", alist)) {
            changeBaudrate(port, alist.baud)
                .then(function() {resolve()})
                .catch(function(e) {reject(e)});
        }
    })
}

function setAttr(attr, src, dst) {
/*Set dst.attr = src.attr if, and only if, src.attr is defined; otherwise, leave dst.attr as-is*/
    if (exists(attr, src)) {dst[attr] = src[attr]}
}

function exists(attr, src) {
/*Returns true if attr exists in src*/
  return src.hasOwnProperty(attr);
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

function deletePort(type, clue) {
// Delete wired or wireless port associated with clue
    let idx = findPortIdx(type, clue);
    if (idx > -1) {
        log("Deleting port: " + ports[idx].path, mDbug);
        if (ports[idx].socketIdx > -1) {
            // Clear socket's knowledge of wired or wireless port record
            sockets[ports[idx].socketIdx].serialIdx = -1;
        }
        // Delete port record and adjust socket's later references down, if any
        ports.splice(idx, 1)
        sockets.forEach(function(v) {if (v.serialIdx > idx) {v.serialIdx--}});
    }
}

function isWiredPort(path) {
// Returns true if path is a known wired port, false otherwise.
    let port = findPort(byPath, path);
    return port && !port.ip;
}

function isWirelessPort(path) {
// Returns true if path is a known wireless port, false otherwise.
    let port = findPort(byPath, path);
    return port && port.ip;
}