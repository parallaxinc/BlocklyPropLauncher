
function parseFile(payload) {

  var output = null;
  var outBuf = '';
  var fb = atob(payload);
  var fs = str2buf(fb);
  var progSize = 0;

  // detect if it's a ".elf" file:
  if (fs[0] === 0x7F && (fb[1] + fb[2] + fb[3]) === 'ELF' && fs[4] === 1) {
    var fe = fs[5];

    var eh = {
      e_phoff: getValueAt(fs, 0x1C, fe, 4),
      e_shoff: getValueAt(fs, 0x20, fe, 4),
      e_shesz: getValueAt(fs, 0x2E, fe, 2),
      e_shnum: getValueAt(fs, 0x30, fe, 2)
    };

    var sh = [];
    for (var g = 0; g < eh.e_shnum * eh.e_shesz; g += eh.e_shesz) {
      sh.push([
        getValueAt(fs, 0x04 + eh.e_shoff + g, fe, 4),
        getValueAt(fs, 0x0C + eh.e_shoff + g, fe, 4),
        getValueAt(fs, 0x10 + eh.e_shoff + g, fe, 4),
        getValueAt(fs, 0x14 + eh.e_shoff + g, fe, 4)
      ]);

      var k = g / eh.e_shesz;
      if ((sh[k][0] === 1 || sh[k][0] === 8) && sh[k][1] + sh[k][3] + 12 > progSize) {
        progSize = sh[k][1] + sh[k][3] + 12;
      }
    }

    //possibly use this as a check or as the progSize value instead:
    //progSize = getValueAt(fb, 0x9C, fe, 2);
    
    output = new Array(progSize);

    // assemble each program section.
    for (var t = 0; t < sh.length; t++) {
      if (sh[t][0] === 1) {
        var offAddr = sh[t][1];
         // the offset for the second section appears to always 
         // be 0x00 when it should be 0x20.  This corrects for that.
        if (sh[t][2] === 0xB4 && offAddr === 0x00) {
          offAddr = 0x20;
        }
        for (z = 0; z < sh[t][3]; z++) {
          output[z + offAddr] = fs[sh[t][2] + z];
        }
      }
    }
    output[5] = checksumArray(output);
    for (var y = 0; y < progSize; y++) {
      outBuf += String.fromCharCode(output[y]) || 0;
    }
    
    
    if (outBuf) {
      return btoa(outBuf); // returns base64 encoded Propeller image
    } else {
      return null;
    }

  } else { 
    // payload must be a ".binary" or ".eeprom" file
    progSize = getValueAt(fs, 0x08, 1, 2);

    // get the file checksum and verify it, if ok, return the 
    var cs = fs[5];
    fs[5] = 0;
    if (checksumArray(fs, progSize) === cs) {
      fs[5] = cs;
      
      // if necessary, trunc the program to the size spec'd in the file header.
      for (var z = 0; z < progSize; z++) {
        outBuf += String.fromCharCode(fs[z]) || 0;
      }

      if (outBuf) {
        return btoa(outBuf); // returns base64 encoded Propeller image
      } else {
        return null;
      }
    }
  }
}
