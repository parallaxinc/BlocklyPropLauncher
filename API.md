# BlocklyProp Launcher REST API (v1) <a name="page-top"></a> 

This document provides details of the API available in the BlocklyProp Launcher. These calls are
available through a websocket interface. The client system should send API requests as JSON packet
messages. These messages are listed here and described below.
* [Open Channel](#open-channel-message)
* [Load Propeller](#load-propeller-message)
* [Serial Terminal](#serial-terminal-message)
* [Port List](#port-list-message)
* [Port Preference](#port-preference-message)


## Open Channel <a name="open-channel-message"></a>
When the websocket is established, this message initializes the channel that all subsequent interactions
with the APU will use.

### Message elements
**type** - Message name. (**Required**)

**baud** - Select a baud rate that the BlocklyProp Launcher will use to communicate with attached Propeller device(s). (Optional)

Note that there is another setting specific to the terminal baud rate in the <a href="#serial-terminal-message">serial-terminal</a> message. 
```json
  {
    "type": "hello-browser",
    "baud": "115200"
  }
```
The BP Launcher responds to this request with a 'hello-client' message containing the following elements:

**type** - A text string containing 'hello-client' (**Required**).

**version** - The semantic version of the BP Launcher (major, minor, patch) (**Required**)

**rxBase64** - A boolean flag indicating that the BP Launcher is capable of receiving base64-encoded serial streams. (**Required**) 
```json
{
  "type": "hello-client",
  "version": "1.0.4",
  "rxBase64": "true"
}
```
Example:
```javascript
  const apiUrl = 'ws://localhost:6009';
  connection = new WebSocket(apiUrl);

  // Callback executed when the connection is opened
  connection.onopen = function(event) {

  // Create a Hello message
  const wsMessage = {
        type: 'hello-browser',
        baud: '115200',
      };

  // Send the message to the API
  connection.send(JSON.stringify(wsMessage));
  };
```


## Load Propeller <a name="load-propeller-message"></a>
The client sends this message when it wants to download a Propeller Application to the connected
Propeller device, storing the app in either RAM or EEPROM (which is really RAM & EEPROM together)

### Message elements
**type** - "load-prop" (**Required**)

**action** - "RAM" or "EEPROM" (**Required**)

**portPath** - target port's name (direct from the port drop-down list); wired or wireless port. (**Required**)

**payload** - A base-64 encoded .elf, .binary, or .eeprom data containing the Propeller Application image.  (**Required**)

**debug** - set to 'true' if a terminal is intended to connect to the Propeller after download, otherwise set to false. Default is false. (Optional)
```json
{
  "type": "load-prop",
  "action": "RAM",
  "portPath": "device_name",
  "payload": "D4F2A34AB...",
  "debug": "false"  
}
```


## Serial Terminal <a name="serial-terminal-message"></a>
The client sends this message to open or close a terminal serial stream, or to transmit data serially to
the Propeller on a specified port at a specific baud rate.

**type** - "serial-terminal" (**Required**)

**action** - One of \["open", "close", or "msg"\] which opens port, closes port, or transmits data
from the client to the Propeller over port \[portPath\]. (**Required**)

**portPath** - Target port's name (direct from the port drop-down list); wired or wireless port. (**Required**)

**baudrate** - Set the desired baud rate for serial communications with the Propeller device. The default value is 115200. (Optional)

**msg** - Contains data message to transmit to Propeller.  (**Required**only when the action element is set to "msg".)

Open Terminal Session:
```javascript
  const messageToSend = {
    type: 'serial-terminal',
    action: 'open',
    outTo: 'terminal',
    portPath: "selected_com_port",
    baudrate: 115200,
    msg: 'none'
  };

  // The connection variable is assumed to hold a valid open websocket handle
  // Send the message to the BP Launcher
   connection.send(JSON.stringify(messageToSend));
```

Open Graph Session:
```javascript
     const message = {
        type: 'serial-terminal',
        action: 'open',
        outTo: 'graph',
        portPath: "selected_com_port",
        baudrate: 9600,
        msg: 'none'
      };

  // The connection variable is assumed to hold a valid open websocket handle
  // Send the message to the BP Launcher
   connection.send(JSON.stringify(message));
```

## Port List <a name="port-list-message"></a>
The client sends this message to get a current list of ports that the Launcher sees on the system.
This causes Launcher to send the list immediately, but also starts a process in the Launcher that
automatically transmits a port-list-response message every 5 seconds.

_Needs Review:_
_This update continues until the BP Launcher receives another "port-list-request" message with a single response directive or the websocket connection is closed._
_Also questioning if the **msg** element has any other options. Otherwise, it appears to be redundant._

**type** - "port-list-request" (**Required**)

**msg** - "port-list-request" (**Required**)

Example:
```javascript
  // Request a port list from the server
  const message = {
    type: 'port-list-request',
    msg: 'port-list-request',
  };

  connection.send(JSON.stringify(message));
```

## Port Preference <a name="port-preference-message"></a>

```javascript
      this.activeConnection.send(JSON.stringify({
        type: 'pref-port',
        portPath: portName,
      }));
```
<!--
Launcher Version request
type: "hello-browser"
baudrate: (optional, defaults to 115200 but is actually unused by Launcher in this case)
Debug Clear To Send request
NOT SUPPORTED; believe the intention was to halt Launcher to Solo "serial" transmissions until Solo is ready to receive
type: "debug-cts"
This process of exploring what the communication looks like is beneficial for me too.  It was defined long ago, partly by Michele and partly by Matt, during the initial design and later websocket support design.  I've made some changes on the Client and Launcher sides, and very little changes on the BlocklyProp side; just what was needed to match.  It's starting to "come back" to me now.

    Something I think Solo (BlocklyProp too, of course) does is request the port list on a timed basis, sending more and more requests to the Launcher; however, the Launcher automatically sends the list on a timed basis once the first request for the list is made on the websocket.

    Over the websocket channel, BlocklyProp Launcher sends JSON packet messages to Solo as described below:

    Serial Terminal data (from Propeller to Solo)
-->

[Top of page](#page-top)
