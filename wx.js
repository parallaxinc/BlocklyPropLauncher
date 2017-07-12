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

var udp_sock;
var local_ip = [];
var temp_ip_addr = '';
var wx_info = {name:'', address:[]};
var disc_packet = '\0\0\0\0';
var wx_scanner_interval = null;

// This is where the info about each module is stored
var wx_modules = [];


function calc_broadcast_addr(mip) {
  
  return ((parseInt(mip[0]) | (~parseInt($('sn-0')))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[1]) | (~parseInt($('sn-1')))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[2]) | (~parseInt($('sn-2')))) & 0xFF).toString(10) + '.' +
         ((parseInt(mip[3]) | (~parseInt($('sn-3')))) & 0xFF).toString(10);
}

function ip_32bit(mip) {
  return String.fromCharCode(parseInt(mip[0])) + 
         String.fromCharCode(parseInt(mip[1])) + 
         String.fromCharCode(parseInt(mip[2])) + 
         String.fromCharCode(parseInt(mip[3]));
}

function discover_modules() {  
  local_ip.length = 0;
  chrome.system.network.getNetworkInterfaces(function (ni_result){
    for (z = 0; z < ni_result.length; z++) {
      if (ni_result[z].address.replace(/\./g,'').length === ni_result[z].address.length - 3) {
        var a = ni_result[z].address.split('.');
        local_ip.push(a);
      }
    }
    chrome.sockets.udp.create({"persistent":true}, function (s_info) {
      udp_sock = s_info.socketId;
      chrome.sockets.udp.bind(udp_sock, "0.0.0.0", 0, function (res) {
        chrome.sockets.udp.setBroadcast(udp_sock, true, function(res) {
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
      });
    });
  });
}

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

function display_modules() {
  var wxl = '';
  for(v = 0; v < wx_modules.length; v++) {
    //if(wx_modules.address !== undefined) {
      wxl += '&nbsp;&nbsp;&#x1f4f6; ' + wx_modules[v].id + ' (' + wx_modules[v].address.join('.') + ')<br>';
    //}
  }
  $('wx-list').innerHTML = wxl;
}


document.addEventListener('DOMContentLoaded', function() {


  chrome.sockets.udp.onReceive.addListener(function (sock_addr) {
    
    var wx_info = JSON.parse(ab2str(sock_addr.data));
    wx_info.address = (sock_addr.remoteAddress).split('.');
    var w_id = (wx_info['mac address'].trim().toLowerCase()).split(':');
    wx_info.id = 'wx-' + w_id[3] + w_id[4] + w_id[5];
    wx_info.present = 3;
    
    var i = false;
    for(v = 0; v < wx_modules.length; v++) {
      if(wx_info.id === wx_modules[v].id) {
        wx_modules[v].present = 3;
      }
      i = true;
    }
    
    if(!i) {
      wx_modules.push(wx_info);
    }

    //console.log(wx_modules);
    
    // Add its IP to the packet so it doesn't get rediscovered on every subsequent packet.
    disc_packet += ip_32bit(wx_info['address']);
  });
});