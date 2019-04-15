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

Though there is no need for a "build" process during development, the release process requires extra effort because certain files need be excluded from the release and the release set must be zipped up for packaging for the Chrome Web Store.

The following needs to be performed every time a release to the Chrome Web Store is needed.

1. Create the _release_ fileset:
    1. Switch to the repository's workspace:
        - _IMPORTANT: On Windows platforms, open a Git Bash command window_
        - ```$ cd path_to_BlocklyProp_Launcher/```
    2. Run the _MakeRelease_ script
        - ```$ ./MakeRelease```
        - This will clean out (or create) the _release_ subfolder and will copy files into it for a Chrome App package.
            - This folder _should not_ be archived in repository commits, thus the repo's ```.gitignore``` file excludes the entire _release_ folder.
2. Test the app by installing the _release_ subfolder contents (Load Unpackaged App from Chrome or the Chrome Apps & Extensions Developer Tool).
3. Distribute the app by archiving (ZIP'ing) the _release_ subfolder contents (_not_ the folder; just its contents) and updating its Chrome Web Store publication.
    - __IMPORTANT:__ Updates to the "public" release are automatically pushed to active existing Chromebook users - mistakes will propogate swiftly.  Make _frequent_ updates to the [development release](https://chrome.google.com/webstore/detail/fbfgnnnjbckeodelipalbpnbpaiadggm) channel, and only well-tested, deliberate updates to the [public release](https://chrome.google.com/webstore/detail/blocklyprop-launcher/iddpgcclgepllhnhlkkinbmmafpbnddb) channel.


## Attribution

This application is built from routines and functions used in the following sample applications:
- [websocket-server](https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/websocket-server)
- [usb/device-info](https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/usb/device-info)
