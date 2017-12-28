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

// Status Notice IDs
const nsDownloading                = 002;
const nsDownloadSuccessful         = 005;

// Error Notice IDs
const neDownloadFailed             = 102;
const nePropellerNotFound          = 104;
const neCanNotOpenPort             = 117;
const neCanNotSetBaudrate          = 119;
const neCanNotDeliverLoader        = 123;
const neUnknownPropellerVersion    = 124;
const nePropellerCommunicationLost = 128;
const neLoaderFailed               = 129;

// Notices, by ID
notices = {
    [nsDownloading]                : "Downloading",
    [nsDownloadSuccessful]         : "Download successful.",
    [neDownloadFailed]             : "Download failed.",
    [nePropellerNotFound]          : "Propeller not found.",
    [neCanNotOpenPort]             : "Can not open port %s.",
    [neCanNotSetBaudrate]          : "Can not set port %s to baudrate %s.",
    [neCanNotDeliverLoader]        : "Unable to deliver loader.",
    [neUnknownPropellerVersion]    : "Found Propeller version %d - expected version 1.",
    [nePropellerCommunicationLost] : "Propeller communication lost while delivering loader.",
    [neLoaderFailed]               : "Loader failed."
};

function notice(noticeId = 0, values = []) {
    /* Notice (message) retriever.  Returns textual message indicated by the noticeId, inserts the optional values into it, and prepends with the noticeId value
       in the form ###-<message>.
     noticeId is the identifier of the notice; ex: nsDownloading.
     values is an optional array of values to stuff into notice.*/
    //Retrieve notice; if undefined,
    nMsg = notices[noticeId];
    //Fill in variables if needed; if notice undefined, use first values element as notice.
    values.forEach(function(x){nMsg = (nMsg) ? nMsg.replace(/%s/, x) : x;});
    if (noticeId >= 100) {nMsg = "Error: " + nMsg;}
    noticeId = "000" + noticeId;
    nMsg = noticeId.substr(noticeId.length-3) + '-' + nMsg;
    return nMsg;
}
