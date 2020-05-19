/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */


// TODO Error checking/reporting, especially in socket functions
// TODO Connect to the rest of the system - add to port list, add program loading functionality, add debugging functionality

// Wi-Fi Module Firmware Versions Supported
WXVer = ["v1.0"];

// Container for the active UDP socket used for discovery broadcasts
var udp_sock;

// Initial discovery packet.  4-bytes per module representing the module's IP are appended as Wi-Fi modules are found
// signaling to a module that it does not have to re-respond.
var disc_packet = '\0\0\0\0';

// Holder for the interval for discovering wireless modules
var wxScannerInterval = null;

function calcBroadcastAddr(mip) {
// Calculate a broadcast IP from a given address and subnet mask
  return ((parseInt(mip[0]) | (~parseInt($('sm0').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[1]) | (~parseInt($('sm1').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[2]) | (~parseInt($('sm2').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[3]) | (~parseInt($('sm3').value))) & 0xFF).toString(10);
}

function ip32bit(mip) {
// convert an IP address to a single 32-bit (4-byte) chunk
  return String.fromCharCode(parseInt(mip[0])) +
         String.fromCharCode(parseInt(mip[1])) +
         String.fromCharCode(parseInt(mip[2])) +
         String.fromCharCode(parseInt(mip[3]));
}

// TODO Add error handling and reporting to these functions
chrome.sockets.udp.create(function (s_info) {
  udp_sock = s_info.socketId;
  chrome.sockets.udp.bind(udp_sock, "0.0.0.0", 0, function (res) {
    chrome.sockets.udp.setBroadcast(udp_sock, true, function(res) {
    });
  });
});

// TODO add error handling
function discoverWirelessPorts() {
// Determine the IP address of each available network connection
  var local_ip = [];
  var ni_result;
  //Get network interfaces
  chrome.system.network.getNetworkInterfaces(function (ni_result){
    for (z = 0; z < ni_result.length; z++) {
      if (ni_result[z].address.replace(/\./g,'').length === ni_result[z].address.length - 3) {
        var a = ni_result[z].address.split('.');
        local_ip.push(a);
      }
    }
    // Send discovery packet(s) via UDP to each network's broadcast address
    var t_time = 0;
    for(var y = 0; y < local_ip.length; y++) {
      for(var t = 100; t < 450; t += 100) {
        setTimeout(function(b_to) {
          chrome.sockets.udp.send(udp_sock, str2ab(disc_packet), b_to, 32420, function (res) {});
        }, t + (y + 1) * 350, calcBroadcastAddr(local_ip[y]));
        t_time = t + (y + 1) * 350 + 500;
      }
    }
    setTimeout(function() {disc_packet = '\0\0\0\0';});
  });
}

function ageWirelessPorts() {
// Age Wi-Fi modules and remove those that haven't been seen for some time from the list
  ports.forEach(function(p) {
    if (p.isWireless && !--p.life) deletePort(byMAC, p.mac);
  })
}

function displayWirelessPorts() {
// Show available Wi-Fi modules in the app UI
  var wxl = '';
  ports.forEach(function(p) {
      if (p.isWireless) {
          wxl += '&nbsp;&nbsp;&#x1f4f6;&nbsp;' + makeWLPortName(p.mac) +
              '&nbsp;(<a style="text-decoration:none;" href="http://' + p.ip +
              '" target="_blank">' + p.ip + '</a>)&nbsp;<span class="wx-name">' +
              p.path.substr(0,20) + '</span><br>';
      }
  })
  $('wx-list').innerHTML = wxl;
}

function deleteAllWirelessPorts() {
// Remove all Wi-Fi modules from the list
    ports.forEach(function(p) {
        if (p.isWireless) deletePort(byMAC, p.mac);
    })
}

document.addEventListener('DOMContentLoaded', function() {
/* UDP listener for discovering Wi-Fi modules
   When a Wi-Fi module is discovered, it is added to the ports list, or updated (if already exists) by resetting it's life.
   It's life value helps keep it in the list unless it hasn't been seen after multiple discovery attempts*/
  chrome.sockets.udp.onReceive.addListener(function (sock_addr) {
      let ip = sock_addr.remoteAddress;
      let wx_info = JSON.parse(ab2str(sock_addr.data));
      let mac = wx_info['mac address'].trim().toLowerCase();

      // Add found Wi-Fi Module's IP to the packet to prevent responses to subsequent packets.    //!!! Need to reconsider this global operation
      disc_packet += ip32bit(ip.split('.'));
      // If allowed, add (or update) it's port record; limit name to 32 characters without leading/trailing whitespace
      // Note: WX support could have been turned off during discovery operation- thus responses may arrive after communication was willfully ended
      if ($('wx-allow').checked) {
          addPort({path: wx_info.name.substr(0,32).replace(/(^\s+|\s+$)/g,''), mac: mac, ip: ip});
          displayWirelessPorts();
      }
  });
});


function parseHTTP(rawResponse) {
/* Parse rawResponse for HTTP content and return an object with all headers and data.
   Returned object is guaranteed to contain ResponseCode and Body headers; all other headers are optional.
   Body is an ArrayBuffer and may be empty.*/
    // Convert rawResponse to ANSI String, find start of body (if any), separate header lines, then headers from values
    let str = String.fromCharCode.apply(null, new Uint8Array(rawResponse));
    let bodyIdx = str.indexOf("\r\n\r\n");
    let headers = ( (bodyIdx > -1) ? str.slice(0, bodyIdx) : str ).split("\r\n");
    headers.forEach(function(l, i, h) {h[i] = l.split(": ")});
    // Status line is a special case; separate by space
    headers[0] = headers[0].toString().split(" ");
    // Convert to {header: value} object and insert ResponseCode: and Body: properties
    let response = {ResponseCode: ((headers[0].length > 1) && (headers[0][0] === "HTTP/1.1")) ? parseInt(headers[0][1]) : 204};
    for(let i = 1; i < headers.length; i++) {
        if (headers[i].length > 1) {response[headers[i][0]] = headers[i][1]}
    }
    response.Body = (bodyIdx > -1) ? rawResponse.slice(bodyIdx+4) : new ArrayBuffer(0);
    return response;
}


function isWiFiModule(response) {
/*Returns true if response is from a recognized Wi-Fi Module type.
  Must formatResponse() first.*/
    let valid = false;
    if (response.length > 1) {
        if (response[0].length > 1) {
            if (response[0][0] === "http/1.1") {
                if (response[1].length > 1) {
                    if ((response[1][0] === "server") && response[1][1].indexOf("esp8266-httpd/") === 0) {
                        valid = true;
                    }
                }
            }
        }
    }
    return valid;
}

function isValidWiFiVersion(response) {
/*Returns true if Wi-Fi Module is running a recognized version of firmware
 Must formatResponse() first.*/

    let valid = false;
    let idx = response.findIndex(function(item) {return item[0] === "content-length"})
    if ((idx > -1) && (response.length > idx+2)) {
        let version = response[idx+2].toString().split(" ");
        if (version.length > 3) {
            if ((WXVer.some(function(v) {return version[0] === v})) &&
                (version[1].slice(0,1) === '(') && (version[1].includes('-')) &&
                (version[2].includes(':')) &&
                (version[3].slice(-1) === ')')) {
                valid = true;
            }
        }
    }
    return valid;
}

chrome.sockets.tcp.onReceive.addListener(debugReceiver);
chrome.sockets.tcp.onReceiveError.addListener(serialError);

/*
 function loadPropellerWX(portPath, action, payload, debug) {

     chrome.sockets.tcp.create(function (s_info) {

         let tcp_sock = s_info.socketId;
         let cleanup = false;

         function httpResponse(info) {
             log(String.fromCharCode.apply(null, new Uint8Array(info.data)), mDbug);
/             let result = formatResponse(String.fromCharCode.apply(null, new Uint8Array(info.data)));
             if (isWiFiModule(result) && isValidWiFiVersion(result)) {
                 log("Success!", mDbug);
//                 var postStr = "POST /propeller/load?baud-rate="+initialBaudrate+"&response-size=8&response-timeout=1000 HTTP/1.1\r\nContent-Length: 4\r\n\r\n1234";
//                 chrome.sockets.tcp.send(tcp_sock, str2ab(postStr), function() {});
             } else {
                 log("Failure!", mDbug);
                 cleanup = true;
             }
             if (cleanup) {
                 chrome.sockets.tcp.disconnect(tcp_sock);
                 chrome.sockets.tcp.onReceive.removeListener(httpResponse);
             }
         };

         chrome.sockets.tcp.onReceive.addListener(httpResponse);

         log("getting...", mDbug);

         let port = findPort(byPath, portPath);
         let ip = (port) ? port.ip : null;
         if (ip) {
             chrome.sockets.tcp.connect(tcp_sock, ip, 80, function() {
//             chrome.sockets.tcp.setKeepAlive(tcp_sock, true, 0, function(res) {log("Keep alive: " + res, mDbug)});

//             var getStr = "GET /wx/setting?name=version HTTP/1.1\r\n\r\n";
//             chrome.sockets.tcp.send(tcp_sock, str2ab(getStr), function() {});

                 //Generate loader package (in txData)
             let packetId = 1;
             generateLoaderPacket(ltUnEncCore, packetId, defaultClockSpeed, defaultClockMode);
             chrome.sockets.tcp.send(tcp_sock, txData, function() {});

//                 var postStr = "POST /propeller/load?baud-rate="+initialBaudrate+"&response-size=8&response-timeout=1000 HTTP/1.1\r\nContent-Length: 48\r\n\r\n\x00\xB4\xC4\x04\x6F\x61\x10\x00\x30\x00\x38\x00\x18\x00\x3C\x00\x20\x00\x02\x00\x08\x00\x00\x00\x38\x1A\x3D\xD6\x1C\x38\x1A\x3D\xD4\x47\x35\xC0\x37\x00\xF6\x3F\x91\xEC\x23\x04\x70\x32\x00\x00";
//                 chrome.sockets.tcp.send(tcp_sock, str2ab(postStr), function() {});

             });
         }
     });
 }
*/
     /*
     chrome.sockets.tcp.connect(tcp_sock, findIpByWXid(wxid), 80, function() {
 if (payload) {
 //Extract Propeller Application from payload
 var binImage = parseFile(payload);
 if (binImage.message !== undefined) {log("Error: " + binImage.message); return;}
 } else {
 var binImage = buf2ab(bin);
 }

 var postStr = "POST /propeller/load?baud-rate=115200 HTTP/1.1\r\nContent-Length: " + binImage.byteLength  + "\r\n\r\n";

 chrome.sockets.tcp.send(tcp_sock, str2ab(postStr), function() {
 chrome.sockets.tcp.send(tcp_sock, binImage, function() {
 });
 });
 });
 }
 */
