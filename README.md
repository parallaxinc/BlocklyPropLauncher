# BlocklyProp Launcher


## Introduction

The BlocklyProp Launcher is an application built using web technologies that connects Parallax Propeller-powered hardware to the BlocklyProp website.  Targeted for the Chromebook platform initially, this application may replace the Python-based BlocklyPropClient at a later time.

It serves as the local conduit through which the cloud-based BlocklyProp Editor can download applications to, and debug with, the Propeller microcontroller.


## Running

BlocklyProp Launcher has been written using HTML, CSS, and JavaScript, and is packaged as a Chrome Application.  After installing the Chrome Application, simply click to run it on a Chromebook.


## Building

To date, this application has been written using the [Chrome Dev Editor](https://chrome.google.com/webstore/detail/chrome-dev-editor/pnoffddplpippgcfjdhbmhkofpnaalpg) and [WebStorm IDE](https://www.jetbrains.com/webstorm/) and launched/debugged using the [Chrome Apps & Extensions Developer Tool](https://chrome.google.com/webstore/detail/chrome-apps-extensions-de/ohmmkhmmmpcnpikjeljgnaoabkaalbgc) or Chrome Extensions (chrome://extensions/) page along with the built-in Chrome Developer Tools (click on the desired "Inspect views" from the developer tool or extensions page, or right-click the running application's window and select "Inspect").

No build process is required- simply press the play button in Chrome Dev Editor or launch from the Chrome Apps & Extensions Developer Tool (or extension page).  NOTE: App workspace folder must first be loaded with the "Load unpacked extension..." feature.


## Attribution

This application is built from routines and functions used in the following sample applications:
- [websocket-server](https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/websocket-server)
- [usb/device-info](https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/usb/device-info)
