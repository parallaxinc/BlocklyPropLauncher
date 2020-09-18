# BlocklyProp Launcher REST API (v1) <a name="page-top"></a> 

This document provides details of the API available in the BlocklyProp Launcher. These calls are
available through a websocket interface. The client system should send API requests as JSON packet
messages. These messages are listed here and described below.
* [Open Channel](#open-channel-message)
* [Load Propeller](#load-propeller-message)
* [Serial Terminal](#serial-terminal-message)
* [Port List](#port-list-message)
* [Preferred Port](#preferred-port-message)


## Open Channel <a name="open-channel-message"></a>
When the websocket is established, this message initializes the channel that all subsequent interactions with the API will use.  This message also facilitates reception of the version of BlocklyProp Launcher that the client is speaking to.

### Send (client -> Launcher)

**type** - "hello-browser" (**Required**)

**baudrate** - Select a baud rate that the BlocklyProp Launcher will use to communicate with attached Propeller device(s).The default value is 115200. (Optional and deprecated)

  - Deprecated: Another baud rate setting is required, specific to the terminal/graph in the <a href="#serial-terminal-message">serial-terminal</a> message; specification via "hello-browser" is ignored. 

```json
  {
    "type": "hello-browser"
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
        type: 'hello-browser'
      };

  // Send the message to the API
  connection.send(JSON.stringify(wsMessage));
  };
```

### Receive (client <- Launcher)
The BP Launcher responds to the "hello-browser" request with a "hello-client" message containing the following elements:

**type** - "hello-client" (**Required**).

**version** - The semantic version of the BP Launcher (major, minor, patch) (**Required**)

**api** - The version of the API used by this BP Launcher (major only) (optional; omission means API v1)

**b64Msg** - [future API] A boolean flag indicating that BP Launcher requires all _msg_ and _payload_ elements (both received and sent) as base64-encoded serial streams. (optional; omission means "false," only some _msg_ and _payload_ elements are base64-encoded)

```json
{
  "type": "hello-client",
  "version": "1.0.4",
  "api": "2",
  "b64Msg": "true"
}
```

## Load Propeller <a name="load-propeller-message"></a>
The client sends this message when it wants to download a Propeller Application to the connected Propeller device, storing the app in either RAM or EEPROM (which is really RAM & EEPROM together).

### Send (client -> Launcher)

**type** - "load-prop" (**Required**)

**action** - "RAM" or "EEPROM" (**Required**)

**portPath** - target port's name (direct from the port drop-down list); wired or wireless port. (**Required**)
  - The client's port drop-down list contents is filled by BP Launcher and any one of those exact values is what BP Launcher expects back (in the portPath element) to indicate the target port.  Old (pre API v1) versions included the port's path and port's name but has since been simplified to only port name.  Regardless, the element name remains as _portPath_ and client must send the exact value direct from the port drop-down item in any case).

**payload** - An (always base-64) encoded .elf, .binary, or .eeprom data image containing the Propeller Application.  (**Required**)

**debug** -  "none", "term", or "graph".  If set to "term" or "graph" then a terminal or graphing display (respectively) is intended to connect to the Propeller after download. 
 (**Required**)

```json
{
  "type": "load-prop",
  "action": "RAM",
  "portPath": "<device_name>",
  "payload": "D4F2A34AB...",
  "debug": "none"  
}
```

### Receive (client <- Launcher)
The BP Launcher responds to the "load-prop" request with numerous messages to indicate status or to command UI display changes.

**type** - "ui-command" (**Required**).

**action** - "message-compile", "open-terminal", "open-graph", or "close-compile" (**Required**).

**msg** - "." (deprecated), or "\r" + a descriptive string of text, indicating milestone moments in the download process. (**Required** only during "message-compile" _actions_)
  - "." indicates a progressive step in the download process meant only as an _activity_ indicator on the UI.  This functionality is meant for older (pre v1.0?) versions of the client and is deprecated.
  - "\r" + descriptive text indicates download operation status in the form ###-message where ### is a 3-digit ID that uniquely indicates the category and intent of the _message_.

```json
{
  "type": "ui-command",
  "action": "message-compile",
  "msg": "\r002-Downloading"
}
```
--or--
```json
{
  "type": "ui-command",
  "action": "open-terminal"
}
```


## Serial Terminal <a name="serial-terminal-message"></a>
The client sends this message to open or close a port for serial data destined for a terminal or graphing display, or to transmit data serially to the Propeller on a specified port at a specific baud rate.  The Propeller also sends messages of this type to communicate serial data to the client.

### Send (client -> Launcher)

**type** - "serial-terminal" (**Required**)

**action** - "open", "close", or "msg" indicates to open port, close port, or transmit data
from the client to the Propeller over port _portPath_. (**Required**)

**portPath** - Target port's name (direct from the port drop-down list); wired or wireless port. (**Required**)

**baudrate** - Set the desired baud rate for serial communications with the Propeller device. The default value is 115200. (Optional)

**msg** - Contains data message to transmit to Propeller.  (**Required** only when _action_ is "msg".)

Examples:

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

### Receive (client <- Launcher)
The BP Launcher may respond to an "open" or "msg" _action_. 

#### Response to Any Action With Port Issue:
Any "serial-terminal" _type_ message that specifies a _portPath_ to an invalid port results in a response message sent back to the client of "serial-terminal" _type_ with the error in the _msg_ element.
  - NOTE: The _action_ element is not populated for this error.

```json
{
  "type": "serial-terminal",
  "msg": "Port '<port_name>' not found.\rPlease close this terminal and select an existing port."
}
```

#### Response to "open" Action:
If the open operation is successful, the BP Launcher will not respond directly; however, the open channel to the Propeller usually results in one or more "serial-terminal" _type_ messages carrying Propeller data back to the client.  See ["Receive (client <- Launcher <- Propeller)"](receive-from-propeller).

If the open operation fails, the BP Launcher sends a "serial-terminal" _type_ message to the client containing the error in _msg_.  
  - NOTE: The _action_ element is not populated for this error.

```json
{
  "type": "serial-terminal",
  "msg": "Failed to connect.\rPlease close this terminal and select a connected port."
}
```

#### Response to "close" Action:
The BP Launcher does not respond to the client for a "close" _action_; it simply handles the request silently.

#### Response to "msg" Action:
The BP Launcher does not directly respond to the client for a "msg" _action_ - it simply sends the _msg_ data to the Propeller; however, the Propeller may respond to that data, through the BP Launcher, as indicated below.

### Receive (client <- Launcher <- Propeller) <a name="receive-from-propeller"></a>
When a port is open for terminal or graph use, data from the Propeller is sent through the BP Launcher to the client using a "serial-terminal" _type_ message.  This message as a _packetID_ element and a _msg_ element.

**type** - "serial-terminal" (**Required**)

**packetID** - An increasing value that uniquely identifies the message packet. (**Required**)

**msg** - Contains base-64 encoded data from the Propeller.  (**Required**)

```json
{
  "type": "serial-terminal",
  "packetID": <1, 2, 3, etc.>,
  "msg": <b64-encoded_data>
}
```

## Port List <a name="port-list-message"></a>
The client sends this message to get a current list of ports that the Launcher sees on the system.  This causes Launcher to send the list immediately, but also starts a process in the Launcher that automatically transmits a port-list-response message every 5 seconds. This update continues until the BP Launcher sees that the websocket connection is closed.

**type** - "port-list-request" (**Required**)

Example:
```javascript
  // Request a port list from the server
  const message = {
    type: 'port-list-request'
  };

  connection.send(JSON.stringify(message));
```

## Preferred Port <a name="preferred-port-message"></a>
The client sends this message when the user has selected a new port in the port drop-down list.  "New" port means a port that wasn't already selected immediately before the user's action.

**type** - "pref-port" (**Required**)

**portPath** - port's name (direct from the port drop-down list); wired or wireless port. (**Required**)

Example:
```javascript
      this.activeConnection.send(JSON.stringify({
        type: 'pref-port',
        portPath: portName,
      }));
```

<!--
Debug Clear To Send request
NOT SUPPORTED; believe the intention was to halt Launcher to Solo "serial" transmissions until Solo is ready to receive
type: "debug-cts"
-->

[Top of page](#page-top)
