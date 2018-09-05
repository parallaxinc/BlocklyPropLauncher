/*
 Notices

 This is a list of notices (messages) generated during the Propeller loading process.  They match the PropLoader message values and meaning as closely as possible.

 A numeric code is prepended to each notice in the format ###-<text_notice>.

 There are three categories of notices and notice codes:

   * Status  - These express state/progress/event information and are given codes 001 through 099.
   * Error   - These express fatal problems and are given codes 100 and beyond.
   * Verbose - These are for seasoned developers. They may express state information or specific deep error information that is usually only helpful to a small
               set of users, thus, they are only shown in debug output. These are all automatically given the code 000.

 Code numbers ARE NEVER REUSED for a condition that means something different than what was first intended by a notice.  When a new Status or Error notice
 is created, it simply takes on the next available code number even if it's logically related to another far away notice.
*/

// Status Notice IDs ("rsvd" are reserved by PropLoader and/or for future use)
//rsvd nsOpeningFile               = 001;
const nsDownloading                = 002;
const nsVerifyingRAM               = 003;
//rsvd nsOpeningFile               = 004;
const nsDownloadSuccessful         = 005;
//rsvd nsTerminalMode              = 006;
//rsvd nsWritingToSDCard           = 007;
//rsvd nsBytesRemaining            = 008;
//rsvd nsBytesSent                 = 009;
//rsvd nsSettingModuleName         = 010;
//rsvd nsUsingAlternatePort        = 011;
//rsvd nsSteppingDownBaudRate      = 012;
//rsvd nsUsingSingleStageLoader    = 013;
const nsVerifyingEEPROM            = 014;

// Error Notice IDs
//rsvd neCanOnlyNameWIFIModules    = 100;
//rsvd neInvalidModuleAddress      = 101;
const neDownloadFailed             = 102;
//rsvd neCantOpenFile              = 103;
const nePropellerNotFound          = 104;
//rsvd neFailedToEnterTerminalMode = 105;
//rsvd neWrongWIFIModuleFirmware   = 106;
//rsvd neFailedToWriteToSDCard     = 107;
//rsvd neInvalidModuleName         = 108;
//rsvd neFailedToSetModuleName     = 109;
//rsvd neFileTruncated             = 110;
//rsvd neFileCorrupted             = 111;
//rsvd neCantReadPropellerAppFile  = 112;
//rsvd neWIFIModuleDiscoveryFailed = 113;
//rsvd neNoWIFIModulesFound        = 114;
//rsvd neSerialPortDiscoveryFailed = 115;
//rsvd neNoSerialPortsFound        = 116;
const neCanNotOpenPort             = 117;
//rsvd neCanNotConnectToModule     = 118;
const neCanNotSetBaudrate          = 119;
//rsvd neInternalCodeError         = 120;
//rsvd neInsufficientMemory        = 121;
//rsvd neNoResetMethod             = 122;
//rsvd neResetFailed               = 123;
const neUnknownPropellerVersion    = 124;
const neRAMChecksumFailed          = 125;
//rsvd neEEPROMChecksumFailed      = 126;
const neEEPROMVerifyFailed         = 127;
const neCommunicationLost          = 128;
const neLoaderFailed               = 129;
const neCanNotFindPort             = 130;
const neCanNotClosePort            = 131;
const neCommunicationFailed        = 199;

// Notices, by ID
notices = {
    [nsDownloading]                : "Downloading",
    [nsVerifyingRAM]               : "Verifying RAM",
    [nsDownloadSuccessful]         : "Download successful!",
    [nsVerifyingEEPROM]            : "Programming and verifying EEPROM",
    [neDownloadFailed]             : "Download failed!",
    [nePropellerNotFound]          : "Propeller not found",
    [neCanNotOpenPort]             : "Can not open port %s",
    [neCanNotSetBaudrate]          : "Can not set port %s to baudrate %s",
    [neUnknownPropellerVersion]    : "Found Propeller version %d - expected version 1",
    [neRAMChecksumFailed]          : "RAM checksum failed",
    [neEEPROMVerifyFailed]         : "EEPROM verify failed",
    [neCommunicationLost]          : "Communication lost",    /*No response*/
    [neLoaderFailed]               : "Loader failed",         /*Response invalid*/
    [neCanNotFindPort]             : "Can not find port %s",  /*Requested port not found in ports list*/
    [neCanNotClosePort]            : "Can not close port %s", /*Requested port can not be closed*/
    [neCommunicationFailed]        : "Communication failed"   /*Response unexpected*/
};

function notice(noticeId = 0, values = []) {
    /* Notice (message) retriever.  Returns textual message indicated by the noticeId, inserts the optional values into it, and prepends with the noticeId value
       in the form ###-<message>.
     noticeId is the identifier of the notice; ex: nsDownloading.
     values is an optional array of values to stuff into notice, or if noticeId = 0, is a custom message.*/
    //Retrieve notice; if defined
    nMsg = notices[noticeId];
    //Fill in variables if needed; if notice undefined, use first values element as notice.
    values.forEach(function(x){nMsg = (nMsg) ? nMsg.replace(/%s/, x) : x;});
    if (noticeId >= 100) {nMsg = "Error: " + nMsg;}
    noticeId = "000" + noticeId;
    nMsg = noticeId.substr(noticeId.length-3) + '-' + nMsg;
    return nMsg;
}

function noticeCode(msg) {
    /*Extracts and returns notice code from msg formatted in the form ###-<message>.  Returns "000" if none.*/
    return Number((results = msg.match(/[0-9]+/)) ? results[0] : "000");
}
