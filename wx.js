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

// Container for the active UDSP socket used for discovery broadcasts
var udp_sock;

var tcp_sock;

// Initial discovery packet.  4-bytes per module representing the module's IP
// are appended as modules are found signaling to a module that it does not have
// to re-respond.
var disc_packet = '\0\0\0\0';

// Holder for the interval for discovering modules
var wx_scanner_interval = null;

// This is where the info about each module is stored
var wx_modules = [];

// Calculate a broadcast IP from a given address and subnet mask
function calc_broadcast_addr(mip) {
  return ((parseInt(mip[0]) | (~parseInt($('sm-0').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[1]) | (~parseInt($('sm-1').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[2]) | (~parseInt($('sm-2').value))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[3]) | (~parseInt($('sm-3').value))) & 0xFF).toString(10);
}

// convert an IP address to a single 32-bit (4-byte) chunk
function ip_32bit(mip) {
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

/*
// Possibly unecessary?  Maybe able to use another open socket?  
// Or should we didicate one to the WX module?
chrome.sockets.tcp.create(function (s_info) {
  tcp_sock = s_info.socketId;
  chrome.sockets.tcp.setKeepAlive(tcp_sock, true, function (res) {});
});
*/

function findIpByWXid(wxid) {
  for(v = 0; v < wx_modules.length; v++) {
    if(wx_modules.id === wxid) {
      return wx_modules[v].address.join('.');
    }
  }
}

/*
// NOT FUNCTIONAL!!!!!
function loadPropWX(wxid, action, payload, debug) {
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

// Determine the IP address of each available network connection
// Send a discovery packet via UDP to a network's broadcast address
// TODO add error handling
function discover_modules() {  
  var local_ip = [];
  var ni_result;
  chrome.system.network.getNetworkInterfaces(function (ni_result){
    for (z = 0; z < ni_result.length; z++) {
      if (ni_result[z].address.replace(/\./g,'').length === ni_result[z].address.length - 3) {
        var a = ni_result[z].address.split('.');
        local_ip.push(a);
      }
    }
    var t_time = 0;
    for(var y = 0; y < local_ip.length; y++) {
      for(var t = 100; t < 450; t += 100) {
        setTimeout(function(b_to) {
          chrome.sockets.udp.send(udp_sock, str2ab(disc_packet), b_to, 32420, function (res) {});
        }, t + (y + 1) * 350, calc_broadcast_addr(local_ip[y]));
        t_time = t + (y + 1) * 350 + 500;
      }
    }
    setTimeout(function() {disc_packet = '\0\0\0\0';});
  });
}

// Remove modules that haven't been seen for some time from the list (currently takes ~12 seconds)
function remove_modules() {
  var rm = [];
  for(v = 0; v < wx_modules.length; v++) {
    wx_modules[v].present--;
    if(wx_modules[v].present < 0) {
      rm.push(v);
    }
  }
  for(v = 0; v < rm.length; v++) {
    wx_modules.splice(rm[v], 1);
  }
}

// Show available modules in the app UI
function display_modules() {
  var wxl = '';
  for(v = 0; v < wx_modules.length; v++) {
    wxl += '&nbsp;&nbsp;&#x1f4f6;&nbsp;' + wx_modules[v].id + 
        '&nbsp;(<a style="text-decoration:none;" href="http://' + wx_modules[v].address.join('.') + 
        '" target="_blank">' + wx_modules[v].address.join('.') + '</a>)&nbsp;<span class="wx-name">' + 
        wx_modules[v].name.substr(0,20) + '</span><br>';
  }
  $('wx-list').innerHTML = wxl;
}

// UDP listener for discovering modules
// When a module is discovered, it is either added to the list, or if already in
// the list, it's "count" is reset.  The "count" serves to ensure that a module
// isn't removed from the list unless it hasn't been seen after multiple
// discovery attempts
document.addEventListener('DOMContentLoaded', function() {
  var wx_info = {name:'', address:[]};
  chrome.sockets.udp.onReceive.addListener(function (sock_addr) {
    var wx_info = JSON.parse(ab2str(sock_addr.data));
    wx_info.address = (sock_addr.remoteAddress).split('.');
    var w_id = (wx_info['mac address'].trim().toLowerCase()).split(':');
    wx_info.id = 'wx-' + w_id[3] + w_id[4] + w_id[5];
    wx_info.present = 3;
    
    //console.log(wx_modules);
    
    var i = false;
    for(v = 0; v < wx_modules.length; v++) {
      if(wx_info.id === wx_modules[v].id) {
        wx_modules[v].present = 3;
        wx_modules[v].name = wx_info.name;
        i = true;
      }
    }
    if(!i) {
      wx_modules.push(wx_info);
    }

    // Add its IP to the packet so it doesn't get rediscovered on every subsequent packet.
    disc_packet += ip_32bit(wx_info['address']);
  });
});