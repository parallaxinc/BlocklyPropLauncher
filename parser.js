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


function parseFile(payload) {
/* Parse payload (.elf, .binary, or .eeprom format) for Propeller Application image.
   Returns Propeller Application image as an ArrayBuffer if successful, or returns an Error object if failed.*/

  // Currently only standard Propeller Application format is supported- No non-zero data beyond vbase (program size)
  var progSize = 0;
  var output = null;

  // Convert payload from base-64 to string (fstr)
  var fstr = atob(payload);

  // Set up workspace as an array buffer (f) and unsigned byte, word, and long views (fbv, fwv, flv)
  // Ensure workspace's length is a multiple of 4 (32-bit longs) for convenient handling
  var f = str2ab(fstr, Math.trunc(fstr.length / 4) * 4);
  var fbv = new Uint8Array(f);
  var fwv = new Uint16Array(f);
  var flv = new Uint32Array(f);

  // Detect if it's an expected ".elf" file format:
  if (fbv[0] === 0x7F && (fstr[1] + fstr[2] + fstr[3]) === 'ELF' && fbv[4] === 1) {
    // Found 32-bit class .elf data; check data encoding and version
    if (fbv[6] !== 1 || flv[5] !== 1 || fbv[5] !== 1) {return Error("Unexpected ELF version or data encoding")}
    // Found version 1 little-endian format; check for executable content
    if (fwv[8] !== 2) {return Error("ELF data does not include Propeller Application Executable content")}
    // Found executable type; find Program Header metrics
    var e_phoff     = flv[7]  / 4;  /*(in longs)*/
    var e_phentsize = fwv[21] / 4;  /*(in longs)*/
    var e_phnum     = fwv[22];
    //Build Propeller Application Image described by program headers
    for (phIdx = 0; phIdx < e_phnum; phIdx++) {
      var phEnt = e_phoff+e_phentsize*phIdx;
      if (flv[phEnt] === 1) {
        //Found load-type program header; find image block's offset (in elf), target address (in output), and data size
        var imageOff   = flv[phEnt+1];  /*(in bytes)*/
        var imageAddr  = flv[phEnt+3];  /*(in bytes)*/
        var imageDSize = flv[phEnt+4];  /*(in bytes)*/
        if (!progSize) {
          // First load-type entry?  Use image's built-in program size to size output ArrayBuffer
          progSize = fwv[imageOff/2+4];
          var imageFile = new ArrayBuffer(progSize);
          output = new Uint8Array(imageFile);
        }
        //Place next block of Propeller Application image into output image
        output.set(fbv.slice(imageOff, imageOff+imageDSize), imageAddr);
      }
    }
    // Verify image found
    if (!progSize) {return Error("Propeller Application image not found")}

    // Generate checksum
    output[5] = checksumArray(output, output.byteLength);

    // Output as ArrayBuffer:
    return imageFile;

  } else { 
    // payload must be a ".binary" or ".eeprom" file
    progSize = fwv[4];
    var imageFile = new ArrayBuffer(progSize);
    var binView = new Uint8Array(fbv, 0, progSize);

    // Verify checksum, error if not
    if (checksumArray(binView, progSize) !== 0) {return Error("Invalid checksum in .binary or .eeprom data");}

    // OUTPUT AS ARRAYBUFFER:
    return f;
  }
}

// ******** SCRATCHPAD ********

// OUTPUT AS A BASE-64 ENCODED STRING:
/*
 var outBuf = '';

 for (var y = 0; y < progSize; y++) {
 outBuf += String.fromCharCode(output[y] || 0);
 }

 if (outBuf) {
 return btoa(outBuf); // returns base64 encoded Propeller image
 } else {
 return null;
 }
 */
/*   //Below is a failed attempt to write the data as a binary file
 for (var y = 0; y < output.byteLength; y++) {
 outBuf += String.fromCharCode(output[y]) || 0;
 }


 chrome.fileSystem.chooseEntry({type: "openDirectory"},
 function(entry, fileEntries) {
 //        console.log(entry.fullPath);
 entry.getFile('log.txt', {create: true, exclusive: true}, function(fileEntry) {
 fileEntry.createWriter(function(fileWriter) {

 fileWriter.onwriteend = function(e) {
 console.log('Write completed.');
 };

 fileWriter.onerror = function(e) {
 console.log('Write failed: ' + e.toString());
 };

 // Create a new Blob and write it to log.txt.
 var blob = new Blob(outBuf, {type: 'text/plain'});

 fileWriter.write(blob);

 }, function() {console.log("createWriter error")});

 }, function() {console.log("getFile error")});
 });
 */


// OUTPUT AS A BASE-64 ENCODED STRING:
/*
 // if necessary, trunc the program to the size spec'd in the file header.
 for (var z = 0; z < progSize; z++) {
 outBuf += String.fromCharCode(fbv[z]) || 0;
 }

 if (outBuf) {
 return btoa(outBuf); // returns base64 encoded Propeller image
 } else {
 return null;
 }
 */


