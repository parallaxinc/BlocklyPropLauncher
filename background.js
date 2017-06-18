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