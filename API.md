# BlocklyProp Launcher REST API (v1) <a name="page-top"></a> 

This document provides details of the API available in the BlocklyProp Launcher. These calls are
available through a websocket interface. The client system should send API requests as JSON packet
messages. These messages are listed here and described below.
* [Open Channel](#open-channel-message)
* [Load Propeller](#load-propeller-message)
* Serial Terminal


## Open Channel <a name="open-channel-message"></a>
When the websocket is established, this message initializes the channel that all subsequent interactions
with the APU will use.

### Message elements
**type** - Message name

**baud** - Select a baud rate that the BlocklyProp Launcher will use to communicate with attached Propeller device(s).
Note that there is another specific setting for terminal baud rate in the open-terminal message. 
```json
  {
    "type": "hello-browser",
    "baud": "115200"
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
**type** - "load-prop"

**action** - "RAM" or "EEPROM"

**portPath** - target port's name (direct from the port drop-down list); wired or wireless port.

**payload** - A base-64 encoded .elf, .binary, or .eeprom data containing the Propeller Application image

**debug** - set to 'true' if a terminal is intended to connect to the Propeller after download, otherwise set to false.
```json
{
  "type": "load-prop",
  "action": "RAM",
  "portPath": "device_name",
  "payload": "D4F2A34AB...",
  "debug": "false"  
}
```


[Top of page](#page-top)
