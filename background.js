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

// Register listeners to create app window upon application launch and
// to close active serial ports upon application termination
chrome.app.runtime.onLaunched.addListener(function() {
    chrome.app.window.create('index.html', {
        id: "BlocklyProp-Launcher",
        innerBounds: {
            maxWidth: 500,
            maxHeight: 500,
            minWidth: 200,
            minHeight: 200
        }, state: "normal"
    }, function(win) {
      win.onClosed.addListener(closeSerialPorts);
    });
  });

function closeSerialPorts(){
// Close this app's active serial ports
    chrome.serial.getConnections(function(activeConnections) {
        activeConnections.forEach(function(port) {
            chrome.serial.disconnect(port.connectionId, function() {});
        });
    });
}