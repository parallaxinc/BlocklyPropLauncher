/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */


// Find Port identifier types
const byCID = "connId";            //Represents numeric Connection ID (cid) type
const byPHID = "phSocket";         //Represents numeric Propeller HTTP Socket ID type
const byPTID = "ptSocket";         //Represents numeric Propeller Telnet Socket ID type
const byMAC = "mac";               //Represents alphanumeric MAC address type
const byPath = "path";             //Represents alphanumeric path (wired/wireless port identifier) type
const byName = "name";             //Represents alphanumeric name (wired/wireless port identifier) type

// Port's max lifetime
const wLife = 2;
const wlLife = 3;

// Container for attributes of connected ports (wired or wireless)
var ports = [];

// Serial packet handling (for transmissions to browser's terminal)
const serPacketMaxTxTime = 100;                                                 // Max wait time before transmitting packet (ms)
const serPacketMax = 1492;                                                      // Size of buffer to transmit serial data to browser
const serPacket = {
    id      : 0,
    bufView : null, /*set later to new Uint8Array(new ArrayBuffer(serPacketMax)) since Object.assign() only shallow-copies*/
    len     : 0,
    timer   : null,
};

function makePortName(name) {
    /* Return friendly port name, excluding leading path.*/
    return name.slice(name.lastIndexOf(portDelim[platform])+1);
}

function makeWLPortName(mac) {
    /* Return wireless fabricated name in the form 'wx-#######' using last 6 digits of it's MAC address.*/
    return 'wx-' + mac.substr(9,16).replace(/\:/g,'');
}

function addPort(alist) {
/* Add new wired or wireless port record (automatically updates existing port if necessary).
   alist: [required] one or more attributes of port to add.  The only valid attributes for an addPort() operation are (use UpdatePort to adjust more):
     path: [required] the string path to the wired serial port, or custom name of wireless port.  Can be empty ("") if mac and ip provided,
           and a wireless name will be fabricated from the MAC address
     mac: [omitted if wired] the wireless port's MAC address
     ip: [omitted if wired] the wireless port's IP address*/

    function get(attr, src, empty) {
        /*Return src.attr (if it exists and is truthy) or returns empty value if not*/
        return ((exists(attr, src)) && src[attr]) ? src[attr] : empty;
    }

    if (!exists("path", alist)) {return}
    if (!alist.path) {
        //Empty port path?  If wireless port details provided, craft port name from mac, else abort (return)
        if (get("ip", alist, "") && get("mac", alist, "")) {alist.path = makeWLPortName(alist.mac)} else {return}
    }
    // Look for existing port (mac used for wireless ports since path/name may have changed since last discovery)
    let port = (get("mac", alist, "")) ? findPort(byMAC, alist.mac) : findPort(byPath, alist.path);
    if (port) {
        // Exists already? Update it's (portPath/Name or iP)
        updatePort(port, alist);
    } else {
        // else, add it as a new port record (all fields included; many with default values to be updated later)
        log("Found port: " + alist.path, mDbug);
        ports.push({
            name       : makePortName(alist.path),                     /*[<>""] Friendly port name; never empty, does not include path*/
            path       : alist.path,                                   /*[<>""] Wired port path+name, or wireless port's custom name, or fabricated name; never empty*/
            connId     : get("connId", alist, null),                   /*[null+] Holds wired serial port's connection id (if open), null (if closed)*/
            mac        : get("mac", alist, ""),                        /*[""+] Holds wireless port's MAC address*/
            ip         : get("ip", alist, ""),                         /*[""+] Wireless port's IP address; */
            life       : (!get("ip", alist, "")) ? wLife : wlLife,     /*[>=0] Initial life value; wired and wireless*/
            bSocket    : null,                                         /*[null+] Socket to browser (persistent)*/
            phSocket   : null,                                         /*[null+] Socket to Propeller's HTTP service (not persistent)*/
            ptSocket   : null,                                         /*[null+] Socket to Propeller's Telnet service (persistent)*/
            mode       : "none",                                       /*["none"+] Intention of the connection; "none", "debug", or "programming"*/
            baud       : 0,                                            /*[>=0] Wired port's data rate*/
            packet     : {},                                           /*[...] Packet buffer for socket*/
            isWired    : !Boolean(get("ip", alist, "")),               /*[true/false] indicates if port is wired or not*/
            isWireless : Boolean(get("ip", alist, ""))                 /*[true/false] indicates if port is wireless or not*/
        });
        // Give it its own packet object and buffer
        Object.assign(ports[ports.length-1].packet, serPacket);
        ports[ports.length-1].packet.bufView = new Uint8Array(new ArrayBuffer(serPacketMax));
    }
}

function updatePort(port, alist) {
/* Update port attributes if necessary.  Automatically handles special case of baudrate changes.
   port: [required] port object to update
   alist: [required] one or more attributes of port to update.  Unchanging attributes can be omitted.  Possible attributes are:
     name: the friendly name of the port (not including path).  Can be empty ("") and a name will be created from path
     path: the string path to the wired serial port, or custom name of wireless port.  Can be empty ("") and a wireless name will be fabricated from the MAC address
     connId: unique identifier for the wired serial port connection id
     ip: the wireless port's IP address
     bSocket: active socket to browser to associate with port; may be null
     phSocket: active socket to Propeller's HTTP service; may be null
     ptSocket: active socket to Propeller's Telnet service; may be null
     mode: the current point of the connection; "none", "debug", "programming"
     baud: wired serial speed*/
    return new Promise(function(resolve, reject) {

        function set(attr) {
            /*Set existing port.attr = alist.attr if, and only if, alist.attr is defined; otherwise, leave port.attr as-is*/
            if (exists(attr, alist)) {port[attr] = alist[attr]}
        }

        if (exists("path", alist)) {
            if (!alist.path) {
                // Empty port path?  If wireless port, craft path from mac, else abort (reject)
                if (port.isWireless && port.mac) {alist.path = makeWLPortName(port.mac)} else {reject(Error("path required!")); return}
            }
            if (exists("name", alist) && !alist.name) {
                // Empty port name?  Create it.
                alist.name = makePortName(alist.path);
            }
        }

//        log("Updating port '" + port.path + "' with " + alist, mDbug);
        // Apply updates (if necessary) as well as special handling
        set("name");
        set("path");
        set("connId");
        set("ip");
        port.life = (port.isWired) ? wLife : wlLife;
        set("bSocket");
        set("phSocket");
        set("ptSocket");
        set("mode");
        if (exists("baud", alist)) {
            changeBaudrate(port, alist.baud)
                .then(function() {resolve()})
                .catch(function(e) {reject(e)});
        }
    })
}

function exists(attr, src) {
/*Returns true if attr exists in src*/
  return src.hasOwnProperty(attr);
}

function findPortIdx(type, clue) {
/* Return index of wired or wireless port associated with clue
   type / clue pairs must be:
     byCID / numeric Connection ID (cid)
     byPHID / numeric Propeller HTTP Socket ID
     byPTID / numeric Propeller Telnet Socket ID
     byMAC / alphanumeric MAC address
     byPath / alphanumeric path (wired/wireless port identifier)
     byName / alphanumeric name (wired/wireless port identifier)
   Returns -1 if not found*/
    return ports.findIndex(function(p) {return p[type] === clue});
}

function findPort(type, clue) {
/* Return port record associated with clue.  This allows caller to later directly retrieve any member of the record (provided caller safely checks for null)
   type / clue pairs must be:
     byCID / numeric Connection ID (cid)
     byPHID / numeric Propeller HTTP Socket ID
     byPTID / numeric Propeller Telnet Socket ID
     byMAC / alphanumeric MAC address
     byPath / alphanumeric path (wired/wireless port identifier)
     byName / alphanumeric name (wired/wireless port identifier)
   Returns null if not found*/
    let cn = 0;
    // Find port record based on scan function
    function findConn(scan) {
        while (cn < ports.length && !scan()) {cn++}
        return cn < ports.length ? ports[cn] : null;
    }
    // Scan for ID, MAC, path, or name
        return findConn(function() {return ports[cn][type] === clue})
}

function deletePort(type, clue) {
/* Delete wired or wireless port associated with clue
   type / clue pairs must be:
     byCID / numeric Connection ID (cid)
     byPHID / numeric Propeller HTTP Socket ID
     byPTID / numeric Propeller Telnet Socket ID
     byMAC / alphanumeric MAC address
     byPath / alphanumeric path (wired/wireless port identifier)
     byName / alphanumeric name (wired/wireless port identifier)*/
    let idx = findPortIdx(type, clue);
    if (idx > -1) {
        log("Removed port: " + ports[idx].path, mDbug);
        ports.splice(idx, 1);
    }
}