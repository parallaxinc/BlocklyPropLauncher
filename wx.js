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


// TODO Error checking/reporting, especially in socket functions
// TODO Connect to the rest of the system - add to port list, add program loading functionality, add debugging functionality

// Wi-Fi Module Firmware Versions Supported
WXVer = ["v1.0"];

// Container for the active UDP socket used for discovery broadcasts
var udp_sock;

//!!! var tcp_sock;

// Initial discovery packet.  4-bytes per module representing the module's IP are appended as Wi-Fi modules are found
// signaling to a module that it does not have to re-respond.
var disc_packet = '\0\0\0\0';

// Holder for the interval for discovering modules
var wx_scanner_interval = null;

function calcBroadcastAddr(mip) {
// Calculate a broadcast IP from a given address and subnet mask
  return ((parseInt(mip[0]) | (~parseInt($('sm-0').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[1]) | (~parseInt($('sm-1').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[2]) | (~parseInt($('sm-2').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[3]) | (~parseInt($('sm-3').value))) & 0xFF).toString(10);
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
    if (p.ip && !--p.life) deletePort(byID, p.connId);
  })
}

function displayWirelessPorts() {
// Show available Wi-Fi modules in the app UI
  var wxl = '';
  ports.forEach(function(p) {
      if (p.ip) {
          wxl += '&nbsp;&nbsp;&#x1f4f6;&nbsp;' + makePortName(p.connId) +
              '&nbsp;(<a style="text-decoration:none;" href="http://' + p.ip +
              '" target="_blank">' + p.ip + '</a>)&nbsp;<span class="wx-name">' +
              p.path.substr(0,20) + '</span><br>';
      }
  })
  $('wx-list').innerHTML = wxl;
}

document.addEventListener('DOMContentLoaded', function() {
/* UDP listener for discovering Wi-Fi modules
   When a Wi-Fi module is discovered, it is added to the ports list, or updated (if already exists) by resetting it's life.
   It's life value helps keep it in the list unless it hasn't been seen after multiple discovery attempts*/
  chrome.sockets.udp.onReceive.addListener(function (sock_addr) {
      let ip = sock_addr.remoteAddress;
      let wx_info = JSON.parse(ab2str(sock_addr.data));
      let mac = wx_info['mac address'].trim().toLowerCase();

      // Add found Wi-Fi Module's IP to the packet to prevent reqponses to subsequent packets.    //!!! Need to reconsider this global operation
      disc_packet += ip32bit(ip.split('.'));
      // Add (or update) it's port record; limit name to 32 characters without leading/trailing whitespace
      addPort(mac, wx_info.name.substr(0,32).replace(/(^\s+|\s+$)/g,''), ip);
  });
});

function formatResponse(response) {
/*Return response formatted as an object of multiple elements (lines), each element's content is split into notable values, often key/value pairs*/
    //Lowercase all, split lines, then split headers from values, then split status line components (protocol/version, response code, response text)
    response = response.toLowerCase().split("\r\n");
    response.forEach(function(l,i, r) {r[i] = l.split(": ")});
    if (response.length) {response[0] = response[0].toString().split(" ")}
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
                    if ((response[1][0] === "server") & response[1][1].indexOf("esp8266-httpd/") === 0) {
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

function getResultCode(response) {
/* Return result code.
   Returns 204 (No Content) if code not found.*/
    if ((response.length) && (response[0].length > 1)) {
        return parseInt(response[0][1], 10);
    } else {
        return 204; //Error: No Content
    }
}

/*
 // Possibly unecessary?  Maybe able to use another open socket?
 // Or should we didicate one to the WX module?
 chrome.sockets.tcp.create(function (s_info) {
 tcp_sock = s_info.socketId;
 chrome.sockets.tcp.setKeepAlive(tcp_sock, true, function (res) {});
 });
 */


 function loadPropellerWX(port, action, payload, debug) {

     chrome.sockets.tcp.create(function (s_info) {

         let tcp_sock = s_info.socketId;
         let cleanup = false;

         function httpResponse(info) {
             log(String.fromCharCode.apply(null, new Uint8Array(info.data)), mDbug);
             let result = formatResponse(String.fromCharCode.apply(null, new Uint8Array(info.data)));
             if (isWiFiModule(result) && isValidWiFiVersion(result)) {
                 log("Success!", mDbug);
                 var postStr = "POST /propeller/load?baud-rate="+initialBaudrate+"&response-size=8&response-timeout=1000 HTTP/1.1\r\nContent-Length: 4\r\n\r\n1234";
                 chrome.sockets.tcp.send(tcp_sock, str2ab(postStr), function() {});
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

         chrome.sockets.tcp.connect(tcp_sock, "192.168.1.103", 80, function() {
             chrome.sockets.tcp.setKeepAlive(tcp_sock, true, 0, function(res) {log("Keep alive: " + res, mDbug)});

//             var getStr = "GET /wx/setting?name=version HTTP/1.1\r\n\r\n";
//             chrome.sockets.tcp.send(tcp_sock, str2ab(getStr), function() {});

             var postStr = "POST /propeller/load?baud-rate="+initialBaudrate+"&response-size=8&response-timeout=1000 HTTP/1.1\r\nContent-Length: 4\r\n\r\n1234";
             chrome.sockets.tcp.send(tcp_sock, str2ab(postStr), function() {});

         });
     });
 }

     /*
     chrome.sockets.tcp.connect(tcp_sock, findIpByWXid(wxid), 80, function() {
 if (payload) {
 //Extract Propeller Application from payload
 var binImage = parseFile(payload);
 if (binImage.message !== undefined) {log("Error: " + binImage.message); return;}
 } else {
 var binImage = buffer2ArrayBuffer(bin);
 }

 var postStr = "POST /propeller/load?baud-rate=115200 HTTP/1.1\r\nContent-Length: " + binImage.byteLength  + "\r\n\r\n";

 chrome.sockets.tcp.send(tcp_sock, str2ab(postStr), function() {
 chrome.sockets.tcp.send(tcp_sock, binImage, function() {
 });
 });
 });
 }
 */
