
var parser = require('logcat-parse');

var BLACKLIST_TAGS = [
    "ConnectivityService",
    "PhoneApp",
    "QcrilMsgTunnelSocket",
    "PerformBackupTask",
    "audio_hw_primary",
    "AudioTrack",
    "AudioFlinger",
    "AudioPolicyManagerBase",
    "SurfaceFlinger"
    ];

$.getJSON("https://api.github.com/gists/"+window.location.hash.substring(1), function(gist_info) {
        var files = gist_info["files"];
        for (var file in files) {
            if (files.hasOwnProperty(file)) {
                console.log("using file " + file);
                logcat = parser.parse(files[file]["content"]);
                console.log(logcat);
                var fragment = "";
                var i, len;
                for (i = 0, len = logcat.messages.length; i < len; i++) {
                    var line = logcat.messages[i];
                    if (BLACKLIST_TAGS.indexOf(line.tag.trim()) >= 0) {
                        fragment += "  <div class=\"log\">\n";
                        fragment += "   <span class=\"left-block\">";
                        fragment += "    <span class=\"pid\">" + line.pid     + "</span>\n";
                        fragment += "    <span class=\"tag\">" + line.tag     + "</span>\n";
                        fragment += "    <span class=\"level level-"+line.level+"\">" + line.level   + "</span>\n";
                        fragment += "   </span><span class=\"right-block\">";
                        fragment += "    <span class=\"msg\">" + line.message + "</span>\n";
                        fragment += "   </span>";
                        fragment += "  </div>\n";
                    }
                }
                $("#gist-content").html(fragment);
                return;
            }
        }
    });
