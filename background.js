/* Copyright (c) 2019 Parallax Inc., All Rights Reserved. */

// Register listeners to create app window upon application launch and
// to close active serial ports upon application termination
chrome.app.runtime.onLaunched.addListener(function() {
    chrome.app.window.create('index.html', {
        id: "BlocklyProp-Launcher",
        innerBounds: {
            width: 500,
            height: 433
        }, state: "normal",
        resizable: false
    }, function(win) {
      win.onClosed.addListener(closeSerialPorts);
      win.onClosed.addListener(closeServer);
    });
  });

function closeSerialPorts() {
// Close this app's active serial ports
    chrome.serial.getConnections(function(activeConnections) {
        activeConnections.forEach(function(port) {
            chrome.serial.disconnect(port.connectionId, function() {});
        });
    });
}

function closeServer() {
// Close this app's active server(s)
    chrome.sockets.tcpServer.getSockets(function (socketInfos) {
        socketInfos.forEach(function(v) {chrome.sockets.tcpServer.close(v.socketId)});
    });
}
