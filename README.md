# BlocklyProp Launcher


## Introduction

The BlocklyProp Launcher is an application built using web technologies that connects Parallax Propeller-powered hardware to the BlocklyProp website.  Targeted for the Chromebook platform initially, this application may replace the Python-based BlocklyPropClient at a later time.

It serves as the local conduit through which the cloud-based BlocklyProp Editor can download applications to, and debug with, the Propeller microcontroller.


## Running

BlocklyProp Launcher has been written using HTML, CSS, and JavaScript, and is packaged as a Chrome Application.

There's a [public release](https://chrome.google.com/webstore/detail/blocklyprop-launcher/iddpgcclgepllhnhlkkinbmmafpbnddb) (available to anyone on a Chromebook) and a [development release](https://chrome.google.com/webstore/detail/fbfgnnnjbckeodelipalbpnbpaiadggm) (available only to a select group of testers).  _Developers must be logged into Chrome with their "permitted" account in order for the development release link to work._

After installing the Chrome Application, simply click to run it on a Chromebook.


## Building

To date, this application has been written using the [Chrome Dev Editor](https://chrome.google.com/webstore/detail/chrome-dev-editor/pnoffddplpippgcfjdhbmhkofpnaalpg) and [WebStorm IDE](https://www.jetbrains.com/webstorm/) and launched/debugged using the [Chrome Apps & Extensions Developer Tool](https://chrome.google.com/webstore/detail/chrome-apps-extensions-de/ohmmkhmmmpcnpikjeljgnaoabkaalbgc) or Chrome Extensions (chrome://extensions/) page along with the built-in Chrome Developer Tools (click on the desired "Inspect views" from the developer tool or extensions page, or right-click the running application's window and select "Inspect").

No build process is required- simply press the play button in Chrome Dev Editor or launch from the Chrome Apps & Extensions Developer Tool (or extension page).  NOTE: App workspace folder must first be loaded with the "Load unpacked extension..." feature.


## Releasing

Though there is no need for a "build" process during development, the release process requires extra effort because this project is currently closed-source and since Chrome Applications are executing from source, the released application needs to have it's Parallax-created code obfuscated prior to publication.  _Obfuscation is not really source code protection, but good obfuscation techniques can at least slow down reverse-engineering efforts._

- Releases of this Chrome App are source-code obfuscated with _javascript-obfuscator_ using the command-line (CLI) tools; currently tested with _javascript-obfuscator v0.9.4_.
    - Requires (and can be installed with) Node.js.
    - Source repository and instructions: [https://github.com/javascript-obfuscator/javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator)
    - Live online version: [https://javascriptobfuscator.herokuapp.com/](https://javascriptobfuscator.herokuapp.com/)
    - One can use the _Beautify_ option of tools like the [UglifyJS Demo](http://lisperator.net/uglifyjs/) to test the effectiveness of (or circumvent) obfuscated code.
- The only files needing obfuscation are: _background.js_, _index.js_, _parser.js_, and _serial.js_.  All others should be unobscured.


After performing _Set-Up for Code Obfuscation_ on the development system (usually just once), the release process itself consists of just the _Obfuscate & Release_ process.


### Set-Up for Code Obfuscation

This is a system and workspace configuration step - usually performed only once per development system.

1. Install Node.js: 
    - Tested with _Node.js v6.10.3 LTS_, installed via: [https://nodejs.org/dist/v6.10.3/node-v6.10.3-x64.msi](https://nodejs.org/dist/v6.10.3/node-v6.10.3-x64.msi)
2. Switch to the repository's workspace:
    - ```$ cd path_to_BlocklyProp_Launcher/```
3. Install _javascript-obfuscator_ using Node's package manager (npm):
    - ```$ npm install javascript-obfuscator```
    - This will create a subfolder in your workspace called _node_modules_ which contains many Node resources including _javascript-obfuscator_.  This folder _should not_ be archived in repository commits, thus the repo's ```.gitignore``` file excludes the entire _node_modules_ folder.


### Obfuscate & Release

This is a frequent operation to be performed every time a release to the Chrome Web Store is needed.

1. Create the _release_ fileset (with obfuscated Parallax JavaScript source code and unobscured public libraries):
    1. Switch to the repository's workspace:
        - _IMPORTANT: On Windows platforms, open a Git Bash command window_
        - ```$ cd path_to_BlocklyProp_Launcher/```
    2. Run the _MakeRelease_ script
        - ```$ ./MakeScript```
        - This will clean out (or create) the _release_ subfolder and will generate the obfuscated files plus the other unobscured resources necessary for a Chrome App package.
            - This folder _should not_ be archived in repository commits, thus the repo's ```.gitignore``` file excludes the entire _release_ folder.
2. Test the app by installing the _release_ subfolder contents (Load Unpackaged App from Chrome or the Chrome Apps & Extensions Developer Tool).
3. Distribute the app by archiving (ZIP'ing) the _release_ subfolder contents (_not_ the folder; just its contents) and publishing it to it's Chrome Web Store account.


## Attribution

This application is built from routines and functions used in the following sample applications:
- [websocket-server](https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/websocket-server)
- [usb/device-info](https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/usb/device-info)
