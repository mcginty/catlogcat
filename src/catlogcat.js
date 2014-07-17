
var parser = require('logcat-parse');

var GIST_ID_PATTERN = /^[0-9a-f]+$/i
var BLACKLIST_TAGS = [
 /*   "ConnectivityService",
    "PhoneApp",
    "QcrilMsgTunnelSocket",
    "PerformBackupTask",
    "audio_hw_primary",
    "AudioTrack",
    "AudioFlinger",
    "AudioPolicyManagerBase",
    "SurfaceFlinger"*/
    ];

var $content = $("#gist-content");

var loadGist = function(gistId) {
    console.log("attempting to load gist with id " + gistId);
    $content.html("Loading...");
    if (!GIST_ID_PATTERN.test(gistId)) {
        $content.text("Not a valid gist id.");
        return;
    }
    $.getJSON("https://api.github.com/gists/"+gistId, function(gist_info) {
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
                        if (BLACKLIST_TAGS.indexOf(line.tag.trim()) < 0) {
                            fragment += "  <div class=\"log\">\n";
                            fragment += "   <span class=\"left-block\">";
                            fragment += "    <span class=\"tag\">" + line.tag + "</span>\n";
                            fragment += "    <span class=\"level level-"+line.level+"\">" + line.level + "</span>\n";
                            fragment += "   </span><span class=\"right-block\">";
                            fragment += "    <span class=\"msg\">" + line.message + "</span>\n";
                            fragment += "   </span>";
                            fragment += "  </div>\n";
                        }
                    }
                    $content.html(fragment);
                    return;
                }
            }
        })
        .fail(function() {
            $content.text("Couldn't load the gist, sorry.");
        });
};

var loadHashGist = function() { loadGist($.url().attr('fragment')); };
$(window).on('hashchange', loadHashGist);
loadHashGist();
